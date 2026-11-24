import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Small secrets (a sibling's refresh token, a pending PKCE verifier) sealed with AES-256-GCM in the SecretBox list.
 * Never a column on a business list. Ported from Openfront Auto Repair; the key comes from VENUE_SECRET_KEY when it is
 * set, and is otherwise derived from SESSION_SECRET by HKDF with a fixed label, so there is no new required setting.
 * The row's key is bound in as additional data, so a sealed value cannot be moved to another row.
 */
const LABEL = 'openfront-venue/secret-box/v1';

export class SecretUnreadable extends Error {
  constructor() { super('A stored secret cannot be opened with this deployment’s key. Reconnect to store it again.'); }
}

export function secretKey(env: Record<string, string | undefined> = process.env): Buffer {
  const own = (env.VENUE_SECRET_KEY || '').trim();
  if (/^[0-9a-f]{64}$/i.test(own)) return Buffer.from(own, 'hex');
  const material = own || env.SESSION_SECRET || '';
  if (material.length < 32) throw new Error('SESSION_SECRET must be set (at least 32 characters) to keep secrets');
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), LABEL, 32));
}

export type Sealed = { ciphertext: string; iv: string; authTag: string };

export function seal(key: Buffer, name: string, value: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name, 'utf8'));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: body.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function open(key: Buffer, name: string, sealed: Sealed): string {
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    d.setAAD(Buffer.from(name, 'utf8'));
    d.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(sealed.ciphertext, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new SecretUnreadable();
  }
}

/** `db` is a Prisma client or transaction client. */
export async function putSecret(db: any, name: string, value: string, key = secretKey()) {
  const sealed = seal(key, name, value);
  await db.secretBox.upsert({ where: { key: name }, create: { key: name, ...sealed, keyVersion: 1 }, update: { ...sealed, rotatedAt: new Date() } });
}

export async function getSecret(db: any, name: string, key = secretKey()): Promise<string | null> {
  const row = await db.secretBox.findUnique({ where: { key: name } });
  if (!row?.ciphertext) return null;
  return open(key, name, row);
}

export async function dropSecret(db: any, name: string) {
  await db.secretBox.deleteMany({ where: { key: name } });
}
