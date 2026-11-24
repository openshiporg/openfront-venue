import { roomChoices } from '../lib/content';
import { InquireForm } from './InquireForm';

export async function InquirePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const rooms = await roomChoices();
  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Host with us</h1>
      <p className="text-sm text-muted-foreground">Tell us what you have in mind. A person on our team answers every request.</p>
      <InquireForm rooms={rooms} initialKind={kind === 'private_event' ? 'private_event' : 'show'} />
    </main>
  );
}
