import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { CodexCliProvider, validateComparisons, validatePlan } from '../providers/codex-cli.js';
import { createApp } from '../app.js';
import { ApiError } from '../errors.js';

const features = ['soil moisture sensor'];
const quote = 'A soil moisture sensor sends a measurement to a controller.';
const patents = [{ publicationNumber: 'TEST_ONLY', title: 'Artificial evidence',
  evidence: [{ id: 'TEST_ONLY:abstract', section: 'abstract', text: quote }] }];
const citation = { evidenceId: 'TEST_ONLY:abstract', quote };
const output = () => ({ summary: 'Both descriptions mention soil moisture sensing.',
  comparisons: [{ publicationNumber: 'TEST_ONLY', feature: features[0], relationship: 'related',
    explanation: 'The supplied passage mentions moisture sensing.', citations: [citation] }],
  alternatives: [{ feature: features[0], approach: 'Investigate a weight-based measurement system.',
    tradeoffs: 'Container weight can change for reasons besides water content.',
    questionsForProfessional: ['What additional records should be searched for this approach?'], citations: [citation] }],
  questions: ['Which claims should a professional review?'],
});

test('AI planner output enforces bounded query and feature fields', () => {
  assert.equal(validatePlan({ features, queries: ['soil moisture sensor'], questions: [] }).queries.length, 1);
  for (const bad of [{}, { features, queries: [], questions: [] }, { features, queries: ['x'.repeat(301)], questions: [] }]) {
    assert.throws(() => validatePlan(bad), { code: 'INVALID_AI_RESPONSE' });
  }
});

test('comparison validates provenance and marks alternative approaches as proposed', () => {
  const result = validateComparisons(output(), patents, features);
  assert.equal(result.comparisons[0].citations[0].quote, quote);
  assert.equal(result.alternatives[0].status, 'proposed_for_review');
});

test('rejects invented quotes, wrong publications, unknown features, and unsupported alternatives', () => {
  const mutations = [
    (data) => { data.comparisons[0].citations = [{ ...citation, quote: 'A claim that never appeared in the source.' }]; },
    (data) => { data.comparisons[0].publicationNumber = 'OTHER'; },
    (data) => { data.comparisons[0].feature = 'invented feature'; },
    (data) => { data.comparisons[0].relationship = 'safe_to_build'; },
    (data) => { data.alternatives[0].citations = [{ evidenceId: 'OTHER:claim', quote }]; },
    (data) => { data.alternatives[0].questionsForProfessional = []; },
    (data) => { data.comparisons = []; },
  ];
  for (const mutate of mutations) {
    const data = structuredClone(output());
    mutate(data);
    assert.throws(() => validateComparisons(data, patents, features), { code: 'INVALID_AI_RESPONSE' });
  }
});

test('Codex SSH invocation sends user input through stdin, with shell and web tools disabled', async () => {
  let captured;
  const ai = new CodexCliProvider({ target: 'tester@mac-mini', spawnImpl: (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {};
    let prompt = '';
    child.stdin.on('data', (chunk) => { prompt += chunk; });
    child.stdin.on('finish', () => {
      captured = { command, args, options, prompt };
      child.stdout.end(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message',
        text: JSON.stringify({ features, queries: ['soil moisture'], questions: [] }) } }) + '\n');
      child.emit('close', 0);
    });
    return child;
  } });
  const idea = 'A sensor; $(do-not-execute) `nor-this`';
  const plan = await ai.plan(idea);
  assert.equal(plan.provider, 'codex_cli_ssh');
  assert.equal(captured.command, 'ssh');
  assert.ok(!captured.args.join(' ').includes('do-not-execute'));
  assert.ok(captured.prompt.includes(idea));
  assert.ok(captured.args.at(-1).includes("'--disable' 'shell_tool'"));
  assert.ok(captured.args.at(-1).includes('web_search="disabled"'));
  assert.ok(captured.args.includes('StrictHostKeyChecking=yes'));
  assert.equal(ai.busy, false);
});

test('AI configuration errors and busy worker are explicit', async () => {
  await assert.rejects(new CodexCliProvider().plan('idea'), { code: 'AI_NOT_CONFIGURED' });
  await assert.rejects(new CodexCliProvider({ target: '-o proxycommand=bad' }).plan('idea'), { code: 'AI_CONFIG_INVALID' });
  const ai = new CodexCliProvider({ target: 'tester@mac-mini' });
  ai.busy = true;
  await assert.rejects(ai.plan('idea'), { code: 'AI_BUSY' });
});

test('HTTP AI planning works, requires disclosure, and comparison errors retain retrieved evidence', async (t) => {
  const ai = { configured: true, plan: async () => ({ features, queries: ['soil moisture'], questions: [], requiresReview: true }),
    compare: async () => { throw new ApiError(502, 'INVALID_AI_RESPONSE', 'Invalid citation'); } };
  const provider = { configured: true, name: 'test', search: async () => ({ patents, skippedRecords: 0 }),
    details: async (patent) => patent };
  const app = createApp({ ai, provider });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (path, data) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const idea = 'A container that senses moisture and controls a water supply.';
  assert.equal((await post('/api/plan', { idea })).status, 400);
  const plan = await post('/api/plan', { idea, allowExternalAi: true });
  assert.equal(plan.status, 200);
  assert.equal((await plan.json()).requiresReview, true);
  const body = { idea, features, queries: ['soil moisture'], allowExternalSearch: true, analyze: true, allowExternalAi: true };
  assert.equal((await post('/api/research', { ...body, allowExternalAi: false })).status, 400);
  const response = await post('/api/research', body);
  assert.equal(response.status, 201);
  const report = await response.json();
  assert.equal(report.status, 'partial');
  assert.equal(report.patents.length, 1);
  assert.equal(report.analysis.status, 'unavailable');
  assert.equal(report.analysis.errorCode, 'INVALID_AI_RESPONSE');
});
