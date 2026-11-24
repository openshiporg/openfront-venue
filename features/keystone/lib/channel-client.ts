import { createHash, randomBytes } from 'node:crypto';
import { siblingRequest, baseUrlOf, AddressRefused, SiblingUnreachable, type UrlPolicy } from './sibling-http';
import { putSecret, getSecret as readSecret, dropSecret, SecretUnreadable } from './secret-box';
import { lockTransactionKey, checkedClient } from './transaction';

/**
 * The venue as an OAuth client of a sibling Openfront deployment (Concerts or Comedy Club), against the server those
 * deployments already run (features/keystone/mcp-oauth): RFC 8414 discovery, RFC 7591 dynamic registration as a public
 * client, authorization code with PKCE S256 and the RFC 8707 resource, rotating refresh tokens.
 *
 * Refresh tokens live only in SecretBox. Access tokens live in this process's memory for their hour and are re-fetched
 * with the refresh token on the request that needs one. No token is ever logged or returned to a browser.
 */
export const CHANNEL_KINDS = ['openfront_concerts', 'openfront_comedy_club'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const CHANNEL_LABEL: Record<ChannelKind, string> = { openfront_concerts: 'Openfront Concerts', openfront_comedy_club: 'Openfront Comedy Club' };
export const SCOPES = 'mcp:read mcp:write';
export const resourceOf = (issuer: string) => `${issuer}/api/mcp-transport/http`;
export const refreshSecretName = (connectionId: string) => `channel:${connectionId}:refresh`;
export const verifierSecretName = (connectionId: string) => `channel:${connectionId}:verifier`;
export const PENDING_MINUTES = 15;

/** The sibling refused the grant (revoked, expired or reused refresh token): staff must reconnect. */
export class NeedsReconnect extends Error {
  constructor(message = 'This connection must be reconnected') { super(message); }
}

export const UNREADABLE_SECRET = 'The stored sign-in for this connection can no longer be read here (the venue’s secret key changed). Reconnect it.';
/** A sealed secret this deployment cannot open (SESSION_SECRET rotated or VENUE_SECRET_KEY wrong) ends the connection: reconnect, never wait. */
async function getSecret(db: any, name: string) {
  try { return await readSecret(db, name); } catch (e) { if (e instanceof SecretUnreadable) throw new NeedsReconnect(UNREADABLE_SECRET); throw e; }
}

const b64url = (b: Buffer) => b.toString('base64url');
export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export type Discovered = { issuer: string; authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint: string; revocationEndpoint: string };

/** Discovery: the issuer must be the base URL and every endpoint must be the fixed path on it. */
export async function discover(policy: UrlPolicy, rawBase: string): Promise<Discovered> {
  const base = baseUrlOf(rawBase, policy);
  const res = await siblingRequest(policy, base, '/.well-known/oauth-authorization-server');
  const meta = res.json;
  if (res.status !== 200 || !meta || typeof meta !== 'object') throw new AddressRefused('That address is not an Openfront deployment (no OAuth server metadata found)');
  if (meta.issuer !== base) throw new AddressRefused('That deployment names a different address as its issuer; enter the address it names itself');
  const fixed = { authorizationEndpoint: `${base}/oauth/authorize`, tokenEndpoint: `${base}/oauth/token`, registrationEndpoint: `${base}/oauth/register`, revocationEndpoint: `${base}/oauth/revoke` };
  if (meta.authorization_endpoint !== fixed.authorizationEndpoint || meta.token_endpoint !== fixed.tokenEndpoint || meta.registration_endpoint !== fixed.registrationEndpoint) {
    throw new AddressRefused('That deployment’s OAuth endpoints are not the standard Openfront ones');
  }
  if (!Array.isArray(meta.code_challenge_methods_supported) || !meta.code_challenge_methods_supported.includes('S256')) throw new AddressRefused('That deployment does not support PKCE S256');
  return { issuer: base, ...fixed };
}

/** Dynamic registration as a public client (no client secret), redirecting to our callback only. */
export async function register(policy: UrlPolicy, d: Discovered, redirectUri: string, clientName: string): Promise<string> {
  const res = await siblingRequest(policy, d.issuer, '/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: clientName.slice(0, 120), redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPES }),
  });
  if (res.status !== 201 && res.status !== 200) throw new AddressRefused(`That deployment refused to register this venue: ${text(res.json?.error_description || res.json?.error || res.status)}`);
  const clientId = res.json?.client_id;
  if (typeof clientId !== 'string' || !clientId) throw new AddressRefused('That deployment did not return a client id');
  return clientId;
}

export function authorizeUrl(d: Discovered, clientId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(d.authorizationEndpoint);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', resource: resourceOf(d.issuer) })) url.searchParams.set(k, v);
  return url.toString();
}

