import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { runHoldCommand } from './calendar';
import { checkedClient } from '../lib/transaction';
import { issueDoorSale, issueComp } from './doorSales';
import { transferTicket } from './checkout';
import { scanAtDoor, admitWillCall, addGuestListEntry, admitGuestListEntry, removeGuestListEntry, importExternalTickets, voidExternalTicket, doorSearch, eventIssued } from './door';
import { createProof, ticketToken } from '../lib/guest-proof';
import { publicHostPolicy, AddressRefused } from '../lib/sibling-http';
import { putSecret, getSecret, secretKey, SecretUnreadable } from '../lib/secret-box';
import { refreshSecretName } from '../lib/channel-client';
import { startConnection } from '../lib/channel-connect';

/**
 * §10 tests 9, 10, 11, 13, 14 and 15: the door's real resolvers against a migrated Postgres schema named by
 * VENUE_TEST_DATABASE_URL (scratch database, schema `dbtest`). Skipped without it, never faked. Test 12 (a real
 * Openfront Concerts) is in door.sibling.test.ts.
 */
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
const url = process.env.VENUE_TEST_DATABASE_URL || '';
const enabled = /^postgres(ql)?:\/\//.test(url) && /[?&]schema=dbtest\b/.test(url);
const suite = enabled ? test : test.skip;
let prisma: PrismaClient;
let door: any;
const ROLE = { canAccessDashboard: true, canManageEvents: true, canManageOrders: true, canScanTickets: true, canManageConnections: true };
const key = () => randomUUID();

