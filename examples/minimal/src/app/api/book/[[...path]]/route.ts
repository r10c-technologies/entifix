import { createServiceProxyRoute } from '@entifix/next-shell/server';

/**
 * Same-origin proxy to the service, carrying the session cookie as a bearer
 * token — so the browser never talks to the service directly and never holds a
 * token it could leak.
 */
const proxy = createServiceProxyRoute({
  baseUrl:
    process.env['EXAMPLE_MINIMAL_SERVICE_URL'] ?? 'http://localhost:3301',
  pathPrefix: 'book',
});

const handler = (
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) =>
  proxy(request, {
    params: context.params.then(({ path }) => ({ path: path ?? [] })),
  });

export { handler as DELETE, handler as GET, handler as POST, handler as PUT };
