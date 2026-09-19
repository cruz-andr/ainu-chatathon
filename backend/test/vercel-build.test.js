import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('Vercel build publishes only explicit assets and an isolated proxy function', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'priorart-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['scripts/build-vercel.js', 'api/index.js', 'backend/public-proxy.js', 'frontend']) {
    await cp(new URL(`../../${path}`, import.meta.url), join(directory, path), { recursive: true });
  }
  execFileSync(process.execPath, ['scripts/build-vercel.js'], { cwd: directory });
  const output = join(directory, '.vercel/output');
  const files = (await readdir(output, { recursive: true })).filter((name) => /\.(?:json|js|html|css|svg)$/.test(name));
  assert.equal(files.length, 11);
  assert.ok(files.includes('static/patrick.svg'));
  assert.ok(!files.some((name) => /fixture|preview|login|sqlite|codex-cli/.test(name)));
  const config = JSON.parse(await readFile(join(output, 'config.json')));
  assert.equal(config.version, 3);
  assert.ok(config.routes.some((route) => route.dest === '/api' && new RegExp(`^${route.src}$`).test('/api/jobs/123')));
  const fn = JSON.parse(await readFile(join(output, 'functions/api.func/.vc-config.json')));
  assert.equal(fn.runtime, 'nodejs22.x');
  assert.equal(fn.shouldAddHelpers, false);
  assert.equal(fn.maxDuration, 30);
});
