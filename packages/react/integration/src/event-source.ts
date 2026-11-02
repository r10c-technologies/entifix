/**
 * The browser transports behind `PushChannelTag` and `ReactiveChannelTag`:
 * `EventSource` over a same-origin URL.
 *
 * Its own entry point because choosing the transport and using the port are
 * different acts. A component that reacts to pushed events reads
 * `PushChannelTag` from `.`; only the composition root that picks SSE
 * imports this (ADR 0006).
 */
export * from './reactive/event-source-channel.js';
export * from './reactive/event-source-push-channel.js';
