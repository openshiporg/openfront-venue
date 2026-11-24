import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { runHoldCommand } from './calendar';
import { checkedClient } from '../lib/transaction';
import { scanAtDoor, setEventIssuer, connectedAvailability, eventIssued, openSiblingDoors, channelEvents } from './door';
import { loopbackPolicy, publicHostPolicy, AddressRefused } from '../lib/sibling-http';
import { startConnection, completeConnection, checkConnection, disconnectConnection } from '../lib/channel-connect';
import { putSecret, getSecret } from '../lib/secret-box';
import { refreshSecretName, forgetAccess } from '../lib/channel-client';

/**
 * §10 test 12: a real Openfront Concerts (the donor exported at 985c180, never run in its checkout) on this machine.
 * VENUE_SIBLING_CONCERTS_URL is its base URL, VENUE_SIBLING_DATABASE_URL its own scratch database (used only to place
 * tonight's times, because Concerts opens doors within 12 hours of the show). The venue connects through Concerts' real
 * consent page, then its scan goes to Concerts' scanTicket. The test passes `loopbackPolicy` explicitly; product code
 * always passes `publicHostPolicy`.
 */
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
const url = process.env.VENUE_TEST_DATABASE_URL || '';
const sibling = (process.env.VENUE_SIBLING_CONCERTS_URL || '').replace(/\/$/, '');
const siblingDb = process.env.VENUE_SIBLING_DATABASE_URL || '';
const enabled = /[?&]schema=dbtest\b/.test(url) && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(sibling) && /^postgres/.test(siblingDb);
const suite = enabled ? test : test.skip;
const REDIRECT = 'http://127.0.0.1:59999/api/connections/callback';
let prisma: PrismaClient, other: PrismaClient, door: any, cookie = '';

async function gql(query: string, variables: any = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${sibling}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify({ query, variables }) });
  const setCookie = res.headers.get('set-cookie');
  const body: any = await res.json();
  return { body, setCookie };
}

before(async () => {
  if (!enabled) return;
  prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  other = new PrismaClient({ datasourceUrl: siblingDb, log: [] });
  const id = (await prisma.user.create({ data: { name: 'Door', email: `sib-${Date.now()}@example.com`, password: 'x' } })).id;
  door = { prisma, session: { itemId: id, data: { role: { canAccessDashboard: true, canManageEvents: true, canScanTickets: true, canManageConnections: true } } }, sudo: () => ({ prisma }) };
  // The promoter's staff account at Concerts (first user is its admin).
  const email = 'door-ops@lanternlive.example', password = 'Lantern-door-2026!';
  await gql('mutation($d: CreateInitialUserInput!) { createInitialUser(data: $d) { item { id } } }', { d: { name: 'Lantern Door Ops', email, password } });
  const auth = await gql('mutation($e: String!, $p: String!) { authenticateUserWithPassword(email: $e, password: $p) { ... on UserAuthenticationWithPasswordSuccess { item { id } } ... on UserAuthenticationWithPasswordFailure { message } } }', { e: email, p: password });
  cookie = String(auth.setCookie || '').split(';')[0];
  assert.ok(cookie, 'signed in at Concerts');
});
after(async () => { if (enabled) { await prisma.$disconnect(); await other.$disconnect(); } });

