'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { btn, input, label } from '../lib/ui';

/** Accept by typing a full name. The terms record must match what was on screen, or the venue changed them meanwhile. */
export function DealAccept({ token, termsHash }: { token: string; termsHash: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const accept = async (e: React.FormEvent) => {
    e.preventDefault(); setPending(true); setError('');
    try {
      await api('mutation($token: String!, $name: String!, $termsHash: String, $key: String!) { acceptVenueDeal(token: $token, name: $name, termsHash: $termsHash, idempotencyKey: $key) }', { token, name, termsHash, key });
      router.refresh();
    } catch (err: any) { setError(err.message); } finally { setPending(false); }
  };
  return (
    <form onSubmit={accept} className="space-y-3 rounded-lg border border-black/15 bg-white p-4">
      <div><label htmlFor="accept-name" className={label}>Type your full name to accept these terms</label>
        <input id="accept-name" className={input} value={name} onChange={e => setName(e.target.value)} autoComplete="name" required minLength={2} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1" /> I can sign for the promoter named above and accept this deal.</label>
      <button className={btn} disabled={pending || !agree || name.trim().length < 2}>{pending ? 'Accepting…' : 'Accept the deal'}</button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
