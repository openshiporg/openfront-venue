import { transition } from '../lib/transaction';
import { appendAuditEvent } from '../lib/audit';
import { zonedDateTime, holdDay } from '../lib/venue-time';
import { HOLD_KINDS, challengeDeadline, holdSettingsOf, lapseReason } from '../lib/hold-rules';

const LIVE = ['held', 'challenged'];

export async function holdSettings(tx: any) {
  return holdSettingsOf(await tx.storeSettings.findFirst({ orderBy: { createdAt: 'asc' } }));
}

/**
 * Time without a cron: every request that touches a room day first closes what has lapsed there.
 * An expired hold, or a challenged hold past its deadline, is released with the reason written on it,
 * its rank is freed, and a challenged hold whose challenger is gone goes back to held. Idempotent.
 */
export async function settleDay(tx: any, roomId: string, date: Date, actor: string | null, now = new Date()) {
  const holds = await tx.dateHold.findMany({ where: { roomId, date, status: { in: LIVE } }, orderBy: { rank: 'asc' } });
  const released: string[] = [];
  for (const hold of holds) {
    const reason = lapseReason(hold, now);
    if (!reason) continue;
    await transition(tx, 'dateHold', hold.id, hold.status, 'released', actor, reason, { rankKey: null, releasedReason: reason });
    released.push(hold.id);
  }
  const live = await tx.dateHold.findMany({ where: { roomId, date, status: { in: LIVE } } });
  const liveIds = new Set(live.map((h: any) => h.id));
  for (const hold of live) {
    if (hold.status === 'challenged' && (!hold.challengedById || !liveIds.has(hold.challengedById))) {
      await transition(tx, 'dateHold', hold.id, 'challenged', 'held', actor, 'Challenger is no longer holding the date', { challengeDeadline: null, challengedById: null });
    }
  }
  return released;
}

