//@ts-check

/**
 * A docs site is files (entifix ADR 0031 §3): a static export with a trailing
 * slash on every address, so each page is `…/index.html` and any static host
 * serves it. It is served under a base path on purpose — the e2e proves the
 * pages, the assets and the Pagefind index all resolve below one.
 *
 * @type {import('next').NextConfig}
 **/
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: '/docs',
  images: { unoptimized: true },
};

module.exports = nextConfig;
