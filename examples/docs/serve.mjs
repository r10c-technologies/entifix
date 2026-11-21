// The exported site, served the way a static host serves it: `out/` under the
// base path, `…/` answered by its `index.html`, nothing else. No dependency —
// `next start` cannot serve an export, and the e2e must see what a host sees.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 3210);
const BASE = '/entifix';
const ROOT = join(import.meta.dirname, 'out');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

createServer((request, response) => {
  const path = decodeURIComponent(
    new URL(request.url ?? '/', 'http://x').pathname,
  );
  if (path === '/health') return response.writeHead(200).end('ok');
  if (!path.startsWith(`${BASE}/`) && path !== BASE) {
    return response.writeHead(404).end();
  }
  let file = normalize(join(ROOT, path.slice(BASE.length)));
  if (!file.startsWith(ROOT)) return response.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory())
    file = join(file, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': TYPES['.html'] });
    return createReadStream(join(ROOT, '404.html')).pipe(response);
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(PORT);
