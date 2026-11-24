import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { runHoldCommand, settleDay } from './calendar';
import { checkedClient } from '../lib/transaction';

/**
 * Runs the real hold commands against a migrated Postgres schema named by VENUE_TEST_DATABASE_URL
 * (the scratch database, schema `dbtest`). Pass it inline for one command; it is never written to a file.
 * Without it these tests are skipped, not faked.
 */
const url = process.env.VENUE_TEST_DATABASE_URL || '';
const enabled = /^postgres(ql)?:\/\//.test(url) && /[?&]schema=dbtest\b/.test(url);
const suite = enabled ? test : test.skip;
let prisma: PrismaClient;
const run = (op: string, input: any) => prisma.$transaction(async raw => runHoldCommand(op, checkedClient(raw), input, actor));
let actor = '';
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

before(async () => { if (!enabled) return; prisma = new PrismaClient({ datasourceUrl: url, log: [] }); actor = (await prisma.user.create({ data: { name: 'Booker', email: `booker-${Date.now()}@example.com`, password: 'x' } })).id; });
after(async () => { if (enabled) await prisma.$disconnect(); });

async function room(timezone = 'America/Los_Angeles') {
  const r = await prisma.room.create({ data: { name: `Hall ${Math.random().toString(36).slice(2, 8)}`, city: 'Portland', timezone } });
  const chart = await prisma.seatingChart.create({ data: { name: 'Standing', roomId: r.id, status: 'published', version: 1 } });
  return { r, chart };
}

suite('ranked holds: a taken rank, a past date and a confirmed day are refused', async () => {
  const { r } = await room(); const date = future(30);
  const a = await run('placeDateHold', { roomId: r.id, date, rank: 1 });
  assert.equal(a.status, 'held');
  await assert.rejects(run('placeDateHold', { roomId: r.id, date, rank: 1 }), /Rank 1 is already held/);
  await assert.rejects(run('placeDateHold', { roomId: r.id, date: '2020-01-01', rank: 1 }), /in the past/);
  await assert.rejects(run('placeDateHold', { roomId: r.id, date, rank: 2, kind: 'rental' }), /needs a promoter/);
});

suite('a challenge sets a deadline; confirming below a live hold is refused until it lapses, then the date confirms', async () => {
  const { r, chart } = await room(); const date = future(40);
  const first = await run('placeDateHold', { roomId: r.id, date, rank: 1 });
  const second = await run('placeDateHold', { roomId: r.id, date, rank: 2 });
  await assert.rejects(run('challengeHold', { holdId: second.id, byHoldId: first.id }), /lower-ranked/);
  const challenged = await run('challengeHold', { holdId: first.id, byHoldId: second.id });
  assert.equal(challenged.status, 'challenged');
  assert.ok(new Date(challenged.challengeDeadline) > new Date());
  await assert.rejects(run('confirmHold', { holdId: second.id, title: 'Late Show', seatingChartId: chart.id, doorsTime: '19:00', showTime: '20:00' }), /Earlier ranked hold must be released/);
  // Time passes: the deadline is now behind us. The next request that touches the day releases rank 1 with the reason.
  await prisma.dateHold.update({ where: { id: first.id }, data: { challengeDeadline: new Date(Date.now() - 60000) } });
  const done = await run('confirmHold', { holdId: second.id, title: 'Late Show', seatingChartId: chart.id, doorsTime: '19:00', showTime: '20:00' });
  assert.equal(done.status, 'confirmed');
  const lapsed = await prisma.dateHold.findUnique({ where: { id: first.id } });
  assert.equal(lapsed?.status, 'released'); assert.equal(lapsed?.releasedReason, 'Did not confirm by the challenge deadline'); assert.equal(lapsed?.rankKey, null);
  const event = await prisma.event.findUnique({ where: { id: done.eventId } });
  assert.equal(event?.status, 'hold');
  assert.equal(event?.showAt?.toISOString().slice(11, 13) === '03' || event?.showAt?.toISOString().slice(11, 13) === '04', true, '20:00 in Portland is 03:00 or 04:00 UTC the next day');
  // The day is now taken for every kind of hold.
  await assert.rejects(run('placeDateHold', { roomId: r.id, date, rank: 3 }), /already confirmed/);
});

suite('settling a day twice changes nothing the second time, and a lapsed challenger frees the challenged hold', async () => {
  const { r } = await room(); const date = future(50);
  const first = await run('placeDateHold', { roomId: r.id, date, rank: 1 });
  const second = await run('placeDateHold', { roomId: r.id, date, rank: 2 });
  await run('challengeHold', { holdId: first.id, byHoldId: second.id });
  await prisma.dateHold.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const when = new Date(date);
  const one = await prisma.$transaction(tx => settleDay(checkedClient(tx), r.id, when, actor));
  const two = await prisma.$transaction(tx => settleDay(checkedClient(tx), r.id, when, actor));
  assert.deepEqual(one, [second.id]); assert.deepEqual(two, []);
  const back = await prisma.dateHold.findUnique({ where: { id: first.id } });
  assert.equal(back?.status, 'held'); assert.equal(back?.challengeDeadline, null);
});

suite('a private-event or house hold confirms without making a show, and only one confirmed hold can own a day', async () => {
  const { r } = await room(); const date = future(60);
  const house = await run('placeDateHold', { roomId: r.id, date, rank: 1, kind: 'internal' });
  const rival = await run('placeDateHold', { roomId: r.id, date, rank: 2 });
  const confirmed = await run('confirmHold', { holdId: house.id });
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.eventId, undefined);
  // The database refuses a second confirmed hold even if a request got past the application check.
  await assert.rejects(prisma.dateHold.update({ where: { id: rival.id }, data: { status: 'confirmed' } }), /DateHold_one_confirmed_per_day|Unique constraint/);
});
