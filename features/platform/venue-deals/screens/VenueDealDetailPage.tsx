import { notFound } from 'next/navigation';
import { gql } from '../../lib/gql';
import { requireAnyPermission, roleFlags } from '../../lib/guard';
import { money, when, label } from '../../lib/format';
import { Page, Row, Rows, Stat, StatusLabel } from '../../components/ui-bits';
import { VenueDealEditor } from '../components/VenueDealEditor';
import { VenueDealActions } from '../components/VenueDealActions';
import { BarSalesForm, BuildStatement } from '../components/NightActuals';

const DEAL = 'id status version dealType issuer rentMode rentCents rentPercentBps rentBase rentBaseKind coProMode venueShareBps contributedRevenues barMode barGuaranteeCents barTiers facilityFeeCents ticketFeeShareBps depositCents depositDueAt balanceDueAt insuranceRequired requiredLimitCents notes termsHash acceptedByName acceptedAt sentAt cancelReason createdAt promoter { id company } houseExpense_venueDeal { id label category basis role amountCents rateCents } promoterPayment_venueDeal(orderBy: [{ createdAt: asc }]) { id direction kind amountCents method reference createdAt }';

function terms(d: any): string[] {
  const out: string[] = [];
  if (d.dealType === 'rental') out.push(d.rentMode === 'flat' ? `Flat rent ${money(d.rentCents)}` : `${d.rentMode === 'versus' ? 'Greater of' : ''} ${money(d.rentCents)} ${d.rentMode === 'versus' ? 'or' : 'plus'} ${d.rentPercentBps / 100}% of ${d.rentBase}`.trim());
  if (d.dealType === 'co_pro') out.push(`Venue takes ${d.venueShareBps / 100}% of net (${(d.contributedRevenues || ['tickets']).join(' and ')}), ${d.coProMode === 'upside' ? 'never below zero' : 'sharing losses'}`);
  if (d.barMode === 'guarantee') out.push(`Bar guarantee ${money(d.barGuaranteeCents)} on net bar; the promoter pays any shortfall`);
  if (d.barMode === 'split') out.push(`Bar split to the promoter: ${(d.barTiers || []).map((t: any) => `${t.bps / 100}% from ${money(t.fromCents)}`).join(', ')}`);
  if (d.facilityFeeCents) out.push(`Facility fee ${money(d.facilityFeeCents)} per ticket`);
  if (d.ticketFeeShareBps) out.push(`${d.ticketFeeShareBps / 100}% of the seller's service fees`);
  for (const h of d.houseExpense_venueDeal || []) out.push(`${h.label}: ${h.basis === 'flat' ? money(h.amountCents) : `clocked ${label(h.role)} hours × ${h.rateCents ? money(h.rateCents) : 'shift rate'}`}`);
  if (d.depositCents) out.push(`Deposit ${money(d.depositCents)}${d.depositDueAt ? ` due ${String(d.depositDueAt).slice(0, 10)}` : ''}`);
  if (d.insuranceRequired) out.push(`Certificate of insurance at ${money(d.requiredLimitCents)} per occurrence`);
  return out;
}

