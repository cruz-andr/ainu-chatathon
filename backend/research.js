import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { rankCandidates, suspectedRepetition } from './selection.js';

export async function research(input, provider) {
  const started = Date.now();
  const outcomes = await Promise.allSettled(input.queries.map((query) => provider.search(query, input.country)));
  const successful = outcomes.filter((result) => result.status === 'fulfilled');
  if (!successful.length) {
    const error = outcomes[0].reason;
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'SEARCH_FAILED', 'All patent searches failed.');
  }
  const warnings = [];
  const records = new Map();
  const searches = outcomes.map((outcome, i) => {
    const query = input.queries[i];
    if (outcome.status === 'rejected') {
      warnings.push(`Search ${i + 1} failed; coverage is incomplete.`);
      return { query, status: 'failed', errorCode: outcome.reason instanceof ApiError ? outcome.reason.code : 'SEARCH_FAILED' };
    }
    for (const patent of outcome.value.patents) {
      if (!records.has(patent.publicationNumber)) records.set(patent.publicationNumber, { ...patent, matchedQueries: [] });
      records.get(patent.publicationNumber).matchedQueries.push(query);
    }
    if (outcome.value.skippedRecords) warnings.push(`Search ${i + 1} contained ${outcome.value.skippedRecords} unusable records.`);
    return { query, status: 'completed', resultCount: outcome.value.patents.length, retrievedAt: outcome.value.retrievedAt };
  });
  const ranked = rankCandidates([...records.values()], input);
  const shortlist = ranked.slice(0, input.maxResults);
  const repetitionNotes = [];
  for (let i = 0; i < ranked.length; i++) {
    const earlier = ranked.slice(0, i).find((other) => suspectedRepetition(ranked[i], other));
    if (earlier) repetitionNotes.push(`Suspected repetitive titles: ${earlier.publicationNumber} and ${ranked[i].publicationNumber}. Family relationship and material differences are unverified; compare both records: ${earlier.sourceUrl} and ${ranked[i].sourceUrl}.`);
  }
  let detailsFailed = 0;
  const patents = await Promise.all(shortlist.map(async (patent, index) => {
    if (index >= 3) return patent;
    try { return await provider.details(patent); }
    catch {
      detailsFailed++;
      warnings.push(`Details unavailable for ${patent.publicationNumber}; only search evidence is available.`);
      return { ...patent, detailsStatus: 'unavailable' };
    }
  }));
  const partial = successful.length !== outcomes.length || detailsFailed > 0;
  return {
    id: randomUUID(), createdAt: new Date().toISOString(), mode: 'live', provider: provider.name,
    status: partial ? 'partial' : patents.length ? 'completed' : 'no_matches',
    input, searches, patents, warnings,
    coverage: {
      publicationAuthority: input.country, pagePerQuery: 1, resultsPerQuery: 10,
      uniquePublicationsRetrieved: records.size, returnedPublications: patents.length,
      detailsRequested: Math.min(3, patents.length),
      deduplication: 'Provider default family grouping per query; publication number across queries.',
      exhaustive: false,
    },
    analysis: { status: 'not_configured', comparisons: [], message: 'AI comparison is not connected yet. These are retrieved source records, not an AI assessment.' },
    elapsedMs: Date.now() - started,
    limitations: [
      'Research assistance only; this is not a patentability or freedom-to-operate opinion.',
      'No matches means none were retrieved by these searches, not that the invention is novel or safe to build.',
      'Search snippets may be incomplete. Abstracts and claims are identified separately when available.',
      'Provider-reported legal status is not independently verified. Unpublished applications are not covered.',
      'Shortlist ranked across all queries by feature keyword overlap in titles/snippets, with query diversity and a repeated-title penalty. This heuristic can miss relevant records; it is not a semantic or legal assessment.',
      'AI reviews at most three shortlisted records and twelve relevance-selected passages per record, each at most 3000 characters. Available referenced parent claims are included when the passage budget allows; omitted or truncated context may matter.',
      ...repetitionNotes,
    ],
  };
}

// Local hackathon storage: bounded, ephemeral, and never written to disk.
export class ReportStore {
  constructor({ ttlMs = 60 * 60 * 1000, limit = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.limit = limit;
    this.reports = new Map();
  }
  prune() {
    for (const [id, entry] of this.reports) if (entry.expiresAt <= Date.now()) this.reports.delete(id);
  }
  put(report) {
    this.prune();
    while (this.reports.size >= this.limit) this.reports.delete(this.reports.keys().next().value);
    this.reports.set(report.id, { report, expiresAt: Date.now() + this.ttlMs });
  }
  get(id) {
    this.prune();
    return this.reports.get(id)?.report;
  }
}
