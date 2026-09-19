// Source text remains plain text even if it contains HTML or Markdown instructions.
function safe(value) {
  return String(value ?? 'Unknown').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
}

export function toMarkdown(report) {
  const lines = [
    '# Founder patent research brief', '',
    `Created: ${report.createdAt}`, `Result: ${report.status}`, `Provider: ${report.provider}`, '',
    '## Idea', '', safe(report.input.idea), '',
    '## Features supplied by the founder', '', ...report.input.features.map((feature) => `- ${safe(feature)}`), '',
    '## Searches', '', ...report.searches.map((search) => `- ${safe(search.query)} — ${search.status}`), '',
    `Publication authority: ${report.coverage.publicationAuthority}. First page only; non-exhaustive.`, '',
    '## Retrieved records', '',
  ];
  if (!report.patents.length) lines.push('No patent records were retrieved. Review search completion and coverage before interpreting this result.', '');
  for (const patent of report.patents) {
    lines.push(`### ${safe(patent.publicationNumber)} — ${safe(patent.title)}`, '',
      `[Open source](${patent.sourceUrl})`, '',
      `Type: ${safe(patent.documentType)}; publication date: ${safe(patent.publicationDate)}.`,
      `Assignees: ${safe(patent.assignees.join(', ') || null)}.`,
      `Legal status (unverified): ${safe(patent.legalStatus.value)}.`,
      `Retrieved: ${patent.retrievedAt}; details: ${patent.detailsStatus}.`, '');
    for (const evidence of patent.evidence) {
      lines.push(`Evidence ${safe(evidence.id)} (${safe(evidence.section)}):`, '',
        ...safe(evidence.text).split('\n').map((line) => `> ${line}`), '');
    }
  }
  lines.push('## Analysis', '', safe(report.analysis.message), '');
  if (report.analysis.summary) lines.push(safe(report.analysis.summary), '');
  for (const comparison of report.analysis.comparisons) {
    lines.push(`### ${safe(comparison.feature)} — ${safe(comparison.publicationNumber)}`, '',
      `Relationship: ${safe(comparison.relationship)}. ${safe(comparison.explanation)}`, '');
    for (const citation of comparison.citations) {
      lines.push(`Evidence ${safe(citation.evidenceId)}:`, '',
        ...safe(citation.quote).split('\n').map((line) => `> ${line}`), '');
    }
  }
  if (report.analysis.alternatives?.length) {
    lines.push('## Alternative approaches for professional review', '',
      'These are technical hypotheses. No alternative has been cleared for patentability or freedom to operate.', '');
    for (const alternative of report.analysis.alternatives) {
      lines.push(`### ${safe(alternative.feature)}`, '', safe(alternative.approach), '',
        `Tradeoffs: ${safe(alternative.tradeoffs)}`, '');
      for (const citation of alternative.citations) {
        lines.push(`Motivating evidence ${safe(citation.evidenceId)}:`, '',
          ...safe(citation.quote).split('\n').map((line) => `> ${line}`), '');
      }
      lines.push(...alternative.questionsForProfessional.map((question) => `- ${safe(question)}`), '');
    }
  }
  if (report.analysis.questions?.length) lines.push('## Questions to investigate', '', ...report.analysis.questions.map((question) => `- ${safe(question)}`), '');
  lines.push('## Warnings and limitations', '',
    ...[...report.warnings, ...report.limitations].map((item) => `- ${safe(item)}`), '');
  return lines.join('\n');
}
