import { zonedDateTime } from './venue-time';

/** Settings that decide how long a hold lives and how long a challenged party has to answer. */
export type HoldSettings = { challengeBusinessDays: number; challengeCountsWeekends: boolean; holdExpiryDays: number };
export const DEFAULT_HOLD_SETTINGS: HoldSettings = { challengeBusinessDays: 1, challengeCountsWeekends: false, holdExpiryDays: 7 };
export const HOLD_KINDS = ['show', 'rental', 'private_event', 'internal'] as const;

export function holdSettingsOf(row: Partial<HoldSettings> | null | undefined): HoldSettings {
  return {
    challengeBusinessDays: Number.isInteger(row?.challengeBusinessDays) && row!.challengeBusinessDays! >= 0 ? row!.challengeBusinessDays! : DEFAULT_HOLD_SETTINGS.challengeBusinessDays,
    challengeCountsWeekends: row?.challengeCountsWeekends ?? DEFAULT_HOLD_SETTINGS.challengeCountsWeekends,
    holdExpiryDays: Number.isInteger(row?.holdExpiryDays) && row!.holdExpiryDays! >= 1 ? row!.holdExpiryDays! : DEFAULT_HOLD_SETTINGS.holdExpiryDays,
  };
}

/** Local wall-clock parts of an instant in a time zone. */
function wallClock(instant: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(instant).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

/**
 * The challenge deadline: the same wall-clock time, `days` business days later, in the room's time zone.
 * Weekends (Saturday and Sunday) are skipped unless the setting counts them. 0 days is the moment itself.
 * Friday 15:00 + 1 business day is Monday 15:00; with weekends counted it is Saturday 15:00.
 */
export function challengeDeadline(from: Date, settings: Pick<HoldSettings, 'challengeBusinessDays' | 'challengeCountsWeekends'>, timeZone: string) {
  const zone = timeZone || 'UTC';
  const local = wallClock(from, zone);
  if (settings.challengeBusinessDays <= 0) return new Date(from);
  const cursor = new Date(Date.UTC(local.year, local.month - 1, local.day));
  let remaining = settings.challengeBusinessDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (settings.challengeCountsWeekends || (weekday !== 0 && weekday !== 6)) remaining -= 1;
  }
  const hh = String(local.hour).padStart(2, '0');
  const mm = String(local.minute).padStart(2, '0');
  return zonedDateTime(cursor.toISOString().slice(0, 10), `${hh}:${mm}`, zone);
}

export type HoldRow = { id: string; status: string; rank: number; expiresAt: Date | string; challengeDeadline?: Date | string | null };
const at = (value: Date | string | null | undefined) => (value ? new Date(value) : null);

/** Why a hold that is still marked live is in fact over, or null when it is live. Applied on read and when the date is touched. */
export function lapseReason(hold: HoldRow, now: Date) {
  if (!['held', 'challenged'].includes(hold.status)) return null;
  if (+new Date(hold.expiresAt) <= +now) return 'Hold expired';
  const deadline = at(hold.challengeDeadline);
  if (hold.status === 'challenged' && deadline && +deadline <= +now) return 'Did not confirm by the challenge deadline';
  return null;
}
export const isLive = (hold: HoldRow, now: Date) => ['held', 'challenged'].includes(hold.status) && !lapseReason(hold, now);

/** Public availability of one room day: names and terms never leave the server. */
export function dayState(holds: HoldRow[], hasConfirmedEvent: boolean, now: Date): 'open' | 'held' | 'booked' {
  if (hasConfirmedEvent || holds.some(h => h.status === 'confirmed')) return 'booked';
  return holds.some(h => isLive(h, now)) ? 'held' : 'open';
}
