export const INQUIRY_KINDS = ['show', 'private_event'] as const;
export const INQUIRY_STATUSES = ['new', 'in_progress', 'won', 'lost'] as const;
/** Allowed moves. A won or lost inquiry is finished; reopening is a new inquiry. */
export const INQUIRY_MOVES: Record<string, string[]> = { new: ['in_progress', 'won', 'lost'], in_progress: ['won', 'lost'], won: [], lost: [] };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateInquiry(input: any) {
  const kind = String(input?.kind || 'show');
  if (!(INQUIRY_KINDS as readonly string[]).includes(kind)) throw new Error('Choose show or private event');
  const name = String(input?.name || '').trim().slice(0, 200);
  const email = String(input?.email || '').trim().toLowerCase().slice(0, 320);
  if (!name) throw new Error('Name required');
  if (!EMAIL.test(email)) throw new Error('A valid email is required');
  const message = String(input?.message || '').trim().slice(0, 5000);
  if (!message) throw new Error('Tell us a little about the event');
  let dateWanted: Date | null = null;
  if (input?.dateWanted) { dateWanted = new Date(input.dateWanted); if (Number.isNaN(+dateWanted)) throw new Error('Valid date required'); }
  const intOrNull = (v: any, label: string) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number`); return n; };
  return {
    kind, name, email, message, dateWanted,
    phone: String(input?.phone || '').trim().slice(0, 60), company: String(input?.company || '').trim().slice(0, 200),
    eventType: String(input?.eventType || '').trim().slice(0, 120), source: String(input?.source || '').trim().slice(0, 120),
    flexibleDates: Boolean(input?.flexibleDates), guests: intOrNull(input?.guests, 'Guests'), budgetCents: intOrNull(input?.budgetCents, 'Budget'),
  };
}
export function inquiryMove(from: string, to: string, reason: string) {
  if (!(INQUIRY_MOVES[from] || []).includes(to)) throw new Error(`An inquiry that is ${from.replace(/_/g, ' ')} cannot become ${to.replace(/_/g, ' ')}`);
  if (to === 'lost' && !reason.trim()) throw new Error('Say why it was lost');
}
