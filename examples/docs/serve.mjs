// The instance, served the way its host serves it (entifix ADR 0031 §3): the
// exported site under `/docs`, the controls' Storybook under `/ui`, one origin,
// `…/` answered by its `index.html`, and `/` sent to the docs. No dependency —
// `next start` cannot serve an export, and the e2e must see what a host sees.
// The container runs this same file.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 3210);
/** Each path prefix and the directory it serves. */
const MOUNTS = [
  { base: '/docs', root: join(import.meta.dirname, 'out') },
  { base: '/ui', root: join(import.meta.dirname, 'ui') },
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

const notFound = response => {
  response.writeHead(404, { 'content-type': TYPES['.html'] });
  createReadStream(join(MOUNTS[0].root, '404.html')).pipe(response);
};

createServer((request, response) => {
  const path = decodeURIComponent(
    new URL(request.url ?? '/', 'http://x').pathname,
  );
  if (path === '/health') return response.writeHead(200).end('ok');
  if (path === '/') {
    return response.writeHead(308, { location: '/docs/' }).end();
  }
  const mount = MOUNTS.find(
    ({ base }) => path === base || path.startsWith(`${base}/`),
  );
  if (mount === undefined) return notFound(response);
  let file = normalize(join(mount.root, path.slice(mount.base.length)));
  if (!file.startsWith(mount.root)) return response.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory())
    file = join(file, 'index.html');
  if (!existsSync(file)) return notFound(response);
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(PORT);
