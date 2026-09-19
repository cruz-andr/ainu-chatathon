import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccessStore } from '../sharing/access.js';
import { Jobs } from '../sharing/jobs.js';
import { createGateway } from '../sharing/gateway.js';

const input = { idea: 'A fictional container with a soil moisture sensor.', features: ['soil moisture sensor'],
  queries: ['soil moisture container'], country: 'US', maxResults: 3, allowExternalSearch: true };
const plan = { idea: input.idea, allowExternalAi: true };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('access codes are hashed, expire, revoke and preserve usage limits across restarts', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'priorart-access-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'access.sqlite');
  let now = Date.UTC(2026, 8, 19, 12);
  let access = new AccessStore(path, { now: () => now });
  const credential = access.create('test', 1);
  assert.equal(access.authenticate(credential.token).id, credential.id);
  assert.equal(access.authenticate('bad'), null);
  assert.equal(access.authenticate(credential.token.slice(0, -1) + '!'), null);
  for (let i = 0; i < 20; i++) access.reserve(credential.id, 'plan', plan);
  assert.throws(() => access.reserve(credential.id, 'plan', plan), { code: 'USAGE_LIMIT' });
  access.close();
  assert.ok(!readFileSync(path).includes(Buffer.from(credential.token.split('.')[1])));
  assert.ok(!readFileSync(path).includes(Buffer.from(input.idea)));
  access = new AccessStore(path, { now: () => now });
  t.after(() => access.close());
  assert.throws(() => access.reserve(credential.id, 'plan', plan), { code: 'USAGE_LIMIT' });
  const other = access.create('other');
  access.revoke(other.id);
  assert.equal(access.authenticate(other.token), null);
  now += 3_600_001;
  assert.equal(access.authenticate(credential.token), null);
});

test('global search budgets cap worst-case provider calls across different teammates', (t) => {
  const access = new AccessStore(':memory:'); t.after(() => access.close());
  const worstCase = { ...input, queries: ['a', 'b', 'c'], maxResults: 5 };
  for (let user = 0; user < 2; user++) {
    const { id } = access.create(`person${user}`);
    for (let n = 0; n < 10; n++) access.reserve(id, 'research', worstCase);
  }
  const third = access.create('third');
  assert.throws(() => access.reserve(third.id, 'research', worstCase), { code: 'USAGE_LIMIT' });
});

test('jobs are serial, owner-scoped, bounded, and expire without persisting prompts', async () => {
  const gate = deferred();
  let active = 0, peak = 0, now = 0;
  const jobs = new Jobs({ now: () => now, ttlMs: 100, maxPending: 2,
    access: { reserve() {}, active: () => true },
    execute: async () => { peak = Math.max(peak, ++active); await gate.promise; active--; return { answer: 'test' }; } });
  const first = jobs.submit('a', 'plan', plan), second = jobs.submit('b', 'plan', plan);
  assert.equal(jobs.get(first.jobId, 'b'), null);
  assert.throws(() => jobs.submit('a', 'plan', plan), { code: 'QUEUE_FULL' });
  await tick();
  assert.equal(jobs.get(first.jobId, 'a').status, 'running');
  assert.equal(jobs.get(second.jobId, 'b').status, 'queued');
  gate.resolve(); await tick();
  assert.equal(peak, 1);
  assert.equal(jobs.get(second.jobId, 'b').status, 'completed');
  now = 101;
  assert.equal(jobs.get(first.jobId, 'a'), null);
});

test('revoked queued jobs never execute and failed jobs do not stall the queue', async () => {
  const gate = deferred(), calls = [], revoked = new Set();
  const jobs = new Jobs({ access: { reserve() {}, active: (id) => !revoked.has(id) },
    execute: async (_kind, data) => { calls.push(data.idea); await gate.promise; throw new Error('SECRET must never escape'); } });
  const first = jobs.submit('a', 'plan', plan);
  const second = jobs.submit('b', 'plan', plan);
  await tick(); revoked.add('b'); gate.resolve(); await tick();
  assert.equal(jobs.get(first.jobId, 'a').error.code, 'JOB_FAILED');
  assert.ok(!jobs.get(first.jobId, 'a').error.message.includes('SECRET'));
  assert.equal(jobs.get(second.jobId, 'b').error.code, 'ACCESS_REVOKED');
  assert.equal(calls.length, 1);
});

