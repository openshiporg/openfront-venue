'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runCommand, readQuery } from '../../lib/commands';

/** On a final promoter statement: take the balance from the promoter, or pay out what the venue owes them. */
export function PromoterBalance({ settlementId, status, dueCents }: { settlementId: string; status: string; dueCents: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((Math.abs(dueCents) / 100).toFixed(2));
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (status !== 'final' || dueCents === 0) return null;
  const inbound = dueCents > 0;
  const record = async () => {
    setPending(true); setError('');
    try {
      const q = await readQuery('query($id: ID!) { settlement(where: { id: $id }) { venueDeal { id } } }', { id: settlementId });
      const dealId = q.settlement?.venueDeal?.id; if (!dealId) throw new Error('This statement has no venue deal');
      await runCommand('recordPromoterPayment', { dealId, data: { kind: inbound ? 'balance' : 'payout', direction: inbound ? 'in' : 'out', amountCents: Math.round(Number(amount) * 100), method, reference } });
      setOpen(false); router.refresh();
    } catch (e: any) { setError(e.message); } finally { setPending(false); }
  };
  return (
    <span className="inline-flex flex-col items-start gap-2">
      <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpen(!open)}>{inbound ? 'Record promoter payment' : 'Record payout to promoter'}</Button>
      {open ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          $<Input className="w-28" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Amount" />
          <select className="h-9 rounded-md border bg-background px-2" value={method} onChange={e => setMethod(e.target.value)} aria-label="Method"><option value="transfer">Transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option></select>
          <Input className="w-40" value={reference} onChange={e => setReference(e.target.value)} placeholder="Reference" aria-label="Reference" />
          <Button size="sm" disabled={pending || reference.trim().length < 3} onClick={record}>Record</Button>
        </span>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
