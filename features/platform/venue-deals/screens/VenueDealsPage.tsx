import { gql } from '../../lib/gql';
import { requireAnyPermission } from '../../lib/guard';
import { money, when, label } from '../../lib/format';
import { FilterTabs, Page, Row, Rows } from '../../components/ui-bits';

const SUMMARY = (d: any) => d.dealType === 'in_house' ? 'In-house'
  : d.dealType === 'co_pro' ? `Co-pro ${d.venueShareBps / 100}% ${d.coProMode === 'upside' ? 'upside' : 'up and down'}`
  : d.rentMode === 'flat' ? `Rent ${money(d.rentCents)}` : `Rent ${money(d.rentCents)} ${d.rentMode === 'versus' ? 'vs' : '+'} ${d.rentPercentBps / 100}%`;

/** Every booked date that has, or needs, a venue deal. Booked dates without a live deal are listed first. */
export async function VenueDealsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAnyPermission('canManageVenueDeals', 'canManageSettlements');
  const { status } = await searchParams;
  const data = await gql(`{
    venueDeals(where: { status: { in: ["draft", "sent", "accepted", "settled", "cancelled"] } }, orderBy: [{ updatedAt: desc }], take: 300) { id status version dealType rentMode rentCents rentPercentBps venueShareBps coProMode barMode issuer acceptedByName event { id title showAt room { name timezone } } promoter { company } }
    events(where: { status: { notIn: ["cancelled", "settled"] } }, orderBy: [{ showAt: asc }], take: 300) { id title showAt status room { name timezone } promoter { company } venueDeal_event(where: { status: { in: ["draft", "sent", "accepted"] } }) { id } }
  }`);
  const deals = (data.venueDeals as any[]).filter(d => !status || d.status === status);
  const missing = (data.events as any[]).filter(e => !e.venueDeal_event.length);
  return (
    <Page title="Venue deals">
      <FilterTabs base="/dashboard/platform/venue-deals" current={status} options={[{ value: '', label: 'All' }, ...['draft', 'sent', 'accepted', 'settled', 'cancelled'].map(v => ({ value: v, label: label(v) }))]} />
      {!status && missing.length ? <>
        <h2 className="text-sm font-medium">Booked, no deal yet</h2>
        <Rows>{missing.map(e => <Row key={e.id} href={`/dashboard/platform/venue-deals/${e.id}`} title={e.title} status={e.status} meta={[when(e.showAt, e.room?.timezone || undefined), e.room?.name, e.promoter?.company].filter(Boolean).join(' · ')} right="Write deal" />)}</Rows>
      </> : null}
      <h2 className="text-sm font-medium">Deals</h2>
      <Rows empty="No venue deals yet. Confirm a rental hold on the calendar, then write its deal here.">
        {deals.map(d => <Row key={d.id} href={`/dashboard/platform/venue-deals/${d.event?.id}`} title={`${d.event?.title || 'Show'} · v${d.version}`} status={d.status}
          meta={[when(d.event?.showAt, d.event?.room?.timezone || undefined), d.event?.room?.name, d.promoter?.company, d.acceptedByName ? `accepted by ${d.acceptedByName}` : ''].filter(Boolean).join(' · ')}
          right={SUMMARY(d)} />)}
      </Rows>
    </Page>
  );
}
