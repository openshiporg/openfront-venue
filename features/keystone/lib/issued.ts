/**
 * D15: the venue answers for the room's legal load whoever sells the tickets. Total issued is
 * own tickets sold + own comps + the connected issuer's sold (last live read) + imported outside barcodes + guest-list places,
 * compared with the configuration's capacity (never above the room's).
 */
export type IssuedParts = { ownSold: number; comps: number; connectedSold: number; imported: number; guestList: number };
export type Issued = IssuedParts & { total: number; capacity: number; over: boolean; overBy: number };

export function totalIssued(parts: IssuedParts, capacity: number): Issued {
  for (const [k, v] of Object.entries(parts)) if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Invalid ${k} count`);
  const total = parts.ownSold + parts.comps + parts.connectedSold + parts.imported + parts.guestList;
  const cap = Number.isSafeInteger(capacity) && capacity > 0 ? capacity : 0;
  // A room with no capacity entered cannot be checked; it never shows the warning.
  return { ...parts, total, capacity: cap, over: cap > 0 && total > cap, overBy: cap > 0 ? Math.max(0, total - cap) : 0 };
}

/** The configuration's capacity, capped at the room's licensed load; the room's when no configuration is set. */
export function configurationCapacity(roomCapacity: number | null | undefined, sectionCapacities: (number | null)[] | null): number {
  const room = Math.max(0, roomCapacity || 0);
  if (!sectionCapacities || !sectionCapacities.length) return room;
  const chart = sectionCapacities.reduce((n: number, c) => n + Math.max(0, c || 0), 0);
  return room ? Math.min(room, chart) : chart;
}

const LIVE_TICKET = { in: ['valid', 'checked_in'] };

export async function issuedCounts(prisma: any, eventId: string): Promise<Issued> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { issuer: true, connectedSold: true, room: { select: { capacity: true } }, seatingChart: { select: { chartSection_chart: { select: { capacity: true } } } } } });
  if (!event) throw new Error('Event not found');
  const [ownSold, comps, imported, guests] = await Promise.all([
    prisma.ticket.count({ where: { eventId, status: LIVE_TICKET, order: { status: { not: 'comp' } } } }),
    prisma.ticket.count({ where: { eventId, status: LIVE_TICKET, order: { status: 'comp' } } }),
    prisma.externalTicket.count({ where: { eventId, status: { not: 'void' } } }),
    prisma.guestListEntry.aggregate({ where: { eventId, status: { not: 'removed' } }, _sum: { plusOnes: true }, _count: { _all: true } }),
  ]);
  const connectedSold = ['openfront_concerts', 'openfront_comedy_club'].includes(event.issuer) ? event.connectedSold || 0 : 0;
  const capacity = configurationCapacity(event.room?.capacity, event.seatingChart ? event.seatingChart.chartSection_chart.map((s: any) => s.capacity) : null);
  return totalIssued({ ownSold, comps, connectedSold, imported, guestList: (guests._count._all || 0) + (guests._sum.plusOnes || 0) }, capacity);
}
