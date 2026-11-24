import { requireAnyPermission } from '../../lib/guard';
import { gql } from '../../lib/gql';
import { when } from '../../lib/format';
import { Page, Row, Rows } from '../../components/ui-bits';
import { ConnectForm, ConnectionActions } from '../components/ConnectionControls';

const KIND: Record<string, string> = { openfront_concerts: 'Openfront Concerts', openfront_comedy_club: 'Openfront Comedy Club' };
const STATUS: Record<string, string> = { pending: 'pending', connected: 'confirmed', needs_reconnect: 'void', disconnected: 'cancelled' };

/** W10: the venue's connections to the Openfront deployments of promoters and clubs that sell its nights. */
export async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireAnyPermission('canManageConnections');
  const q = await searchParams;
  const data = await gql(`{ channelConnections(orderBy: [{ createdAt: desc }], take: 100) { id kind issuer siblingName siblingUserLabel scopes status connectedAt lastUsedAt lastError eventsCount: event_connectionCount } }`);
  return (
    <Page title="Connections">
      <p className="max-w-2xl text-sm text-muted-foreground">Connect a promoter’s Openfront Concerts or a club’s Openfront Comedy Club. Their staff approve the venue on their own site; after that the venue’s calendar can name their events, the storefront shows their live prices, and the door scans their tickets with their system answering.</p>
      {q.connected ? <p role="status" className="rounded-lg border border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">Connected.</p> : null}
      {q.error ? <p role="alert" className="rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{q.error}</p> : null}
      <ConnectForm />
      <Rows empty="No connections yet.">{data.channelConnections.map((c: any) => <Row key={c.id} title={`${KIND[c.kind] || c.kind} · ${c.issuer.replace(/^https?:\/\//, '')}`} status={STATUS[c.status] || c.status}
        meta={<div className="space-y-2"><div>{[c.status.replace(/_/g, ' '), c.siblingUserLabel ? `acting as ${c.siblingUserLabel}` : '', c.scopes.includes('mcp:write') ? 'can scan and open doors' : c.scopes ? 'read only: scans will be refused' : '', `${c.eventsCount} event${c.eventsCount === 1 ? '' : 's'}`, c.lastError].filter(Boolean).join(' · ')}</div><ConnectionActions connection={c} /></div>}
        right={c.lastUsedAt ? `used ${when(c.lastUsedAt)}` : c.connectedAt ? `connected ${when(c.connectedAt)}` : ''} />)}</Rows>
    </Page>
  );
}
