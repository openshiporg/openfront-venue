'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { runCommand, readQuery } from '../../lib/commands';

const ISSUERS: Record<string, string> = { own: 'Our box office', openfront_concerts: 'A connected Openfront Concerts', openfront_comedy_club: 'A connected Openfront Comedy Club', other: 'Another seller (import their barcodes)' };

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [note, setNote] = useState('');
  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(true); setError(''); setNote('');
    try { const r = await fn(); setNote(ok(r)); router.refresh(); return r; } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return { busy, error, note, act };
}
const Feedback = ({ error, note }: { error: string; note: string }) => <>{error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}{note ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{note}</p> : null}</>;

/** W2.1: who sells tickets for this night. */
export function IssuerPicker({ eventId, issuer, connections }: { eventId: string; issuer: string; connections: { id: string; kind: string; siblingName: string; issuer: string; status: string }[] }) {
  const { busy, error, note, act } = useAct();
  const [choice, setChoice] = useState(issuer); const [connectionId, setConnectionId] = useState(''); const [events, setEvents] = useState<any[] | null>(null); const [externalEventId, setExternal] = useState('');
  const [sellerName, setSeller] = useState(''); const [url, setUrl] = useState('');
  const usable = connections.filter(c => c.kind === choice && c.status === 'connected');
  async function load(id: string) {
    setConnectionId(id); setEvents(null); setExternal('');
    if (!id) return;
    await act(async () => { const d = await readQuery('query($c: ID!) { channelEvents(connectionId: $c) }', { c: id }); setEvents(d.channelEvents); return d; }, () => '');
  }
  return (
    <form className="space-y-3 rounded-lg border p-4" onSubmit={e => { e.preventDefault(); act(() => runCommand('setEventIssuer', { eventId, issuer: choice, connectionId, externalEventId, sellerName, url }), r => `Tickets now sold by ${r.externalSellerName || 'our box office'}`); }}>
      <h3 className="text-sm font-medium">Who sells tickets</h3>
      <div className="flex flex-col gap-2">{Object.entries(ISSUERS).map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="issuer" value={v} checked={choice === v} onChange={() => { setChoice(v); setConnectionId(''); setEvents(null); }} />{l}</label>)}</div>
      {choice.startsWith('openfront_') ? usable.length ? <div className="space-y-2">
        <label className="block space-y-1 text-sm">Connection<select className="h-10 w-full rounded-md border bg-background px-2" value={connectionId} onChange={e => load(e.target.value)}><option value="">Choose…</option>{usable.map(c => <option key={c.id} value={c.id}>{c.siblingName || c.issuer}</option>)}</select></label>
        {events ? <label className="block space-y-1 text-sm">Their event<select className="h-10 w-full rounded-md border bg-background px-2" value={externalEventId} onChange={e => setExternal(e.target.value)}><option value="">Choose…</option>{events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}{ev.at ? ` · ${new Date(ev.at).toLocaleDateString()}` : ''}</option>)}</select></label> : null}
      </div> : <p className="text-sm text-muted-foreground">No working connection of that kind. Add one under <a className="underline" href="/dashboard/platform/connections">Connections</a>.</p> : null}
      {choice === 'other' ? <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-sm">Seller name<Input value={sellerName} onChange={e => setSeller(e.target.value)} placeholder="Dice, Eventbrite, the promoter’s site…" /></label><label className="space-y-1 text-sm">Their ticket page (optional)<Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label></div> : null}
      <Button type="submit" disabled={busy || (choice.startsWith('openfront_') && !externalEventId) || (choice === 'other' && !sellerName.trim())}>Save seller</Button>
      <Feedback error={error} note={note} />
    </form>
  );
}

