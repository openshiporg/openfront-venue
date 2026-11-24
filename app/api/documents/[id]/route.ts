import type { IncomingMessage } from 'node:http';
import { keystoneContext } from '@/features/keystone/context';
import { staffWithFiles } from '@/features/keystone/models/Document';
import { readDocument } from '@/features/keystone/lib/documents';

/** Download a stored file. Staff who handle files only; always as an attachment, never rendered by the browser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await keystoneContext.withRequest({ headers: { cookie: req.headers.get('cookie') || '' }, method: 'GET', url: '/api/documents' } as IncomingMessage);
  if (!context.session?.itemId) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  if (!staffWithFiles({ session: context.session })) return Response.json({ error: 'Your role does not allow you to open files.' }, { status: 403 });
  const { id } = await params;
  const doc = await readDocument(context.sudo().prisma, id);
  if (!doc) return Response.json({ error: 'File not found' }, { status: 404 });
  return new Response(new Uint8Array(doc.bytes), { headers: {
    'Content-Type': doc.mimeType, 'Content-Disposition': `attachment; filename="${doc.filename}"`, 'Content-Length': String(doc.bytes.byteLength),
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
  } });
}
