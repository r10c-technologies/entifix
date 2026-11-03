/**
 * Server push: the port a host publishes to and a connection reads from
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)).
 *
 * A subpath rather than part of `.`, so a host can ban it from every package
 * that must not know a browser exists. The SSE adapter is at `./push/sse`.
 */
export * from './server-push.js';