/** One booked date's venue deal: current terms, the promoter's link, payments, every earlier version, and settlement night. */
export async function VenueDealDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  await requireAnyPermission('canManageVenueDeals', 'canManageSettlements');
  const can = await roleFlags('canManageVenueDeals', 'canManageSettlements');
  const { eventId } = await params;
  const data = await gql(`query($id: ID!) {
    event(where: { id: $id }) { id title status showAt room { name timezone } promoter { id company }
      venueDeal_event(orderBy: [{ version: desc }]) { ${DEAL} }
      barSales_event { id grossCents compsCents voidsCents taxCents netCents report { id title } }
      settlement_event(where: { version: { gt: 0 } }, orderBy: [{ version: desc }]) { id party version status balanceDuePromoterCents balanceDueArtistCents } }
    promoters(orderBy: [{ company: asc }], take: 300) { id company }
  }`, { id: eventId });
  const e = data.event; if (!e) notFound();
  const versions: any[] = e.venueDeal_event;
  const live = versions.find(d => ['draft', 'sent', 'accepted', 'settled'].includes(d.status));
  const promoters = data.promoters.map((p: any) => ({ value: p.id, label: p.company }));
  const settlements: any[] = e.settlement_event;
  const promoterStatements = settlements.filter(s => s.party === 'promoter');
  const frozen = settlements.some(s => ['signed_promoter', 'signed_artist', 'final'].includes(s.status));
  const depositPaid = (live?.promoterPayment_venueDeal || []).filter((p: any) => p.kind === 'deposit').reduce((n: number, p: any) => n + p.amountCents, 0);
  const over = ['completed', 'settling', 'settled'].includes(e.status);
  return (
    <Page title={e.title} crumbs={[{ label: 'Venue deals', href: '/platform/venue-deals' }]}
      action={live && can.canManageVenueDeals ? <VenueDealActions dealId={live.id} status={live.status} depositLeftCents={Math.max(0, (live.depositCents || 0) - depositPaid)} /> : null}>
      <p className="text-sm text-muted-foreground">{[when(e.showAt, e.room?.timezone || undefined), e.room?.name, e.promoter?.company, label(e.status)].filter(Boolean).join(' · ')}</p>
      {live ? (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-3"><span className="font-medium">Version {live.version}</span><StatusLabel status={live.status} /><span className="text-sm text-muted-foreground">{label(live.dealType)} · {live.promoter?.company} · tickets: {label(live.issuer)}</span></div>
          <ul className="list-disc pl-5 text-sm">{terms(live).map((t, i) => <li key={i}>{t}</li>)}</ul>
          {live.notes ? <p className="text-sm">{live.notes}</p> : null}
          <p className="font-mono text-xs text-muted-foreground">{live.termsHash ? `Terms hash ${live.termsHash.slice(0, 16)}` : 'Not sent yet'}{live.acceptedByName ? ` · accepted by ${live.acceptedByName} ${when(live.acceptedAt, e.room?.timezone || undefined)}` : ''}</p>
        </div>
      ) : <p className="rounded-lg border p-4 text-sm text-muted-foreground">No live deal for this date.</p>}
      {can.canManageVenueDeals && (!live || ['draft', 'sent', 'accepted'].includes(live.status)) && !frozen ? (
        <details className="rounded-lg" open={!live}>
          <summary className="cursor-pointer text-sm font-medium">{!live ? 'Write the deal' : live.status === 'draft' ? 'Edit the draft' : `Revise (saves version ${live.version + 1})`}</summary>
          <div className="pt-3"><VenueDealEditor eventId={e.id} deal={live} promoters={promoters} /></div>
        </details>
      ) : null}
      {live ? <>
        <h2 className="text-sm font-medium">Promoter payments</h2>
        <div className="grid gap-3 sm:grid-cols-3"><Stat name="Deposit agreed" value={money(live.depositCents)} /><Stat name="Deposit received" value={money(depositPaid)} /><Stat name="Deposit outstanding" value={money(Math.max(0, live.depositCents - depositPaid))} /></div>
        <Rows empty="No payments recorded.">{live.promoterPayment_venueDeal.map((p: any) => <Row key={p.id} title={`${label(p.kind)} ${p.direction === 'in' ? 'from' : 'to'} the promoter`} meta={`${label(p.method)} ${p.reference} · ${when(p.createdAt, e.room?.timezone || undefined)}`} right={money(p.amountCents)} />)}</Rows>
      </> : null}
      {over && can.canManageSettlements ? <>
        <h2 className="text-sm font-medium">Bar at close</h2>
        {e.barSales_event[0] ? <p className="text-sm text-muted-foreground">Recorded: gross {money(e.barSales_event[0].grossCents)}, net {money(e.barSales_event[0].netCents)}{e.barSales_event[0].report ? ` · report attached` : ''}</p> : null}
        <BarSalesForm eventId={e.id} bar={e.barSales_event[0]} frozen={frozen} />
        {live && ['accepted', 'settled'].includes(live.status) && live.dealType !== 'in_house' && !frozen ? <>
          <h2 className="text-sm font-medium">Promoter statement</h2>
          <BuildStatement eventId={e.id} ownBoxOffice={live.issuer === 'own'} coPro={live.dealType === 'co_pro'} />
        </> : null}
      </> : null}
      {promoterStatements.length ? <>
        <h2 className="text-sm font-medium">Statements</h2>
        <Rows>{promoterStatements.map(s => <Row key={s.id} href={`/dashboard/platform/settlements/${s.id}`} title={`Promoter statement v${s.version}`} status={s.status} right={money(s.balanceDuePromoterCents)} />)}</Rows>
      </> : null}
      {versions.length > 1 || (versions.length && !live) ? <>
        <h2 className="text-sm font-medium">Earlier versions</h2>
        <Rows>{versions.filter(d => d !== live).map(d => <Row key={d.id} title={`Version ${d.version}`} status={d.status} meta={[terms(d).slice(0, 2).join('; '), d.cancelReason].filter(Boolean).join(' · ')} right={d.termsHash ? d.termsHash.slice(0, 10) : ''} />)}</Rows>
      </> : null}
    </Page>
  );
}
