'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runCommand } from '../../lib/commands';

/** Send (a copyable link, shown once), cancel with a reason, and record promoter money with a method and reference. */
export function VenueDealActions({ dealId, status, depositLeftCents }: { dealId: string; status: string; depositLeftCents: number }) {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState({ open: false, kind: 'deposit', amount: depositLeftCents ? (depositLeftCents / 100).toFixed(2) : '', method: 'transfer', reference: '' });
  const go = async (fn: () => Promise<void>) => { setPending(true); setError(''); try { await fn(); router.refresh(); } catch (e: any) { setError(e.message); } finally { setPending(false); } };
  const send = () => go(async () => { const r = await runCommand('sendVenueDeal', { dealId }); setLink(`${window.location.origin}${r.path}`); });
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {['draft', 'sent'].includes(status) ? <Button size="sm" className="min-h-11" disabled={pending} onClick={send}>{status === 'draft' ? 'Send to promoter' : 'New link'}</Button> : null}
        {['sent', 'accepted'].includes(status) ? <Button size="sm" variant="outline" className="min-h-11" onClick={() => setPay({ ...pay, open: !pay.open })}>Record payment</Button> : null}
        {['draft', 'sent', 'accepted'].includes(status) ? <Button size="sm" variant="outline" className="min-h-11" onClick={() => setCancel(!cancel)}>Cancel deal</Button> : null}
      </div>
      {link ? (
        <div className="flex w-full max-w-xl flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
          <span className="text-muted-foreground">Copy this link for the promoter. It is shown once; sending again replaces it.</span>
          <Input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Deal link" />
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(link)}>Copy</Button>
        </div>
      ) : null}
      {cancel ? (
        <div className="flex flex-wrap gap-2">
          <Input className="w-72" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is the deal cancelled?" aria-label="Cancel reason" />
          <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => go(async () => { await runCommand('cancelVenueDeal', { dealId, reason }); setCancel(false); })}>Cancel deal</Button>
        </div>
      ) : null}
      {pay.open ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className="h-9 rounded-md border bg-background px-2" value={pay.kind} onChange={e => setPay({ ...pay, kind: e.target.value })} aria-label="Payment kind"><option value="deposit">Deposit in</option></select>
          $<Input className="w-28" inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} aria-label="Amount" />
          <select className="h-9 rounded-md border bg-background px-2" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })} aria-label="Method"><option value="transfer">Transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option></select>
          <Input className="w-40" value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} placeholder="Reference" aria-label="Reference" />
          <Button size="sm" disabled={pending} onClick={() => go(async () => { await runCommand('recordPromoterPayment', { dealId, data: { kind: pay.kind, direction: 'in', amountCents: Math.round(Number(pay.amount) * 100), method: pay.method, reference: pay.reference } }); setPay({ ...pay, open: false }); })}>Record</Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
