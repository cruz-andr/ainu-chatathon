import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readJson } from '../app.js';
import { ApiError } from '../errors.js';
import { validatePlanRequest, validateResearch } from '../validation.js';
import { toMarkdown } from '../brief.js';
import { runResearch } from '../run-research.js';
import { Jobs } from './jobs.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const assetRoot = new URL('../../frontend/', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ['/login.html', ['login.html', 'text/html']],
  ...['api', 'app', 'render', 'login'].map((name) => [`/src/${name}.js`, [`src/${name}.js`, 'text/javascript']]),
]);

export function createGateway({ access, provider, ai, publicOrigin = '', now = Date.now }) {
  if (publicOrigin && (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(publicOrigin))) throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin with no path.');
  const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
  const sessions = new Map(), requestBuckets = new Map();
  const jobs = new Jobs({ access, now, execute: (kind, input) => kind === 'plan'
    ? ai.plan(input.idea) : runResearch(input, provider, ai) });
  function throttle(key, limit) {
    const minute = Math.floor(now() / 60_000);
    for (const [id, bucket] of requestBuckets) if (bucket.minute !== minute) requestBuckets.delete(id);
    const bucket = requestBuckets.get(key) ?? { minute, count: 0 };
    bucket.count++;
    requestBuckets.set(key, bucket);
    if (bucket.count > limit) throw new ApiError(429, 'RATE_LIMIT', 'Too many requests. Wait one minute and try again.');
  }
  function identity(req) {
    if (req.headers.authorization) return access.authenticate(req.headers.authorization.replace(/^Bearer /, ''));
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('priorart_session='))?.slice(17);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
    const session = sessions.get(hash(cookie));
    if (!session || session.expires <= now() || !access.active(session.user.id)) return null;
    return session.user;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const sessionCookie = (value, age) => `priorart_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${publicOrigin ? '; Secure' : ''}`;
    try {
      const localHost = `127.0.0.1:${server.address().port}`;
      const localName = `localhost:${server.address().port}`;
      const allowedHosts = publicHost ? [publicHost, localHost, localName] : [localHost, localName];
      if (!allowedHosts.includes(req.headers.host)) throw new ApiError(403, 'HOST_NOT_ALLOWED', 'Host is not configured.');
      const origins = publicOrigin ? [publicOrigin] : [`http://${localHost}`, `http://${localName}`];
      if (req.headers.origin && !origins.includes(req.headers.origin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Use the shared website origin.');
      if (req.method === 'POST' && !req.headers.authorization && !req.headers.origin) throw new ApiError(403, 'ORIGIN_REQUIRED', 'Browser requests must include the shared website origin.');
      const url = new URL(req.url, 'http://localhost');
      // Do not accept access credentials in URLs, where proxies and history retain them.
      if (url.search) throw new ApiError(400, 'QUERY_NOT_ALLOWED', 'Use request bodies or authorization headers, never URL credentials.');
      const path = url.pathname;
      const user = identity(req);
      throttle(user ? `user:${user.id}` : 'anonymous', user ? 120 : 120);
      if (req.method === 'POST' && path === '/api/session') {
        throttle('login', 30);
        const body = await readJson(req);
        const verified = access.authenticate(body?.token);
        if (!verified) throw new ApiError(401, 'UNAUTHORIZED', 'Access code is invalid, expired, or revoked.');
        for (const [id, session] of sessions) if (session.expires <= now() || session.user.id === verified.id) sessions.delete(id);
        if (sessions.size >= 100) throw new ApiError(429, 'SESSION_LIMIT', 'Too many active sessions.');
        const secret = randomBytes(32).toString('hex');
        sessions.set(hash(secret), { user: verified, expires: now() + 8 * 3_600_000 });
        res.setHeader('Set-Cookie', sessionCookie(secret, 8 * 3600));
        send(200, { status: 'authenticated' }); return;
      }
      const publicAsset = ['/login.html', '/src/login.js', '/styles.css'].includes(path);
      if (!user && !publicAsset) {
        if (req.method === 'GET' && ['/', '/index.html'].includes(path)) {
          res.writeHead(302, { Location: '/login.html' }); res.end(); return;
        }
        throw new ApiError(401, 'UNAUTHORIZED', 'Open the shared website and sign in with your teammate access code.');
      }
      if (req.method === 'POST' && path === '/api/logout') {
        for (const [id, session] of sessions) if (session.user.id === user.id) sessions.delete(id);
        res.setHeader('Set-Cookie', sessionCookie('', 0)); send(200, { status: 'signed_out' }); return;
      }
      if (req.method === 'GET' && path === '/api/health') {
        send(200, { status: 'ok', searchConfigured: provider.configured, aiConfigured: Boolean(ai?.configured), shared: true, storage: 'Reports in memory; expire one hour after completion or on restart.' }); return;
      }
      if (req.method === 'POST' && ['/api/plan', '/api/research'].includes(path)) {
        const kind = path === '/api/plan' ? 'plan' : 'research';
        const input = kind === 'plan' ? validatePlanRequest(await readJson(req)) : validateResearch(await readJson(req));
        if ((kind === 'plan' || input.analyze) && !ai?.configured) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The host needs to connect the AI worker.');
        if (kind === 'research' && !provider.configured) throw new ApiError(503, 'SEARCH_NOT_CONFIGURED', 'The host needs to configure patent search.');
        send(202, jobs.submit(user.id, kind, input)); return;
      }
      const jobMatch = path.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
      if (req.method === 'GET' && jobMatch) {
        const job = jobs.get(jobMatch[1], user.id);
        if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found or expired.');
        send(200, job); return;
      }
      const reportMatch = path.match(/^\/api\/research\/([a-f0-9-]{36})(\/brief\.md)?$/);
      if (req.method === 'GET' && reportMatch) {
        const report = jobs.report(reportMatch[1], user.id);
        if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found or expired.');
        if (!reportMatch[2]) send(200, report);
        else { res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="patent-research-${report.id}.md"` }); res.end(toMarkdown(report)); }
        return;
      }
      if (req.method === 'GET' && assets.has(path)) {
        const [name, type] = assets.get(path);
        const body = await readFile(new URL(name, assetRoot));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); return;
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error.status === 429) res.setHeader('Retry-After', '60');
      send(error instanceof ApiError ? error.status : 500, { error: { code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : 'An unexpected server error occurred.' } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 100;
  const pruneTimer = setInterval(() => {
    jobs.prune();
    for (const [id, session] of sessions) if (session.expires <= now() || !access.active(session.user.id)) sessions.delete(id);
  }, 60_000);
  pruneTimer.unref();
  server.on('close', () => clearInterval(pruneTimer));
  return server;
}
