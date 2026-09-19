import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEvidence, rankCandidates, suspectedRepetition } from '../selection.js';
import { research } from '../research.js';
import { CodexCliProvider } from '../providers/codex-cli.js';

// Artificial records only; these fixtures are never returned by the live provider.
const claim = (n, text) => ({ id: `TEST:claim:${n}`, section: 'claim', text: `${n}. ${text}` });
const record = (id, title, snippet, query = 'first') => ({
  publicationNumber: id, title, sourceUrl: `https://example.test/${id}`,
  matchedQueries: [query], detailsStatus: 'not_requested',
  evidence: [{ id: `${id}:snippet`, section: 'search_snippet', text: snippet }],
});

test('selects late relevant claims and recursive parents instead of first twelve', () => {
  const evidence = [claim(1, 'A container assembly.')];
  for (let i = 2; i < 35; i++) evidence.push(claim(i, 'A decorative finish.'));
  evidence.push(claim(35, 'The assembly of claim 1 with a soil moisture sensor.'));
  evidence.push(claim(54, 'The assembly of claim 35 with a water pump.'));
  evidence.push(claim(55, 'The assembly of claim 54 with a controller activating the pump.'));
  const selected = selectEvidence({ evidence }, ['soil moisture sensor', 'controller activating water pump']);
  for (const n of [1, 35, 54, 55]) assert.ok(selected.some((entry) => entry.id === `TEST:claim:${n}`));
  assert.ok(selected.length <= 12);
  for (const entry of selected) assert.ok(evidence.find((source) => source.id === entry.id).text.includes(entry.text));
});

test('retains several founder features rather than repeated hits on one feature', () => {
  const evidence = Array.from({ length: 20 }, (_, i) => claim(i + 1, 'A soil moisture sensor.'));
  evidence.push(claim(21, 'An integrated reservoir.'), claim(22, 'An adjustable threshold.'));
  const selected = selectEvidence({ evidence }, ['soil moisture sensor', 'integrated reservoir', 'adjustable threshold']);
  assert.ok(selected.some((entry) => entry.id === 'TEST:claim:21'));
  assert.ok(selected.some((entry) => entry.id === 'TEST:claim:22'));
});

test('long passages use bounded contiguous relevant windows and do not mutate sources', () => {
  const text = 'Unrelated material. '.repeat(300) + 'A soil moisture sensor activates a water pump.';
  const patent = { evidence: [{ id: 'TEST:abstract', section: 'abstract', text }] };
  const [selected] = selectEvidence(patent, ['soil moisture sensor water pump']);
  assert.ok(selected.text.includes('soil moisture sensor'));
  assert.ok(selected.text.length <= 3000);
  assert.ok(text.includes(selected.text));
  assert.equal(patent.evidence[0].text, text);
});

test('claim dependencies handle ranges, cycles, missing parents and a strict passage budget', () => {
  const patent = { evidence: [claim(1, 'A foundation of claim 2.'), claim(2, 'A base of claim 1.'),
    claim(3, 'A soil moisture sensor of claims 1–2.'), claim(4, 'A pump of claim 99.')] };
  const selected = selectEvidence(patent, ['soil moisture sensor'], { maxPassages: 3 });
  assert.deepEqual(selected.map((entry) => entry.id), ['TEST:claim:1', 'TEST:claim:2', 'TEST:claim:3']);
  const bounded = selectEvidence(patent, ['soil moisture sensor'], { maxPassages: 2 });
  assert.ok(bounded.length <= 2);
  assert.ok(!bounded.some((entry) => entry.id === 'TEST:claim:3'), 'Do not include a dependency bundle that cannot fit');
  assert.equal(selectEvidence({ evidence: [] }, []).length, 0);
});

test('ranking finds a stronger second-query result and demotes repeated titles without deleting them', () => {
  const input = { features: ['soil moisture sensor', 'adjustable threshold'], idea: 'Plant watering' };
  const a = record('A', 'Watering system', 'soil moisture sensor');
  const b = record('B', 'Watering system', 'soil moisture sensor');
  const c = record('C', 'Adjustable threshold moisture sensor', 'soil moisture sensor adjustable threshold', 'second');
  const d = record('D', 'Moisture feedback', 'soil moisture sensor');
  const ranked = rankCandidates([a, b, c, d], input);
  assert.equal(ranked[0], c);
  assert.ok(ranked.indexOf(d) < ranked.indexOf(b));
  assert.equal(ranked.length, 4);
  assert.ok(suspectedRepetition(a, b));
  assert.deepEqual(a.matchedQueries, ['first']);
});

test('equally relevant records from an unrepresented query receive priority', () => {
  const rows = [record('A', 'First sensor', 'soil moisture'), record('B', 'Second sensor', 'soil moisture'),
    record('C', 'Third sensor', 'soil moisture', 'second')];
  const result = rankCandidates(rows, { features: ['soil moisture'] });
  assert.deepEqual(result.map((patent) => patent.publicationNumber), ['A', 'C', 'B']);
});

test('research diversifies before capping detail calls and discloses suspected repetition', async () => {
  const first = [record('A', 'Moisture sensor', 'soil moisture sensor'), record('B', 'Moisture sensor', 'soil moisture sensor'),
    record('D', 'Water control', 'soil moisture sensor'), record('E', 'Packaging', 'cardboard')];
  const later = record('C', 'Adjustable moisture threshold', 'soil moisture sensor adjustable threshold');
  const detailed = [];
  const report = await research({ idea: 'A plant pot', features: ['soil moisture sensor', 'adjustable threshold'],
    queries: ['first', 'second'], country: 'US', maxResults: 4 }, {
    name: 'test_only', search: async (query) => ({ patents: query === 'first' ? first : [later] }),
    details: async (patent) => { detailed.push(patent.publicationNumber); return { ...patent, detailsStatus: 'available' }; },
  });
  assert.equal(detailed.length, 3);
  assert.ok(detailed.includes('C'));
  assert.ok(!(detailed.includes('A') && detailed.includes('B')));
  assert.ok(report.limitations.some((text) => text.includes('Family relationship') && text.includes('https://example.test/B')));
  assert.equal(report.coverage.uniquePublicationsRetrieved, 5);
  assert.equal(report.status, 'completed');
});

test('comparison sends selected late evidence to AI and validates against that exact context', async () => {
  const evidence = Array.from({ length: 20 }, (_, i) => claim(i + 1, 'Decorative coating.'));
  evidence.push(claim(35, 'A soil moisture sensor activates a water pump.'));
  const ai = new CodexCliProvider();
  ai.invoke = async (_task, data) => {
    const selected = data.patents[0].evidence.find((entry) => entry.id === 'TEST:claim:35');
    assert.ok(selected);
    return { summary: 'The supplied text mentions sensing and pumping.', alternatives: [], questions: [],
      comparisons: [{ publicationNumber: 'TEST', feature: 'soil moisture sensor', relationship: 'related',
        explanation: 'The claim mentions a soil moisture sensor.', citations: [{ evidenceId: selected.id, quote: selected.text }] }] };
  };
  const result = await ai.compare({ input: { idea: 'A watering device', features: ['soil moisture sensor'] },
    patents: [{ publicationNumber: 'TEST', title: 'Test evidence', evidence }] });
  assert.equal(result.status, 'completed');
});
