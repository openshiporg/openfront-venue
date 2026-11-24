import type { IncomingMessage } from 'node:http';
import { keystoneContext } from '@/features/keystone/context';
import { permissions } from '@/features/keystone/access';
import { settlementExportDoc, statementCsv, statementPdf } from '@/features/keystone/lib/statement-export';

/** Settlement Export button: `?format=pdf` or `?format=csv`. Signed-in staff who manage settlements or venue deals only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await keystoneContext.withRequest({ headers: { cookie: req.headers.get('cookie') || '' }, method: 'GET', url: '/api/settlements/export' } as IncomingMessage);
  if (!context.session?.itemId) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  const allowed = permissions.canManageSettlements({ session: context.session } as any) || permissions.canManageVenueDeals({ session: context.session } as any);
  if (!allowed) return Response.json({ error: 'You need permission to manage settlements.' }, { status: 403 });
  const { id } = await params;
  const s = await context.prisma.settlement.findUnique({ where: { id }, include: { event: { include: { room: true } }, venueDeal: { include: { promoter: true } }, settlementLine_settlement: { orderBy: { createdAt: 'asc' } } } });
  if (!s || s.version === 0) return Response.json({ error: 'Settlement not found' }, { status: 404 });
  const store = await context.prisma.storeSettings.findFirst({ orderBy: { createdAt: 'asc' } });
  const doc = settlementExportDoc(s, store?.name || 'Openfront Venue');
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'pdf';
  const name = `settlement-${(s.event?.title || 'show').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-v${s.version}.${format}`;
  const body = format === 'csv' ? statementCsv(doc) : new Uint8Array(statementPdf(doc));
  return new Response(body, { headers: { 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
}
