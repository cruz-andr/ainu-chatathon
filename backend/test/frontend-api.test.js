import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../frontend/src/api.js', import.meta.url), 'utf8');
let version = 0;
const load = () => import(`data:text/javascript;base64,${Buffer.from(source + `\n// test ${version++}`).toString('base64')}`);

test('frontend uses shared same-origin API and resolves queued plans', async (t) => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  globalThis.window = { location: { hostname: 'demo.example', port: '', origin: 'https://demo.example', assign: () => assert.fail('Unexpected redirect') } };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return urls.length === 1 ? Response.json({ jobId: 'test-job', status: 'queued' }, { status: 202 })
      : Response.json({ status: 'completed', result: { features: ['sensor'], queries: ['moisture'], questions: [] } });
  };
  const api = await load();
  assert.equal((await api.plan('A fictional sensor')).features[0], 'sensor');
  assert.deepEqual(urls, ['https://demo.example/api/plan', 'https://demo.example/api/jobs/test-job']);
  assert.equal(api.briefUrl('test'), 'https://demo.example/api/research/test/brief.md');
});

test('local developer bridge never redirects credential failures to a nonexistent login page', async (t) => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  globalThis.window = { location: { hostname: 'localhost', port: '5174', origin: 'http://localhost:5174', assign: () => assert.fail('Use local .env, not browser login') } };
  globalThis.fetch = async (url) => {
    assert.equal(url, 'http://localhost:5174/api/health');
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid code' } }, { status: 401 });
  };
  const api = await load();
  await assert.rejects(api.health(), { code: 'UNAUTHORIZED' });
});

test('original local frontend retains synchronous backend compatibility', async (t) => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  globalThis.window = { location: { hostname: 'localhost', port: '5173', origin: 'http://localhost:5173' } };
  globalThis.fetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:3001/api/health');
    return Response.json({ status: 'ok' });
  };
  assert.equal((await (await load()).health()).status, 'ok');
});
