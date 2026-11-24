'use client';
import { ActionButton } from '../../components/ActionButton';
import { ArtistPaymentEditor, AdjustmentEditor } from '../../events/components/SettlementInputs';
import { PromoterBalance } from './PromoterBalance';

const NEXT: Record<string, string> = { draft: 'Mark reviewed', reviewed: 'Sign as promoter', signed_promoter: 'Sign for artist', signed_artist: 'Finalize' };
// Promoter statement: the promoter's side signs, then a second venue user countersigns and it is final.
const NEXT_PROMOTER: Record<string, string> = { draft: 'Mark reviewed', reviewed: 'Promoter signed', signed_promoter: 'Countersign and finalize' };
export function SettlementActions({ settlementId, eventId, status, party = 'artist', dueCents = 0, latest = true, approvers = [] }: { settlementId: string; eventId: string; status: string; party?: string; dueCents?: number; latest?: boolean; approvers?: { id: string; name: string }[] }) {
  if (!latest) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {(party === 'promoter' ? NEXT_PROMOTER : NEXT)[status] ? <ActionButton command="signSettlement" variant="default" input={{ settlementId }}>{(party === 'promoter' ? NEXT_PROMOTER : NEXT)[status]}</ActionButton> : null}
      {party === 'promoter' ? <PromoterBalance settlementId={settlementId} status={status} dueCents={dueCents} /> : <>
      {['draft', 'reviewed'].includes(status) ? <ActionButton command="computeSettlement" input={{ eventId }}>Recompute</ActionButton> : null}
      {status === 'final' && dueCents > 0 ? <ArtistPaymentEditor settlementId={settlementId} dueCents={dueCents} /> : null}
      </>}
      {['signed_promoter', 'signed_artist', 'final'].includes(status) ? <AdjustmentEditor settlementId={settlementId} approvers={approvers} /> : null}
    </div>
  );
}
