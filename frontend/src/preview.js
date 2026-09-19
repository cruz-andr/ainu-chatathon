// Renders the artificial fixture through the real report renderer so layout can
// be developed offline. Loaded only by preview.html, never by the live app, so
// no fixture can reach a real report path.
import { renderReport } from './render.js';

const mount = document.getElementById('report');

try {
  const response = await fetch('/data/fixture-report.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  renderReport(await response.json(), mount);
} catch (error) {
  const message = document.createElement('p');
  message.className = 'notice';
  message.textContent = `Could not load the fixture (${error.message}). Run "npm run frontend" from the project root.`;
  mount.append(message);
}
