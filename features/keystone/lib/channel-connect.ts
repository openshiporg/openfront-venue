import { digest, opaqueToken } from './guest-proof';
import { appendAuditEvent } from './audit';
import { putSecret, getSecret, dropSecret, SecretUnreadable } from './secret-box';
import { lockTransactionKey, checkedClient } from './transaction';
import { type UrlPolicy, AddressRefused, SiblingUnreachable } from './sibling-http';
import {
  CHANNEL_KINDS, CHANNEL_LABEL, PENDING_MINUTES, type ChannelKind, NeedsReconnect, discover, register, authorizeUrl, pkcePair, exchangeCode,
  refreshSecretName, verifierSecretName, rememberAccess, siblingGraphQL, revokeAndDrop, text, accessToken, forgetAccess,
} from './channel-client';

/**
 * W10: connecting a sibling Openfront deployment. Every function takes the URL policy as an argument; the dashboard and
 * the callback route always pass the public-host policy.
 */
export async function startConnection(prisma: any, policy: UrlPolicy, args: { kind: string; baseUrl: string; redirectUri: string; userId: string; connectionId?: string | null; venueName?: string }) {
  if (!CHANNEL_KINDS.includes(args.kind as ChannelKind)) throw new Error('Choose Openfront Concerts or Openfront Comedy Club');
  const kind = args.kind as ChannelKind;
  const found = await discover(policy, args.baseUrl);
  const clientId = await register(policy, found, args.redirectUri, `${args.venueName || 'Openfront Venue'} (venue door and calendar)`);
  const { verifier, challenge } = pkcePair();
  const state = opaqueToken();
  const pending = { kind, baseUrl: found.issuer, issuer: found.issuer, clientId, scopes: '', status: 'pending', stateHash: digest(state), pendingExpiresAt: new Date(Date.now() + PENDING_MINUTES * 60000), startedById: args.userId, lastError: '' };
  const connection = await prisma.$transaction(async (raw: any) => {
    const tx = checkedClient(raw);
    let row;
    if (args.connectionId) {
      const prior = await tx.channelConnection.findUnique({ where: { id: args.connectionId } });
      if (!prior) throw new Error('Connection not found');
      if (prior.kind !== kind || prior.issuer !== found.issuer) throw new Error('Reconnect uses the same deployment; add a new connection for a different one');
      await lockTransactionKey(tx, `channel:${prior.id}`);
      row = await tx.channelConnection.update({ where: { id: prior.id }, data: pending });
    } else {
      row = await tx.channelConnection.create({ data: pending });
    }
    await putSecret(tx, verifierSecretName(row.id), verifier);
    await appendAuditEvent(tx, args.userId, { action: 'connection.started', targetList: 'ChannelConnection', targetId: row.id, after: { kind, issuer: found.issuer } });
    return row;
  });
  return { id: connection.id, status: 'pending', authorizeUrl: authorizeUrl(found, clientId, args.redirectUri, state, challenge) };
}

export class CallbackRefused extends Error {}

