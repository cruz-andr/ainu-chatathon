import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateResearch } from '../validation.js';
import { SerpApiProvider, normalizePatent } from '../providers/serpapi.js';
import { research, ReportStore } from '../research.js';
import { ApiError } from '../errors.js';
import { toMarkdown } from '../brief.js';
import { createApp } from '../app.js';

const input = {
  idea: 'A plant container that measures moisture and controls watering.',
  features: ['moisture sensing', 'water delivery'],
  queries: ['plant container moisture water'],
  country: 'US', maxResults: 5, allowExternalSearch: true,
};
// Artificial field values for isolated tests; never served as live patent results.
const raw = { publication_number: 'US12345678B2', title: 'Test-only record', snippet: 'Test-only moisture sensing passage.' };
const normalized = () => normalizePatent(raw, '2026-09-19T16:00:00Z');
const stubProvider = () => ({
  configured: true, name: 'test_only',
  search: async () => ({ patents: [normalized()], retrievedAt: '2026-09-19T16:00:00Z', skippedRecords: 0 }),
  details: async (patent) => ({ ...patent, detailsStatus: 'available' }),
});

test('validates inputs before allowing externally transmitted searches', () => {
  assert.deepEqual(validateResearch(input), input);
  for (const change of [{ allowExternalSearch: false }, { queries: [] }, { queries: ['a', 'b', 'c', 'd'] },
    { idea: 'short' }, { maxResults: 100 }, { country: 'XX' }, { features: 'not an array' }]) {
    assert.throws(() => validateResearch({ ...input, ...change }), { code: 'INVALID_REQUEST' });
  }
});

test('normalization keeps unknowns unknown and separates snippets from claims', () => {
  const record = normalized();
  assert.equal(record.legalStatus.value, null);
  assert.equal(record.legalStatus.verified, false);
  assert.equal(record.evidence[0].section, 'search_snippet');
  assert.equal(record.documentType, 'granted_patent');
  assert.equal(normalizePatent({ ...raw, publication_number: 'US20260123456A1' }, '').documentType, 'published_application');
  assert.equal(normalizePatent({ ...raw, publication_number: 'javascript:alert(1)' }, ''), null);
});

test('missing credentials never invoke the network', async () => {
  const provider = new SerpApiProvider({ fetchImpl: () => assert.fail('Network must not be called') });
  await assert.rejects(provider.search('moisture', 'US'), { code: 'SEARCH_NOT_CONFIGURED' });
});

test('provider enforces documented request parameters and retrieves actual response evidence', async () => {
  const urls = [];
  const provider = new SerpApiProvider({ apiKey: 'secret-test-key', fetchImpl: async (url) => {
    urls.push(url);
    const details = url.searchParams.get('engine') === 'google_patents_details';
    return Response.json({ search_metadata: { status: 'Success' }, ...(details
      ? { publication_number: raw.publication_number, abstract: 'Test abstract.', claims: ['1. Test claim.'], legal_status: 'Active' }
      : { organic_results: [raw] }) });
  } });
  const result = await provider.search('moisture', 'US');
  const record = await provider.details(result.patents[0]);
  assert.equal(urls[0].searchParams.get('num'), '10');
  assert.equal(urls[0].searchParams.get('country'), 'US');
  assert.equal(urls[1].searchParams.get('patent_id'), `patent/${raw.publication_number}/en`);
  assert.deepEqual(record.evidence.map((item) => item.section), ['search_snippet', 'abstract', 'claim']);
  assert.equal(record.evidence[2].text, '1. Test claim.');
  assert.equal(record.legalStatus.verified, false);
});

