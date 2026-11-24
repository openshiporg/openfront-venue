import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { runHoldCommand } from './calendar';
import { checkedClient } from '../lib/transaction';
import { scanAtDoor, setEventIssuer, connectedAvailability, eventIssued, channelEvents, forgetConnectedAvailability } from './door';
import { loopbackPolicy } from '../lib/sibling-http';
import { startConnection, completeConnection, disconnectConnection } from '../lib/channel-connect';
import { getSecret } from '../lib/secret-box';
import { refreshSecretName } from '../lib/channel-client';

/**
 * §10 test 12b: a real Openfront Comedy Club (exported at 261f2dd, never run in its checkout) on this machine.
 * VENUE_SIBLING_COMEDY_URL is its base URL, VENUE_SIBLING_COMEDY_DATABASE_URL its own scratch database (read to find
 * the comp ticket's code, and to set two tiers paused/closed as fixtures), VENUE_SIBLING_COMEDY_SESSION_SECRET the
 * SESSION_SECRET it runs with (its QR token is HMAC(SESSION_SECRET, ticketCode), so the test can present the real QR).
 * The venue connects through Comedy's real consent page; product code always passes `publicHostPolicy`.
 */
const url = process.env.VENUE_TEST_DATABASE_URL || '';
const sibling = (process.env.VENUE_SIBLING_COMEDY_URL || '').replace(/\/$/, '');
const siblingDb = process.env.VENUE_SIBLING_COMEDY_DATABASE_URL || '';
const siblingSecret = process.env.VENUE_SIBLING_COMEDY_SESSION_SECRET || '';
const enabled = /[?&]schema=dbtest\b/.test(url) && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(sibling) && /^postgres/.test(siblingDb) && siblingSecret.length >= 32;
const suite = enabled ? test : test.skip;
const REDIRECT = 'http://127.0.0.1:59998/api/connections/callback';
let prisma: PrismaClient, other: PrismaClient, door: any, cookie = '';