async function setup(t, options = {}) {
  const access = new AccessStore(':memory:');
  const a = access.create('first'), b = access.create('second');
  let calls = 0;
  const server = createGateway({ access,
    provider: { configured: true, name: 'test_only', search: async () => { calls++; return { patents: [], skippedRecords: 0 }; } },
    ai: { configured: true, plan: async () => { calls++; return { features: ['sensor'], queries: ['sensor container'], questions: [] }; } }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); access.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { token, body, headers = {}, ...rest } = {}) => fetch(base + path, {
    ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), redirect: 'manual',
  });
  return { access, a, b, base, request, calls: () => calls };
}

test('unauthenticated, cross-origin, unsafe host and file requests cannot trigger work or read secrets', async (t) => {
  const { request, a, calls, base } = await setup(t);
  assert.equal((await request('/')).status, 302);
  assert.equal((await request('/login.html')).status, 200);
  assert.equal((await request('/api/health')).status, 401);
  assert.equal((await request('/api/plan', { body: plan, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/plan', { body: plan, token: 'invalid' })).status, 401);
  // fetch replaces the Host header; use raw HTTP to test host-header rejection.
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/health`, { headers: { Host: 'attacker.example', Authorization: `Bearer ${a.token}` } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(invalidHostStatus, 403);
  for (const path of ['/.env', '/.runtime/access.sqlite', '/src/../../.env']) assert.equal((await request(path, { token: a.token })).status, 404);
  assert.equal((await request('/api/plan', { body: { ...plan, allowExternalAi: false }, token: a.token })).status, 400);
  assert.equal((await request('/api/health?token=unsafe', { token: a.token })).status, 400);
  assert.equal(calls(), 0);
});

test('browser login creates HttpOnly session; revocation blocks existing sessions', async (t) => {
  const { request, a, base, access } = await setup(t);
  const login = await request('/api/session', { body: { token: a.token }, headers: { Origin: base } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie.includes('HttpOnly'));
  assert.ok(setCookie.includes('SameSite=Strict'));
  assert.ok(!setCookie.includes(a.token));
  const cookie = setCookie.split(';')[0];
  const health = await request('/api/health', { headers: { Cookie: cookie } });
  assert.equal(health.status, 200);
  assert.equal((await request('/api/plan', { body: plan, headers: { Cookie: cookie } })).status, 403);
  access.revoke(a.id);
  assert.equal((await request('/api/health', { headers: { Cookie: cookie } })).status, 401);
});

test('public mode uses Secure cookies and rejects non-configured origins', async (t) => {
  const { request, a } = await setup(t, { publicOrigin: 'https://demo.example' });
  const login = await request('/api/session', { body: { token: a.token }, headers: { Origin: 'https://demo.example', Host: 'demo.example' } });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get('set-cookie').includes('; Secure'));
  assert.equal((await request('/api/plan', { token: a.token, body: plan, headers: { Origin: 'https://other.example' } })).status, 403);
});

test('authenticated jobs return results, enforce report ownership, and support brief downloads', async (t) => {
  const { request, a, b } = await setup(t);
  const submission = await request('/api/research', { token: a.token, body: input });
  assert.equal(submission.status, 202);
  const { jobId } = await submission.json();
  await tick();
  assert.equal((await request(`/api/jobs/${jobId}`, { token: b.token })).status, 404);
  const job = await request(`/api/jobs/${jobId}`, { token: a.token }).then((r) => r.json());
  assert.equal(job.status, 'completed');
  const id = job.result.id;
  assert.equal((await request(`/api/research/${id}`, { token: b.token })).status, 404);
  assert.equal((await request(`/api/research/${id}/brief.md`, { token: b.token })).status, 404);
  assert.equal((await request(`/api/research/${id}/brief.md`, { token: a.token })).status, 200);
  assert.equal((await request(`/api/research/${id}/brief.tex`, { token: b.token })).status, 404);
  assert.equal((await request(`/api/research/${id}/brief.pdf`, { token: b.token })).status, 404);
  const tex = await request(`/api/research/${id}/brief.tex`, { token: a.token });
  assert.equal(tex.status, 200);
  assert.match(await tex.text(), /documentclass/);
  const planning = await request('/api/plan', { token: a.token, body: plan }).then((r) => r.json());
  await tick();
  assert.equal((await request(`/api/jobs/${planning.jobId}`, { token: a.token }).then((r) => r.json())).result.features[0], 'sensor');
});

test('login throttling rejects repeated guesses without trusting spoofed IP headers', async (t) => {
  const { request, base, calls } = await setup(t);
  for (let i = 0; i < 30; i++) assert.equal((await request('/api/session', { body: { token: 'invalid' }, headers: { Origin: base, 'X-Forwarded-For': `192.0.2.${i}` } })).status, 401);
  const response = await request('/api/session', { body: { token: 'invalid' }, headers: { Origin: base } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(calls(), 0);
});
