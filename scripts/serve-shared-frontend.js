// Teammate dev server: credentials remain server-side, never bundled into JS.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readJson } from '../backend/app.js';

const upstream = process.env.SHARED_API_URL;
const token = process.env.SHARED_API_TOKEN;
if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(upstream ?? '') || !/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(token ?? '')) {
  throw new Error('Set SHARED_API_URL (HTTPS origin) and SHARED_API_TOKEN in your local .env. No SSH or Tailscale needed.');
}
const port = 5174;
const assets = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ...['api', 'app', 'render'].map((name) => [`/src/${name}.js`, `src/${name}.js`])]);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
    if (!hosts.includes(req.headers.host) || (req.headers.origin && !hosts.map((host) => `http://${host}`).includes(req.headers.origin))) {
      res.writeHead(403).end(); return;
    }
    const url = new URL(req.url, 'http://localhost');
    const apiRoute = /^\/api\/(?:health|plan|research|jobs\/[a-f0-9-]{36}|research\/[a-f0-9-]{36}(?:\/brief\.(?:md|tex|pdf))?)$/.test(url.pathname);
    if (!url.search && apiRoute && ['GET', 'POST'].includes(req.method)) {
      if (req.method === 'POST' && !req.headers.origin) { res.writeHead(403).end(); return; }
      const body = req.method === 'POST' ? JSON.stringify(await readJson(req)) : undefined;
      const response = await fetch(upstream + url.pathname, { method: req.method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      for (const name of ['content-type', 'content-disposition', 'retry-after']) if (response.headers.has(name)) res.setHeader(name, response.headers.get(name));
      res.writeHead(response.status); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (req.method === 'GET' && !url.search && assets.has(url.pathname)) {
      const name = assets.get(url.pathname);
      const body = await readFile(new URL(`../frontend/${name}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(body); return;
    }
    res.writeHead(404).end();
  } catch {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'SHARED_BACKEND_UNAVAILABLE', message: 'Could not reach the shared backend. Check your private .env and ask the host whether the tunnel is running.' } }));
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, '127.0.0.1', () => console.log(`Your local frontend, shared backend: http://localhost:${port}`));
