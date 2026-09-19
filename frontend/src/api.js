// Typed-by-convention client for the founder patent research API.
// Field names mirror README.md exactly; do not rename them here.

const localPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5173';
const localBridge = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5174';
const API_BASE = window.__API_BASE__ ?? (localPreview ? 'http://127.0.0.1:3001' : window.location.origin);

export class ApiFailure extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new ApiFailure(
      'NETWORK',
      `Could not reach the research API at ${API_BASE}. Start it with "npm start".`,
      0,
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !localBridge && API_BASE === window.location.origin) window.location.assign('/login.html');
    throw new ApiFailure(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `Request failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  if (response.status === 202 && body?.jobId) return waitForJob(body.jobId);
  return body;
}

async function waitForJob(id) {
  const until = Date.now() + 20 * 60_000;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const job = await call(`/api/jobs/${encodeURIComponent(id)}`);
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new ApiFailure(job.error.code, job.error.message, 502);
  }
  throw new ApiFailure('JOB_WAIT_TIMEOUT', 'The queued job is taking too long. Contact the host before starting another run.', 408);
}

const postJson = (path, payload) => call(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const health = () => call('/api/health');

export const plan = (idea) => postJson('/api/plan', { idea, allowExternalAi: true });

export const research = ({ idea, features, queries, country, maxResults, analyze }) =>
  postJson('/api/research', {
    idea,
    features,
    queries,
    country,
    maxResults,
    allowExternalSearch: true,
    ...(analyze ? { analyze: true, allowExternalAi: true } : {}),
  });

export const briefUrl = (id) => `${API_BASE}/api/research/${id}/brief.md`;
