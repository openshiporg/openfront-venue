'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runCommand } from '../../lib/commands';

type Tier = { from: string; pct: string };
type House = { label: string; category: string; basis: 'flat' | 'from_shifts'; role: string; amount: string; rate: string };
const toCents = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v) * 100));
const toBps = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v) * 100));
const dollars = (c?: number | null) => (c ? (c / 100).toFixed(2) : '');
const pct = (b?: number | null) => (b ? String(b / 100) : '');
const sel = 'h-9 rounded-md border bg-background px-2 text-sm';

const ROLES = ['security', 'crowd_manager', 'bartender', 'barback', 'box_office', 'door', 'sound', 'lights', 'stagehand', 'manager', 'server', 'cleaner'];
const CATS = ['security', 'stagehands', 'sound', 'lights', 'cleaning', 'insurance', 'box_office', 'other'];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="font-medium">{label}</span>{children}{hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}</label>;
}

/**
 * Draft or revise how the venue is paid for a show. A draft saves in place; a sent or accepted deal saves as the next version
 * and the promoter's old link stops working. Every percentage names its base.
 */
export function VenueDealEditor({ eventId, deal, promoters, onSaved }: { eventId: string; deal?: any; promoters: { value: string; label: string }[]; onSaved?: () => void }) {
  const router = useRouter();
  const d = deal || {};
  const [f, setF] = useState({
    promoterId: d.promoter?.id || '', dealType: d.dealType || 'rental', issuer: d.issuer || 'own',
    rentMode: d.rentMode || 'flat', rent: dollars(d.rentCents), rentPct: pct(d.rentPercentBps), rentBaseKind: d.rentBaseKind || 'net_of_tax_and_fees', rentBase: d.rentBase || '',
    coProMode: d.coProMode || 'upside', venueShare: pct(d.venueShareBps), barIn: Array.isArray(d.contributedRevenues) ? d.contributedRevenues.includes('bar') : false,
    barMode: d.barMode || 'none', barGuarantee: dollars(d.barGuaranteeCents),
    facilityFee: dollars(d.facilityFeeCents), feeShare: pct(d.ticketFeeShareBps), deposit: dollars(d.depositCents),
    depositDueAt: d.depositDueAt ? String(d.depositDueAt).slice(0, 10) : '', balanceDueAt: d.balanceDueAt ? String(d.balanceDueAt).slice(0, 10) : '',
    insuranceRequired: d.insuranceRequired ?? true, limit: d.requiredLimitCents ? String(d.requiredLimitCents / 100) : '1000000', notes: d.notes || '', reason: '',
  });
  const [tiers, setTiers] = useState<Tier[]>((Array.isArray(d.barTiers) ? d.barTiers : []).map((t: any) => ({ from: dollars(t.fromCents) || '0', pct: pct(t.bps) })));
  const [house, setHouse] = useState<House[]>((d.houseExpense_venueDeal || []).map((h: any) => ({ label: h.label, category: h.category, basis: h.basis, role: h.role || 'security', amount: dollars(h.amountCents), rate: dollars(h.rateCents) })));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const revising = deal && deal.status !== 'draft';

  const save = async () => {
    setPending(true); setError('');
    try {
      const data = {
        dealType: f.dealType, issuer: f.issuer, rentMode: f.rentMode, rentCents: toCents(f.rent), rentPercentBps: toBps(f.rentPct), rentBaseKind: f.rentBaseKind, rentBase: f.rentBase,
        coProMode: f.coProMode, venueShareBps: toBps(f.venueShare), contributedRevenues: f.barIn ? ['tickets', 'bar'] : ['tickets'],
        barMode: f.barMode, barGuaranteeCents: toCents(f.barGuarantee), barTiers: tiers.map(t => ({ fromCents: toCents(t.from), bps: toBps(t.pct) })),
        facilityFeeCents: toCents(f.facilityFee), ticketFeeShareBps: toBps(f.feeShare), depositCents: toCents(f.deposit),
        depositDueAt: f.depositDueAt || null, balanceDueAt: f.balanceDueAt || null, insuranceRequired: f.insuranceRequired, requiredLimitCents: toCents(f.limit), notes: f.notes,
        houseExpenses: house.map(h => h.basis === 'flat' ? { label: h.label, category: h.category, basis: 'flat', amountCents: toCents(h.amount) } : { label: h.label, category: h.category, basis: 'from_shifts', role: h.role, rateCents: h.rate.trim() ? toCents(h.rate) : undefined }),
      };
      await runCommand('saveVenueDeal', { eventId, dealId: deal?.id, promoterId: f.promoterId || undefined, reason: f.reason, data });
      onSaved?.(); router.refresh();
    } catch (e: any) { setError(e.message); } finally { setPending(false); }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Promoter or renter"><select className={sel} value={f.promoterId} onChange={set('promoterId')}><option value="">Choose…</option>{promoters.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
        <Field label="Deal"><select className={sel} value={f.dealType} onChange={set('dealType')}><option value="rental">Rental (four-wall)</option><option value="co_pro">Co-promotion</option><option value="in_house">In-house (we promote)</option></select></Field>
        <Field label="Who sells the tickets"><select className={sel} value={f.issuer} onChange={set('issuer')}><option value="own">Our box office</option><option value="openfront_concerts">Promoter on Openfront Concerts</option><option value="openfront_comedy_club">Openfront Comedy Club</option><option value="other">Another ticket seller</option></select></Field>
      </div>
      {f.dealType === 'rental' ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Rent"><select className={sel} value={f.rentMode} onChange={set('rentMode')}><option value="flat">Flat</option><option value="versus">Greater of minimum or %</option><option value="plus">Minimum plus %</option></select></Field>
          <Field label={f.rentMode === 'flat' ? 'Rent ($)' : 'Minimum ($)'}><Input inputMode="decimal" value={f.rent} onChange={set('rent')} /></Field>
          {f.rentMode !== 'flat' ? <Field label="Percent"><Input inputMode="decimal" value={f.rentPct} onChange={set('rentPct')} /></Field> : null}
          {f.rentMode !== 'flat' ? <Field label="Percent of"><select className={sel} value={f.rentBaseKind} onChange={set('rentBaseKind')}><option value="net_of_tax_and_fees">Tickets less tax and fees</option><option value="gross">Gross ticket money</option></select></Field> : null}
          {f.rentMode !== 'flat' ? <div className="sm:col-span-4"><Field label="Base, in words (shown to the promoter)"><Input value={f.rentBase} onChange={set('rentBase')} placeholder="Ticket money less refunds, sales tax, service fees and facility fees" /></Field></div> : null}
        </div>
      ) : null}
      {f.dealType === 'co_pro' ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Venue share (%)" hint="Of ticket net (and bar, if shared) less house and show costs"><Input inputMode="decimal" value={f.venueShare} onChange={set('venueShare')} /></Field>
          <Field label="Risk"><select className={sel} value={f.coProMode} onChange={set('coProMode')}><option value="upside">Upside only (venue never loses)</option><option value="up_and_down">Shares profit and loss</option></select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.barIn} onChange={set('barIn')} /> Bar goes into the pot</label>
        </div>
      ) : null}
      {f.dealType !== 'in_house' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Bar terms"><select className={sel} value={f.barMode} onChange={set('barMode')}><option value="none">None</option><option value="guarantee">Bar guarantee</option><option value="split">Bar split to the promoter</option></select></Field>
            {f.barMode === 'guarantee' ? <Field label="Guarantee on net bar ($)" hint="The promoter pays any shortfall"><Input inputMode="decimal" value={f.barGuarantee} onChange={set('barGuarantee')} /></Field> : null}
            <Field label="Facility fee per ticket ($)" hint="Billed when another seller sells"><Input inputMode="decimal" value={f.facilityFee} onChange={set('facilityFee')} /></Field>
            <Field label="Share of seller service fees (%)"><Input inputMode="decimal" value={f.feeShare} onChange={set('feeShare')} /></Field>
          </div>
          {f.barMode === 'split' ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Bar split tiers (each rate applies to net bar from its threshold to the next)</p>
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  From $<Input className="w-28" inputMode="decimal" value={t.from} onChange={e => setTiers(tiers.map((x, j) => j === i ? { ...x, from: e.target.value } : x))} aria-label="Tier from" />
                  pay <Input className="w-20" inputMode="decimal" value={t.pct} onChange={e => setTiers(tiers.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} aria-label="Tier percent" /> %
                  <Button size="sm" variant="ghost" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setTiers([...tiers, { from: tiers.length ? '' : '0', pct: '' }])}>Add tier</Button>
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium">House expenses billed to the promoter</p>
            {house.map((h, i) => {
              const up = (patch: Partial<House>) => setHouse(house.map((x, j) => j === i ? { ...x, ...patch } : x));
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <Input className="w-40" value={h.label} onChange={e => up({ label: e.target.value })} placeholder="Label" aria-label="Expense label" />
                  <select className={sel} value={h.category} onChange={e => up({ category: e.target.value })} aria-label="Category">{CATS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select>
                  <select className={sel} value={h.basis} onChange={e => up({ basis: e.target.value as any })} aria-label="Basis"><option value="flat">Flat</option><option value="from_shifts">Clocked shifts</option></select>
                  {h.basis === 'flat' ? <>$<Input className="w-28" inputMode="decimal" value={h.amount} onChange={e => up({ amount: e.target.value })} aria-label="Amount" /></> : <>
                    <select className={sel} value={h.role} onChange={e => up({ role: e.target.value })} aria-label="Role">{ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select>
                    at $<Input className="w-24" inputMode="decimal" value={h.rate} onChange={e => up({ rate: e.target.value })} placeholder="shift rate" aria-label="Hourly rate" />/h
                  </>}
                  <Button size="sm" variant="ghost" onClick={() => setHouse(house.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={() => setHouse([...house, { label: '', category: 'security', basis: 'from_shifts', role: 'security', amount: '', rate: '' }])}>Add house expense</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Deposit ($)"><Input inputMode="decimal" value={f.deposit} onChange={set('deposit')} /></Field>
            <Field label="Deposit due"><Input type="date" value={f.depositDueAt} onChange={set('depositDueAt')} /></Field>
            <Field label="Balance due"><Input type="date" value={f.balanceDueAt} onChange={set('balanceDueAt')} /></Field>
            <Field label="Insurance limit ($)"><Input inputMode="decimal" value={f.limit} onChange={set('limit')} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.insuranceRequired} onChange={set('insuranceRequired')} /> Certificate of insurance required</label>
          </div>
        </>
      ) : <p className="text-sm text-muted-foreground">An in-house show pays the artist through an offer and settles through the artist settlement. Record it here so the date carries its deal type.</p>}
      <Field label="Notes shown to the promoter"><textarea className="min-h-20 rounded-md border bg-background p-2 text-sm" value={f.notes} onChange={set('notes')} /></Field>
      {revising ? <Field label="Why the terms changed"><Input value={f.reason} onChange={set('reason')} placeholder="Promoter asked for a flat rent" /></Field> : null}
      <div className="flex items-center gap-3">
        <Button className="min-h-11" disabled={pending} onClick={save}>{pending ? 'Saving…' : revising ? `Save as version ${(deal.version || 1) + 1}` : 'Save draft'}</Button>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
