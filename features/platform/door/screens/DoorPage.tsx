import { notFound } from 'next/navigation';
import { requireAnyPermission } from '../../lib/guard';
import { gql } from '../../lib/gql';
import { when } from '../../lib/format';
import { Page, Row, Rows, Stat } from '../../components/ui-bits';
import { ScanConsole } from '../components/ScanConsole';
import { isVenueToday } from '../../operations/lib/today';

export async function DoorPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  await requireAnyPermission('canScanTickets');
  const { event: selected } = await searchParams;
  const list = await gql(`{ events(where: { status: { in: ["on_sale", "sold_out", "doors", "in_progress", "completed"] } }, orderBy: [{ showAt: asc }], take: 30) { id title status showAt room { timezone } } }`);
  // Today's shows first, then upcoming soonest, then past shows newest first.
  const clock = new Date(); const nowIso = clock.toISOString();
  const rank = (e: any) => isVenueToday(e.showAt, e.room?.timezone, clock) ? 0 : e.showAt >= nowIso ? 1 : 2;
  list.events.sort((a: any, b: any) => rank(a) - rank(b) || (rank(a) === 2 ? String(b.showAt).localeCompare(String(a.showAt)) : String(a.showAt).localeCompare(String(b.showAt))));
  // A named event that is not open for scanning is a 404, never another event's door.
  let named = selected === undefined ? null : list.events.find((e: any) => e.id === selected);
  if (selected !== undefined && !named) {
    const found = await gql(`query($id: ID!) { events(where: { id: { equals: $id }, status: { in: ["on_sale", "sold_out", "doors", "in_progress", "completed"] } }, take: 1) { id title status showAt } }`, { id: String(selected) }).catch(() => ({ events: [] }));
    named = found.events[0];
    if (!named) notFound();
  }
  const current = named || list.events.find((e: any) => ['doors', 'in_progress'].includes(e.status)) || list.events.find((e: any) => rank(e) < 2) || list.events[0];
  // Admitted counts places from every source (own, connected seller, imported, guest list); issued is D15's total from every seller.
  const detail = current ? await gql(`query($id: ID!) { scans: scanEvents(where: { event: { id: { equals: $id } } }, orderBy: [{ at: desc }], take: 15) { id gate result source message codeLast4 places at ticket { ticketCode } guestListEntry { name } externalTicket { holderName } } event(where: { id: $id }) { issuer externalSellerName connection { status siblingName } } issued: eventIssued(eventId: $id) admittedScans: scanEvents(where: { event: { id: { equals: $id } }, result: { equals: "admitted" } }) { places } }`, { id: current.id }) : null;
  const admitted = detail ? detail.admittedScans.reduce((n: number, s: any) => n + (s.places || 1), 0) : 0;
  const issued = detail?.issued;
  const seller = detail?.event?.issuer === 'own' ? 'Box office' : detail?.event?.externalSellerName || 'Another seller';
  return (
    <Page title="Door scan">
      {current && detail ? <section className="space-y-3"><h2 className="text-base font-semibold">{current.title} <span className="font-normal text-muted-foreground">· {when(current.showAt)}</span></h2>
        <p className="text-sm text-muted-foreground">Tickets sold by {seller}{detail.event?.connection && detail.event.connection.status !== 'connected' ? ' · the connection needs reconnecting; connected tickets will not admit' : ''}{issued && !issued.fresh ? ` · ${issued.message}` : ''}</p>
        <div className="grid grid-cols-3 gap-3"><Stat name="Admitted" value={admitted} /><Stat name="Issued, every seller" value={issued?.total ?? ''} /><Stat name="Capacity" value={issued?.capacity || ''} /></div>
        {issued?.over ? <p role="alert" className="rounded-lg border-2 border-amber-600 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Issued is {issued.overBy} over this room’s capacity ({issued.ownSold} sold here, {issued.comps} comps, {issued.connectedSold} by the connected seller, {issued.imported} imported, {issued.guestList} on the guest list).</p> : null}
        {['doors', 'in_progress'].includes(current.status) ? <ScanConsole eventId={current.id} /> : <p className="text-sm text-muted-foreground">Scanning opens when the event is at doors.</p>}
        <h3 className="pt-2 text-sm font-medium">Latest scans</h3>
        <Rows empty="No scans yet.">{detail.scans.map((s: any) => <Row key={s.id} title={s.ticket?.ticketCode || s.guestListEntry?.name || s.externalTicket?.holderName || (s.codeLast4 ? `…${s.codeLast4}` : 'Scan')} status={['admitted', 'reentry'].includes(s.result) ? 'confirmed' : 'void'} meta={[s.gate, s.source.replace(/_/g, ' '), s.result.replace(/_/g, ' '), s.places > 1 ? `${s.places} people` : '', s.message].filter(Boolean).join(' · ')} right={when(s.at)} />)}</Rows></section> : null}
      <section className="space-y-2"><h2 className="text-sm font-medium">{current ? 'Other events' : 'Events'}</h2>
        <Rows empty="No events are open for scanning.">{list.events.filter((e: any) => e.id !== current?.id).map((e: any) => <Row key={e.id} href={`/dashboard/platform/door?event=${e.id}`} title={e.title} status={e.status} meta={when(e.showAt)} />)}</Rows></section>
    </Page>
  );
}