test('provider failures and malformed payloads are not treated as no matches', async () => {
  for (const payload of [{ error: 'secret-test-key' }, { search_metadata: { status: 'Success' } },
    { search_metadata: { status: 'Processing' }, organic_results: [] }]) {
    const provider = new SerpApiProvider({ apiKey: 'secret-test-key', fetchImpl: async () => Response.json(payload) });
    await assert.rejects(provider.search('moisture', 'US'), (error) => {
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes('secret-test-key'));
      return true;
    });
  }
  const provider = new SerpApiProvider({ apiKey: 'secret-test-key', fetchImpl: async () => { throw new Error('secret-test-key'); } });
  await assert.rejects(provider.search('moisture', 'US'), { code: 'SEARCH_PROVIDER_UNAVAILABLE' });
});

test('completed empty searches stay distinct from failed searches', async () => {
  const provider = new SerpApiProvider({ apiKey: 'test', fetchImpl: async () => Response.json({
    search_metadata: { status: 'Success' }, search_information: { total_results: 0 },
  }) });
  const report = await research(input, provider);
  assert.equal(report.status, 'no_matches');
  assert.equal(report.coverage.exhaustive, false);
  assert.equal(report.analysis.status, 'not_configured');
});

test('detail identifier mismatches reject unrelated source evidence', async () => {
  const provider = new SerpApiProvider({ apiKey: 'test', fetchImpl: async () => Response.json({
    search_metadata: { status: 'Success' }, publication_number: 'US99999999B2', claims: ['Wrong patent'],
  }) });
  await assert.rejects(provider.details(normalized()), { code: 'INVALID_PROVIDER_RESPONSE' });
});

test('deduplicates publications across searches and caps detail requests at three', async () => {
  let detailRequests = 0;
  const provider = stubProvider();
  provider.search = async () => ({ patents: Array.from({ length: 5 }, (_, index) => normalizePatent({
    ...raw, publication_number: `US1234567${index}B2`,
  }, '2026-09-19T16:00:00Z')), skippedRecords: 0 });
  provider.details = async (patent) => { detailRequests++; return patent; };
  const report = await research({ ...input, queries: ['moisture sensor', 'watering container'] }, provider);
  assert.equal(report.patents.length, 5);
  assert.equal(detailRequests, 3);
  assert.equal(report.patents[0].matchedQueries.length, 2);
});

test('partial failures preserve usable records and disclose incomplete coverage', async () => {
  const provider = stubProvider();
  provider.search = async (query) => {
    if (query === 'failed query') throw new ApiError(502, 'SEARCH_FAILED', 'failure');
    return { patents: [normalized()], skippedRecords: 0 };
  };
  provider.details = async () => { throw new Error('details unavailable'); };
  const report = await research({ ...input, queries: ['working query', 'failed query'] }, provider);
  assert.equal(report.status, 'partial');
  assert.equal(report.patents.length, 1);
  assert.equal(report.patents[0].detailsStatus, 'unavailable');
  assert.equal(report.searches[1].status, 'failed');
  assert.equal(report.warnings.length, 2);
});

test('report store expires entries and caps retained reports', () => {
  const store = new ReportStore({ limit: 1 });
  store.put({ id: 'first' });
  store.put({ id: 'second' });
  assert.equal(store.get('first'), undefined);
  store.reports.get('second').expiresAt = Date.now() - 1;
  assert.equal(store.get('second'), undefined);
});

test('export preserves evidence and escapes untrusted document content', async () => {
  const report = await research({ ...input, idea: '<script>alert(1)</script> [click](javascript:alert(1))' }, stubProvider());
  const markdown = toMarkdown(report);
  assert.ok(markdown.includes('US12345678B2:snippet'));
  // Ordinary punctuation stays readable; only link and emphasis syntax is escaped.
  assert.ok(markdown.includes('Test-only moisture sensing passage.'));
  assert.ok(!markdown.includes('<script>'));
  assert.ok(!markdown.includes('[click]('));
  assert.ok(markdown.includes('not connected yet'));
});

