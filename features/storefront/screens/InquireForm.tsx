'use client';
import { useState } from 'react';

type Room = { id: string; name: string };
const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

/** Public request form: a promoter or agent asks for a date, or a client asks about a private event. */
export function InquireForm({ rooms, initialKind }: { rooms: Room[]; initialKind: string }) {
  const [kind, setKind] = useState(initialKind);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (n: string) => String(f.get(n) || '').trim();
    const budget = text('budget');
    setState('sending'); setError('');
    try {
      const res = await fetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        query: 'mutation Submit($input: JSON!) { result: submitInquiry(input: $input) }',
        variables: { input: { idempotencyKey: key, kind, name: text('name'), email: text('email'), phone: text('phone'), company: text('company'), dateWanted: text('date') || null, flexibleDates: f.get('flexible') === 'on', roomId: text('room') || null, guests: text('guests') || null, eventType: text('eventType'), budgetCents: budget ? Math.round(Number(budget) * 100) : null, message: text('message'), website: text('website'), source: 'website' } },
      }) });
      const body = await res.json();
      if (body.errors?.length) throw new Error(body.errors[0].message);
      setState('sent');
    } catch (err: any) { setError(err.message); setState('idle'); }
  };
  if (state === 'sent') return <p className="rounded-lg border p-6 text-sm">Thank you. We have your request and will reply by email.</p>;
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2 text-sm">
        {[['show', 'Book a show'], ['private_event', 'Private event']].map(([v, l]) => <button type="button" key={v} onClick={() => setKind(v)} className={`rounded-md border px-3 py-2 ${kind === v ? 'bg-foreground text-background' : ''}`}>{l}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" required placeholder="Your name" aria-label="Your name" className={field} />
        <input name="email" type="email" required placeholder="Email" aria-label="Email" className={field} />
        <input name="phone" placeholder="Phone" aria-label="Phone" className={field} />
        <input name="company" placeholder={kind === 'show' ? 'Promoter or act' : 'Company (optional)'} aria-label="Company" className={field} />
        <input name="date" type="date" aria-label="Date wanted" className={field} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="flexible" /> My dates are flexible</label>
        <select name="room" aria-label="Room" className={field}><option value="">Any room</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <input name="guests" inputMode="numeric" placeholder={kind === 'show' ? 'Expected attendance' : 'Guests'} aria-label="Guests" className={field} />
        {kind === 'private_event' ? <input name="eventType" placeholder="Wedding, corporate, birthday…" aria-label="Event type" className={field} /> : null}
        <input name="budget" inputMode="decimal" placeholder="Budget (optional)" aria-label="Budget" className={field} />
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <textarea name="message" required rows={5} placeholder="Tell us about the event" aria-label="Message" className={field} />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button disabled={state === 'sending'} className="rounded-md bg-foreground px-4 py-2 text-sm text-background">{state === 'sending' ? 'Sending…' : 'Send request'}</button>
    </form>
  );
}
