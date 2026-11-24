import { authorize } from './operators';
import { command, transition } from '../lib/transaction';

/** Publish only a coherent, non-empty room layout. Existing immutable versions are never rewritten. */
export async function publishSeatingChart(_: any, { input }: any, context: any) {
  authorize(context, 'canManageRooms');
  if (!input.idempotencyKey || !input.seatingChartId) throw new Error('Chart and idempotency key required');
  return command(context, { operation: 'publishSeatingChart', idempotencyKey: input.idempotencyKey, lock: `chart:${input.seatingChartId}`, params: input }, async tx => {
    const chart = await tx.seatingChart.findUnique({ where: { id: input.seatingChartId }, include: { room: true, chartSection_chart: { include: { seat_chartSection: true } } } });
    if (!chart || chart.status !== 'draft') throw new Error('Draft chart required');
    if (!chart.room || !chart.chartSection_chart.length) throw new Error('Room and sections required');
    let capacity = 0;
    for (const section of chart.chartSection_chart) {
      if (!section.name?.trim()) throw new Error('Section name required');
      if (section.kind === 'ga') {
        if (!Number.isSafeInteger(section.capacity) || section.capacity < 1 || section.seat_chartSection.length) throw new Error('GA section needs positive capacity and no reserved seats');
        capacity += section.capacity;
      } else {
        const seats = section.seat_chartSection;
        if (!seats.length || !seats.some((s: any) => s.status === 'sellable')) throw new Error('Reserved section needs sellable seats');
        const labels = seats.map((s: any) => s.label?.trim());
        if (labels.some((s: any) => !s) || new Set(labels).size !== labels.length) throw new Error('Seat labels must be non-empty and unique within a section');
        const sellable = seats.filter((s: any) => s.status === 'sellable').length;
        await tx.chartSection.update({ where: { id: section.id }, data: { capacity: sellable } });
        capacity += sellable;
      }
    }
    if (capacity > chart.room.capacity) throw new Error('Configuration capacity exceeds the room’s licensed capacity');
    await transition(tx, 'seatingChart', chart.id, 'draft', 'published', context.session.itemId);
    return { id: chart.id, status: 'published', capacity };
  });
}
