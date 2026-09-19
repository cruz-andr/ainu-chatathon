// Offline layout development. Renders the artificial fixture through the real
// exporter so brief.js can be iterated without a provider, a key, or SSH.
// This script never imports or invokes a live provider.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { toMarkdown } from '../backend/brief.js';

const source = new URL('../data/fixture-report.json', import.meta.url);
const destination = new URL('../output/fixture-brief.md', import.meta.url);
const report = JSON.parse(await readFile(source, 'utf8'));
const banner = `> ${report._fixture}\n\n`;
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(destination, banner + toMarkdown(report));
console.log(`Wrote fixture brief: ${destination.pathname}`);
