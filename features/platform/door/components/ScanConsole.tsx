'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { runCommand, readQuery } from '../../lib/commands';
import { CameraScan } from './CameraScan';

const GO = 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
const STOP = 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100';
const ASK = 'border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100';
/** One scanner for every seller (§4.6): own, connected Openfront, imported barcodes, guest list, will-call. */
const RESULT: Record<string, { title: string; tone: string }> = {
  admitted: { title: 'Admit', tone: GO },
  reentry: { title: 'Re-entry: admit', tone: GO },
  duplicate: { title: 'Already scanned', tone: STOP },
  void: { title: 'Not valid: refunded, voided or sent on', tone: STOP },
  wrong_event: { title: 'Ticket for another show', tone: ASK },
  not_found: { title: 'Unknown ticket', tone: STOP },
  issuer_refused: { title: 'Seller refused this ticket', tone: STOP },
  issuer_unreachable: { title: 'Do not admit: seller not answering', tone: ASK },
};
const SOURCE: Record<string, string> = { own: 'Box office ticket', connected: 'Checked with the seller', external: 'Imported barcode', guest_list: 'Guest list', will_call: 'Will-call, ID checked' };
const admits = (r: string) => r === 'admitted' || r === 'reentry';

export function ScanConsole({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [code, setCode] = useState(''); const [gate, setGate] = useState('Main'); const [last, setLast] = useState<any>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState(''); const [found, setFound] = useState<any>(null); const [idChecked, setIdChecked] = useState<Record<string, boolean>>({});
  function show(result: any) { setLast({ ...result, at: new Date() }); navigator.vibrate?.(admits(result.result) ? 80 : [60, 60, 60]); router.refresh(); }
  async function act(fn: () => Promise<any>) {
    setError(''); setBusy(true);
    try { show(await fn()); } catch (e: any) { setLast(null); setError(e.message); navigator.vibrate?.([60, 60, 60]); } finally { setBusy(false); }
  }
  const scan = (raw: string) => { const value = raw.trim(); if (!value) return; return act(async () => { const r = await runCommand('scanTicket', { eventId, code: value, gate: gate.trim() || 'Main' }); setCode(''); return r; }); };
  async function search(e: React.FormEvent) {
    e.preventDefault(); setError('');
    try { setFound((await readQuery('query($e: ID, $t: String) { doorSearch(eventId: $e, term: $t) }', { e: eventId, t: term.trim() })).doorSearch.found); } catch (err: any) { setError(err.message); }
  }
  const refreshSearch = () => term.trim() && readQuery('query($e: ID, $t: String) { doorSearch(eventId: $e, term: $t) }', { e: eventId, t: term.trim() }).then(d => setFound(d.doorSearch.found)).catch(() => undefined);
  const willCall = (key: string, input: Record<string, unknown>) => act(async () => { const r = await runCommand('admitWillCall', { ...input, idChecked: true, gate: gate.trim() || 'Will-call' }); refreshSearch(); return r; }).then(() => setIdChecked(c => ({ ...c, [key]: false })));
  const guest = (id: string, quantity: number) => act(async () => { const r = await runCommand('admitGuestListEntry', { guestListEntryId: id, quantity, gate: gate.trim() || 'Main' }); refreshSearch(); return r; });
  const shown = last ? RESULT[last.result] || { title: last.result, tone: 'border-border' } : null;
  const checkbox = (key: string) => <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!idChecked[key]} onChange={e => setIdChecked(c => ({ ...c, [key]: e.target.checked }))} /> ID checked</label>;
  return (
    <div className="space-y-4">
      {shown ? <div role="status" aria-live="assertive" className={cn('rounded-lg border-2 p-4', shown.tone)}>
        <p className="text-2xl font-semibold">{shown.title}{last.places > 1 && admits(last.result) ? ` ${last.places}` : ''}</p>
        {last.message ? <p className="text-sm">{last.message}</p> : null}
        <p className="text-sm opacity-80">{[SOURCE[last.source], last.codeLast4 ? `…${last.codeLast4}` : '', `${last.admitted} admitted so far`].filter(Boolean).join(' · ')}</p></div> : null}
      {error ? <p role="alert" className="rounded-lg border-2 border-red-600 bg-red-50 p-4 text-base font-medium text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p> : null}
      <CameraScan onCode={scan} busy={busy} />
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); scan(code); }}>
        <label className="flex-1 space-y-1 text-sm font-medium">Ticket code or barcode<Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TK-… or the seller’s barcode" autoCapitalize="characters" autoComplete="off" className="h-11 text-base" /></label>
        <label className="space-y-1 text-sm font-medium sm:w-32">Gate<Input value={gate} onChange={(e) => setGate(e.target.value)} className="h-11 text-base" /></label>
        <Button type="submit" className="h-11" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Check ticket'}</Button>
      </form>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={search}>
        <label className="flex-1 space-y-1 text-sm font-medium">Will-call and guest list<Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, email, order number or last 4 of a barcode" autoComplete="off" className="h-11 text-base" /></label>
        <Button type="submit" variant="outline" className="h-11">Search</Button>
      </form>
      {found ? <div className="divide-y rounded-lg border text-sm">
        {found.tickets.map((t: any) => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div><p className="font-medium">{t.holderName || t.order?.guestName || 'Ticket holder'}</p><p className="text-xs text-muted-foreground">{[t.ticketCode, t.order?.orderNumber, t.seatInventory?.seat?.label, t.status.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</p></div>
          {t.status === 'valid' ? <div className="flex items-center gap-2">{checkbox(t.id)}<Button size="sm" disabled={busy || !idChecked[t.id]} onClick={() => willCall(t.id, { ticketId: t.id })}>Admit</Button></div> : null}</div>)}
        {found.external.map((t: any) => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div><p className="font-medium">{t.holderName || 'Ticket holder'}</p><p className="text-xs text-muted-foreground">{[t.batch?.sellerName, t.ticketType, `…${t.barcodeLast4}`, t.status.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</p></div>
          {t.status === 'valid' ? <div className="flex items-center gap-2">{checkbox(t.id)}<Button size="sm" disabled={busy || !idChecked[t.id]} onClick={() => willCall(t.id, { externalTicketId: t.id })}>Admit</Button></div> : null}</div>)}
        {found.guests.map((g: any) => { const left = 1 + g.plusOnes - g.admittedCount; return <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div><p className="font-medium">{g.name}{g.plusOnes ? ` +${g.plusOnes}` : ''}</p><p className="text-xs text-muted-foreground">{[`Guest list (${g.addedFor})`, g.note, `${g.admittedCount} of ${1 + g.plusOnes} in`].filter(Boolean).join(' · ')}</p></div>
          {left > 0 ? <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => guest(g.id, 1)}>Admit 1</Button>{left > 1 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => guest(g.id, left)}>Admit all {left}</Button> : null}</div> : null}</div>; })}
        {!found.tickets.length && !found.external.length && !found.guests.length ? <p className="p-3 text-muted-foreground">Nobody matches. Try the email or the last 4 of the barcode.</p> : null}
      </div> : null}
    </div>
  );
}
