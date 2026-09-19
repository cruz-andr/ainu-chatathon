import { ApiError } from './errors.js';

function invalid(message) {
  throw new ApiError(400, 'INVALID_REQUEST', message);
}

function text(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    invalid(`${name} must contain ${min}–${max} characters.`);
  }
  return value.trim();
}

function strings(value, name, min, max, length) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    invalid(`${name} must be an array with ${min}–${max} entries.`);
  }
  return [...new Set(value.map((item) => text(item, name, 2, length)))];
}

export function validateResearch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Expected a JSON object.');
  const idea = text(body.idea, 'idea', 20, 5000);
  const features = strings(body.features ?? [], 'features', 0, 8, 300);
  const queries = strings(body.queries, 'queries', 1, 3, 300);
  const country = body.country ?? 'US';
  if (!['US', 'EP', 'WO', 'GB', 'CA', 'AU', 'JP', 'CN', 'KR', 'DE', 'FR'].includes(country)) {
    invalid('Choose a supported publication authority (for example US, EP, or WO).');
  }
  const maxResults = body.maxResults ?? 5;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
    invalid('maxResults must be an integer from 1 to 10.');
  }
  if (body.allowExternalSearch !== true) {
    invalid('Set allowExternalSearch to true after agreeing to send the search queries to the search provider.');
  }
  if (body.analyze !== undefined && typeof body.analyze !== 'boolean') invalid('analyze must be true or false.');
  if (body.analyze && (body.allowExternalAi !== true || !features.length)) {
    invalid('AI comparison requires at least one confirmed feature and allowExternalAi: true.');
  }
  return { idea, features, queries, country, maxResults, allowExternalSearch: true,
    ...(body.analyze ? { analyze: true, allowExternalAi: true } : {}) };
}

export function validatePlanRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Expected a JSON object.');
  const idea = text(body.idea, 'idea', 20, 5000);
  if (body.allowExternalAi !== true) invalid('Set allowExternalAi to true after agreeing to send the idea to Codex on the Mac mini and its model provider.');
  return { idea };
}
