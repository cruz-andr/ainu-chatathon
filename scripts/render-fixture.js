// Offline layout development. Renders the artificial fixture through the real
// exporters so brief.js, latex.js and pdf.js can be iterated without a provider,
// a key, or SSH. This script never imports or invokes a live provider.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { toMarkdown } from '../backend/brief.js';
import { toLatex } from '../backend/latex.js';
import { toPdf } from '../backend/pdf.js';

const source = new URL('../data/fixture-report.json', import.meta.url);
const markdownOut = new URL('../output/fixture-brief.md', import.meta.url);
const latexOut = new URL('../output/fixture-brief.tex', import.meta.url);
const pdfOut = new URL('../output/fixture-brief.pdf', import.meta.url);

const report = JSON.parse(await readFile(source, 'utf8'));
const banner = `> ${report._fixture}\n\n`;
const latex = toLatex(report);

await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(markdownOut, banner + toMarkdown(report));
await writeFile(latexOut, latex);

const written = [markdownOut.pathname, latexOut.pathname];
try {
  await writeFile(pdfOut, await toPdf(latex));
  written.push(pdfOut.pathname);
} catch (error) {
  // A missing TeX install should not block Markdown and LaTeX development.
  console.warn(`PDF skipped (${error.code ?? 'error'}): ${error.message}`);
}
console.log(`Wrote fixture briefs:\n  ${written.join('\n  ')}`);