/** W11: import another seller's barcode export. The file is read in the browser and sent once; only hashes are kept. */
export function ExternalImport({ eventId, sellerName }: { eventId: string; sellerName: string }) {
  const { busy, error, note, act } = useAct();
  const [seller, setSeller] = useState(sellerName); const [csv, setCsv] = useState(''); const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState({ barcode: '', name: '', type: '', status: '' });
  return (
    <form className="space-y-3 rounded-lg border p-4" onSubmit={e => { e.preventDefault(); const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v.trim())); act(() => runCommand('importExternalTickets', { eventId, sellerName: seller, csv, filename, mapping: Object.keys(m).length ? m : null }), r => `${r.added} added, ${r.alreadyImported} already imported, ${r.voided} voided${r.repeatedInFile ? `, ${r.repeatedInFile} repeated in the file` : ''}`).then(r => r && setCsv('')); }}>
      <h3 className="text-sm font-medium">Import outside tickets</h3>
      <p className="text-xs text-muted-foreground">CSV export from the seller. A column named barcode, code or ticket number is used unless you name it below. Importing the same file again adds nothing; a status column of void, cancelled or refunded voids the barcode.</p>
      <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-sm">Seller<Input value={seller} onChange={e => setSeller(e.target.value)} /></label>
        <label className="space-y-1 text-sm">File<Input type="file" accept=".csv,text/csv,text/plain" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setFilename(f.name); setCsv(await f.text()); }} /></label></div>
      <details className="text-sm"><summary className="cursor-pointer">Column names (if not detected)</summary><div className="mt-2 grid gap-2 sm:grid-cols-4">{(['barcode', 'name', 'type', 'status'] as const).map(k => <label key={k} className="space-y-1 capitalize">{k}<Input value={mapping[k]} onChange={e => setMapping(m => ({ ...m, [k]: e.target.value }))} /></label>)}</div></details>
      <Button type="submit" disabled={busy || !csv || !seller.trim()}>{busy ? 'Importing…' : 'Import'}</Button>
      <Feedback error={error} note={note} />
    </form>
  );
}

export function VoidExternal({ id }: { id: string }) {
  const { busy, error, act } = useAct();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { const reason = window.prompt('Why is this ticket void?'); if (reason) act(() => runCommand('voidExternalTicket', { externalTicketId: id, reason }), () => 'Voided'); }}>Void</Button>{error ? <span className="text-xs text-red-600">{error}</span> : null}</span>;
}

/** W6.4: the guest list for the night. */
export function GuestListEditor({ eventId }: { eventId: string }) {
  const { busy, error, note, act } = useAct();
  const [name, setName] = useState(''); const [plusOnes, setPlus] = useState('0'); const [addedFor, setFor] = useState('artist'); const [noteText, setNoteText] = useState('');
  return (
    <form className="grid gap-2 rounded-lg border p-4 sm:grid-cols-5 sm:items-end" onSubmit={e => { e.preventDefault(); act(() => runCommand('addGuestListEntry', { eventId, name, plusOnes: Number(plusOnes), addedFor, note: noteText }), r => `Added: ${r.places} place${r.places === 1 ? '' : 's'}`).then(r => { if (r) { setName(''); setPlus('0'); setNoteText(''); } }); }}>
      <label className="space-y-1 text-sm sm:col-span-2">Guest name<Input value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="space-y-1 text-sm">Plus-ones<Input type="number" min={0} max={20} value={plusOnes} onChange={e => setPlus(e.target.value)} /></label>
      <label className="space-y-1 text-sm">For<select className="h-10 w-full rounded-md border bg-background px-2" value={addedFor} onChange={e => setFor(e.target.value)}><option value="artist">Artist</option><option value="promoter">Promoter</option><option value="house">House</option></select></label>
      <Button type="submit" disabled={busy || !name.trim()}>Add</Button>
      <label className="space-y-1 text-sm sm:col-span-5">Note<Textarea rows={1} value={noteText} onChange={e => setNoteText(e.target.value)} /></label>
      <div className="sm:col-span-5"><Feedback error={error} note={note} /></div>
    </form>
  );
}

export function RemoveGuest({ id }: { id: string }) {
  const { busy, error, act } = useAct();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => runCommand('removeGuestListEntry', { guestListEntryId: id, reason: 'Removed by staff' }), () => 'Removed')}>Remove</Button>{error ? <span className="text-xs text-red-600">{error}</span> : null}</span>;
}
