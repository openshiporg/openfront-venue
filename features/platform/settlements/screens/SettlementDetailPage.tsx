import { requireAnyPermission } from '../../lib/guard';
import { notFound } from 'next/navigation';
import { gql } from '../../lib/gql';
import { money } from '../../lib/format';
import { Page, Row, Rows, StatusLabel } from '../../components/ui-bits';
import { SettlementActions } from '../components/SettlementActions';

const PROMOTER_SHEET: [string, string][] = [['Ticket gross', 'ticketGrossCents'], ['Tax', 'taxCents'], ['Fees in the gross', 'ticketFeesCents'], ['Net box office', 'netBoxOfficeCents'], ['House expenses', 'totalExpensesCents'], ['Deposits paid', 'depositsPaidCents'], ['Balance (promoter owes +, venue owes −)', 'balanceDuePromoterCents']];
const WORKSHEET: [string, string][] = [['Gross tickets', 'ticketGrossCents'], ['Pass-through fees', 'ticketFeesCents'], ['Tax', 'taxCents'], ['Net box office', 'netBoxOfficeCents'], ['Counted expenses', 'totalExpensesCents'], ['Breakeven', 'breakevenCents'], ['Split base', 'splitPointCents'], ['Artist guarantee', 'artistGuaranteeCents'], ['Artist overage', 'artistOverageCents'], ['Artist total', 'artistTotalCents'], ['Venue merch share', 'merchVenueShareCents'], ['Deposits paid', 'depositsPaidCents'], ['Balance due to artist', 'balanceDueArtistCents'], ['Promoter net', 'promoterNetCents']];

export async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission('canManageSettlements');
  const { id } = await params;
  const data = await gql(`query($id: ID!) { settlement(where: { id: $id }) { id version status hash party balanceDuePromoterCents venueDeal { id promoter { company } } event { id title } ${WORKSHEET.map(([, k]) => k).join(' ')} paidCount compCount settlementLine_settlement(orderBy: [{ createdAt: asc }]) { id kind label rule amountCents roundingRemainder } artistPayment_settlement { id kind amountCents status reference } } }`, { id });
  const s = data.settlement; if (!s) notFound();
  const peers = await gql(`query($eventId: ID!, $party: String!) { settlements(where: { event: { id: { equals: $eventId } }, party: { equals: $party } }, orderBy: [{ version: desc }], take: 1) { id } users(where: { role: { canApproveAdjustments: { equals: true } } }, take: 50) { id name } authenticatedItem { ... on User { id } } }`, { eventId: s.event.id, party: s.party || 'artist' }).catch(() => null);
  const latest = !peers || peers.settlements?.[0]?.id === s.id;
  const approvers = (peers?.users || []).filter((u: any) => u.id !== peers?.authenticatedItem?.id);
  const promoter = s.party === 'promoter';
  const sheet = promoter ? PROMOTER_SHEET : WORKSHEET;
  return (
    <Page title={`${s.event?.title} · ${promoter ? 'promoter' : 'artist'} statement v${s.version}`} crumbs={[{ label: 'Settlements', href: '/platform/settlements' }]} action={<SettlementActions settlementId={s.id} eventId={s.event.id} status={s.status} party={s.party || 'artist'} dueCents={promoter ? s.balanceDuePromoterCents : s.balanceDueArtistCents} latest={latest} approvers={approvers} />}>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><StatusLabel status={s.status} /><span className="font-mono text-xs">Hash {String(s.hash).slice(0, 12)}</span><span>{s.paidCount} paid · {s.compCount} comp</span>{promoter && s.venueDeal ? <span>{s.venueDeal.promoter?.company}</span> : null}<a className="underline" href={`/api/settlements/${s.id}/export?format=pdf`}>Export PDF</a><a className="underline" href={`/api/settlements/${s.id}/export?format=csv`}>Export CSV</a></div>
      <div className="divide-y rounded-lg border">
        {sheet.map(([name, key]) => <div key={key} className="flex items-center justify-between gap-4 p-3 text-sm"><span>{name}</span><span className="font-medium tabular-nums">{money(s[key])}</span></div>)}
      </div>
      <h2 className="text-sm font-medium">Lines</h2>
      <Rows empty="No lines.">{s.settlementLine_settlement.map((l: any) => <Row key={l.id} title={l.label} meta={[l.kind.replace(/_/g, ' '), l.rule].filter(Boolean).join(' · ')} right={l.roundingRemainder ? `remainder ${l.roundingRemainder}/10000` : money(l.amountCents)} />)}</Rows>
      {promoter ? null : <>
      <h2 className="text-sm font-medium">Artist payments</h2>
      <Rows empty="No payments recorded.">{s.artistPayment_settlement.map((p: any) => <Row key={p.id} title={`${p.kind} ${p.reference}`} status={p.status} right={money(p.amountCents)} />)}</Rows>
      </>}
    </Page>
  );
}
