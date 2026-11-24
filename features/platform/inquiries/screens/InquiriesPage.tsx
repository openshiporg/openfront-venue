import { gql } from '../../lib/gql';
import { requireAnyPermission } from '../../lib/guard';
import { day } from '../../lib/format';
import { Page, Row, Rows } from '../../components/ui-bits';
import { InquiryActions } from '../components/InquiryActions';

const KIND: Record<string, string> = { show: 'Show date', private_event: 'Private event' };

/** Requests from promoters, agents and clients, newest first. Open ones above finished ones. */
export async function InquiriesPage() {
  await requireAnyPermission('canManageInquiries');
  const data = await gql(`{ inquiries(orderBy: [{ createdAt: desc }], take: 300) { id kind name email phone company dateWanted flexibleDates guests eventType budgetCents message status lostReason source createdAt room { name } handledBy { name } } }`);
  const rows: any[] = data.inquiries;
  const open = rows.filter((r) => ['new', 'in_progress'].includes(r.status));
  const done = rows.filter((r) => !['new', 'in_progress'].includes(r.status));
  const render = (r: any) => (
    <Row key={r.id} title={`${r.name}${r.company ? `, ${r.company}` : ''}`} status={r.status}
      meta={<span className="space-y-0.5"><span className="block">{[KIND[r.kind], r.dateWanted ? `${day(r.dateWanted)}${r.flexibleDates ? ' (flexible)' : ''}` : 'No date', r.room?.name, r.guests ? `${r.guests} guests` : '', r.eventType].filter(Boolean).join(' · ')}</span><span className="block">{r.email}{r.phone ? ` · ${r.phone}` : ''}{r.handledBy?.name ? ` · ${r.handledBy.name}` : ''}</span><span className="block whitespace-pre-line text-foreground/80">{r.message}</span>{r.lostReason ? <span className="block">Lost: {r.lostReason}</span> : null}</span>}
      right={<InquiryActions inquiryId={r.id} status={r.status} />} />
  );
  return (
    <Page title="Inquiries">
      <Rows empty="No open inquiries. Requests from the public form appear here.">{open.map(render)}</Rows>
      {done.length ? <><h2 className="text-sm font-medium">Closed</h2><Rows>{done.map(render)}</Rows></> : null}
    </Page>
  );
}
