import type { IncomingMessage } from 'node:http';
import { keystoneContext } from '@/features/keystone/context';
import { staffWithFiles } from '@/features/keystone/models/Document';
import { storeDocument, MAX_DOCUMENT_BYTES } from '@/features/keystone/lib/documents';
import { isSameOrigin, issuerFromRequest } from '@/features/keystone/mcp-oauth/http';

/** Upload one file (multipart field `file`, plus title, kind, eventId, venueDealId, promoterId). Staff who handle files; same-origin only. */
export async function POST(req: Request) {
  if (!isSameOrigin(req, issuerFromRequest(req))) return Response.json({ error: 'This upload must come from this site.' }, { status: 403 });
  const context = await keystoneContext.withRequest({ headers: { cookie: req.headers.get('cookie') || '' }, method: 'POST', url: '/api/documents' } as IncomingMessage);
  if (!context.session?.itemId) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  if (!staffWithFiles({ session: context.session })) return Response.json({ error: 'Your role does not allow you to upload files.' }, { status: 403 });
  if (Number(req.headers.get('content-length') || 0) > MAX_DOCUMENT_BYTES + 64 * 1024) return Response.json({ error: 'Files can be at most 10 MB' }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: 'Send the file as a form upload.' }, { status: 400 }); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
  const field = (k: string) => { const v = form.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null; };
  try {
    const doc = await storeDocument(context.sudo().prisma, String(context.session.itemId), {
      bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mimeType: file.type,
      title: field('title') || undefined, kind: field('kind') || undefined, eventId: field('eventId'), venueDealId: field('venueDealId'), promoterId: field('promoterId'),
    });
    return Response.json(doc, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'The file could not be stored.' }, { status: 400 });
  }
}