/** Sibling text shown to staff: plain, short, never HTML. */
export function text(value: unknown, max = 300): string {
  return String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

type TokenSet = { accessToken: string; refreshToken: string; expiresAt: number; scope: string };

async function tokenRequest(policy: UrlPolicy, issuer: string, form: Record<string, string>): Promise<TokenSet> {
  const res = await siblingRequest(policy, issuer, '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  if (res.status >= 500 || res.status === 0) throw new SiblingUnreachable();
  const body = res.json || {};
  if (res.status !== 200) {
    if (body.error === 'invalid_grant' || body.error === 'invalid_client') throw new NeedsReconnect(`The seller’s system ended this connection: ${text(body.error_description || body.error)}`);
    throw new SiblingUnreachable(`The seller’s system refused the token request: ${text(body.error_description || body.error || res.status)}`);
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') throw new SiblingUnreachable('The seller’s system returned no token');
  const ttl = Number.isFinite(Number(body.expires_in)) ? Number(body.expires_in) : 3600;
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + Math.max(60, ttl - 60) * 1000, scope: typeof body.scope === 'string' ? body.scope : '' };
}

export function exchangeCode(policy: UrlPolicy, issuer: string, args: { clientId: string; code: string; redirectUri: string; verifier: string }) {
  return tokenRequest(policy, issuer, { grant_type: 'authorization_code', code: args.code, redirect_uri: args.redirectUri, client_id: args.clientId, code_verifier: args.verifier, resource: resourceOf(issuer) });
}

/** Per-process access-token memory. Never persisted, never logged. */
const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();
export function rememberAccess(connectionId: string, t: { accessToken: string; expiresAt: number }) { accessTokens.set(connectionId, { token: t.accessToken, expiresAt: t.expiresAt }); }
export function forgetAccess(connectionId: string) { accessTokens.delete(connectionId); }

/**
 * A live access token for the connection, refreshing on this request when the remembered one is missing or old.
 * The refresh runs under the connection's advisory lock and re-reads the sealed refresh token inside it, so two
 * requests never spend the same rotating refresh token (the sibling would end the whole grant on reuse).
 */
export async function accessToken(prisma: any, connection: { id: string; issuer: string; clientId: string; status: string }, policy: UrlPolicy, force = false): Promise<string> {
  if (connection.status !== 'connected') throw new NeedsReconnect(connection.status === 'disconnected' ? 'This connection was disconnected' : 'This connection must be reconnected');
  const cached = accessTokens.get(connection.id);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  const running = inFlight.get(connection.id);
  if (running) return running;
  const job = (async () => {
    try {
      return await prisma.$transaction(async (raw: any) => {
        const tx = checkedClient(raw);
        await lockTransactionKey(tx, `channel:${connection.id}`);
        const refresh = await getSecret(tx, refreshSecretName(connection.id));
        if (!refresh) throw new NeedsReconnect();
        const set = await tokenRequest(policy, connection.issuer, { grant_type: 'refresh_token', refresh_token: refresh, client_id: connection.clientId, resource: resourceOf(connection.issuer) });
        await putSecret(tx, refreshSecretName(connection.id), set.refreshToken);
        await tx.channelConnection.update({ where: { id: connection.id }, data: { lastRefreshedAt: new Date(), lastError: '' } });
        rememberAccess(connection.id, set);
        return set.accessToken;
      }, { timeout: 25000 });
    } catch (e) {
      if (e instanceof NeedsReconnect) await markNeedsReconnect(prisma, connection.id, e.message);
      throw e;
    } finally {
      inFlight.delete(connection.id);
    }
  })();
  inFlight.set(connection.id, job);
  return job;
}

export async function markNeedsReconnect(prisma: any, connectionId: string, message: string) {
  forgetAccess(connectionId);
  await prisma.channelConnection.updateMany({ where: { id: connectionId, status: 'connected' }, data: { status: 'needs_reconnect', lastError: text(message) } });
}

export type SiblingGraphQL = { data: any; errors: { message: string }[] };

/** GraphQL on the sibling as the connected account. A 401 refreshes once and retries. */
export async function siblingGraphQL(prisma: any, connection: any, policy: UrlPolicy, query: string, variables: Record<string, unknown> = {}): Promise<SiblingGraphQL> {
  const call = async (token: string) => siblingRequest(policy, connection.issuer, '/api/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }),
  });
  let res = await call(await accessToken(prisma, connection, policy));
  if (res.status === 401) { forgetAccess(connection.id); res = await call(await accessToken(prisma, connection, policy, true)); }
  if (res.status === 401) { await markNeedsReconnect(prisma, connection.id, 'The seller’s system no longer accepts this connection'); throw new NeedsReconnect(); }
  if (res.status >= 500 || res.status === 0 || !res.json) throw new SiblingUnreachable();
  await prisma.channelConnection.update({ where: { id: connection.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { data: res.json.data ?? null, errors: Array.isArray(res.json.errors) ? res.json.errors.map((e: any) => ({ message: text(e?.message) })) : [] };
}

/** Public GraphQL on the sibling (no token), for its public availability queries. */
export async function siblingPublicGraphQL(policy: UrlPolicy, issuer: string, query: string, variables: Record<string, unknown> = {}, timeoutMs?: number): Promise<SiblingGraphQL> {
  const res = await siblingRequest(policy, issuer, '/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), timeoutMs });
  if (res.status >= 500 || res.status === 0 || !res.json) throw new SiblingUnreachable();
  return { data: res.json.data ?? null, errors: Array.isArray(res.json.errors) ? res.json.errors.map((e: any) => ({ message: text(e?.message) })) : [] };
}

/** Best-effort RFC 7009 revocation at the sibling; the local secret is dropped either way. */
export async function revokeAndDrop(prisma: any, connection: any, policy: UrlPolicy) {
  const refresh = await getSecret(prisma, refreshSecretName(connection.id)).catch(() => null);
  if (refresh && connection.issuer) {
    await siblingRequest(policy, connection.issuer, '/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh, client_id: connection.clientId }).toString() }).catch(() => undefined);
  }
  forgetAccess(connection.id);
  await dropSecret(prisma, refreshSecretName(connection.id));
  await dropSecret(prisma, verifierSecretName(connection.id));
}
