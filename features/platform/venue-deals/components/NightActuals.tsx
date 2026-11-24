'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runCommand } from '../../lib/commands';

const cents = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v) * 100));
const dollars = (c?: number | null) => (c ? (c / 100).toFixed(2) : '');

/** Upload one file to the private store as a Document, through the GraphQL multipart upload. Returns the Document id. */
export async function uploadDocument(file: File, title: string, kind: string, eventId: string): Promise<string> {
  const body = new FormData();
  body.append('operations', JSON.stringify({
    query: 'mutation($data: DocumentCreateInput!) { createDocument(data: $data) { id } }',
    variables: { data: { title, kind, event: { connect: { id: eventId } }, file: { upload: null } } },
  }));
  body.append('map', JSON.stringify({ 0: ['variables.data.file.upload'] }));
  body.append('0', file);
  const res = await fetch('/api/graphql', { method: 'POST', body, credentials: 'include', headers: { 'apollo-require-preflight': 'true' } });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data.createDocument.id;
}

/** Bar totals at close, from the POS report, with the report attached. Net = gross − comps − voids − tax. */
export function BarSalesForm({ eventId, bar, frozen }: { eventId: string; bar: any; frozen: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ gross: dollars(bar?.grossCents), comps: dollars(bar?.compsCents), voids: dollars(bar?.voidsCents), tax: dollars(bar?.taxCents) });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const net = cents(f.gross) - cents(f.comps) - cents(f.voids) - cents(f.tax);
  const save = async () => {
    setPending(true); setError('');
    try {
      const reportId = file ? await uploadDocument(file, `Bar POS report ${new Date().toISOString().slice(0, 10)}`, 'pos_report', eventId) : undefined;
      await runCommand('recordBarSales', { eventId, data: { grossCents: cents(f.gross), compsCents: cents(f.comps), voidsCents: cents(f.voids), taxCents: cents(f.tax), reportId } });
      router.refresh();
    } catch (e: any) { setError(e.message); } finally { setPending(false); }
  };
  if (frozen) return <p className="text-sm text-muted-foreground">Bar totals are frozen: the settlement is signed.</p>;
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      {([['gross', 'Gross'], ['comps', 'Comps'], ['voids', 'Voids'], ['tax', 'Tax']] as const).map(([k, l]) => (
        <label key={k} className="flex flex-col gap-1"><span className="font-medium">{l} ($)</span><Input className="w-28" inputMode="decimal" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
      ))}
      <label className="flex flex-col gap-1"><span className="font-medium">POS report</span><input type="file" accept=".pdf,.csv,.xlsx,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs" /></label>
      <span className="pb-2 tabular-nums">Net ${(net / 100).toFixed(2)}</span>
      <Button size="sm" className="min-h-11" disabled={pending || net < 0} onClick={save}>{pending ? 'Saving…' : 'Save bar totals'}</Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

/** Build the promoter statement. When another seller sold the tickets, staff enter the seller's totals and attach its report. */
export function BuildStatement({ eventId, ownBoxOffice, coPro }: { eventId: string; ownBoxOffice: boolean; coPro: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ gross: '', tax: '', sold: '', fees: '', show: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const build = async () => {
    setPending(true); setError('');
    try {
      const statementId = !ownBoxOffice && file ? await uploadDocument(file, 'Ticket seller statement', 'promoter_statement', eventId) : undefined;
      const data: any = { showExpensesCents: cents(f.show) };
      if (!ownBoxOffice) Object.assign(data, { statementId, ticketGrossCents: cents(f.gross), taxCents: cents(f.tax), ticketsSold: Number(f.sold || 0), outsideServiceFeesCents: cents(f.fees) });
      const r = await runCommand('buildPromoterSettlement', { eventId, data });
      router.push(`/dashboard/platform/settlements/${r.id}`);
    } catch (e: any) { setError(e.message); } finally { setPending(false); }
  };
  const box = (k: keyof typeof f, l: string, money = true) => <label key={k} className="flex flex-col gap-1"><span className="font-medium">{l}</span><Input className="w-32" inputMode={money ? 'decimal' : 'numeric'} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      {!ownBoxOffice ? <>
        {box('gross', 'Ticket gross ($)')}{box('tax', 'Ticket tax ($)')}{box('sold', 'Tickets sold', false)}{box('fees', 'Seller service fees ($)')}
        <label className="flex flex-col gap-1"><span className="font-medium">Seller statement</span><input type="file" accept=".pdf,.csv,.xlsx,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs" /></label>
      </> : <span className="pb-2 text-muted-foreground">Ticket money comes from our box office orders.</span>}
      {coPro ? box('show', 'Promoter show costs ($)') : null}
      <Button size="sm" className="min-h-11" disabled={pending} onClick={build}>{pending ? 'Working…' : 'Build promoter statement'}</Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
