// Embeds the compiled fixture PDF so layout is reviewed in the format the
// founder actually receives, rather than in an HTML approximation of it.
// Loaded only by preview.html, so no fixture can reach a live report path.

const viewer = document.getElementById('viewer');
const PDF_PATH = '/output/fixture-brief.pdf';

function fallback(message) {
  const note = document.createElement('p');
  note.className = 'notice';
  note.textContent = message;
  const hint = document.createElement('p');
  hint.className = 'meta';
  hint.textContent = 'Run "npm run render:fixture" from the project root, then reload. '
    + 'It needs pdflatex on the PATH.';
  viewer.replaceChildren(note, hint);
}

try {
  // HEAD first so a missing or un-compiled PDF gives a real explanation
  // instead of an empty grey embed.
  const response = await fetch(PDF_PATH, { method: 'HEAD' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const frame = document.createElement('iframe');
  frame.className = 'pdf-frame';
  frame.title = 'Compiled briefing preview (artificial fixture)';
  frame.src = PDF_PATH;
  viewer.replaceChildren(frame);
} catch (error) {
  fallback(`The compiled briefing is not available (${error.message}).`);
}
