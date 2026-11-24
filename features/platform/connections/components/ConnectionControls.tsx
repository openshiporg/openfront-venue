'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runCommand } from '../../lib/commands';

/** Starts the OAuth round trip: the browser goes to the sibling's consent page and comes back to /api/connections/callback. */
export function ConnectForm() {
  const [kind, setKind] = useState('openfront_concerts'); const [baseUrl, setBaseUrl] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return (
    <form className="grid gap-2 rounded-lg border p-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { const r = await runCommand('startChannelConnection', { kind, baseUrl }); window.location.assign(r.authorizeUrl); } catch (err: any) { setError(err.message); setBusy(false); }
    }}>
      <label className="space-y-1 text-sm">Their system<select className="h-10 w-full rounded-md border bg-background px-2" value={kind} onChange={e => setKind(e.target.value)}><option value="openfront_concerts">Openfront Concerts</option><option value="openfront_comedy_club">Openfront Comedy Club</option></select></label>
      <label className="space-y-1 text-sm">Their address<Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://tickets.promoter.com" inputMode="url" /></label>
      <Button type="submit" disabled={busy || !baseUrl.trim()}>{busy ? 'Opening…' : 'Connect'}</Button>
      {error ? <p role="alert" className="text-sm text-red-600 sm:col-span-3">{error}</p> : null}
    </form>
  );
}

export function ConnectionActions({ connection }: { connection: { id: string; kind: string; issuer: string; status: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<any>) => { setBusy(true); setMsg(''); try { const r = await fn(); if (r?.message) setMsg(r.message); router.refresh(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); } };
  if (connection.status === 'disconnected') return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {connection.status === 'connected' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => runCommand('checkChannelConnection', { connectionId: connection.id }))}>Check</Button> : null}
      {connection.status !== 'connected' ? <Button size="sm" disabled={busy} onClick={() => run(async () => { const r = await runCommand('startChannelConnection', { kind: connection.kind, baseUrl: connection.issuer, connectionId: connection.id }); window.location.assign(r.authorizeUrl); })}>Reconnect</Button> : null}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm('Disconnect? Their tickets will not scan here until you connect again.')) run(() => runCommand('disconnectChannel', { connectionId: connection.id })); }}>Disconnect</Button>
      {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
    </div>
  );
}
