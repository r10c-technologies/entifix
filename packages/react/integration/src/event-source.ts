/**
 * The browser transport behind `ReactiveChannelTag`: one `EventSource` over a
 * same-origin URL.
 *
 * Its own entry point because choosing the transport and using the port are
 * different acts. A component that reacts to change events reads
 * `ReactiveChannelTag` from `.`; only the composition root that picks SSE
 * imports this (ADR 0006).
 */
export * from './reactive/event-source-channel.js';
