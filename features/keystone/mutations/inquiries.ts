import { command } from '../lib/transaction';
import { appendAuditEvent } from '../lib/audit';
import { authorize } from './operators';
import { validateInquiry, inquiryMove } from '../lib/inquiries';
import { holdDay, localDay } from '../lib/venue-time';
import { dayState } from '../lib/hold-rules';

/** Public: a promoter, agent or client asks for a date. Idempotent on the key; a filled `website` field is a bot and is dropped. */
export async function submitInquiry(_: any, { input }: any, context: any) {
  if (!input?.idempotencyKey) throw new Error('Idempotency key required');
  if (String(input.website || '').trim()) return { id: null, status: 'new' };
  const data = validateInquiry(input);
  if (input.roomId && !(await context.prisma.room.findUnique({ where: { id: input.roomId } }))) throw new Error('Room not found');
  return command(context, { operation: 'submitInquiry', idempotencyKey: input.idempotencyKey, lock: `inquiry:${data.email}`, params: { ...input, data } }, async tx => {
    const recent = await tx.inquiry.count({ where: { email: data.email, createdAt: { gt: new Date(Date.now() - 3600000) } } });
    if (recent >= 5) throw new Error('Too many requests from this email. Please wait an hour or call us.');
    const row = await tx.inquiry.create({ data: { ...data, roomId: input.roomId || null, status: 'new' } });
    await appendAuditEvent(tx, null, { action: 'submitInquiry', targetList: 'Inquiry', targetId: row.id, after: { kind: row.kind } });
    return { id: row.id, status: row.status };
  });
}

/** Staff: take, win or lose an inquiry; optionally link it to the promoter who asked. */
export async function workInquiry(_: any, { input }: any, context: any) {
  authorize(context, 'canManageInquiries');
  if (!input?.idempotencyKey) throw new Error('Idempotency key required');
  const actor = context.session.itemId;
  return command(context, { operation: 'workInquiry', idempotencyKey: input.idempotencyKey, lock: `inquiry-row:${input.inquiryId}`, params: input }, async tx => {
    const row = await tx.inquiry.findUnique({ where: { id: input.inquiryId } });
    if (!row) throw new Error('Inquiry not found');
    const to = String(input.status || '');
    inquiryMove(row.status, to, String(input.reason || ''));
    const count = await tx.inquiry.updateMany({ where: { id: row.id, status: row.status }, data: { status: to, handledById: actor, lostReason: to === 'lost' ? String(input.reason).trim() : row.lostReason, promoterId: input.promoterId || row.promoterId } });
    if (count.count !== 1) throw new Error('Inquiry changed; reload it');
    await appendAuditEvent(tx, actor, { action: `${row.status}:${to}`, targetList: 'Inquiry', targetId: row.id, before: { status: row.status }, after: { status: to }, reason: String(input.reason || '') });
    return { id: row.id, status: to };
  });
}

/**
 * Public availability by day for one room: open, held or booked. Nothing about who holds a date or on what terms.
 * Lapsed holds are ignored on read; nothing is written.
 */
/**
 * Public avails (dissertation §5.12, P9): for each day from `from` to `to` (inclusive, at most 400 days), open, held or booked.
 * No names, ranks or holders. Days are the room's local days, and holds lapse on read. With no room, a day is booked when any
 * room is booked, held when any is held. Events count on the day they start in the room's time zone.
 */
export async function venueAvails(_: any, { from, to, roomId }: any, context: any) {
  const start = new Date(holdDay(from || new Date().toISOString()));
  const last = new Date(holdDay(to || new Date(+start + 59 * 86400000).toISOString()));
  if (last < start) throw new Error('The end date is before the start date');
  const span = Math.round((+last - +start) / 86400000) + 1;
  if (span > 400) throw new Error('Ask for at most 400 days');
  const end = new Date(+last + 86400000);
  const now = new Date();
  const rooms = await context.prisma.room.findMany({ where: roomId ? { id: roomId } : {}, select: { id: true, timezone: true } });
  if (roomId && !rooms.length) throw new Error('Room not found');
  const zoneOf = new Map<string, string>(rooms.map((r: any) => [r.id, r.timezone || 'UTC']));
  const ids = rooms.map((r: any) => r.id);
  const [holds, events] = await Promise.all([
    context.prisma.dateHold.findMany({ where: { roomId: { in: ids }, date: { gte: start, lt: end }, status: { in: ['held', 'challenged', 'confirmed'] } }, select: { id: true, roomId: true, date: true, status: true, rank: true, expiresAt: true, challengeDeadline: true } }),
    // A day either side so a show near midnight UTC lands on its local day.
    context.prisma.event.findMany({ where: { roomId: { in: ids }, showAt: { gte: new Date(+start - 86400000), lt: new Date(+end + 86400000) }, status: { notIn: ['cancelled'] } }, select: { roomId: true, showAt: true } }),
  ]);
  const booked = new Set(events.map((e: any) => `${e.roomId}|${localDay(e.showAt, zoneOf.get(e.roomId) || 'UTC')}`));
  const rank: Record<string, number> = { open: 0, held: 1, booked: 2 };
  const out: { date: string; state: string }[] = [];
  for (let i = 0; i < span; i++) {
    const day = new Date(+start + i * 86400000).toISOString().slice(0, 10);
    let state = 'open';
    for (const id of ids) {
      const s = dayState(holds.filter((h: any) => h.roomId === id && h.date.toISOString().slice(0, 10) === day), booked.has(`${id}|${day}`), now);
      if (rank[s] > rank[state]) state = s;
    }
    out.push({ date: day, state });
  }
  return out;
}

/** Public: the rooms a buyer or client may ask for, with only what the public pages show. */
export async function publicRooms(_: any, __: any, context: any) {
  const rows = await context.sudo().prisma.room.findMany({ orderBy: { name: 'asc' }, take: 50, select: { id: true, name: true, city: true, capacity: true, description: true, accessibilityNotes: true, timezone: true } });
  return rows.map((r: any) => ({ ...r, timezone: r.timezone || 'UTC' }));
}
