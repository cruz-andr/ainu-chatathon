// Vercel-only bridge. No model credentials, CLI, SQLite or background jobs here.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const COOKIE = '__Host-priorart_visitor';
const SESSION_MS = 8 * 3_600_000;
const hmac = (key, text) => createHmac('sha256', key).update(text).digest('hex');
const validKey = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const equal = (a, b) => validKey(a) && validKey(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export function signVisitor(id, expires, key) {
  const payload = `${id}.${expires}`;
  return `${payload}.${hmac(key, `visitor:${payload}`)}`;
}

export function readVisitor(cookie, key, now = Date.now()) {
  const raw = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw || !/^[a-f0-9]{32}\.\d{13}\.[a-f0-9]{64}$/.test(raw)) return null;
  const [id, expires, signature] = raw.split('.');
  if (Number(expires) <= now || Number(expires) > now + SESSION_MS || !equal(signature, hmac(key, `visitor:${id}.${expires}`))) return null;
  return id;
}

export function createPublicProxy({ upstream, key, fetchImpl = fetch, now = Date.now, vercel = false, allowLocalHttp = false } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: { code, message } })); };
    try {
      if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(upstream ?? '') || !validKey(key)) {
        send(503, 'DEPLOYMENT_NOT_CONFIGURED', 'The host must configure the private Mac mini connection in Vercel.'); return;
      }
      const host = req.headers.host;
      if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host)) { send(403, 'HOST_NOT_ALLOWED', 'Invalid website host.'); return; }
      const expectedOrigin = `${allowLocalHttp ? 'http' : 'https'}://${host}`;
      if ((req.headers.origin && req.headers.origin !== expectedOrigin)
        || (req.method === 'POST' && req.headers.origin !== expectedOrigin)
        || req.headers['sec-fetch-site'] === 'cross-site') {
        send(403, 'ORIGIN_NOT_ALLOWED', 'Use the form on this website.'); return;
      }
      const url = new URL(req.url, expectedOrigin);
      const allowedGet = /^\/api\/(?:health|jobs\/[a-f0-9-]{36}|research\/[a-f0-9-]{36}(?:\/brief\.(?:md|tex|pdf))?)$/.test(url.pathname);
      const allowedPost = ['/api/plan', '/api/research'].includes(url.pathname);
      if (url.search || !((req.method === 'GET' && allowedGet) || (req.method === 'POST' && allowedPost))) {
        send(404, 'NOT_FOUND', 'Endpoint not found.'); return;
      }
      let body;
      if (req.method === 'POST') {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { send(415, 'JSON_REQUIRED', 'Use JSON.'); return; }
        const chunks = []; let size = 0;
        // Build Output uses the raw Node request, without body-parser helpers.
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) { send(413, 'BODY_TOO_LARGE', 'Request exceeds 32 KB.'); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8');
        try { JSON.parse(body); } catch { send(400, 'INVALID_JSON', 'Request must be valid JSON.'); return; }
      }
      let id = readVisitor(req.headers.cookie, key, now());
      if (!id) {
        id = randomBytes(16).toString('hex');
        res.setHeader('Set-Cookie', `${COOKIE}=${signVisitor(id, now() + SESSION_MS, key)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_MS / 1000}`);
      }
      // Only trust Vercel's platform-injected client header in the Vercel runtime.
      // Locally use the actual socket peer, never caller-supplied forwarding headers.
      const candidate = vercel ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
      const ip = typeof candidate === 'string' && isIP(candidate) ? candidate : 'unknown';
      const network = hmac(key, `network:${ip}`);
      const response = await fetchImpl(upstream + url.pathname, {
        method: req.method, body, redirect: 'error', signal: AbortSignal.timeout(27_000),
        headers: { Authorization: `Bearer ${key}`, 'X-Visitor-Id': id, 'X-Visitor-Network': network,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      });
      if ([401, 403].includes(response.status)) {
        send(503, 'BACKEND_AUTH_FAILED', 'The host needs to check the private backend connection. No visitor login is required.'); return;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!/^(application\/json|application\/pdf|application\/x-tex|text\/markdown)(?:;|$)/.test(contentType)) {
        send(502, 'BACKEND_UNAVAILABLE', 'The research worker is temporarily unavailable. Contact the host.'); return;
      }
      const reader = response.body.getReader(), chunks = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4_000_000) { await reader.cancel(); send(502, 'REPORT_TOO_LARGE', 'The report exceeds the public demo response limit.'); return; }
        chunks.push(Buffer.from(value));
      }
      // Never forward upstream cookies, credentials, redirects or internal headers.
      for (const name of ['content-type', 'content-disposition', 'retry-after']) if (response.headers.has(name)) res.setHeader(name, response.headers.get(name));
      res.writeHead(response.status); res.end(Buffer.concat(chunks));
    } catch {
      if (!res.headersSent) send(502, 'BACKEND_UNAVAILABLE', 'The Mac mini research worker is unavailable. Contact the host; do not repeatedly resubmit.');
      else res.end();
    }
  };
}
