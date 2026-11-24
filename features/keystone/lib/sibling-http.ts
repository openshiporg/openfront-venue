import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';

/**
 * Outbound HTTP to a sibling Openfront deployment (§8.1 security rules).
 *
 * The caller passes a URL policy. Product code always passes `publicHostPolicy`: https only, and every address the
 * host resolves to must be public. The check runs inside the socket's DNS lookup, so it holds for the address actually
 * connected to, on every call (no window between a check and the connect). The only other policy is `loopbackPolicy`,
 * which a test passes explicitly to reach a sibling it started on this machine; there is no setting that switches it on.
 */
export type UrlPolicy = {
  name: string;
  /** Why this URL may not be used, or null when it may. */
  refuseUrl(url: URL): string | null;
  /** May the socket connect to this resolved address? */
  allowAddress(address: string, family: number): boolean;
};

// Separate lists per family: Node's BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules (::ffff:0:0/96).
const nonPublic4 = new BlockList();
const nonPublic6 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) nonPublic4.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) nonPublic6.addSubnet(net, bits, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  const mapped = family === 6 && /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return family === 4 ? !nonPublic4.check(address, 'ipv4') : !nonPublic6.check(address, 'ipv6');
}

const plainUrl = (url: URL) => (url.username || url.password ? 'A connection address cannot contain a user name or password' : null);

export const publicHostPolicy: UrlPolicy = {
  name: 'public',
  refuseUrl(url) {
    if (url.protocol !== 'https:') return 'The deployment address must start with https://';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) return 'That address is on a private network; use the deployment’s public https address';
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return 'That address is not on the public internet; use the deployment’s public https address';
    return plainUrl(url);
  },
  allowAddress: address => isPublicAddress(address),
};

const isLoopback = (address: string) => /^127\./.test(address) || address === '::1' || address === '::ffff:127.0.0.1';
export const loopbackPolicy: UrlPolicy = {
  name: 'loopback',
  refuseUrl(url) {
    if (!['http:', 'https:'].includes(url.protocol)) return 'http or https only';
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'This policy reaches this machine only';
    return plainUrl(url);
  },
  allowAddress: address => isLoopback(address),
};

export class SiblingUnreachable extends Error {
  constructor(message = 'The seller’s system is not answering') { super(message); }
}
export class AddressRefused extends Error {}

export const SIBLING_TIMEOUT_MS = 10_000;
const MAX_BODY = 2 * 1024 * 1024;

/** The deployment's base URL: scheme, host and port only. Throws AddressRefused with words for staff. */
export function baseUrlOf(raw: string, policy: UrlPolicy): string {
  let url: URL;
  try { url = new URL(String(raw || '').trim()); } catch { throw new AddressRefused('Enter the deployment’s full address, for example https://tickets.example.com'); }
  const refused = policy.refuseUrl(url);
  if (refused) throw new AddressRefused(refused);
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) throw new AddressRefused('Enter only the deployment’s address, with no path, for example https://tickets.example.com');
  return url.origin;
}

/** Only these paths are ever requested on a sibling. */
const FIXED_PATHS = ['/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/token', '/oauth/revoke', '/api/graphql'];

export type SiblingResponse = { status: number; json: any; text: string };

export async function siblingRequest(policy: UrlPolicy, base: string, path: string, init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<SiblingResponse> {
  const timeoutMs = Math.min(SIBLING_TIMEOUT_MS, Math.max(500, init.timeoutMs ?? SIBLING_TIMEOUT_MS));
  if (!FIXED_PATHS.includes(path)) throw new Error(`Refusing to call ${path} on a sibling`);
  const origin = baseUrlOf(base, policy);
  const url = new URL(path, origin);
  const lib = url.protocol === 'https:' ? https : http;
  const lookup: any = (host: string, options: any, done: any) => {
    dnsLookup(host, { ...options, all: true }, (err: any, addresses: any) => {
      if (err) return done(err);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }]) as { address: string; family: number }[];
      if (!list.length || list.some(a => !policy.allowAddress(a.address, a.family))) return done(new AddressRefused('That deployment’s address resolves to a private network'));
      if (options?.all) done(null, list); else done(null, list[0].address, list[0].family);
    });
  };
  return new Promise<SiblingResponse>((resolve, reject) => {
    const req = lib.request(url, {
      method: init.method || 'GET', lookup, timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'Openfront Venue', ...(init.body ? { 'content-length': Buffer.byteLength(init.body).toString() } : {}), ...(init.headers || {}) },
    }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { req.destroy(new SiblingUnreachable('The seller’s system sent too much data')); return; } chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode || 0, json, text });
      });
      res.on('error', () => reject(new SiblingUnreachable()));
    });
    // The abort signal is a hard deadline for the whole exchange; `timeout` also catches an idle socket.
    req.on('timeout', () => req.destroy(new SiblingUnreachable(`The seller’s system did not answer within ${Math.round(timeoutMs / 1000)} seconds`)));
    req.on('error', (e: any) => { reject(e instanceof AddressRefused || e instanceof SiblingUnreachable ? e : new SiblingUnreachable()); });
    if (init.body) req.write(init.body);
    req.end();
  });
}
