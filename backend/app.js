import { createServer } from 'node:http';
import { ApiError } from './errors.js';
import { validateResearch, validatePlanRequest } from './validation.js';
import { ReportStore } from './research.js';
import { runResearch } from './run-research.js';
import { toMarkdown } from './brief.js';
import { toLatex } from './latex.js';
import { toPdf } from './pdf.js';

export async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Use Content-Type: application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds 32 KB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}

export function createApp({ provider, ai, store = new ReportStore(), frontendOrigin = 'http://localhost:5173' }) {
  let activeResearch = 0;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.headers.origin) {
        if (req.headers.origin !== frontendOrigin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Frontend origin is not allowed.');
        res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') {
        send(200, { status: 'ok', searchConfigured: provider.configured, aiConfigured: Boolean(ai?.configured), storage: 'memory; expires after one hour or server restart' });
        return;
      }
      if (req.method === 'POST' && path === '/api/plan') {
        const { idea } = validatePlanRequest(await readJson(req));
        if (!ai?.configured) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Configure the Mac mini Codex worker first.');
        send(200, await ai.plan(idea));
        return;
      }
      if (req.method === 'POST' && path === '/api/research') {
        const input = validateResearch(await readJson(req));
        if (input.analyze && !ai?.configured) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Configure the Mac mini Codex worker or disable analysis.');
        if (activeResearch >= 2) throw new ApiError(429, 'BUSY', 'Two research requests are already running. Try again shortly.');
        activeResearch++;
        try {
          const report = await runResearch(input, provider, ai);
          store.put(report);
          send(201, report);
        } finally { activeResearch--; }
        return;
      }
      const match = path.match(/^\/api\/research\/([0-9a-f-]{36})(?:\/brief\.(md|tex|pdf))?$/);
      if (req.method === 'GET' && match) {
        const report = store.get(match[1]);
        if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found or expired. Run the search again.');
        // Each export escapes source text for its own format; none is HTML.
        if (match[2] === 'pdf') {
          // Typesetting is slow; bound it so a stuck run cannot hold the socket.
          const pdf = await toPdf(toLatex(report), { timeoutMs: 12_000 });
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': pdf.length,
            'Content-Disposition': `inline; filename="patent-research-${report.id}.pdf"`,
          });
          res.end(pdf);
          return;
        }
        const exports = {
          md: { type: 'text/markdown', render: toMarkdown },
          tex: { type: 'application/x-tex', render: toLatex },
        };
        const format = exports[match[2]];
        if (format) {
          res.writeHead(200, {
            'Content-Type': `${format.type}; charset=utf-8`,
            'Content-Disposition': `attachment; filename="patent-research-${report.id}.${match[2]}"`,
          });
          res.end(format.render(report));
        } else send(200, report);
        return;
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      if (!res.headersSent) {
        const known = error instanceof ApiError;
        send(known ? error.status : 500, { error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'An unexpected server error occurred.',
        } });
      } else res.end();
    }
  });
}
