import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPublicProxy, signVisitor, readVisitor } from '../public-proxy.js';
import { AccessStore } from '../sharing/access.js';
import { createGateway } from '../sharing/gateway.js';

const key = 'a'.repeat(64), visitor = 'b'.repeat(32), network = 'c'.repeat(64);
async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('anonymous cookies are signed, expiring and cannot select another visitor', () => {
  const now = Date.now(), cookie = `__Host-priorart_visitor=${signVisitor(visitor, now + 1000, key)}`;
  assert.equal(readVisitor(cookie, key, now), visitor);
  assert.equal(readVisitor(cookie.replace(visitor, 'd'.repeat(32)), key, now), null);
  assert.equal(readVisitor(cookie, key, now + 1000), null);
  assert.equal(readVisitor(cookie, 'e'.repeat(64), now), null);
});
test('anonymous budgets survive cookie clearing through the network limit', () => {
  const access = new AccessStore(':memory:');
  try {
    for (let i = 0; i < 10; i++) {
      const user = access.visitor(i.toString(16).padStart(32, '0'), network);
      assert.equal(access.active(user.id), true);
      access.reserve(user.id, 'plan', {});
    }
    const user = access.visitor(visitor, network);
    assert.throws(() => access.reserve(user.id, 'plan', {}), { code: 'USAGE_LIMIT' });
    assert.equal(access.visitor('invalid', network), null);
  } finally { access.close(); }
});
test('public proxy issues automatic sessions and keeps jobs private through the gateway', async (t) => {
  const access = new AccessStore(':memory:'); t.after(() => access.close());
  const gateway = await listen(t, createGateway({ access, proxyKey: key,
    provider: { configured: true }, ai: { configured: true, plan: async () => ({ features: ['sensor'], queries: ['sensor'], questions: [] }) } }));
  let forwarded;
  const publicBase = await listen(t, createServer(createPublicProxy({ upstream: 'https://worker.example', key, allowLocalHttp: true,
    fetchImpl: (url, options) => { forwarded = options; return fetch(gateway + new URL(url).pathname, options); } })));
  const submit = await fetch(publicBase + '/api/plan', { method: 'POST', headers: {
    Origin: publicBase, 'Content-Type': 'application/json', Authorization: 'Bearer attacker', 'X-Visitor-Id': visitor,
  }, body: JSON.stringify({ idea: 'A fictional pot with a soil sensor', allowExternalAi: true }) });
  assert.equal(submit.status, 202);
  assert.equal(forwarded.headers.Authorization, `Bearer ${key}`);
  assert.notEqual(forwarded.headers['X-Visitor-Id'], visitor);
  assert.equal(forwarded.headers.Cookie, undefined);
  const cookie = submit.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Secure/);
  assert.ok(!cookie.includes(key));
  const { jobId } = await submit.json();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await fetch(publicBase + `/api/jobs/${jobId}`)).status, 404);
  const own = await fetch(publicBase + `/api/jobs/${jobId}`, { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await own.json()).status, 'completed');
  assert.equal((await fetch(gateway + '/api/health', { headers: { 'X-Visitor-Id': visitor, 'X-Visitor-Network': network } })).status, 401);
  assert.equal((await fetch(gateway + '/api/health', { headers: { Authorization: `Bearer ${key}` } })).status, 401);
});
test('public proxy blocks unsafe routes and origins before contacting the worker', async (t) => {
  let calls = 0;
  const base = await listen(t, createServer(createPublicProxy({ upstream: 'https://worker.example', key, allowLocalHttp: true,
    fetchImpl: async () => { calls++; return new Response('{}', { headers: { 'content-type': 'application/json' } }); } })));
  for (const path of ['/api/session', '/.env', '/api/health?token=secret']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + '/api/plan', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/plan', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/plan', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: 'invalid' })).status, 400);
  assert.equal(calls, 0);
});
test('missing configuration and upstream errors fail closed without exposing HTML or login', async (t) => {
  for (const [options, status, code] of [
    [{}, 503, 'DEPLOYMENT_NOT_CONFIGURED'],
    [{ fetchImpl: async () => new Response('private', { status: 401 }) }, 503, 'BACKEND_AUTH_FAILED'],
    [{ fetchImpl: async () => new Response('<html>internal</html>', { headers: { 'content-type': 'text/html' } }) }, 502, 'BACKEND_UNAVAILABLE'],
  ]) {
    const configured = Object.keys(options).length ? { upstream: 'https://worker.example', key } : {};
    const base = await listen(t, createServer(createPublicProxy({ ...configured, ...options, allowLocalHttp: true })));
    const response = await fetch(base + '/api/health');
    assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
  }
});
