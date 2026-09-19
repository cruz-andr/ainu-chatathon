import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPdf } from '../pdf.js';
import { toLatex } from '../latex.js';

// A stubbed pdflatex, so these tests never depend on a TeX installation.
function stubLatex({ code = 0, failWith = null } = {}) {
  const calls = [];
  const impl = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = Object.assign(new EventEmitter(), { resume() {} });
    child.stderr = Object.assign(new EventEmitter(), { resume() {} });
    queueMicrotask(() => {
      if (failWith) {
        child.emit('error', failWith);
        return;
      }
      if (code === 0) writeFileSync(join(options.cwd, 'brief.pdf'), '%PDF-1.5 stub\n');
      child.emit('close', code);
    });
    return child;
  };
  impl.calls = calls;
  return impl;
}

// Control characters only; the escaper in latex.js is what handles these.
const control = 'a \\ b { c } d $ e & f # g ^ h _ i ~ j % k < l > m';

const report = () => ({
  createdAt: 'now', status: 'completed', provider: 'test_only', elapsedMs: 1,
  input: { idea: control, features: ['feature'] },
  searches: [], warnings: [], limitations: ['Research assistance only.'],
  coverage: {
    publicationAuthority: 'US', pagePerQuery: 1, resultsPerQuery: 10,
    uniquePublicationsRetrieved: 1, returnedPublications: 0, detailsRequested: 0,
  },
  patents: [],
  analysis: { status: 'not_requested', comparisons: [], message: 'no analysis' },
});

test('typesetting disables shell escape and confines file access', async () => {
  const spawnImpl = stubLatex();
  await toPdf(toLatex(report()), { spawnImpl });
  assert.equal(spawnImpl.calls.length, 2, 'should run two passes');
  for (const call of spawnImpl.calls) {
    assert.ok(call.args.includes('-no-shell-escape'));
    assert.ok(call.args.includes('-interaction=nonstopmode'));
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env.openin_any, 'p');
    assert.equal(call.options.env.openout_any, 'p');
    assert.ok(Number.isFinite(call.options.timeout), 'each pass must be bounded');
  }
});

test('no document text is passed as a command argument', async () => {
  const spawnImpl = stubLatex();
  await toPdf(toLatex(report()), { spawnImpl });
  for (const call of spawnImpl.calls) {
    for (const argument of call.args) {
      assert.ok(!argument.includes(control), 'source text must never reach argv');
      assert.ok(!argument.includes('feature'), 'source text must never reach argv');
    }
    // Only the fixed source name and paths this module chose.
    assert.ok(call.args.at(-1) === 'brief.tex');
  }
});

test('a missing pdflatex is reported as unconfigured, not as a failed report', async () => {
  const missing = Object.assign(new Error('not found'), { code: 'ENOENT' });
  await assert.rejects(
    () => toPdf(toLatex(report()), { spawnImpl: stubLatex({ failWith: missing }) }),
    (error) => error.code === 'PDF_NOT_CONFIGURED' && error.status === 503,
  );
});

test('a failed compile surfaces as an error and never returns a partial document', async () => {
  await assert.rejects(
    () => toPdf(toLatex(report()), { spawnImpl: stubLatex({ code: 1 }) }),
    (error) => error.code === 'PDF_FAILED' && error.status === 502,
  );
});

test('a successful compile returns PDF bytes', async () => {
  const pdf = await toPdf(toLatex(report()), { spawnImpl: stubLatex() });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-', 'should return a PDF header');
});
