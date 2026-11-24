import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { venueDealMutations, viewVenueDeal, acceptVenueDeal } from './venueDeals';
import { venueAvails } from './inquiries';
import { operator } from './operators';
import { runHoldCommand } from './calendar';
import { checkedClient } from '../lib/transaction';
import { canonicalDigest } from '../lib/guest-proof';

/**
 * Venue deals, bar totals, promoter payments and the promoter settlement, run as the real resolvers against a migrated
 * Postgres schema named by VENUE_TEST_DATABASE_URL (scratch database, schema `dbtest`). Skipped without it, never faked.
 */
const url = process.env.VENUE_TEST_DATABASE_URL || '';
const enabled = /^postgres(ql)?:\/\//.test(url) && /[?&]schema=dbtest\b/.test(url);
const suite = enabled ? test : test.skip;
let prisma: PrismaClient;
let staff: any, other: any, guest: any;
const ALL = { canManageEvents: true, canManageVenueDeals: true, canManageSettlements: true, canManageContacts: true };
const ctxFor = (id: string | null) => ({ prisma, session: id ? { itemId: id, data: { role: ALL } } : undefined, sudo: () => ({ prisma }) });
const key = () => randomUUID();
const m = (name: keyof typeof venueDealMutations, input: any, ctx = staff) => venueDealMutations[name](null, { input: { idempotencyKey: key(), ...input } }, ctx);

