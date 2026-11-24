import { gql } from '../../lib/gql';
import { requireAnyPermission } from '../../lib/guard';
import { money, when } from '../../lib/format';
import { Page } from '../../components/ui-bits';
import { BarSalesForm } from '../../venue-deals/components/NightActuals';

/** Bar totals at close for shows that are over and not yet settled, from the POS report (D6). Newest first. */
export async function BarPage() {
  await requireAnyPermission('canManageSettlements');
  const data = await gql(`{ events(where: { status: { in: ["completed", "settling", "settled"] } }, orderBy: [{ showAt: desc }], take: 60) {
    id title status showAt room { name timezone }
    barSales_event { id grossCents compsCents voidsCents taxCents netCents report { id title } }
    venueDeal_event(where: { status: { in: ["accepted", "settled"] } }) { barMode barGuaranteeCents }
    settlement_event(where: { status: { in: ["signed_promoter", "signed_artist", "final"] } }) { id } } }`);
  const events: any[] = data.events;
  return (
    <Page title="Bar">
      {events.length ? events.map(e => {
        const bar = e.barSales_event[0]; const deal = e.venueDeal_event[0];
        return (
          <section key={e.id} className="space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{e.title}</span>
              <span className="text-sm text-muted-foreground">{[when(e.showAt, e.room?.timezone || undefined), e.room?.name].filter(Boolean).join(' · ')}</span>
            </div>
            {bar ? <p className="text-sm text-muted-foreground">Net {money(bar.netCents)}{deal?.barMode === 'guarantee' ? ` against a ${money(deal.barGuaranteeCents)} guarantee${bar.netCents < deal.barGuaranteeCents ? `: shortfall ${money(deal.barGuaranteeCents - bar.netCents)}` : ': met'}` : ''}{bar.report ? <> · <a className="underline" href={`/api/documents/${bar.report.id}`}>{bar.report.title}</a></> : ' · no report attached'}</p> : <p className="text-sm text-muted-foreground">Not recorded yet.</p>}
            <BarSalesForm eventId={e.id} bar={bar} frozen={e.settlement_event.length > 0} />
          </section>
        );
      }) : <p className="rounded-lg border p-6 text-sm text-muted-foreground">No finished shows yet. Bar totals are entered after doors close.</p>}
    </Page>
  );
}
