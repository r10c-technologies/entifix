//@ts-check

/**
 * Nx 24 removed `withNx`; with an empty `nx` block it added nothing here.
 * The example consumes entifix through each package's built `exports`, so
 * Next needs no workspace path mapping or transpile list.
 *
 * @type {import('next').NextConfig}
 **/
const nextConfig = {};

module.exports = nextConfig;
