import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeDeadline, dayState, holdSettingsOf, lapseReason } from './hold-rules';
import { zonedDateTime } from './venue-time';

const LA = 'America/Los_Angeles';
const oneDay = { challengeBusinessDays: 1, challengeCountsWeekends: false };

test('1 business day from Friday 15:00 in Los Angeles is Monday 15:00', () => {
  const friday = zonedDateTime('2027-03-05', '15:00', LA); // a Friday
  assert.equal(challengeDeadline(friday, oneDay, LA).toISOString(), zonedDateTime('2027-03-08', '15:00', LA).toISOString());
});

test('with weekends counted the same deadline is Saturday 15:00', () => {
  const friday = zonedDateTime('2027-03-05', '15:00', LA);
  assert.equal(challengeDeadline(friday, { challengeBusinessDays: 1, challengeCountsWeekends: true }, LA).toISOString(), zonedDateTime('2027-03-06', '15:00', LA).toISOString());
});

test('the wall-clock time survives a daylight-saving change, and the room zone decides the weekday', () => {
  // Saturday 2027-03-13 20:00 in LA; clocks go forward on Sunday the 14th. Weekend is skipped, Monday 20:00 PDT.
  const saturday = zonedDateTime('2027-03-13', '20:00', LA);
  assert.equal(challengeDeadline(saturday, oneDay, LA).toISOString(), zonedDateTime('2027-03-15', '20:00', LA).toISOString());
  // Friday 20:00 in LA is already Saturday in UTC: the weekday is the room's, not the server's.
  const lateFriday = zonedDateTime('2027-03-05', '20:00', LA);
  assert.equal(challengeDeadline(lateFriday, oneDay, LA).toISOString(), zonedDateTime('2027-03-08', '20:00', LA).toISOString());
});

test('several business days and zero days', () => {
  const wednesday = zonedDateTime('2027-03-03', '09:30', LA);
  assert.equal(challengeDeadline(wednesday, { challengeBusinessDays: 2, challengeCountsWeekends: false }, LA).toISOString(), zonedDateTime('2027-03-05', '09:30', LA).toISOString());
  assert.equal(challengeDeadline(wednesday, { challengeBusinessDays: 3, challengeCountsWeekends: false }, LA).toISOString(), zonedDateTime('2027-03-08', '09:30', LA).toISOString());
  assert.equal(challengeDeadline(wednesday, { challengeBusinessDays: 0, challengeCountsWeekends: false }, LA).toISOString(), wednesday.toISOString());
});

test('settings fall back to the defaults when missing or invalid', () => {
  assert.deepEqual(holdSettingsOf(null), { challengeBusinessDays: 1, challengeCountsWeekends: false, holdExpiryDays: 7 });
  assert.deepEqual(holdSettingsOf({ challengeBusinessDays: -3, holdExpiryDays: 0 }), { challengeBusinessDays: 1, challengeCountsWeekends: false, holdExpiryDays: 7 });
  assert.equal(holdSettingsOf({ challengeBusinessDays: 2, holdExpiryDays: 3 }).holdExpiryDays, 3);
});

test('a hold lapses by expiry or by a missed challenge deadline, and only then', () => {
  const now = new Date('2027-03-08T12:00:00Z');
  const future = new Date('2027-03-20T00:00:00Z');
  assert.equal(lapseReason({ id: 'a', status: 'held', rank: 1, expiresAt: future }, now), null);
  assert.equal(lapseReason({ id: 'a', status: 'held', rank: 1, expiresAt: new Date('2027-03-08T11:59:00Z') }, now), 'Hold expired');
  assert.equal(lapseReason({ id: 'a', status: 'challenged', rank: 1, expiresAt: future, challengeDeadline: new Date('2027-03-08T12:00:00Z') }, now), 'Did not confirm by the challenge deadline');
  assert.equal(lapseReason({ id: 'a', status: 'challenged', rank: 1, expiresAt: future, challengeDeadline: new Date('2027-03-08T12:01:00Z') }, now), null);
  assert.equal(lapseReason({ id: 'a', status: 'confirmed', rank: 1, expiresAt: new Date('2020-01-01') }, now), null);
});

test('a day is open, held or booked and a lapsed hold does not hold the day', () => {
  const now = new Date('2027-03-08T12:00:00Z');
  const live = { id: 'a', status: 'held', rank: 1, expiresAt: new Date('2027-03-20T00:00:00Z') };
  const dead = { id: 'b', status: 'held', rank: 1, expiresAt: new Date('2027-03-01T00:00:00Z') };
  assert.equal(dayState([], false, now), 'open');
  assert.equal(dayState([dead], false, now), 'open');
  assert.equal(dayState([live], false, now), 'held');
  assert.equal(dayState([live, { ...live, id: 'c', status: 'confirmed' }], false, now), 'booked');
  assert.equal(dayState([], true, now), 'booked');
});
