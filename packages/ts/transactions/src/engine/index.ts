/**
 * The mechanism behind `@entifix/transactions`' ports: the in-memory circuit
 * breaker, bulkhead and retry budget, and the outbox relay and its metrics.
 *
 * A subpath rather than part of `.` although it installs nothing `.` does not,
 * because a consumer that writes against the contracts — a cell, a route, a
 * participant — must be able to ban the engine by name, and a ban matches a
 * specifier (ADR 0006).
 */
export * from './in-memory-bulkhead.js';
export * from './in-memory-circuit-breaker.js';
export * from './in-memory-retry-budget.js';
export * from './outbox-metrics.js';
export * from './outbox-relay.js';
