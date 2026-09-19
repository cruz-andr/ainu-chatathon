// Typed-by-convention client for the founder patent research API.
// Field names mirror README.md exactly; do not rename them here.

const API_BASE = window.__API_BASE__ ?? 'http://127.0.0.1:3001';

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
    throw new ApiFailure(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `Request failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  return body;
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