/** The sibling sent staff back with a code (or an error). The state proves the round trip; PKCE proves the code is ours. */
export async function completeConnection(prisma: any, policy: UrlPolicy, args: { state: string; code?: string | null; error?: string | null; errorDescription?: string | null; iss?: string | null; redirectUri: string; userId: string }) {
  if (!args.state) throw new CallbackRefused('This connection link is incomplete. Start the connection again.');
  const row = await prisma.channelConnection.findFirst({ where: { stateHash: digest(args.state) } });
  if (!row || row.status !== 'pending') throw new CallbackRefused('This connection link was already used or replaced. Start the connection again.');
  if (!row.pendingExpiresAt || row.pendingExpiresAt.getTime() < Date.now()) throw new CallbackRefused('This connection took too long. Start it again.');
  if (row.startedById && row.startedById !== args.userId) throw new CallbackRefused('Finish the connection signed in as the person who started it.');
  if (args.iss && args.iss !== row.issuer) throw new CallbackRefused('The answer came from a different deployment than the one connected.');
  if (args.error) {
    await prisma.channelConnection.update({ where: { id: row.id }, data: { stateHash: '', lastError: text(args.errorDescription || args.error) } });
    throw new CallbackRefused(args.error === 'access_denied' ? 'The connection was not approved at the seller.' : `The seller refused: ${text(args.errorDescription || args.error)}`);
  }
  if (!args.code) throw new CallbackRefused('The seller sent no authorization code. Start the connection again.');
  const verifier = await getSecret(prisma, verifierSecretName(row.id)).catch(e => { if (e instanceof SecretUnreadable) return null; throw e; });
  if (!verifier) throw new CallbackRefused('This connection link is no longer valid. Start the connection again.');
  // One use only: clear the state before spending the code.
  const claimed = await prisma.channelConnection.updateMany({ where: { id: row.id, status: 'pending', stateHash: row.stateHash }, data: { stateHash: '' } });
  if (claimed.count !== 1) throw new CallbackRefused('This connection link was already used. Start the connection again.');
  let set;
  try {
    set = await exchangeCode(policy, row.issuer, { clientId: row.clientId, code: args.code, redirectUri: args.redirectUri, verifier });
  } catch (e: any) {
    await prisma.channelConnection.update({ where: { id: row.id }, data: { lastError: text(e?.message) } });
    throw new CallbackRefused(e instanceof NeedsReconnect || e instanceof SiblingUnreachable || e instanceof AddressRefused ? e.message : 'The seller did not complete the connection.');
  }
  await prisma.$transaction(async (raw: any) => {
    const tx = checkedClient(raw);
    await lockTransactionKey(tx, `channel:${row.id}`);
    await putSecret(tx, refreshSecretName(row.id), set.refreshToken);
    await dropSecret(tx, verifierSecretName(row.id));
    await tx.channelConnection.update({ where: { id: row.id }, data: { status: 'connected', scopes: set.scope, connectedAt: new Date(), lastRefreshedAt: new Date(), lastError: '', pendingExpiresAt: null } });
    await appendAuditEvent(tx, args.userId, { action: 'connection.connected', targetList: 'ChannelConnection', targetId: row.id, after: { issuer: row.issuer, scopes: set.scope } });
  });
  rememberAccess(row.id, set);
  const label = await describeSiblingUser(prisma, { ...row, status: 'connected' }, policy).catch(() => '');
  if (label) await prisma.channelConnection.update({ where: { id: row.id }, data: { siblingUserLabel: label } });
  return { id: row.id, status: 'connected', siblingUserLabel: label, scopes: set.scope };
}

/** Who the venue acts as at the sibling, shown on the connection. */
export async function describeSiblingUser(prisma: any, connection: any, policy: UrlPolicy): Promise<string> {
  const r = await siblingGraphQL(prisma, connection, policy, '{ authenticatedItem { ... on User { name email role { name } } } }');
  const u = r.data?.authenticatedItem;
  if (!u) return '';
  return text([u.name || u.email, u.email && u.name ? `<${u.email}>` : '', u.role?.name ? `· ${u.role.name}` : ''].filter(Boolean).join(' '), 200);
}

/** Staff "Check": refresh now and read who we are; a refused grant becomes needs_reconnect. */
export async function checkConnection(prisma: any, policy: UrlPolicy, connectionId: string) {
  const row = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!row) throw new Error('Connection not found');
  if (row.status !== 'connected') return { id: row.id, status: row.status, ok: false, message: row.status === 'pending' ? 'Waiting for approval at the seller' : row.lastError || 'Reconnect this connection' };
  try {
    forgetAccess(row.id);
    await accessToken(prisma, row, policy, true);
    const label = await describeSiblingUser(prisma, row, policy);
    await prisma.channelConnection.update({ where: { id: row.id }, data: { siblingUserLabel: label || row.siblingUserLabel, lastError: '' } });
    return { id: row.id, status: 'connected', ok: true, siblingUserLabel: label, message: `Connected to ${CHANNEL_LABEL[row.kind as ChannelKind]} as ${label || 'the approving account'}` };
  } catch (e: any) {
    const now = await prisma.channelConnection.findUnique({ where: { id: row.id } });
    if (!(e instanceof NeedsReconnect)) await prisma.channelConnection.update({ where: { id: row.id }, data: { lastError: text(e?.message) } });
    return { id: row.id, status: now?.status || row.status, ok: false, message: text(e?.message) };
  }
}

export async function disconnectConnection(prisma: any, policy: UrlPolicy, connectionId: string, userId: string) {
  const row = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!row) throw new Error('Connection not found');
  if (row.status === 'disconnected') return { id: row.id, status: 'disconnected' };
  await revokeAndDrop(prisma, row, policy);
  await prisma.$transaction(async (raw: any) => {
    const tx = checkedClient(raw);
    await tx.channelConnection.update({ where: { id: row.id }, data: { status: 'disconnected', stateHash: '', pendingExpiresAt: null } });
    await appendAuditEvent(tx, userId, { action: 'connection.disconnected', targetList: 'ChannelConnection', targetId: row.id, before: { status: row.status } });
  });
  return { id: row.id, status: 'disconnected' };
}
