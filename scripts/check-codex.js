import assert from 'node:assert/strict';
import { CodexCliProvider } from '../backend/providers/codex-cli.js';

// Opt-in integration check: uses your Codex account, but no patent API or real invention.
const ai = new CodexCliProvider({ mode: process.env.CODEX_MODE || 'ssh', target: process.env.CODEX_SSH_TARGET, binary: process.env.CODEX_BINARY });
console.log('Testing live Mac mini Codex with a fictional idea and clearly artificial evidence.');
const idea = 'A plant container with a soil moisture sensor that opens a water valve when the soil is dry.';
const plan = await ai.plan(idea);
assert.ok(plan.queries.length > 0);
console.log(`Query planning passed: ${plan.features.length} features, ${plan.queries.length} queries.`);
const analysis = await ai.compare({
  input: { idea, features: ['soil moisture sensor', 'automatic water valve'] },
  patents: [{
    publicationNumber: 'TEST_ONLY_RECORD', title: 'Artificial test record; not an actual patent',
    evidence: [{ id: 'TEST_ONLY_RECORD:abstract', section: 'abstract',
      text: 'This artificial test record describes a soil moisture sensor connected to a controller. The controller opens an automatic water valve when the measured soil moisture falls below a threshold.' }],
  }],
});
assert.equal(analysis.status, 'completed');
assert.ok(analysis.comparisons.length > 0);
console.log(`Comparison passed: ${analysis.comparisons.length} comparisons, ${analysis.alternatives.length} proposed alternatives; citations validated.`);
console.log('Live Codex works. Live patent retrieval still requires its own provider key and separate verification.');
