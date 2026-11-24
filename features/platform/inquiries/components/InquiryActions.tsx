'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runTyped } from '../../lib/commands';

/** Take, win or lose an inquiry. Losing asks why, so the reason is on the record. */
export function InquiryActions({ inquiryId, status }: { inquiryId: string; status: string }) {
  const router = useRouter();
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (['won', 'lost'].includes(status)) return null;
  const move = async (to: string) => {
    setPending(true); setError('');
    try { await runTyped('workInquiry', 'JSON', { idempotencyKey: crypto.randomUUID(), inquiryId, status: to, reason }); setLosing(false); router.refresh(); }
    catch (e: any) { setError(e.message); }
    finally { setPending(false); }
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'new' ? <Button size="sm" variant="outline" className="min-h-11" disabled={pending} onClick={() => move('in_progress')}>Take it</Button> : null}
        <Button size="sm" className="min-h-11" disabled={pending} onClick={() => move('won')}>Won</Button>
        {!losing ? <Button size="sm" variant="outline" className="min-h-11" onClick={() => setLosing(true)}>Lost</Button> : null}
      </div>
      {losing ? (
        <div className="flex flex-wrap gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why was it lost?" aria-label="Reason lost" className="w-64" />
          <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => move('lost')}>Mark lost</Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
