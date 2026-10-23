/**
 * The query string as a load request, with no React behind it.
 *
 * Apart from `./url` because a server component that parses `searchParams`
 * has no use for the hooks, and `./url` re-exports modules that import React.
 * Nothing here imports anything but `@entifix/core`.
 */
export * from './url/url-query.js';