before(async () => {
  if (!enabled) return;
  prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  const id = (await prisma.user.create({ data: { name: 'Door', email: `door-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'x' } })).id;
  door = { prisma, session: { itemId: id, data: { role: ROLE } }, sudo: () => ({ prisma }) };
});
after(async () => { if (enabled) await prisma.$disconnect(); });

let dayOffset = 400 + Math.floor(Math.random() * 300);
/** A booked night at doors with a 2-section GA configuration, and a GA price level. */
async function nightAtDoors(opts: { capacity?: number; allowReentry?: boolean } = {}) {
  const room = await prisma.room.create({ data: { name: `Room ${Math.random().toString(36).slice(2, 8)}`, city: 'Chicago', timezone: 'America/Chicago', capacity: opts.capacity ?? 500 } });
  const chart = await prisma.seatingChart.create({ data: { name: 'Standing', roomId: room.id, status: 'published', version: 1 } });
  const section = await prisma.chartSection.create({ data: { name: 'Floor', kind: 'ga', capacity: opts.capacity ?? 500, chartId: chart.id } });
  const promoter = await prisma.promoter.create({ data: { company: `Lantern Live ${Math.random().toString(36).slice(2, 6)}`, email: 'book@lantern.example' } });
  const day = new Date(Date.now() + (dayOffset++) * 86400000).toISOString().slice(0, 10);
  const hold = await prisma.$transaction(raw => runHoldCommand('placeDateHold', checkedClient(raw), { roomId: room.id, date: day, rank: 1, kind: 'rental', promoterId: promoter.id }, door.session.itemId));
  const done = await prisma.$transaction(raw => runHoldCommand('confirmHold', checkedClient(raw), { holdId: hold.id, title: 'Door night', seatingChartId: chart.id, doorsTime: '19:00', showTime: '20:00' }, door.session.itemId));
  const eventId = done.eventId as string;
  const level = await prisma.priceLevel.create({ data: { eventId, name: 'GA', priceCents: 2500, feeCents: 0, facilityFeeCents: 0, capacity: opts.capacity ?? 500, status: 'active', perOrderLimit: 8, sections: { connect: [{ id: section.id }] } } as any });
  await prisma.event.update({ where: { id: eventId }, data: { status: 'doors', allowReentry: !!opts.allowReentry } });
  return { eventId, levelId: level.id, roomId: room.id };
}
const sell = async (eventId: string, levelId: string, qty: number, comp = false) =>
  (comp ? issueComp : issueDoorSale)(null, { input: { idempotencyKey: key(), eventId, levelId, qty, name: 'Walk Up', ...(comp ? { reason: 'Artist guest' } : { tender: { kind: 'card_external', reference: 'TERM-4471' } }) } }, door) as Promise<any>;
const scan = (eventId: string, code: string, k = key()) => scanAtDoor(door, { idempotencyKey: k, eventId, code, gate: 'Main' }, publicHostPolicy);

suite('9. own tickets: one admission, re-entry only when allowed, wrong event, void after refund, transfer voids the old code', async () => {
  const a = await nightAtDoors();
  const b = await nightAtDoors({ allowReentry: true });
  const sale = await sell(a.eventId, a.levelId, 3);
  const [t1, t2, t3] = sale.tickets;
  assert.equal((await scan(a.eventId, t1.token)).result, 'admitted', 'QR secret admits');
  assert.equal((await scan(a.eventId, t1.ticketCode)).result, 'duplicate', 'second scan of the same ticket');
  assert.equal((await scan(b.eventId, t2.ticketCode)).result, 'wrong_event');
  await prisma.ticket.updateMany({ where: { ticketCode: t3.ticketCode }, data: { status: 'refunded' } });
  assert.equal((await scan(a.eventId, t3.ticketCode)).result, 'void', 'refunded ticket refuses');
  const re = (await sell(b.eventId, b.levelId, 1)).tickets[0];
  assert.equal((await scan(b.eventId, re.ticketCode)).result, 'admitted');
  assert.equal((await scan(b.eventId, re.ticketCode)).result, 'reentry', 're-entry setting on');
  // Transfer: the old code is void, the new one admits.
  const order = await prisma.ticket.findUnique({ where: { ticketCode: t2.ticketCode }, select: { orderId: true } });
  const moved: any = await transferTicket(null, { input: { ticketCode: t2.ticketCode, orderId: order!.orderId, proof: createProof(order!.orderId!), toEmail: 'friend@example.com', toName: 'Friend', idempotencyKey: key() } }, { ...door, session: undefined });
  assert.equal((await scan(a.eventId, t2.ticketCode)).result, 'void');
  assert.equal((await scan(a.eventId, moved.token)).result, 'admitted');
  // A replay of the same scan key returns the stored answer, and the stored record has no ticket secret.
  const k = key();
  const first = await scan(a.eventId, (await sell(a.eventId, a.levelId, 1)).tickets[0].token, k);
  const row = await prisma.idempotencyKey.findUnique({ where: { idempotencyKey: k } });
  assert.ok(!JSON.stringify(row).includes(ticketToken(String((await prisma.scanEvent.findUnique({ where: { id: first.id }, include: { ticket: true } }))!.ticket!.ticketCode))));
  // Unknown codes are logged as not_found, never admitted.
  assert.equal((await scan(a.eventId, 'TK-NOPE0000')).result, 'not_found');
  assert.equal(await prisma.scanEvent.count({ where: { eventId: a.eventId, result: 'admitted' } }), 3);
});

suite('10. outside tickets: a repeat import adds nothing, a barcode admits once, void refuses, another event says not found, no raw barcode stored', async () => {
  const a = await nightAtDoors();
  const b = await nightAtDoors();
  await prisma.event.update({ where: { id: a.eventId }, data: { issuer: 'other', externalSellerName: 'Dice' } });
  const csv = 'Barcode,Name,Ticket Type,Status\nDICE-5501-AAAA,Ann Lee,GA,valid\nDICE-5502-BBBB,Bo Chen,GA,valid\nDICE-5503-CCCC,Cy Diaz,VIP,valid\n';
  const first: any = await importExternalTickets(null, { input: { idempotencyKey: key(), eventId: a.eventId, sellerName: 'Dice', csv } }, door);
  assert.deepEqual([first.added, first.alreadyImported], [3, 0]);
  const again: any = await importExternalTickets(null, { input: { idempotencyKey: key(), eventId: a.eventId, sellerName: 'Dice', csv: csv + 'DICE-5504-DDDD,Dee,GA,valid\n' } }, door);
  assert.deepEqual([again.added, again.alreadyImported], [1, 3], 'a repeat import adds only the new barcode');
  assert.equal(await prisma.externalTicket.count({ where: { eventId: a.eventId } }), 4);
  // Another seller's night: the venue does not sell the room twice; it can still comp a house guest.
  await assert.rejects(sell(a.eventId, a.levelId, 1), /sold by Dice/);
  assert.equal((await sell(a.eventId, a.levelId, 1, true)).tickets.length, 1);
  assert.equal((await scan(a.eventId, 'dice 5501 aaaa')).result, 'admitted', 'matched by hash after normalising');
  assert.equal((await scan(a.eventId, 'DICE-5501-AAAA')).result, 'duplicate');
  const bo = await prisma.externalTicket.findFirst({ where: { eventId: a.eventId, holderName: 'Bo Chen' } });
  await voidExternalTicket(null, { input: { idempotencyKey: key(), externalTicketId: bo!.id, reason: 'Refunded at Dice' } }, door);
  assert.equal((await scan(a.eventId, 'DICE-5502-BBBB')).result, 'void');
  // A later export with a status column voids a barcode imported before.
  const third: any = await importExternalTickets(null, { input: { idempotencyKey: key(), eventId: a.eventId, sellerName: 'Dice', csv: 'Barcode,Status\nDICE-5503-CCCC,Cancelled\n' } }, door);
  assert.equal(third.voided, 1);
  assert.equal((await scan(a.eventId, 'DICE-5503-CCCC')).result, 'void');
  assert.equal((await scan(b.eventId, 'DICE-5504-DDDD')).result, 'not_found', 'another event’s barcode');
  // Nothing anywhere holds a raw barcode.
  const dump = JSON.stringify([await prisma.externalTicket.findMany({ where: { eventId: a.eventId } }), await prisma.externalTicketBatch.findMany({ where: { eventId: a.eventId } }), await prisma.scanEvent.findMany({ where: { eventId: { in: [a.eventId, b.eventId] } } }), await prisma.idempotencyKey.findMany({ where: { requestPath: { in: ['importExternalTickets', 'scanTicket'] } }, orderBy: { createdAt: 'desc' }, take: 40 }), await prisma.auditEvent.findMany({ where: { targetList: 'ExternalTicketBatch' }, orderBy: { createdAt: 'desc' }, take: 5 })]);
  for (const raw of ['DICE-5501-AAAA', 'DICE5501AAAA', 'DICE-5504-DDDD', 'DICE5504DDDD', 'dice 5501 aaaa']) assert.ok(!dump.includes(raw), `${raw} is not stored`);
  // Will-call finds an imported ticket by name and admits it with ID checked.
  const found: any = await doorSearch(null, { eventId: a.eventId, term: 'dee' }, door);
  assert.equal(found.found.external.length, 1);
  await assert.rejects(admitWillCall(null, { input: { idempotencyKey: key(), externalTicketId: found.found.external[0].id } }, door), /ID/);
  const wc: any = await admitWillCall(null, { input: { idempotencyKey: key(), externalTicketId: found.found.external[0].id, idChecked: true } }, door);
  assert.equal(wc.result, 'admitted'); assert.equal(wc.source, 'will_call');
});

suite('11. guest list: an entry with 2 plus-ones admits 3 and refuses the 4th', async () => {
  const a = await nightAtDoors();
  const entry: any = await addGuestListEntry(null, { input: { idempotencyKey: key(), eventId: a.eventId, name: 'Mara Quinn', plusOnes: 2, addedFor: 'artist' } }, door);
  assert.equal(entry.places, 3);
  const admit = (quantity: number) => admitGuestListEntry(null, { input: { idempotencyKey: key(), guestListEntryId: entry.id, quantity } }, door) as Promise<any>;
  assert.equal((await admit(1)).result, 'admitted');
  assert.equal((await admit(2)).result, 'admitted');
  const fourth = await admit(1);
  assert.equal(fourth.result, 'duplicate'); assert.match(fourth.message, /All 3 places/);
  const row = await prisma.guestListEntry.findUnique({ where: { id: entry.id } });
  assert.equal(row!.admittedCount, 3);
  assert.equal((await prisma.scanEvent.aggregate({ where: { guestListEntryId: entry.id, result: 'admitted' }, _sum: { places: true } }))._sum.places, 3);
  await assert.rejects(removeGuestListEntry(null, { input: { idempotencyKey: key(), guestListEntryId: entry.id, reason: 'x' } }, door), /already in/);
  // The database refuses more admissions than places, whatever the caller.
  await assert.rejects(prisma.guestListEntry.update({ where: { id: entry.id }, data: { admittedCount: 4 } }), /venue_guest_list_valid/);
});

suite('13. connected issuer failure: an unreachable host gives issuer_unreachable and no admission; a private-address URL is refused at connect time', async () => {
  const a = await nightAtDoors();
  // A connection whose deployment cannot be reached (the .invalid TLD never resolves), with the product's public-host policy.
  const conn = await prisma.channelConnection.create({ data: { kind: 'openfront_concerts', baseUrl: 'https://venue-sibling.invalid', issuer: 'https://venue-sibling.invalid', clientId: 'mcp_cl_x', status: 'connected', connectedAt: new Date() } });
  await putSecret(prisma, refreshSecretName(conn.id), `mcp_rt_${randomBytes(24).toString('base64url')}`);
  await prisma.event.update({ where: { id: a.eventId }, data: { issuer: 'openfront_concerts', connectionId: conn.id, externalEventId: 'evt_remote_1', externalSellerName: 'Lantern Live' } });
  const r: any = await scan(a.eventId, 'TK-REMOTE0001');
  assert.equal(r.result, 'issuer_unreachable'); assert.equal(r.source, 'connected'); assert.match(r.message, /not answering/);
  assert.equal(await prisma.scanEvent.count({ where: { eventId: a.eventId, result: 'admitted' } }), 0);
  // The database itself refuses a connected scan recorded as admitted unless the seller said admitted.
  await assert.rejects(prisma.scanEvent.create({ data: { eventId: a.eventId, source: 'connected', result: 'admitted', issuerResult: '', at: new Date() } }), /venue_scan_valid/);
  for (const bad of ['https://10.0.0.5', 'https://192.168.1.20', 'https://169.254.169.254', 'https://[::1]', 'http://concerts.example.com', 'https://localhost'])
    await assert.rejects(startConnection(prisma, publicHostPolicy, { kind: 'openfront_concerts', baseUrl: bad, redirectUri: 'https://venue.example/api/connections/callback', userId: door.session.itemId }), AddressRefused, bad);
  assert.equal(await prisma.channelConnection.count({ where: { baseUrl: { in: ['https://10.0.0.5', 'https://192.168.1.20'] } } }), 0, 'nothing stored for a refused address');
});

suite('14. SecretBox: a refresh token round-trips; the row never holds the plain token; a wrong key fails', async () => {
  const name = `channel:${randomUUID()}:refresh`;
  const token = `mcp_rt_${randomBytes(32).toString('base64url')}`;
  await putSecret(prisma, name, token);
  assert.equal(await getSecret(prisma, name), token);
  const row = await prisma.secretBox.findUnique({ where: { key: name } });
  assert.ok(row && !JSON.stringify(row).includes(token) && !JSON.stringify(row).includes(token.slice(7)));
  await assert.rejects(getSecret(prisma, name, secretKey({ SESSION_SECRET: randomBytes(32).toString('hex') })), SecretUnreadable);
  const rotated = `mcp_rt_${randomBytes(32).toString('base64url')}`;
  await putSecret(prisma, name, rotated);
  assert.equal(await getSecret(prisma, name), rotated);
  assert.ok((await prisma.secretBox.findUnique({ where: { key: name } }))!.rotatedAt);
});

suite('15. total issued: own sold + comps + imported + guest list (+ connected sold) against the configuration; warns exactly when over', async () => {
  const a = await nightAtDoors({ capacity: 10 });
  await sell(a.eventId, a.levelId, 4);
  await sell(a.eventId, a.levelId, 1, true);
  await importExternalTickets(null, { input: { idempotencyKey: key(), eventId: a.eventId, sellerName: 'Dice', csv: 'barcode\nX-0001\nX-0002\n' } }, door);
  const g: any = await addGuestListEntry(null, { input: { idempotencyKey: key(), eventId: a.eventId, name: 'Band guest', plusOnes: 2 } }, door);
  let issued: any = await eventIssued(null, { eventId: a.eventId }, door);
  assert.deepEqual([issued.ownSold, issued.comps, issued.imported, issued.guestList, issued.connectedSold, issued.total, issued.capacity, issued.over], [4, 1, 2, 3, 0, 10, 10, false]);
  await addGuestListEntry(null, { input: { idempotencyKey: key(), eventId: a.eventId, name: 'One more', plusOnes: 0 } }, door);
  issued = await eventIssued(null, { eventId: a.eventId }, door);
  assert.deepEqual([issued.total, issued.over, issued.overBy], [11, true, 1], 'over by exactly one');
  // The connected issuer's sold count is added when the event is connected (here the last stored read, as when the seller is not answering).
  const conn = await prisma.channelConnection.create({ data: { kind: 'openfront_comedy_club', baseUrl: 'https://venue-sibling.invalid', issuer: 'https://venue-sibling.invalid', clientId: 'mcp_cl_y', status: 'connected', connectedAt: new Date() } });
  await putSecret(prisma, refreshSecretName(conn.id), `mcp_rt_${randomBytes(24).toString('base64url')}`);
  await prisma.event.update({ where: { id: a.eventId }, data: { issuer: 'openfront_comedy_club', connectionId: conn.id, externalEventId: 'show_1', externalSellerName: 'Lantern Live', connectedSold: 5, connectedSoldAt: new Date() } });
  issued = await eventIssued(null, { eventId: a.eventId }, door);
  assert.equal(issued.connectedSold, 5); assert.equal(issued.total, 16); assert.equal(issued.fresh, false); assert.match(issued.message, /not answering/);
  const ev = await prisma.event.findUnique({ where: { id: a.eventId } });
  assert.equal(ev!.connectedSold, 5, 'an unreachable seller does not wipe the last count');
  assert.ok(g.id);
});