before(async () => {
  if (!enabled) return;
  prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  const mk = async (n: string) => (await prisma.user.create({ data: { name: n, email: `${n.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'x' } })).id;
  staff = ctxFor(await mk('Settler')); other = ctxFor(await mk('Countersigner')); guest = ctxFor(null);
});
after(async () => { if (enabled) await prisma.$disconnect(); });

async function bookedRental(day: string, time = '20:00') {
  const room = await prisma.room.create({ data: { name: `Hall ${Math.random().toString(36).slice(2, 8)}`, city: 'Los Angeles', timezone: 'America/Los_Angeles' } });
  const chart = await prisma.seatingChart.create({ data: { name: 'Standing', roomId: room.id, status: 'published', version: 1 } });
  const promoter = await prisma.promoter.create({ data: { company: `Lantern Live ${Math.random().toString(36).slice(2, 6)}`, email: 'book@lantern.example' } });
  const hold = await prisma.$transaction(raw => runHoldCommand('placeDateHold', checkedClient(raw), { roomId: room.id, date: day, rank: 1, kind: 'rental', promoterId: promoter.id }, staff.session.itemId));
  const done = await prisma.$transaction(raw => runHoldCommand('confirmHold', checkedClient(raw), { holdId: hold.id, title: 'Rental night', seatingChartId: chart.id, doorsTime: '19:00', showTime: time }, staff.session.itemId));
  return { room, promoter, eventId: done.eventId as string };
}
const ahead = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

suite('avails: an 8 pm Los Angeles show marks only its own local day booked', async () => {
  // Pick the next 24 December so the date is always in the future.
  const y = new Date().getUTCMonth() === 11 && new Date().getUTCDate() >= 20 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear();
  const day = `${y}-12-24`;
  const { room, eventId } = await bookedRental(day);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  assert.equal(event?.showAt?.toISOString().slice(0, 10), `${y}-12-25`, 'stored instant is the next day in UTC');
  const avails = await venueAvails(null, { from: `${y}-12-23`, to: `${y}-12-26`, roomId: room.id }, guest);
  assert.deepEqual(avails.map((d: any) => [d.date, d.state]), [[`${y}-12-23`, 'open'], [`${y}-12-24`, 'booked'], [`${y}-12-25`, 'open'], [`${y}-12-26`, 'open']]);
  // The event's promoter is the Promoter on the hold; the staff user is bookedBy.
  assert.ok(event?.promoterId && event.promoterId !== staff.session.itemId);
  assert.equal(event?.bookedById, staff.session.itemId);
});

suite('deal versions: a sent deal is frozen with its hash, a revision supersedes it, and the old link cannot accept', async () => {
  const { promoter, eventId } = await bookedRental(ahead(70));
  const v1 = await m('saveVenueDeal', { eventId, data: { dealType: 'rental', rentMode: 'versus', rentCents: 300000, rentPercentBps: 1500, depositCents: 100000 } });
  assert.equal(v1.version, 1);
  await assert.rejects(m('saveVenueDeal', { eventId, promoterId: (await prisma.promoter.create({ data: { company: 'Someone Else' } })).id, data: {} }), /promoter on the booked date/);
  const sent = await m('sendVenueDeal', { dealId: v1.id });
  const token1 = sent.path.split('/').pop();
  const row = await prisma.venueDeal.findUnique({ where: { id: v1.id } });
  assert.equal(row?.status, 'sent'); assert.equal(row?.termsHash, canonicalDigest(row?.terms)); assert.equal(row?.promoterId, promoter.id);
  assert.notEqual(row?.publicTokenHash, token1, 'only the digest is stored');
  const view = await viewVenueDeal(null, { token: token1 }, guest);
  assert.equal(view.terms.rentCents, 300000); assert.equal(view.termsHash, sent.termsHash);
  // Editing a sent deal makes version 2; the version 1 link dies.
  const v2 = await m('saveVenueDeal', { dealId: v1.id, data: { dealType: 'rental', rentMode: 'flat', rentCents: 350000 }, reason: 'Promoter asked for flat rent' });
  assert.equal(v2.version, 2);
  assert.equal((await prisma.venueDeal.findUnique({ where: { id: v1.id } }))?.status, 'superseded');
  await assert.rejects(acceptVenueDeal(null, { token: token1, name: 'Pat Promoter', idempotencyKey: key() }, guest), /no longer valid/);
  const sent2 = await m('sendVenueDeal', { dealId: v2.id });
  const token2 = sent2.path.split('/').pop();
  await assert.rejects(acceptVenueDeal(null, { token: token2, name: 'Pat Promoter', termsHash: sent.termsHash, idempotencyKey: key() }, guest), /changed after you opened/);
  await assert.rejects(acceptVenueDeal(null, { token: token2, name: 'P', idempotencyKey: key() }, guest), /full name/);
  const ok = await acceptVenueDeal(null, { token: token2, name: 'Pat Promoter', termsHash: sent2.termsHash, idempotencyKey: key() }, guest);
  assert.equal(ok.status, 'accepted');
  await assert.rejects(m('sendVenueDeal', { dealId: v2.id }), /accepted/);
  // The database itself refuses a second live deal for the event.
  await assert.rejects(prisma.venueDeal.create({ data: { eventId, version: 9, status: 'draft' } }), /VenueDeal_one_live_per_event|Unique constraint/);
});

suite('promoter settlement: lines sum to the balance, a signed statement is frozen, and paying it settles the deal', async () => {
  const { eventId } = await bookedRental(ahead(80));
  const deal = await m('saveVenueDeal', { eventId, data: {
    dealType: 'rental', rentMode: 'flat', rentCents: 250000, depositCents: 50000, barMode: 'guarantee', barGuaranteeCents: 500000, issuer: 'other', facilityFeeCents: 150,
    houseExpenses: [{ label: 'Cleaning', category: 'cleaning', basis: 'flat', amountCents: 30000 }],
  } });
  const sent = await m('sendVenueDeal', { dealId: deal.id });
  await acceptVenueDeal(null, { token: sent.path.split('/').pop(), name: 'Pat Promoter', termsHash: sent.termsHash, idempotencyKey: key() }, guest);
  await m('recordPromoterPayment', { dealId: deal.id, data: { kind: 'deposit', direction: 'in', amountCents: 50000, method: 'transfer', reference: 'WIRE-001' } });
  await assert.rejects(m('recordPromoterPayment', { dealId: deal.id, data: { kind: 'deposit', amountCents: 1, method: 'transfer', reference: 'WIRE-002' } }), /more than the agreed deposit/);
  await assert.rejects(m('buildPromoterSettlement', { eventId }), /show must be over/);
  await prisma.event.update({ where: { id: eventId }, data: { status: 'completed' } });
  await m('recordBarSales', { eventId, data: { grossCents: 450000, compsCents: 30000, voidsCents: 10000, taxCents: 30000 } }); // net $3,800
  await assert.rejects(m('buildPromoterSettlement', { eventId, data: { ticketsSold: 400 } }), /Attach the promoter ticket statement/);
  const doc = await prisma.document.create({ data: { title: 'Seller statement', kind: 'promoter_statement', eventId } });
  const built = await m('buildPromoterSettlement', { eventId, data: { statementId: doc.id, ticketsSold: 400, ticketGrossCents: 1200000 } });
  // $600 facility fees + $300 cleaning + $2,500 rent + $1,200 bar shortfall − $500 deposit = $4,100 owed by the promoter.
  assert.equal(built.balanceCents, 410000);
  const lines = await prisma.settlementLine.findMany({ where: { settlementId: built.id } });
  assert.equal(lines.reduce((n, l) => n + (l.amountCents || 0), 0), built.balanceCents);
  assert.equal(lines.find(l => l.kind === 'bar_guarantee_shortfall')?.amountCents, 120000);
  assert.ok(lines.every(l => l.rule));
  const sign = (ctx: any) => operator('signSettlement')(null, { input: { idempotencyKey: key(), settlementId: built.id } }, ctx);
  await sign(staff); await sign(staff); // reviewed, then signed by the promoter's side
  await assert.rejects(sign(staff), /different user/);
  assert.equal((await sign(other)).status, 'final');
  await assert.rejects(m('recordBarSales', { eventId, data: { grossCents: 1 } }), /frozen/);
  await assert.rejects(m('buildPromoterSettlement', { eventId, data: { statementId: doc.id } }), /signed/);
  await assert.rejects(m('recordPromoterPayment', { dealId: deal.id, data: { kind: 'payout', direction: 'out', amountCents: 100, method: 'cash', reference: 'C-1' } }), /wrong direction/);
  const paid = await m('recordPromoterPayment', { dealId: deal.id, data: { kind: 'balance', direction: 'in', amountCents: 410000, method: 'transfer', reference: 'WIRE-003' } });
  assert.equal(paid.remainingCents, 0);
  assert.equal((await prisma.venueDeal.findUnique({ where: { id: deal.id } }))?.status, 'settled');
  assert.equal((await prisma.event.findUnique({ where: { id: eventId } }))?.status, 'settled');
  const view = await viewVenueDeal(null, { token: sent.path.split('/').pop() }, guest);
  assert.ok((view.settlement?.lines.length || 0) > 0);
});
