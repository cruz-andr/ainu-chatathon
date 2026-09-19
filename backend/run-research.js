import { research } from './research.js';
import { ApiError } from './errors.js';

// Shared by the local synchronous API and the authenticated job worker.
export async function runResearch(input, provider, ai) {
  const started = Date.now();
  const report = await research(input, provider);
  if (input.analyze && report.patents.length) {
    try { report.analysis = await ai.compare(report); }
    catch (error) {
      report.analysis = { status: 'unavailable', comparisons: [], message: 'AI comparison failed; retrieved patent evidence remains available.',
        errorCode: error instanceof ApiError ? error.code : 'AI_FAILED' };
      report.status = 'partial';
      report.warnings.push(report.analysis.message);
    }
  } else if (input.analyze) {
    report.analysis = { status: 'no_evidence', comparisons: [], message: 'No patent records are available for AI comparison.' };
  } else {
    report.analysis = { status: 'not_requested', comparisons: [], message: 'AI comparison was not requested. These are retrieved source records.' };
  }
  report.elapsedMs = Date.now() - started;
  return report;
}