suite('12. a ticket issued by a real Openfront Concerts scans at the venue through the sibling’s scanTicket; second scan is a duplicate; a dead grant asks for reconnect and admits no one', async () => {
  // --- At Concerts: the promoter's night, on sale, with a real comp ticket.
  const seed = async (section: string, data: any) => { const r = await gql('mutation($s: String!, $d: JSON!) { seedConcerts(section: $s, data: $d) }', { s: section, d: data }); assert.ok(r.body.data?.seedConcerts?.id, JSON.stringify(r.body.errors)); return r.body.data.seedConcerts.id as string; };
  await seed('settings', { name: 'Lantern Live', currencyCode: 'USD', refundApprovalThresholdCents: 20000 });
  await seed('venue', { name: 'Openfront Venue Room', city: 'Chicago', timezone: 'America/Chicago', address: '1 Venue Way', capacity: 300, ownedByPromoter: false, taxBps: 0, defaultFacilityFeeCents: 0, contact: 'house@venue.example', chart: { name: 'GA', sections: [{ name: 'Floor', kind: 'ga', capacity: 300 }] } });
  await seed('artist', { name: 'Harbor Lights', genreTags: 'Indie', agentName: 'Desk', agentEmail: 'desk@agency.example' });
  const title = `Harbor Lights at the Venue ${randomUUID().slice(0, 6)}`;
  const remoteId = await seed('event', { key: 'e1', title, venue: 'Openfront Venue Room', chart: 'GA', status: 'on_sale', showDays: 0, artist: 'Harbor Lights', deal: { dealType: 'flat_guarantee', guaranteeCents: 100000, percentageBps: 0, promoterProfitBps: 0, expenseCapCents: 0, depositCents: 0, merchSplitBps: 0, hardMerchSplitBps: 0, breakevenBasis: '', radiusClause: '', hospitalityRiderCents: 0 }, levels: [{ name: 'GA', priceCents: 3000, feeCents: 300, facilityFeeCents: 0, capacity: 300, sections: ['Floor'], phases: [] }], expenses: [] });
  // Tonight, so Concerts lets doors open (fixture time only; status goes through Concerts' own advanceEvent below).
  await other.$executeRawUnsafe(`UPDATE "Event" SET "doorsAt" = now() + interval '1 hour', "showAt" = now() + interval '2 hours', "curfewAt" = now() + interval '5 hours' WHERE id = $1`, remoteId);
  const level = (await other.$queryRawUnsafe<any[]>(`SELECT id FROM "PriceLevel" WHERE "event" = $1`, remoteId))[0];
  const comp = await gql('mutation($i: DoorSaleInput!) { issueComp(input: $i) }', { i: { idempotencyKey: randomUUID(), eventId: remoteId, levelId: level.id, qty: 1, name: 'Rae Harbor', reason: 'Band guest' } });
  const remoteTicket = comp.body.data?.issueComp?.tickets?.[0];
  assert.ok(remoteTicket?.token, JSON.stringify(comp.body.errors));

  // --- At the venue: the public-host policy refuses this loopback sibling; the loopback policy (tests only) reaches it.
  await assert.rejects(startConnection(prisma, publicHostPolicy, { kind: 'openfront_concerts', baseUrl: sibling, redirectUri: REDIRECT, userId: door.session.itemId }), AddressRefused);
  const started = await startConnection(prisma, loopbackPolicy, { kind: 'openfront_concerts', baseUrl: sibling, redirectUri: REDIRECT, userId: door.session.itemId, venueName: 'Openfront Venue' });
  const consentUrl = new URL(started.authorizeUrl);
  assert.equal(consentUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(consentUrl.searchParams.get('resource'), `${sibling}/api/mcp-transport/http`);
  // The promoter approves on Concerts' own consent page.
  const page = await (await fetch(consentUrl, { headers: { cookie } })).text();
  const ticket = page.match(/name="ticket" value="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  assert.ok(ticket, 'Concerts shows its consent screen');
  const approve = await fetch(consentUrl, { method: 'POST', redirect: 'manual', headers: { cookie, origin: sibling, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ intent: 'approve', ticket, allow_write: '1' }) });
  const back = new URL(String(approve.headers.get('location')));
  assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
  const connected = await completeConnection(prisma, loopbackPolicy, { state: back.searchParams.get('state') || '', code: back.searchParams.get('code'), iss: back.searchParams.get('iss'), redirectUri: REDIRECT, userId: door.session.itemId });
  assert.equal(connected.status, 'connected');
  assert.match(connected.siblingUserLabel, /Lantern Door Ops/);
  // The code is single use: replaying the callback is refused.
  await assert.rejects(completeConnection(prisma, loopbackPolicy, { state: back.searchParams.get('state') || '', code: back.searchParams.get('code'), redirectUri: REDIRECT, userId: door.session.itemId }), /already used|replaced/);
  const row = await prisma.channelConnection.findUnique({ where: { id: connected.id } });
  const refresh = await getSecret(prisma, refreshSecretName(connected.id));
  assert.match(String(refresh), /^mcp_rt_/);
  assert.ok(!JSON.stringify(row).includes(String(refresh)) && !JSON.stringify(await prisma.secretBox.findUnique({ where: { key: refreshSecretName(connected.id) } })).includes(String(refresh)));

  // --- The venue's night, sold by Concerts.
  const room = await prisma.room.create({ data: { name: `Sibling room ${randomUUID().slice(0, 6)}`, city: 'Chicago', timezone: 'America/Chicago', capacity: 300 } });
  const chart = await prisma.seatingChart.create({ data: { name: 'GA', roomId: room.id, status: 'published', version: 1 } });
  await prisma.chartSection.create({ data: { name: 'Floor', kind: 'ga', capacity: 300, chartId: chart.id } });
  const promoter = await prisma.promoter.create({ data: { company: `Lantern Live ${randomUUID().slice(0, 4)}`, email: 'book@lantern.example' } });
  const day = new Date(Date.now() + (900 + Math.floor(Math.random() * 200)) * 86400000).toISOString().slice(0, 10);
  const hold = await prisma.$transaction(raw => runHoldCommand('placeDateHold', checkedClient(raw), { roomId: room.id, date: day, rank: 1, kind: 'rental', promoterId: promoter.id }, door.session.itemId));
  const { eventId } = await prisma.$transaction(raw => runHoldCommand('confirmHold', checkedClient(raw), { holdId: hold.id, title, seatingChartId: chart.id, doorsTime: '19:00', showTime: '20:00' }, door.session.itemId)) as any;
  const listed = await channelEvents(null, { connectionId: connected.id }, door, loopbackPolicy);
  assert.ok(listed.some((e: any) => e.id === remoteId && e.title === title), 'the promoter’s events are listed');
  const set: any = await setEventIssuer(null, { input: { idempotencyKey: randomUUID(), eventId, issuer: 'openfront_concerts', connectionId: connected.id, externalEventId: remoteId } }, door, loopbackPolicy);
  assert.equal(set.externalUrl, `${sibling}/events/${remoteId}`);
  await prisma.event.update({ where: { id: eventId }, data: { status: 'on_sale' } });
  // Public prices come from Concerts' public eventAvailability.
  const avail: any = await connectedAvailability(null, { eventId }, door, loopbackPolicy);
  assert.equal(avail.live, true); assert.equal(avail.levels[0].allInCents, 3300); assert.equal(avail.soldOut, false);
  // W6.2: opening doors at the venue opens them at Concerts through its own advanceEvent.
  await prisma.event.update({ where: { id: eventId }, data: { status: 'doors' } });
  const opened = await openSiblingDoors(prisma, eventId, loopbackPolicy);
  assert.equal(opened?.opened, true, opened?.message);

  // --- The door.
  const scan = (code: string) => scanAtDoor(door, { idempotencyKey: randomUUID(), eventId, code, gate: 'Main' }, loopbackPolicy) as Promise<any>;
  const first = await scan(remoteTicket.token);
  assert.equal(first.result, 'admitted', first.message); assert.equal(first.source, 'connected');
  assert.equal((await other.$queryRawUnsafe<any[]>(`SELECT status FROM "Ticket" WHERE "ticketCode" = $1`, remoteTicket.ticketCode))[0].status, 'checked_in', 'Concerts recorded the admission');
  assert.equal((await scan(remoteTicket.ticketCode)).result, 'duplicate', 'second scan');
  assert.equal((await scan('TK-NOT-AT-CONCERTS')).result, 'not_found');
  const issued: any = await eventIssued(null, { eventId }, door, loopbackPolicy);
  assert.equal(issued.fresh, true); assert.ok(issued.connectedSold >= 1, 'sold count read live from Concerts');
  const check: any = await checkConnection(prisma, loopbackPolicy, connected.id);
  assert.equal(check.ok, true, check.message);
  // Concerts has sold for this night: leaving it (to own, to another seller, or to another Concerts event) would strand
  // those holders at the door, so it is refused and nothing changes.
  const otherRemote = await seed('event', { key: 'e2', title: `${title} (late show)`, venue: 'Openfront Venue Room', chart: 'GA', status: 'on_sale', showDays: 3, artist: 'Harbor Lights', deal: { dealType: 'flat_guarantee', guaranteeCents: 100000, percentageBps: 0, promoterProfitBps: 0, expenseCapCents: 0, depositCents: 0, merchSplitBps: 0, hardMerchSplitBps: 0, breakevenBasis: '', radiusClause: '', hospitalityRiderCents: 0 }, levels: [{ name: 'GA', priceCents: 3000, feeCents: 300, facilityFeeCents: 0, capacity: 300, sections: ['Floor'], phases: [] }], expenses: [] });
  for (const to of [{ issuer: 'own' }, { issuer: 'other', sellerName: 'Dice' }, { issuer: 'openfront_concerts', connectionId: connected.id, externalEventId: otherRemote }])
    await assert.rejects(setEventIssuer(null, { input: { idempotencyKey: randomUUID(), eventId, ...to } }, door, loopbackPolicy), /has sold \d+ tickets? for this night/, to.issuer);
  const kept = (await prisma.event.findUnique({ where: { id: eventId } }))!;
  assert.deepEqual([kept.issuer, kept.externalEventId], ['openfront_concerts', remoteId]);

  // A dead grant: Concerts answers invalid_grant, the connection becomes needs_reconnect, and the scan admits no one.
  const fresh = (await prisma.event.findUnique({ where: { id: eventId } }))!;
  await putSecret(prisma, refreshSecretName(connected.id), `mcp_rt_${randomBytes(32).toString('base64url')}`);
  forgetAccess(connected.id);
  const second = (await gql('mutation($i: DoorSaleInput!) { issueComp(input: $i) }', { i: { idempotencyKey: randomUUID(), eventId: remoteId, levelId: level.id, qty: 1, name: 'Sam Late', reason: 'Band guest' } })).body.data.issueComp.tickets[0];
  const dead = await scan(second.token);
  assert.equal(dead.result, 'issuer_unreachable'); assert.match(dead.message, /reconnect/i);
  assert.equal((await prisma.channelConnection.findUnique({ where: { id: connected.id } }))!.status, 'needs_reconnect');
  assert.equal((await other.$queryRawUnsafe<any[]>(`SELECT status FROM "Ticket" WHERE "ticketCode" = $1`, second.ticketCode))[0].status, 'valid', 'not admitted anywhere');
  assert.equal(await prisma.scanEvent.count({ where: { eventId, result: 'admitted' } }), 1);
  assert.ok(fresh.connectionId);
  await disconnectConnection(prisma, loopbackPolicy, connected.id, door.session.itemId);
  assert.equal(await getSecret(prisma, refreshSecretName(connected.id)), null);
});