test('export leads with conclusions and keeps source passages in the appendix', async () => {
  const report = await research(input, stubProvider());
  const markdown = toMarkdown(report);
  const features = markdown.indexOf('## Where your features stand');
  const records = markdown.indexOf('## Records retrieved');
  const appendixAt = markdown.indexOf('## Appendix: source passages');
  assert.ok(features > 0 && records > 0 && appendixAt > 0);
  assert.ok(features < records, 'feature table must precede the record list');
  assert.ok(records < appendixAt, 'full source passages must come last');
});

test('export reports uncompared founder features as a research gap, not as clearance', async () => {
  const report = await research(input, stubProvider());
  // The stub has no AI analysis, so neither supplied feature is compared.
  const markdown = toMarkdown(report);
  for (const feature of input.features) {
    assert.ok(markdown.includes(feature), `feature missing from export: ${feature}`);
  }
  assert.ok(markdown.includes('Not established in reviewed evidence'));
  assert.ok(markdown.includes('not evidence that no patent covers them'));
  // Disclaimers legitimately use these words ("not that the invention is novel"),
  // so scan only lines that are not themselves negations.
  const affirmative = markdown.split('\n').filter((line) => !/\bnot\b/i.test(line));
  for (const claim of [/\bpatentable\b/i, /\bis novel\b/i, /\b(?:cleared|safe) to build\b/i,
    /\bfreedom to operate\b/i, /\bdoes not infringe\b/i]) {
    const hit = affirmative.find((line) => claim.test(line));
    assert.equal(hit, undefined, `export must not assert ${claim} in: ${hit}`);
  }
});

test('export distinguishes records by how much of each was actually reviewed', async () => {
  const provider = stubProvider();
  const report = await research(input, {
    ...provider,
    details: async () => { throw new ApiError(502, 'DETAILS_FAILED', 'unavailable'); },
  });
  const markdown = toMarkdown(report);
  assert.ok(markdown.includes('Full text could not be retrieved; snippet only'));
});

test('export escapes block markers without corrupting numbered claim text', () => {
  const report = {
    createdAt: 'now', status: 'completed', provider: 'test_only',
    input: { idea: 'idea', features: ['f'] },
    searches: [], warnings: [], limitations: [],
    coverage: { publicationAuthority: 'US', uniquePublicationsRetrieved: 1, returnedPublications: 1, detailsRequested: 1 },
    patents: [{
      publicationNumber: 'US12345678B2', title: 'Test-only record', sourceUrl: 'https://example.invalid/x',
      assignees: [], publicationDate: null, filingDate: null, priorityDate: null, grantDate: null,
      documentType: 'granted_patent', legalStatus: { value: null, verified: false },
      retrievedAt: 'now', detailsStatus: 'available', matchedQueries: ['q'],
      evidence: [{ id: 'US12345678B2:claim:8', section: 'claim', text: '8. A test-only claim.\n# not a heading' }],
    }],
    analysis: { status: 'not_requested', comparisons: [], message: 'no analysis' },
  };
  const markdown = toMarkdown(report);
  // A digit cannot carry a Markdown escape, so the period is escaped instead.
  assert.ok(markdown.includes('8\\. A test-only claim.'));
  assert.ok(!/\\[0-9]/.test(markdown));
  assert.ok(markdown.includes('\\# not a heading'));
});

test('HTTP contract: health, validation, research, retrieval, export, origin restrictions', async (t) => {
  const app = createApp({ provider: stubProvider() });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.searchConfigured, true);
  assert.equal(health.aiConfigured, false);
  const post = (body) => fetch(`${base}/api/research`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post({})).status, 400);
  const response = await post(input);
  assert.equal(response.status, 201);
  const report = await response.json();
  const stored = await fetch(`${base}/api/research/${report.id}`).then((result) => result.json());
  assert.equal(stored.id, report.id);
  const exported = await fetch(`${base}/api/research/${report.id}/brief.md`);
  assert.match(exported.headers.get('content-type'), /text\/markdown/);
  assert.ok((await exported.text()).includes('Founder patent research brief'));
  assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
});
