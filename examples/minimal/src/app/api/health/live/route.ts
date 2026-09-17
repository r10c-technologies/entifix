/**
 * Liveness, and the build mode it runs in.
 *
 * `@entifix/testing-e2e` probes this before a hermetic run to refuse attaching
 * to a development server by accident. Written out rather than taken from
 * `createHealthRoutes`, whose other two handlers need a config service this
 * example does not have.
 */
export function GET() {
  return Response.json({
    status: 'live',
    app: '@entifix/example-minimal',
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  });
}
