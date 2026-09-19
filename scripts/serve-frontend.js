// Zero-dependency static server for frontend/. Local demo use only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../frontend/', import.meta.url));
const dataRoot = fileURLToPath(new URL('../data/', import.meta.url));
const port = Number(process.env.FRONTEND_PORT ?? 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const relative = normalize(path === '/' ? 'index.html' : path.slice(1));
  if (relative.startsWith('..')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  // /data/* serves the shared fixture so the preview page and the exporter read
  // the same file. Read-only, and only reachable on this local dev server.
  const base = relative.startsWith('data/') ? dataRoot : root;
  const target = relative.startsWith('data/') ? relative.slice('data/'.length) : relative;
  try {
    const body = await readFile(join(base, target));
    res.writeHead(200, {
      'Content-Type': types[extname(relative)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Frontend: http://localhost:${port}`);
});
