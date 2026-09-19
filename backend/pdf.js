// Compiles a LaTeX briefing to PDF with pdflatex.
//
// SECURITY: the LaTeX handed here contains provider, model, and founder text.
// backend/latex.js has already escaped every TeX control character, so the
// source cannot carry markup. This module is the second layer:
//
//   - shell escape is disabled, so \write18 cannot run a command even if a
//     backslash ever survived escaping;
//   - openin_any/openout_any are restricted, so \input and \openout cannot
//     reach outside the working directory;
//   - the process runs in a fresh temporary directory that is always removed;
//   - only paths this module chooses are passed as arguments. No founder or
//     provider string ever becomes an argv entry;
//   - every run is bounded by a timeout and the output size is capped.
//
// Compilation failure is reported as a failure. It never falls back to a
// partial or substituted document.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from './errors.js';

const SOURCE_NAME = 'brief.tex';
const OUTPUT_NAME = 'brief.pdf';
const MAX_BYTES = 20 * 1024 * 1024;

function compilePass(binary, directory, timeoutMs, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, [
      '-no-shell-escape',
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',
      '-output-directory', directory,
      SOURCE_NAME,
    ], {
      cwd: directory,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: {
        ...process.env,
        // web2c path restrictions: confine reads and writes to the work directory.
        openin_any: 'p',
        openout_any: 'p',
        TEXMFOUTPUT: directory,
      },
    });
    // TeX logs echo source text; do not surface or persist them.
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', (error) => reject(error));
    child.on('close', (code) => (code === 0
      ? resolve()
      : reject(new ApiError(502, 'PDF_FAILED', 'The briefing could not be typeset.'))));
  });
}

export async function toPdf(latex, {
  binary = process.env.PDFLATEX_BINARY || 'pdflatex',
  timeoutMs = 30_000,
  spawnImpl = spawn,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'patent-brief-'));
  try {
    await writeFile(join(directory, SOURCE_NAME), latex, 'utf8');
    // Two passes so longtable column widths settle.
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        await compilePass(binary, directory, timeoutMs, spawnImpl);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.code === 'ENOENT') {
          throw new ApiError(503, 'PDF_NOT_CONFIGURED',
            'pdflatex is not installed on the server. Download the LaTeX source instead.');
        }
        throw new ApiError(502, 'PDF_FAILED', 'The briefing could not be typeset.');
      }
    }
    const pdf = await readFile(join(directory, OUTPUT_NAME));
    if (!pdf.length || pdf.length > MAX_BYTES) {
      throw new ApiError(502, 'PDF_FAILED', 'The typeset briefing was empty or too large.');
    }
    return pdf;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'PDF_FAILED', 'The briefing could not be typeset.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
