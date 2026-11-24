import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { venueDealMutations, viewVenueDeal, acceptVenueDeal } from './venueDeals';
import { venueAvails } from './inquiries';
import { operator } from './operators';
import { runHoldCommand } from './calendar';
import { checkedClient } from '../lib/transaction';
import { canonicalDigest, createProof, digest, ticketToken } from '../lib/guest-proof';
import { transferTicket } from './checkout';
import { storeDocument, readDocument } from '../lib/documents';
import { issueDoorSale, issueComp } from './doorSales';
import { createHold } from './inventory';
import { verifyProof } from '../lib/guest-proof';

/**
 * Venue deals, bar totals, promoter payments and the promoter settlement, run as the real resolvers against a migrated
 * Postgres schema named by VENUE_TEST_DATABASE_URL (scratch database, schema `dbtest`). Skipped without it, never faked.
 */
// Link and ticket secrets are HMACs under SESSION_SECRET, as on a live deployment; a run without one gets a fresh random secret.
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
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

suite('no link or ticket secret is written to the idempotency table: deal link, transfer, door sale, comp and hold proof', async () => {
  const { eventId } = await bookedRental(ahead(75));
  const draft = await m('saveVenueDeal', { eventId, data: { dealType: 'rental', rentMode: 'flat', rentCents: 200000 } });
  const sendKey = key();
  const sent = await venueDealMutations.sendVenueDeal(null, { input: { idempotencyKey: sendKey, dealId: draft.id } }, staff);
  const token = sent.path.split('/').pop()!;
  assert.ok(token.length >= 32);
  const stored = await prisma.idempotencyKey.findUnique({ where: { idempotencyKey: sendKey } });
  assert.ok(stored, 'the send is recorded for replay');
  assert.ok(!JSON.stringify(stored).includes(token), 'the deal link token is not in IdempotencyKey');
  const again = await venueDealMutations.sendVenueDeal(null, { input: { idempotencyKey: sendKey, dealId: draft.id } }, staff);
  assert.equal(again.path, sent.path, 'a replay rebuilds the same link');
  assert.equal((await viewVenueDeal(null, { token }, guest))?.version, 1);

  const order = await prisma.ticketOrder.create({ data: { eventId, status: 'paid', guestEmail: 'buyer@example.com', guestName: 'Buyer', orderNumber: `VT-${Date.now()}` } as any });
  const code = `TK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  await prisma.ticket.create({ data: { orderId: order.id, eventId, ticketCode: code, tokenHash: digest(ticketToken(code)), status: 'valid' } as any });
  const moveKey = key();
  const moved = await transferTicket(null, { input: { ticketCode: code, orderId: order.id, proof: createProof(order.id), toEmail: 'friend@example.com', toName: 'Friend', idempotencyKey: moveKey } }, guest);
  assert.equal(moved.token, ticketToken(moved.ticketCode));
  const fresh = await prisma.ticket.findUnique({ where: { ticketCode: moved.ticketCode } });
  assert.equal(fresh?.tokenHash, digest(moved.token));
  const row = await prisma.idempotencyKey.findUnique({ where: { idempotencyKey: moveKey } });
  assert.ok(row && !JSON.stringify(row).includes(moved.token), 'the new ticket token is not in IdempotencyKey');
  // Door sale, comp and online hold: the reply carries the QR tokens and the hold proof; the stored reply carries none.
  const box: any = ctxFor((await prisma.user.create({ data: { name: 'Box office', email: `box-${Date.now()}@example.com`, password: 'x' } })).id);
  box.session.data.role = { ...ALL, canManageOrders: true };
  const room = (await prisma.event.findUnique({ where: { id: eventId }, select: { roomId: true } }))!.roomId!;
  await prisma.room.update({ where: { id: room }, data: { capacity: 500 } });
  const section = await prisma.chartSection.create({ data: { name: 'Floor', kind: 'ga', capacity: 300, chart: { connect: { id: (await prisma.event.findUnique({ where: { id: eventId } }))!.seatingChartId! } } } });
  const level = await prisma.priceLevel.create({ data: { eventId, name: 'GA', priceCents: 3000, feeCents: 0, facilityFeeCents: 0, capacity: 300, status: 'active', perOrderLimit: 8, sections: { connect: [{ id: section.id }] } } as any });
  await prisma.event.update({ where: { id: eventId }, data: { status: 'on_sale' } });
  for (const [issueFn, extra] of [[issueDoorSale, { tender: { kind: 'card_external', reference: 'TERM-4471' } }], [issueComp, { reason: 'Artist guest' }]] as const) {
    const k = key();
    const r: any = await (issueFn as any)(null, { input: { idempotencyKey: k, eventId, levelId: level.id, qty: 2, name: 'Walk Up', ...extra } }, box);
    assert.equal(r.tickets.length, 2);
    for (const t of r.tickets) assert.equal(t.token, ticketToken(t.ticketCode));
    const stored = JSON.stringify(await prisma.idempotencyKey.findUnique({ where: { idempotencyKey: k } }));
    assert.ok(r.tickets.every((t: any) => stored.includes(t.ticketCode) && !stored.includes(t.token)), 'codes kept, QR tokens not stored');
    const again: any = await (issueFn as any)(null, { input: { idempotencyKey: k, eventId, levelId: level.id, qty: 2, name: 'Walk Up', ...extra } }, box);
    assert.deepEqual(again.tickets.map((t: any) => t.token), r.tickets.map((t: any) => t.token), 'a replay rebuilds the same tokens');
  }
  const holdKey = key();
  const hold: any = await createHold(null, { idempotencyKey: holdKey, eventId, levelId: level.id, qty: 1 }, guest);
  assert.ok(verifyProof(hold.proof, hold.id));
  assert.ok(!JSON.stringify(await prisma.idempotencyKey.findUnique({ where: { idempotencyKey: holdKey } })).includes(hold.proof), 'the hold proof is not stored');
});

suite('documents are stored in the database: a POS report uploads and reads back with no storage service set up', async () => {
  for (const k of ['S3_BUCKET_NAME', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT']) delete process.env[k];
  const { eventId } = await bookedRental(ahead(80));
  const bytes = new TextEncoder().encode('Item,Qty,Net\nDraft lager,410,2870.00\n');
  const doc = await storeDocument(prisma, staff.session.itemId, { bytes, filename: '../../etc/pos report.csv', mimeType: 'text/csv', kind: 'pos_report', title: 'POS close', eventId });
  assert.equal(doc.filename, 'pos report.csv', 'no path survives in the name');
  assert.equal(doc.sizeBytes, bytes.byteLength);
  const back = await readDocument(prisma, doc.id);
  assert.equal(Buffer.compare(back!.bytes, Buffer.from(bytes)), 0);
  await assert.rejects(storeDocument(prisma, staff.session.itemId, { bytes: new Uint8Array(0), filename: 'x.csv' }), /empty/);
  await assert.rejects(storeDocument(prisma, staff.session.itemId, { bytes: new Uint8Array(10 * 1024 * 1024 + 1), filename: 'big.pdf' }), /10 MB/);
  const bar = await m('recordBarSales', { eventId, data: { grossCents: 300000, compsCents: 5000, voidsCents: 2000, taxCents: 0, reportId: doc.id } });
  const row = await prisma.barSales.findFirst({ where: { eventId }, include: { report: true } });
  assert.equal(row?.report?.id, doc.id); assert.equal(row?.netCents, 293000); assert.ok(bar);
  assert.equal(await prisma.auditEvent.count({ where: { targetList: 'Document', targetId: doc.id, action: 'document.uploaded' } }), 1);
});
