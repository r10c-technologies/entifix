/**
 * Running a service: the HTTP server and its lifecycle, and loading its
 * configuration at boot.
 *
 * Apart from `.` because `.` is what a route set is written against — guards,
 * generic routes — and a cell that holds one must be able to ban the process it
 * runs in by specifier (ADR 0006). It is also the half that needs
 * `@effect/platform-node`, an optional peer for that reason.
 */
export * from './load-remote-configuration.js';
export * from './make-service.js';
