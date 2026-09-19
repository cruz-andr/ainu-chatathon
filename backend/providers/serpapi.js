import { ApiError } from '../errors.js';

const string = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const publicationPattern = /^[A-Z]{2}[0-9]{4,}[A-Z][0-9]?$/;

export function normalizePatent(raw, retrievedAt) {
  const publicationNumber = string(raw?.publication_number);
  if (!publicationNumber || !publicationPattern.test(publicationNumber) || !string(raw.title)) return null;
  const id = `patent/${publicationNumber}/en`;
  const snippet = string(raw.snippet);
  return {
    id, publicationNumber, title: string(raw.title),
    sourceUrl: `https://patents.google.com/${id}`,
    assignees: string(raw.assignee) ? [string(raw.assignee)] : [],
    publicationDate: string(raw.publication_date),
    filingDate: string(raw.filing_date),
    priorityDate: string(raw.priority_date),
    grantDate: string(raw.grant_date),
    documentType: /^US\d+B/.test(publicationNumber) ? 'granted_patent'
      : /^US\d+A1$/.test(publicationNumber) ? 'published_application' : 'unknown',
    legalStatus: { value: null, verified: false },
    retrievedAt, detailsStatus: 'not_requested', matchedQueries: [],
    evidence: snippet ? [{ id: `${publicationNumber}:snippet`, section: 'search_snippet', text: snippet }] : [],
  };
}

export class SerpApiProvider {
  constructor({ apiKey, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = 'serpapi_google_patents';
  }

  get configured() { return Boolean(this.apiKey); }

  async request(parameters) {
    if (!this.configured) {
      throw new ApiError(503, 'SEARCH_NOT_CONFIGURED', 'Add SERPAPI_API_KEY to the server .env file to enable live search.');
    }
    const url = new URL('https://serpapi.com/search.json');
    for (const [key, value] of Object.entries({ ...parameters, api_key: this.apiKey })) {
      url.searchParams.set(key, String(value));
    }
    let response, body;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
      if (!response.ok) {
        throw new ApiError(502, 'SEARCH_PROVIDER_ERROR', `Patent provider returned HTTP ${response.status}. Check credentials, quota, or provider availability.`);
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Do not expose upstream URLs/errors: the URL contains the API key.
      throw new ApiError(502, 'SEARCH_PROVIDER_UNAVAILABLE', 'Patent provider request failed or timed out. Retry the search.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.error
        || body.search_metadata?.status !== 'Success') {
      throw new ApiError(502, 'SEARCH_PROVIDER_ERROR', 'Patent provider did not return a completed successful response.');
    }
    return body;
  }

  async search(query, country) {
    const body = await this.request({ engine: 'google_patents', q: query, country, num: 10, scholar: false });
    // A missing results array is accepted only when the provider explicitly reports zero results.
    if (!Array.isArray(body.organic_results) && body.search_information?.total_results !== 0) {
      throw new ApiError(502, 'INVALID_PROVIDER_RESPONSE', 'Patent search results were missing or malformed.');
    }
    const rows = body.organic_results ?? [];
    const retrievedAt = new Date().toISOString();
    const patents = rows.map((row) => normalizePatent(row, retrievedAt)).filter(Boolean);
    if (rows.length && !patents.length) {
      throw new ApiError(502, 'INVALID_PROVIDER_RESPONSE', 'No usable patent records were returned by the provider.');
    }
    return { patents, retrievedAt, skippedRecords: rows.length - patents.length };
  }

  async details(patent) {
    const body = await this.request({ engine: 'google_patents_details', patent_id: patent.id });
    if (body.publication_number !== patent.publicationNumber) {
      throw new ApiError(502, 'INVALID_PROVIDER_RESPONSE', 'Patent detail identifier did not match the requested publication.');
    }
    const evidence = [...patent.evidence];
    const abstract = string(body.abstract);
    if (abstract) evidence.push({ id: `${patent.publicationNumber}:abstract`, section: 'abstract', text: abstract });
    const claims = Array.isArray(body.claims) ? body.claims : [];
    for (const [index, claim] of claims.entries()) {
      if (string(claim)) evidence.push({ id: `${patent.publicationNumber}:claim:${index + 1}`, section: 'claim', text: string(claim) });
    }
    return {
      ...patent, evidence,
      assignees: Array.isArray(body.assignees) ? body.assignees.filter((item) => string(item)) : patent.assignees,
      detailsStatus: 'available', detailsRetrievedAt: new Date().toISOString(),
      legalStatus: { value: string(body.legal_status), verified: false },
    };
  }
}
