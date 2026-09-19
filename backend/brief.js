// Markdown export for the founder-facing research brief.
//
// Ordering rule: conclusions first, source text last. A founder should reach the
// feature table and the comparisons without scrolling past the claim appendix.
//
// Nothing here assesses a patent. Feature status reports only what the saved
// analysis did or did not compare; an absent comparison is reported as absent,
// never as an absence of relevant prior art.

// Source text stays plain text even if it contains HTML or Markdown instructions.
// Escapes the inline constructs that could forge structure or links, and leaves
// ordinary punctuation alone so the document stays readable.
function safe(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]|])/g, '\\$1');
}

// Table cells and headings must not carry line breaks into the surrounding block.
const inline = (value) => safe(value).replace(/\s*\n\s*/g, ' ');

// Block-level markers are only meaningful at the start of a line. Ordered lists
// escape the period rather than the digit, since `\8` is not a valid Markdown
// escape and would render the backslash literally.
const blockSafe = (value) => safe(value)
  .split('\n')
  .map((line) => line
    .replace(/^(\s*)([#>+-])/, '$1\\$2')
    .replace(/^(\s*)(\d+)\./, '$1$2\\.'))
  .join('\n');

const quote = (value) => blockSafe(value).split('\n').map((line) => `> ${line}`);

const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
  '',
];

const DOC_TYPE = {
  granted_patent: 'Granted patent',
  published_application: 'Published application',
  unknown: 'Type unknown',
};

const FEATURE_STATUS = {
  related: 'Related in reviewed evidence',
  uncertain: 'Uncertain in reviewed evidence',
  none: 'Not established in reviewed evidence',
};

// Status comes from the saved comparisons only. A feature nobody compared is
// reported as uncompared; it is never upgraded or downgraded here.
function featureStatus(feature, comparisons) {
  const matches = comparisons.filter((item) => item.feature === feature);
  if (!matches.length) return { status: FEATURE_STATUS.none, records: [], note: 'No comparison in the saved analysis.' };
  const relationship = matches.some((item) => item.relationship === 'related') ? 'related' : 'uncertain';
  return {
    status: FEATURE_STATUS[relationship],
    records: [...new Set(matches.map((item) => item.publicationNumber))],
    note: '',
  };
}

// Repeated titles are reported as observed duplication, not as family membership,
// which this data cannot establish.
function duplicateTitles(patents) {
  const byTitle = new Map();
  for (const patent of patents) {
    const key = (patent.title ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(patent.publicationNumber);
  }
  const shared = new Map();
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const number of group) {
      shared.set(number, group.filter((other) => other !== number));
    }
  }
  return shared;
}

function recordNote(patent, shared) {
  const notes = [];
  if (patent.detailsStatus === 'available') notes.push('Full text reviewed');
  else if (patent.detailsStatus === 'unavailable') notes.push('Full text could not be retrieved; snippet only');
  else notes.push('Full text not requested; snippet only');
  const duplicates = shared.get(patent.publicationNumber);
  if (duplicates?.length) notes.push(`shares a title with ${duplicates.join(', ')} (family membership unverified)`);
  return notes.join('; ');
}

function overview(report) {
  const analysed = new Set(report.analysis.comparisons?.map((item) => item.publicationNumber) ?? []);
  const withText = report.patents.filter((patent) => patent.detailsStatus === 'available').length;
  return [
    '## What was researched', '',
    blockSafe(report.input.idea), '',
    `Searched ${inline(report.coverage.publicationAuthority)} publications with `
      + `${report.searches.length} quer${report.searches.length === 1 ? 'y' : 'ies'}, first page only. `
      + `${report.coverage.uniquePublicationsRetrieved} unique publications were retrieved and `
      + `${report.patents.length} kept. Full text was reviewed for ${withText}. `
      + `${analysed.size} appear in the comparisons below.`, '',
    `Result: ${inline(report.status)}. Created ${inline(report.createdAt)} via ${inline(report.provider)}.`, '',
  ];
}

function featureTable(report) {
  const comparisons = report.analysis.comparisons ?? [];
  const rows = report.input.features.map((feature) => {
    const { status, records, note } = featureStatus(feature, comparisons);
    return [inline(feature), status, records.length ? records.map(inline).join(', ') : inline(note)];
  });
  const uncompared = rows.filter((row) => row[1] === FEATURE_STATUS.none).length;
  return [
    '## Where your features stand', '',
    'Status describes what the saved analysis compared against retrieved passages. '
      + 'It is not a patentability, novelty, or infringement assessment.', '',
    ...table(['Your feature', 'Status in the saved analysis', 'Records'], rows),
    ...(uncompared
      ? [`${uncompared} of ${report.input.features.length} features were not compared in this run. `
        + 'That is a gap in the research, not evidence that no patent covers them.', '']
      : []),
  ];
}

function analysisSections(report) {
  const { analysis } = report;
  if (analysis.status !== 'completed') {
    return ['## Analysis', '', blockSafe(analysis.message), '',
      ...(analysis.status === 'unavailable'
        ? ['The retrieved records and their passages below are unaffected.', ''] : [])];
  }

  const lines = ['## What the saved analysis concluded', '', blockSafe(analysis.summary), '',
    blockSafe(analysis.message), ''];

  const comparisons = analysis.comparisons ?? [];
  if (comparisons.length) {
    lines.push('## Feature-by-feature comparison', '',
      'Every explanation below is followed by the exact passage it relies on. '
      + 'Quote checking proves the text is real; it does not prove the interpretation.', '');
    const byFeature = new Map();
    for (const item of comparisons) {
      if (!byFeature.has(item.feature)) byFeature.set(item.feature, []);
      byFeature.get(item.feature).push(item);
    }
    for (const [feature, items] of byFeature) {
      lines.push(`### ${inline(feature)}`, '');
      for (const item of items) {
        lines.push(`**${inline(item.publicationNumber)}** — ${FEATURE_STATUS[item.relationship]}.`, '',
          blockSafe(item.explanation), '');
        for (const citation of item.citations) {
          lines.push(...quote(citation.quote), '', `Source: ${inline(citation.evidenceId)}`, '');
        }
      }
    }
  }

  if (analysis.alternatives?.length) {
    lines.push('## Alternative approaches for professional review', '',
      'Technical hypotheses only. Engineering detail in these proposals goes beyond what the '
      + 'cited passages state. No alternative has been cleared for patentability or freedom to operate.', '');
    for (const alternative of analysis.alternatives) {
      lines.push(`### ${inline(alternative.feature)}`, '',
        blockSafe(alternative.approach), '',
        `**Tradeoffs.** ${blockSafe(alternative.tradeoffs)}`, '',
        '**Ask a patent professional.**', '',
        ...alternative.questionsForProfessional.map((question) => `- ${inline(question)}`), '');
      for (const citation of alternative.citations) {
        lines.push('Motivating passage:', '', ...quote(citation.quote), '',
          `Source: ${inline(citation.evidenceId)}`, '');
      }
    }
  }

  if (analysis.questions?.length) {
    lines.push('## Questions to investigate', '',
      ...analysis.questions.map((question) => `- ${inline(question)}`), '');
  }
  return lines;
}

function recordTable(report, shared) {
  if (!report.patents.length) {
    return ['## Records retrieved', '',
      'No patent records were retrieved. Review search completion and coverage before '
      + 'interpreting this result. No retrieved match is not proof of novelty.', ''];
  }
  const rows = report.patents.map((patent) => [
    `[${inline(patent.publicationNumber)}](${patent.sourceUrl})`,
    DOC_TYPE[patent.documentType] ?? DOC_TYPE.unknown,
    inline(patent.title),
    recordNote(patent, shared),
  ]);
  return [
    '## Records retrieved', '',
    'These records differ in how much was reviewed. Records without retrieved full text '
      + 'were not compared in depth and should not be read as weaker or stronger on that basis.', '',
    ...table(['Publication', 'Type', 'Title', 'What was reviewed'], rows),
  ];
}

function coverageSection(report) {
  const { coverage } = report;
  const lines = ['## Search coverage and limits', '',
    ...table(['Scope', 'Value'], [
      ['Publication authority', inline(coverage.publicationAuthority)],
      ['Pages per query', inline(coverage.pagePerQuery)],
      ['Results per query', inline(coverage.resultsPerQuery)],
      ['Unique publications retrieved', inline(coverage.uniquePublicationsRetrieved)],
      ['Publications kept', inline(coverage.returnedPublications)],
      ['Full-text requests', inline(coverage.detailsRequested)],
      ['Exhaustive', coverage.exhaustive ? 'Yes' : 'No'],
    ]),
    '### Searches run', '',
    ...report.searches.map((search) => {
      const outcome = search.status === 'completed'
        ? `completed, ${inline(search.resultCount)} results`
        : `failed (${inline(search.errorCode)})`;
      return `- ${inline(search.query)} — ${outcome}`;
    }), '',
  ];
  if (coverage.deduplication) lines.push(`Deduplication: ${inline(coverage.deduplication)}`, '');
  if (report.warnings.length) {
    lines.push('### Warnings', '', ...report.warnings.map((item) => `- ${inline(item)}`), '');
  }
  lines.push('### Limitations', '', ...report.limitations.map((item) => `- ${inline(item)}`), '');
  return lines;
}

function appendix(report) {
  if (!report.patents.length) return [];
  const lines = ['## Appendix: source passages', '',
    'Full retrieved text for each record, kept verbatim so every quote above can be '
    + 'traced to its source. Passages may be longer than the quotes selected from them.', '',
    'Claim evidence IDs use the position of the claim in the provider response, which '
    + 'does not always match the claim number printed in the text. Cite the printed '
    + 'number when discussing a claim.', ''];
  for (const patent of report.patents) {
    lines.push(`### ${inline(patent.publicationNumber)} — ${inline(patent.title)}`, '',
      `[Open source record](${patent.sourceUrl})`, '',
      ...table(['Field', 'Value'], [
        ['Type', DOC_TYPE[patent.documentType] ?? DOC_TYPE.unknown],
        ['Assignees', inline(patent.assignees.join(', ') || null)],
        ['Filed', inline(patent.filingDate)],
        ['Priority', inline(patent.priorityDate)],
        ['Published', inline(patent.publicationDate)],
        ['Granted', inline(patent.grantDate)],
        ['Legal status (unverified)', inline(patent.legalStatus.value)],
        ['Retrieved', inline(patent.retrievedAt)],
        ['Full text', inline(patent.detailsStatus)],
        ['Matched queries', inline(patent.matchedQueries.join('; ') || null)],
      ]));
    if (!patent.evidence.length) {
      lines.push('No passages were retained for this record.', '');
      continue;
    }
    for (const evidence of patent.evidence) {
      lines.push(`**${inline(evidence.id)}** (${inline(evidence.section)})`, '',
        ...quote(evidence.text), '');
    }
  }
  return lines;
}

export function toMarkdown(report) {
  const shared = duplicateTitles(report.patents);
  return [
    '# Founder patent research brief', '',
    'Research assistance only. Not legal advice, and not a patentability, novelty, '
      + 'infringement, or freedom-to-operate opinion.', '',
    ...overview(report),
    ...featureTable(report),
    ...analysisSections(report),
    ...recordTable(report, shared),
    ...coverageSection(report),
    ...appendix(report),
  ].join('\n');
}