async function gql(query: string, variables: any = {}) {
  const res = await fetch(`${sibling}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ query, variables }) });
  return { body: await res.json() as any, setCookie: res.headers.get('set-cookie') };
}
const ok = async (query: string, variables: any = {}) => { const r = await gql(query, variables); assert.ok(r.body.data && !r.body.errors, JSON.stringify(r.body.errors)); return r.body.data; };

before(async () => {
  if (!enabled) return;
  process.env.SESSION_SECRET ||= createHmac('sha256', 'venue').update(randomUUID()).digest('hex');
  prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  other = new PrismaClient({ datasourceUrl: siblingDb, log: [] });
  const id = (await prisma.user.create({ data: { name: 'Door', email: `sibc-${Date.now()}@example.com`, password: 'x' } })).id;
  door = { prisma, session: { itemId: id, data: { role: { canAccessDashboard: true, canManageEvents: true, canScanTickets: true, canManageConnections: true } } }, sudo: () => ({ prisma }) };
  // The club's manager at Comedy Club (first user is its admin).
  const email = 'door@laughtrack.example', password = 'Laugh-door-2026!';
  await gql('mutation($d: CreateInitialUserInput!) { createInitialUser(data: $d) { item { id } } }', { d: { name: 'Laugh Track Door', email, password } });
  const auth = await gql('mutation($e: String!, $p: String!) { authenticateUserWithPassword(email: $e, password: $p) { ... on UserAuthenticationWithPasswordSuccess { item { id } } } }', { e: email, p: password });
  cookie = String(auth.setCookie || '').split(';')[0];
  assert.ok(cookie, 'signed in at Comedy Club');
});
after(async () => { if (enabled) { await prisma.$disconnect(); await other.$disconnect(); } });

suite('12b. a ticket issued by a real Openfront Comedy Club scans at the venue through checkInTicket; prices are price + fee from showAvailability; paused and closed tiers are not offered', async () => {
  // --- At Comedy Club: the club's own setup records, a weekly template, one generated show on sale, a real comp ticket.
  const record = async (entity: string, data: any) => (await ok('mutation($e: String!, $d: JSON!) { r: ensureClubOnboardingRecord(entity: $e, data: $d) }', { e: entity, d: data })).r.id as string;
  await record('Venue', { name: 'The Laugh Track', timezone: 'America/Chicago', address: '412 Congress Ave, Austin, TX', defaultAgeRestriction: '18', drinkMinimumItems: 0, drinkMinimumCentsFloor: 0, serviceFeeBps: 0, taxBps: 0, policies: 'Valid ID required.' });
  await record('VenueSettings', { refundWindowHours: 24, holdMinutes: 10, approvalThresholdCents: 10000, compApprovalQuantity: 4 });
  await record('Room', { name: 'Main Room', capacity: 180, seatingMode: 'ga' });
  const title = `Late Laughs ${randomUUID().slice(0, 6)}`;
  const templateId = await record('ShowTemplate', { title, room: 'Main Room', recurrenceRule: 'FREQ=WEEKLY;BYDAY=WE', startTime: '23:30', duration: 90, isOpenMic: false, defaultAgeRestriction: '18',
    tiers: [{ name: 'GA', priceCents: 2000, feeCents: 300, capacity: 100, isTableTier: false, seatsPerUnit: 1 }, { name: 'Bar rail', priceCents: 1500, feeCents: 200, capacity: 20, isTableTier: false, seatsPerUnit: 1 }, { name: 'Early bird', priceCents: 1000, feeCents: 100, capacity: 20, isTableTier: false, seatsPerUnit: 1 }] });
  await ok('mutation($t: ID!, $k: String!) { generateShowsFromTemplate(templateId: $t, from: null, idempotencyKey: $k) }', { t: templateId, k: randomUUID() });
  const remote = (await other.$queryRawUnsafe<any[]>(`SELECT s.id FROM "Show" s WHERE s.title = $1 AND s."startsAt" > now() ORDER BY s."startsAt" ASC LIMIT 1`, title))[0];
  assert.ok(remote?.id, 'Comedy generated a show');
  const remoteId = String(remote.id);
  await ok('mutation($s: ID!, $k: String!) { publishShow(showId: $s, nextStatus: "on_sale", idempotencyKey: $k) }', { s: remoteId, k: randomUUID() });
  // Fixture state for the tier rule: Comedy tiers can be paused or closed by the club.
  await other.$executeRawUnsafe(`UPDATE "PriceTier" SET status = 'paused' WHERE "show" = $1 AND name = 'Bar rail'`, remoteId);
  await other.$executeRawUnsafe(`UPDATE "PriceTier" SET status = 'closed' WHERE "show" = $1 AND name = 'Early bird'`, remoteId);
  const ga = (await other.$queryRawUnsafe<any[]>(`SELECT id FROM "PriceTier" WHERE "show" = $1 AND name = 'GA'`, remoteId))[0];
  const comp = await ok('mutation($s: ID!, $t: ID!, $k: String!) { c: issueComp(showId: $s, tierId: $t, quantity: 1, recipientName: "Rae Laugh", reason: "comic_guest", idempotencyKey: $k) }', { s: remoteId, t: ga.id, k: randomUUID() });
  const ticketCode = (await other.$queryRawUnsafe<any[]>(`SELECT t."ticketCode" FROM "Ticket" t JOIN "TicketOrder" o ON o.id = t."order" WHERE o."orderNumber" = $1`, comp.c.orderNumber))[0].ticketCode as string;
  const qr = createHmac('sha256', siblingSecret).update('ticket\0' + ticketCode).digest('hex');

  // --- At the venue: connect through Comedy's own consent page.
  const started = await startConnection(prisma, loopbackPolicy, { kind: 'openfront_comedy_club', baseUrl: sibling, redirectUri: REDIRECT, userId: door.session.itemId, venueName: 'Openfront Venue' });
  const consentUrl = new URL(started.authorizeUrl);
  assert.equal(consentUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(consentUrl.searchParams.get('resource'), `${sibling}/api/mcp-transport/http`);
  const page = await (await fetch(consentUrl, { headers: { cookie } })).text();
  const ticket = page.match(/name="ticket" value="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  assert.ok(ticket, 'Comedy Club shows its consent screen');
  const approve = await fetch(consentUrl, { method: 'POST', redirect: 'manual', headers: { cookie, origin: sibling, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ intent: 'approve', ticket, allow_write: '1' }) });
  const back = new URL(String(approve.headers.get('location')));
  assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
  const connected = await completeConnection(prisma, loopbackPolicy, { state: back.searchParams.get('state') || '', code: back.searchParams.get('code'), iss: back.searchParams.get('iss'), redirectUri: REDIRECT, userId: door.session.itemId });
  assert.equal(connected.status, 'connected');
  assert.match(String(await getSecret(prisma, refreshSecretName(connected.id))), /^mcp_rt_/);

  // --- The venue's night, sold by the club.
  const room = await prisma.room.create({ data: { name: `Comedy room ${randomUUID().slice(0, 6)}`, city: 'Austin', timezone: 'America/Chicago', capacity: 180 } });
  const chart = await prisma.seatingChart.create({ data: { name: 'GA', roomId: room.id, status: 'published', version: 1 } });
  await prisma.chartSection.create({ data: { name: 'Floor', kind: 'ga', capacity: 180, chartId: chart.id } });
  const promoter = await prisma.promoter.create({ data: { company: `Laugh Track ${randomUUID().slice(0, 4)}`, email: 'book@laughtrack.example' } });
  const day = new Date(Date.now() + (1100 + Math.floor(Math.random() * 200)) * 86400000).toISOString().slice(0, 10);
  const hold = await prisma.$transaction(raw => runHoldCommand('placeDateHold', checkedClient(raw), { roomId: room.id, date: day, rank: 1, kind: 'rental', promoterId: promoter.id }, door.session.itemId));
  const { eventId } = await prisma.$transaction(raw => runHoldCommand('confirmHold', checkedClient(raw), { holdId: hold.id, title, seatingChartId: chart.id, doorsTime: '22:30', showTime: '23:30' }, door.session.itemId)) as any;
  const listed = await channelEvents(null, { connectionId: connected.id }, door, loopbackPolicy);
  const mine = listed.find((e: any) => e.id === remoteId);
  assert.ok(mine && mine.title === title, 'the club’s shows are listed');
  assert.equal(mine.sold, 1, 'soldCount read from Comedy');
  const set: any = await setEventIssuer(null, { input: { idempotencyKey: randomUUID(), eventId, issuer: 'openfront_comedy_club', connectionId: connected.id, externalEventId: remoteId } }, door, loopbackPolicy);
  assert.equal(set.externalUrl, `${sibling}/shows/${remoteId}`);
  await prisma.event.update({ where: { id: eventId }, data: { status: 'on_sale' } });
  // Public prices: Comedy showAvailability, all-in = price + fee; the paused and the closed tier are not offered.
  forgetConnectedAvailability(eventId);
  const avail: any = await connectedAvailability(null, { eventId }, door, loopbackPolicy);
  assert.equal(avail.live, true, avail.message);
  assert.deepEqual(avail.levels.map((l: any) => [l.name, l.allInCents, l.soldOut]), [['GA', 2300, false]]);
  const issuedBefore: any = await eventIssued(null, { eventId }, door, loopbackPolicy);
  assert.equal(issuedBefore.fresh, true); assert.equal(issuedBefore.connectedSold, 1, 'soldCount read live');
  // The club has sold for this night: the seller cannot be changed away from it.
  await assert.rejects(setEventIssuer(null, { input: { idempotencyKey: randomUUID(), eventId, issuer: 'own' } }, door, loopbackPolicy), /has sold 1 ticket for this night/);

  // --- The door: closed at the venue means the club is not asked; open, the real QR admits once.
  const scan = (code: string) => scanAtDoor(door, { idempotencyKey: randomUUID(), eventId, code, gate: 'Main' }, loopbackPolicy) as Promise<any>;
  await assert.rejects(scan(qr), /Doors are not open/);
  assert.equal((await other.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "CheckIn" WHERE "show" = $1`, remoteId))[0].n, 0, 'Comedy was not asked while the venue doors were shut');
  await prisma.event.update({ where: { id: eventId }, data: { status: 'doors' } });
  const first = await scan(qr);
  assert.equal(first.result, 'admitted', first.message); assert.equal(first.source, 'connected');
  assert.equal((await other.$queryRawUnsafe<any[]>(`SELECT status FROM "Ticket" WHERE "ticketCode" = $1`, ticketCode))[0].status, 'checked_in', 'Comedy recorded the admission');
  const dup = await scan(ticketCode);
  assert.equal(dup.result, 'duplicate'); assert.match(dup.message, /First admitted/);
  assert.equal((await scan('T-NOT-AT-THE-CLUB')).result, 'not_found');
  assert.equal(await prisma.scanEvent.count({ where: { eventId, result: 'admitted' } }), 1);
  await disconnectConnection(prisma, loopbackPolicy, connected.id, door.session.itemId);
  assert.equal(await getSecret(prisma, refreshSecretName(connected.id)), null);
});
