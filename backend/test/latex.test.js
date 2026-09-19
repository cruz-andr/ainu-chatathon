import test from 'node:test';
import assert from 'node:assert/strict';
import { toLatex } from '../latex.js';

// Artificial values only; no live provider or model is contacted.
const control = 'a \\ b { c } d $ e & f # g ^ h _ i ~ j % k < l > m';

const report = () => ({
  createdAt: '2026-01-01T00:00:00.000Z', status: 'completed', provider: 'test_only', elapsedMs: 1,
  input: { idea: control, features: ['compared feature', 'uncompared feature'] },
  searches: [{ query: control, status: 'completed', resultCount: 1 }],
  warnings: [], limitations: ['Research assistance only.'],
  coverage: {
    publicationAuthority: 'US', pagePerQuery: 1, resultsPerQuery: 10,
    uniquePublicationsRetrieved: 1, returnedPublications: 1, detailsRequested: 1,
  },
  patents: [{
    publicationNumber: 'AA0000001A1', title: control, sourceUrl: 'https://example.invalid/x',
    assignees: [control], publicationDate: null, filingDate: null, priorityDate: null, grantDate: null,
    documentType: 'granted_patent', legalStatus: { value: null, verified: false },
    retrievedAt: 'now', detailsStatus: 'available', matchedQueries: ['q'],
    evidence: [{ id: 'AA0000001A1:claim:1', section: 'claim', text: control }],
  }],
  analysis: {
    status: 'completed', summary: control, message: 'interpretation requires review',
    comparisons: [{
      publicationNumber: 'AA0000001A1', feature: 'compared feature', relationship: 'related',
      explanation: control, citations: [{ evidenceId: 'AA0000001A1:claim:1', quote: control }],
    }],
    alternatives: [], questions: [control],
  },
});

test('latex export neutralises every control character in untrusted text', () => {
  const output = toLatex(report());
  const body = output.slice(output.indexOf('\\begin{document}') + '\\begin{document}'.length);
  // A surviving raw backslash from source text would let source text act as markup.
  assert.ok(!body.includes('a \\ b'), 'raw backslash survived escaping');
  assert.ok(body.includes('\\textbackslash{}'), 'backslash was not converted to a text command');
  for (const [raw, escaped] of [['{ c }', '\\{ c \\}'], ['$ e', '\\$ e'], ['& f', '\\& f'],
    ['# g', '\\# g'], ['_ i', '\\_ i'], ['% k', '\\% k']]) {
    assert.ok(body.includes(escaped), `expected ${escaped}`);
    assert.ok(!body.includes(` ${raw} `), `unescaped ${raw} survived`);
  }
  assert.ok(body.includes('\\textasciicircum{}'), 'caret not neutralised');
  assert.ok(body.includes('\\textasciitilde{}'), 'tilde not neutralised');
  // Exactly one document terminator: source text must not be able to close it early.
  assert.equal(body.split('\\end{document}').length - 1, 1);
});

test('latex export rejects a source URL that is not a plain http link', () => {
  const unsafe = report();
  unsafe.patents[0].sourceUrl = 'https://example.invalid/x}{trailing';
  const output = toLatex(unsafe);
  assert.ok(!output.includes('}{trailing}'), 'malformed URL reached an href argument');
  assert.ok(output.includes('AA0000001A1'), 'publication number should still be shown as text');
});

test('latex export states it is not advice and shows uncompared features', () => {
  const output = toLatex(report());
  assert.ok(output.includes('not legal advice and not an opinion'));
  assert.ok(output.includes('Not established in reviewed evidence'));
  assert.ok(output.includes('not evidence that no patent covers them'));
  assert.ok(output.includes('uncompared feature'));
});

test('latex export handles an empty result without implying novelty', () => {
  const empty = report();
  empty.patents = [];
  empty.status = 'no_matches';
  empty.analysis = { status: 'no_evidence', comparisons: [], message: 'no records to compare' };
  const output = toLatex(empty);
  assert.ok(output.includes('No patent records were retrieved'));
  assert.ok(output.includes('not proof of novelty'));
  assert.ok(output.includes('\\end{document}'));
});