/** The commands that move a date hold. `authorize` and the command wrapper are applied by `operator`. */
export async function runHoldCommand(operation: string, tx: any, input: any, actor: string) {
  const now = new Date();
  const audit = (id: string, after: any, reason = '') => appendAuditEvent(tx, actor, { action: operation, targetList: 'DateHold', targetId: id, after, reason });

  if (operation === 'placeDateHold') {
    const date = new Date(input.date);
    if (Number.isNaN(+date) || !Number.isInteger(input.rank) || input.rank < 1) throw new Error('Valid date and positive rank required');
    const room = input.roomId ? await tx.room.findUnique({ where: { id: input.roomId } }) : null;
    if (!room) throw new Error('Room required');
    const kind = input.kind || 'show';
    if (!(HOLD_KINDS as readonly string[]).includes(kind)) throw new Error('Unknown hold kind');
    if (date < new Date(holdDay(now.toISOString()))) throw new Error('Date is in the past');
    if (input.artistId && !(await tx.artist.findUnique({ where: { id: input.artistId } }))) throw new Error('Artist not found');
    if (input.promoterId && !(await tx.promoter.findUnique({ where: { id: input.promoterId } }))) throw new Error('Promoter not found');
    if (kind === 'rental' && !input.promoterId) throw new Error('A rental needs a promoter');
    const settings = await holdSettings(tx);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(+now + settings.holdExpiryDays * 86400000);
    if (Number.isNaN(+expiresAt) || expiresAt <= now) throw new Error('Expiry must be in the future');
    await settleDay(tx, room.id, date, actor, now);
    if (await tx.dateHold.count({ where: { roomId: room.id, date, status: 'confirmed' } })) throw new Error('Date is already confirmed');
    const rankKey = `${room.id}:${date.toISOString().slice(0, 10)}:${input.rank}`;
    if (await tx.dateHold.findUnique({ where: { rankKey } })) throw new Error(`Rank ${input.rank} is already held for this date`);
    const row = await tx.dateHold.create({ data: { roomId: room.id, date, kind, artistId: input.artistId || null, agencyId: input.agencyId || null, promoterId: input.promoterId || null, notes: String(input.notes || ''), rank: input.rank, rankKey, status: 'held', expiresAt } });
    await audit(row.id, { rank: row.rank, kind });
    return { id: row.id, status: row.status };
  }

  const row = await tx.dateHold.findUnique({ where: { id: input.holdId } });
  if (!row) throw new Error('Date hold not found');
  const lapsed = await settleDay(tx, row.roomId, row.date, actor, now);

  if (operation === 'releaseDateHold') {
    const fresh = await tx.dateHold.findUnique({ where: { id: row.id } });
    if (!['held', 'challenged'].includes(fresh.status)) {
      if (lapsed.includes(row.id)) return { id: row.id, status: 'released' };
      throw new Error('Only an unconfirmed hold can be released');
    }
    const reason = input.reason || 'Released by staff';
    await transition(tx, 'dateHold', fresh.id, fresh.status, 'released', actor, reason, { rankKey: null, releasedReason: reason });
    await settleDay(tx, row.roomId, row.date, actor, now);
    return { id: row.id, status: 'released' };
  }

  if (operation === 'challengeHold') {
    // holdId is the hold being challenged (the higher rank); byHoldId is the lower rank that is ready to confirm.
    const challenger = input.byHoldId ? await tx.dateHold.findUnique({ where: { id: input.byHoldId } }) : null;
    if (!challenger) throw new Error('The challenging hold is required');
    if (challenger.roomId !== row.roomId || +challenger.date !== +row.date) throw new Error('Both holds must be for the same room and date');
    if (challenger.status !== 'held') throw new Error('The challenging hold must be a live hold');
    if (row.status !== 'held') throw new Error(row.status === 'challenged' ? 'That hold is already challenged' : 'Hold expired');
    if (challenger.rank <= row.rank) throw new Error('Only a lower-ranked hold can challenge the hold above it');
    const room = await tx.room.findUnique({ where: { id: row.roomId } });
    const settings = await holdSettings(tx);
    const deadline = challengeDeadline(now, settings, room?.timezone || 'UTC');
    await transition(tx, 'dateHold', row.id, 'held', 'challenged', actor, `Challenged by rank ${challenger.rank}`, { challengeDeadline: deadline, challengedById: challenger.id });
    await audit(row.id, { challengedBy: challenger.id, challengeDeadline: deadline.toISOString() });
    return { id: row.id, status: 'challenged', challengeDeadline: deadline.toISOString(), challengedBy: challenger.id };
  }

  if (operation === 'confirmHold') {
    const fresh = await tx.dateHold.findUnique({ where: { id: row.id } });
    if (!['held', 'challenged'].includes(fresh.status)) throw new Error(fresh.releasedReason ? `Hold cannot be confirmed: ${fresh.releasedReason}` : 'Hold cannot be confirmed');
    // One confirmed hold per room and date across every kind; and no earlier live rank.
    if (await tx.dateHold.count({ where: { roomId: row.roomId, date: row.date, status: 'confirmed' } })) throw new Error('This date is already confirmed');
    if (await tx.dateHold.count({ where: { roomId: row.roomId, date: row.date, status: { in: LIVE }, rank: { lt: row.rank } } })) throw new Error('Earlier ranked hold must be released');
    const room = await tx.room.findUnique({ where: { id: row.roomId } });
    if (fresh.kind === 'internal' || fresh.kind === 'private_event') {
      await transition(tx, 'dateHold', row.id, fresh.status, 'confirmed', actor, '', { challengeDeadline: null });
      await audit(row.id, { kind: fresh.kind, status: 'confirmed' });
      return { id: row.id, status: 'confirmed' };
    }
    const title = String(input.title || '').trim();
    if (!title) throw new Error('Event title required');
    const chart = await tx.seatingChart.findUnique({ where: { id: input.seatingChartId } });
    if (!chart || chart.roomId !== row.roomId || chart.status !== 'published') throw new Error('Published room configuration required');
    if (input.ageRestriction && !['all_ages', '16', '18', '21'].includes(input.ageRestriction)) throw new Error('Unknown age restriction');
    const day = row.date.toISOString().slice(0, 10);
    const zone = room?.timezone || 'UTC';
    const showAt = input.showTime ? zonedDateTime(day, input.showTime, zone) : new Date(input.showAt || row.date);
    const doorsAt = input.doorsTime ? zonedDateTime(day, input.doorsTime, zone) : new Date(input.doorsAt || row.date);
    if (Number.isNaN(+showAt) || Number.isNaN(+doorsAt) || doorsAt > showAt) throw new Error('Doors must open before the show');
    const event = await tx.event.create({ data: { title, roomId: row.roomId, seatingChartId: chart.id, showAt, doorsAt, status: 'hold', promoterId: actor, ageRestriction: input.ageRestriction || 'all_ages' } });
    await transition(tx, 'dateHold', row.id, fresh.status, 'confirmed', actor, '', { eventId: event.id, challengeDeadline: null });
    if (row.artistId) await tx.eventArtist.create({ data: { eventId: event.id, artistId: row.artistId, billing: 'headliner', position: 1 } });
    await appendAuditEvent(tx, actor, { action: operation, targetList: 'Event', targetId: event.id, after: { status: 'hold' } });
    return { id: row.id, eventId: event.id, status: 'confirmed' };
  }
  throw new Error(`Unknown hold command ${operation}`);
}
