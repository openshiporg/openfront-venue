import { createHash } from 'node:crypto';
import { appendAuditEvent } from './audit';

export const DOCUMENT_KINDS = ['rider', 'contract', 'insurance', 'pos_report', 'promoter_statement', 'barcode_import', 'other'] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** A filename safe to echo back in Content-Disposition: no paths, quotes or control characters. */
export function safeFilename(name: string) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return clean || 'file';
}

export type NewDocument = { bytes: Uint8Array; filename: string; mimeType?: string; title?: string; kind?: string; eventId?: string | null; venueDealId?: string | null; promoterId?: string | null };

/** Store one file in the database with its checksum, and audit it. One short transaction per file. */
export async function storeDocument(prisma: any, actorId: string, input: NewDocument) {
  const size = input.bytes?.byteLength || 0;
  if (!size) throw new Error('The file is empty');
  if (size > MAX_DOCUMENT_BYTES) throw new Error('Files can be at most 10 MB');
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(input.kind || '') ? input.kind! : 'other';
  const filename = safeFilename(input.filename);
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType || '') ? input.mimeType! : 'application/octet-stream';
  const buffer = Buffer.from(input.bytes);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return prisma.$transaction(async (tx: any) => {
    for (const [model, id] of [['event', input.eventId], ['venueDeal', input.venueDealId], ['promoter', input.promoterId]] as const) {
      if (id && !(await tx[model].findUnique({ where: { id }, select: { id: true } }))) throw new Error(`The ${model === 'venueDeal' ? 'venue deal' : model} was not found`);
    }
    const doc = await tx.document.create({
      data: { title: String(input.title || filename).slice(0, 200), kind, filename, mimeType, sizeBytes: size, sha256, content: buffer.toString('base64'), eventId: input.eventId || null, venueDealId: input.venueDealId || null, promoterId: input.promoterId || null, uploadedById: actorId },
      select: { id: true, title: true, kind: true, filename: true, mimeType: true, sizeBytes: true, sha256: true },
    });
    await appendAuditEvent(tx, actorId, { action: 'document.uploaded', targetList: 'Document', targetId: doc.id, after: { kind, filename, sizeBytes: size, sha256 } });
    return doc;
  });
}

/** The stored bytes and how to serve them, or null. */
export async function readDocument(prisma: any, id: string) {
  const doc = await prisma.document.findUnique({ where: { id }, select: { id: true, filename: true, mimeType: true, sha256: true, content: true } });
  if (!doc?.content) return null;
  return { filename: doc.filename || 'file', mimeType: doc.mimeType || 'application/octet-stream', sha256: doc.sha256, bytes: Buffer.from(doc.content, 'base64') };
}
