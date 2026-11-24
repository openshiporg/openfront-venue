import { keystoneContext } from '@/features/keystone/context';
import { viewVenueDeal } from '@/features/keystone/mutations/venueDeals';
import { formatCents as usd, formatBps as pct } from '@/features/keystone/lib/venue-deal';
import { DealAccept } from './DealAccept';

const label = (v: string) => v.replace(/_/g, ' ');

/** P11: the promoter or renter reads the deal sent to them, accepts it by typing their name, and later sees the final statement. */
export async function DealPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let deal: any = null;
  try { deal = await viewVenueDeal(null, { token }, keystoneContext.sudo()); } catch { deal = null; }
  if (!deal) return (
    <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-10">
      <h1 className="text-2xl font-semibold">This link is no longer valid</h1>
      <p className="text-sm text-muted-foreground">The venue may have sent a newer version of the deal. Ask them for the latest link.</p>
    </main>
  );
  const t = deal.terms || {};
  const zone = deal.event?.timezone || 'UTC';
  const showAt = deal.event?.showAt ? new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(new Date(deal.event.showAt)) : '';
  const items: [string, string][] = [];
  if (t.dealType === 'rental') items.push(['Rent', t.rentMode === 'flat' ? usd(t.rentCents) : t.rentMode === 'versus' ? `The greater of ${usd(t.rentCents)} or ${pct(t.rentPercentBps)} of ${t.rentBase}` : `${usd(t.rentCents)} plus ${pct(t.rentPercentBps)} of ${t.rentBase}`]);
  if (t.dealType === 'co_pro') items.push(['Co-promotion', `The venue takes ${pct(t.venueShareBps)} of the net (${(t.contributedRevenues || []).join(' and ')} less house and show costs), ${t.coProMode === 'upside' ? 'and never shares a loss' : 'and shares a loss in the same proportion'}`]);
  if (t.barMode === 'guarantee') items.push(['Bar guarantee', `Net bar sales of at least ${usd(t.barGuaranteeCents)}; you pay any shortfall`]);
  if (t.barMode === 'split') items.push(['Bar split', (t.barTiers || []).map((x: any) => `${pct(x.bps)} of net bar from ${usd(x.fromCents)}`).join('; ')]);
  if (t.facilityFeeCents) items.push(['Facility fee', `${usd(t.facilityFeeCents)} per ticket sold`]);
  if (t.ticketFeeShareBps) items.push(['Ticket fee share', `${pct(t.ticketFeeShareBps)} of the ticket seller's service fees`]);
  for (const h of t.houseExpenses || []) items.push([h.label, h.basis === 'flat' ? usd(h.amountCents) : `Clocked ${label(h.role)} hours × ${h.rateCents !== undefined ? `${usd(h.rateCents)} an hour` : 'the staff rate'}`]);
  if (t.depositCents) items.push(['Deposit', `${usd(t.depositCents)}${t.depositDueAt ? ` due ${t.depositDueAt.slice(0, 10)}` : ''}`]);
  if (t.balanceDueAt) items.push(['Balance due', t.balanceDueAt.slice(0, 10)]);
  if (t.insuranceRequired) items.push(['Insurance', `A certificate of insurance at ${usd(t.requiredLimitCents)} per occurrence, naming the venue as additional insured`]);
  items.push(['Tickets sold by', t.issuer === 'own' ? 'The venue box office' : t.issuer === 'other' ? 'Your ticket seller' : label(t.issuer).replace('openfront', 'Openfront')]);
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{deal.venue} · deal version {deal.version}</p>
        <h1 className="text-2xl font-semibold">{deal.event?.title || 'Your date'}</h1>
        <p className="text-sm">{[showAt, deal.event?.room].filter(Boolean).join(' · ')}</p>
        <p className="text-sm text-muted-foreground">For {deal.promoter}</p>
      </div>
      <dl className="divide-y rounded-lg border border-black/15 bg-white">
        {items.map(([k, v]) => <div key={k} className="grid gap-1 p-3 sm:grid-cols-3"><dt className="text-sm font-medium">{k}</dt><dd className="text-sm sm:col-span-2">{v}</dd></div>)}
      </dl>
      {t.notes ? <p className="whitespace-pre-line text-sm">{t.notes}</p> : null}
      {deal.status === 'sent' ? <DealAccept token={token} termsHash={deal.termsHash} /> : (
        <p className="rounded-lg border border-black/15 bg-white p-3 text-sm">
          {deal.status === 'accepted' || deal.status === 'settled' ? `Accepted by ${deal.acceptedByName} on ${String(deal.acceptedAt).slice(0, 10)}.` : `This deal is ${label(deal.status)}.`}
        </p>
      )}
      {deal.payments.length ? <section className="space-y-2"><h2 className="font-medium">Payments</h2>
        <ul className="divide-y rounded-lg border border-black/15 bg-white text-sm">{deal.payments.map((p: any, i: number) => <li key={i} className="flex justify-between p-3"><span>{label(p.kind)} {p.direction === 'in' ? 'received' : 'paid to you'} · {String(p.at).slice(0, 10)}</span><span className="tabular-nums">{usd(p.amountCents)}</span></li>)}</ul>
      </section> : null}
      {deal.settlement ? <section className="space-y-2"><h2 className="font-medium">Final statement</h2>
        <ul className="divide-y rounded-lg border border-black/15 bg-white text-sm">
          {deal.settlement.lines.map((l: any, i: number) => <li key={i} className="flex justify-between gap-4 p-3"><span><span className="block font-medium">{l.label}</span><span className="text-xs text-muted-foreground">{l.rule}</span></span><span className="tabular-nums">{usd(l.amountCents)}</span></li>)}
          <li className="flex justify-between p-3 font-semibold"><span>{deal.settlement.balanceCents > 0 ? 'You owe the venue' : deal.settlement.balanceCents < 0 ? 'The venue owes you' : 'Settled'}</span><span className="tabular-nums">{usd(Math.abs(deal.settlement.balanceCents))}</span></li>
        </ul>
      </section> : null}
      <p className="font-mono text-xs text-muted-foreground">Terms record {String(deal.termsHash).slice(0, 16)}</p>
    </main>
  );
}
