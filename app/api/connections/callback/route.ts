import type { IncomingMessage } from 'node:http';
import { keystoneContext } from '@/features/keystone/context';
import { permissions } from '@/features/keystone/access';
import { completeConnection } from '@/features/keystone/lib/channel-connect';
import { publicHostPolicy } from '@/features/keystone/lib/sibling-http';
import { issuerFromRequest } from '@/features/keystone/mcp-oauth/http';

/**
 * W10.3: the sibling's consent page sends staff back here with ?code&state (or ?error). The code is exchanged with the
 * PKCE verifier sealed at start; the refresh token goes into SecretBox. Nothing here echoes a token or a code.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = issuerFromRequest(req);
  const back = (q: Record<string, string>) => Response.redirect(`${origin}/dashboard/platform/connections?${new URLSearchParams(q)}`, 303);
  const context = await keystoneContext.withRequest({ headers: { cookie: req.headers.get('cookie') || '' }, method: 'GET', url: '/api/connections/callback' } as IncomingMessage);
  if (!context.session?.itemId) return Response.redirect(`${origin}/dashboard/signin?from=${encodeURIComponent('/dashboard/platform/connections')}`, 303);
  if (!permissions.canManageConnections({ session: context.session })) return back({ error: 'Your role does not allow you to manage connections.' });
  try {
    const done = await completeConnection(context.sudo().prisma, publicHostPolicy, {
      state: url.searchParams.get('state') || '', code: url.searchParams.get('code'), error: url.searchParams.get('error'),
      errorDescription: url.searchParams.get('error_description'), iss: url.searchParams.get('iss'),
      redirectUri: `${origin}/api/connections/callback`, userId: String(context.session.itemId),
    });
    return back({ connected: done.id });
  } catch (e: any) {
    return back({ error: e?.message || 'The connection could not be completed.' });
  }
}
