import { command } from '../lib/transaction';
import { appendAuditEvent } from '../lib/audit';
import { authorize } from './operators';
import { validateInquiry, inquiryMove } from '../lib/inquiries';
import { holdDay } from '../lib/venue-time';
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
export async function roomAvailability(_: any, { roomId, from, days }: any, context: any) {
  const start = new Date(holdDay(from || new Date().toISOString()));
  const span = Math.min(Math.max(Number(days) || 60, 1), 400);
  const end = new Date(+start + span * 86400000);
  const now = new Date();
  const [holds, events] = await Promise.all([
    context.prisma.dateHold.findMany({ where: { roomId, date: { gte: start, lt: end }, status: { in: ['held', 'challenged', 'confirmed'] } }, select: { id: true, date: true, status: true, rank: true, expiresAt: true, challengeDeadline: true } }),
    context.prisma.event.findMany({ where: { roomId, showAt: { gte: start, lt: end }, status: { notIn: ['cancelled'] } }, select: { showAt: true } }),
  ]);
  const eventDays = new Set(events.map((e: any) => e.showAt.toISOString().slice(0, 10)));
  const out: { date: string; state: string }[] = [];
  for (let i = 0; i < span; i++) {
    const day = new Date(+start + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: day, state: dayState(holds.filter((h: any) => h.date.toISOString().slice(0, 10) === day), eventDays.has(day), now) });
  }
  return out;
}
