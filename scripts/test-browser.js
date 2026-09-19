// Offline UI integration test. Artificial responses exist only in this test server.
// Requires Chrome; set CHROME_BINARY for installations outside the macOS default.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const fixture = JSON.parse(await readFile(new URL('../data/fixture-report.json', import.meta.url)));
const config = JSON.parse(await readFile('.vercel/output/config.json'));
const assets = new Map([['/', 'index.html'], ...['styles.css', 'patrick.svg', 'src/app.js', 'src/api.js', 'src/render.js'].map(p => ['/' + p, p])]);
let submissions = 0;
const server = createServer(async (req, res) => {
  for (const [name, value] of Object.entries(config.routes[0].headers)) res.setHeader(name, value);
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (assets.has(req.url)) {
    const path = assets.get(req.url);
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(await readFile(join('.vercel/output/static', path))); return;
  }
  if (req.method === 'POST') {
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body);
    if (req.url === '/api/plan' && input.allowExternalAi === true) { submissions++; json(202, { jobId: 'plan', status: 'queued' }); return; }
    if (req.url === '/api/research' && input.allowExternalSearch === true && input.allowExternalAi === true) { submissions++; json(202, { jobId: 'report', status: 'queued' }); return; }
  }
  if (req.url === '/api/jobs/plan') { json(200, { status: 'completed', result: { features: fixture.input.features, queries: ['artificial fixture query'], questions: ['Artificial clarification question?'] } }); return; }
  if (req.url === '/api/jobs/report') { json(200, { status: 'completed', result: fixture }); return; }
  if (req.url.endsWith('/brief.pdf')) { json(503, { error: { code: 'PDF_NOT_CONFIGURED', message: 'Artificial missing-compiler test.' } }); return; }
  json(404, { error: { code: 'NOT_FOUND' } });
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(join(tmpdir(), 'patrick-browser-test-'));
const chrome = spawn(process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws, session, nextId = 0;
const pending = new Map(), exceptions = [];
function command(method, params = {}, targeted = true) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(targeted && session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 100; n++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out; set CHROME_BINARY if needed.')), 20000);
    chrome.on('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', part => { output = (output + part.toString()).slice(-8000); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  ws = new WebSocket(url); await once(ws, 'open');
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    const entry = pending.get(message.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, false);
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }, false));
  await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command('Page.navigate', { url: base });
  await until("document.readyState === 'complete' && Boolean(document.getElementById('plan-submit'))");
  assert.match(await evaluate('document.title'), /Patrick/);
  assert.ok(await evaluate("[...document.querySelectorAll('img.mark')].every(img => img.complete && img.naturalWidth > 0)"), 'Every Patrick logo must load');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'), 'Mobile landing page must fit its viewport');
  const label = await evaluate("document.getElementById('plan-submit').textContent");
  await evaluate("document.getElementById('idea').value = 'ARTIFICIAL FIXTURE invention with a sensor and a reservoir.'; document.getElementById('plan-submit').click(); true");
  await until("!document.getElementById('step-plan').hidden");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('step-idea')).display"), 'none');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.marketing')).display"), 'none');
  assert.equal(await evaluate("document.getElementById('plan-submit').textContent"), label);
  assert.equal(await evaluate("document.getElementById('plan-submit-run').disabled"), true);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'), 'Mobile plan must fit its viewport');
  await evaluate("document.getElementById('consent-search').click(); document.getElementById('plan-submit-run').click(); true");
  await until("!document.getElementById('step-report').hidden");
  assert.ok(await evaluate("document.getElementById('report').textContent.includes('FIXTURE')"));
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'), 'Mobile report must fit its viewport');
  await evaluate("[...document.querySelectorAll('.downloads a')].find(a => a.href.endsWith('.pdf')).click(); true");
  await until("document.getElementById('report').textContent.includes('Artificial missing-compiler test.')");
  assert.equal(await evaluate("document.getElementById('step-report').hidden"), false);
  await evaluate("document.getElementById('report-restart').click(); true");
  assert.notEqual(await evaluate("getComputedStyle(document.getElementById('step-idea')).display"), 'none');
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.marketing')).display"), 'none');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 1440'), 'Desktop page must fit its viewport');
  assert.equal(submissions, 2); assert.deepEqual(exceptions, []);
  console.log('Offline Chrome checks passed: Patrick labels, consent, queued flow, hidden sections, mobile/desktop layouts, report, PDF errors, and reset.');
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.pid) await Promise.race([once(chrome, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
