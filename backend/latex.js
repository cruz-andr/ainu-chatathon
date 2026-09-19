// LaTeX export of the founder research brief.
//
// This document is a briefing prepared FOR professional review. It is not an
// opinion and must never present itself as one: the formal typesetting carries
// no authority the underlying search does not have. Same ordering rule as the
// Markdown export — conclusions first, source passages in an appendix.
//
// SECURITY: every string here originates from a provider response, a model, or
// founder input. In LaTeX an unescaped backslash is code execution (\write18,
// \input). Nothing reaches the document without passing through tex().

const ESCAPES = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '%': '\\%',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
};

// Single pass, so a replacement's own backslash is never re-escaped.
function tex(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  return String(value).replace(/[\\{}$&#^_~%<>]/g, (character) => ESCAPES[character]);
}

// Table cells and headings must not carry paragraph breaks.
const cell = (value) => tex(value).replace(/\s*\n\s*/g, ' ');

// URLs are not escaped as text; hyperref needs them raw, so only safe ones pass.
const link = (url, label) => (/^https?:\/\/[^\s{}\\%#]+$/.test(url ?? '')
  ? `\\href{${url}}{${cell(label)}}`
  : cell(label));

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

function featureStatus(feature, comparisons) {
  const matches = comparisons.filter((item) => item.feature === feature);
  if (!matches.length) return { status: FEATURE_STATUS.none, records: 'No comparison in the saved analysis' };
  const relationship = matches.some((item) => item.relationship === 'related') ? 'related' : 'uncertain';
  return {
    status: FEATURE_STATUS[relationship],
    records: [...new Set(matches.map((item) => item.publicationNumber))].join(', '),
  };
}

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
    for (const number of group) shared.set(number, group.filter((other) => other !== number));
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

const itemize = (items) => (items.length
  ? ['\\begin{itemize}[leftmargin=*]', ...items.map((item) => `  \\item ${cell(item)}`), '\\end{itemize}', '']
  : []);

const quote = (text) => ['\\begin{quote}', tex(text), '\\end{quote}', ''];

function longtable(spec, headers, rows) {
  return [
    `\\begin{longtable}{${spec}}`,
    '\\toprule',
    `${headers.map((header) => `\\textbf{${cell(header)}}`).join(' & ')} \\\\`,
    '\\midrule',
    '\\endhead',
    ...rows.map((row) => `${row.join(' & ')} \\\\`),
    '\\bottomrule',
    '\\end{longtable}',
    '',
  ];
}

const PREAMBLE = [
  '\\documentclass[11pt,a4paper]{article}',
  '\\usepackage[utf8]{inputenc}',
  '\\usepackage[T1]{fontenc}',
  '\\usepackage[margin=1in]{geometry}',
  '\\usepackage{longtable}',
  '\\usepackage{booktabs}',
  '\\usepackage{enumitem}',
  '\\usepackage{parskip}',
  '\\usepackage[hidelinks]{hyperref}',
  '\\setlength{\\emergencystretch}{3em}',
  '\\pagestyle{plain}',
  '',
];

function header(report) {
  return [
    '\\begin{center}',
    '{\\LARGE\\bfseries Patent research briefing}\\\\[0.4em]',
    '{\\large Prepared for review with a patent professional}',
    '\\end{center}',
    '',
    '\\begin{center}',
    '\\fbox{\\begin{minipage}{0.92\\textwidth}',
    '\\textbf{This document is not legal advice and not an opinion.} It is a record of '
      + 'an automated keyword search and an unreviewed interpretation of the passages it '
      + 'retrieved. It does not establish patentability, novelty, non-infringement, or '
      + 'freedom to operate, and nothing in it has been checked by a registered patent '
      + 'attorney or agent. Its formal presentation carries no authority beyond the '
      + 'search described in the coverage section.',
    '\\end{minipage}}',
    '\\end{center}',
    '',
    `\\noindent Generated ${cell(report.createdAt)} \\quad Source: ${cell(report.provider)} `
      + `\\quad Result: ${cell(report.status)}`,
    '',
    '\\hrulefill',
    '',
  ];
}

function overview(report) {
  const analysed = new Set(report.analysis.comparisons?.map((item) => item.publicationNumber) ?? []);
  const withText = report.patents.filter((patent) => patent.detailsStatus === 'available').length;
  return [
    '\\section*{What was researched}',
    tex(report.input.idea),
    '',
    `Searched ${cell(report.coverage.publicationAuthority)} publications with `
      + `${report.searches.length} quer${report.searches.length === 1 ? 'y' : 'ies'}, first page only. `
      + `${cell(report.coverage.uniquePublicationsRetrieved)} unique publications were retrieved and `
      + `${report.patents.length} kept. Full text was reviewed for ${withText}. `
      + `${analysed.size} appear in the comparisons below.`,
    '',
  ];
}

function featureSection(report) {
  const comparisons = report.analysis.comparisons ?? [];
  const rows = report.input.features.map((feature) => {
    const { status, records } = featureStatus(feature, comparisons);
    return [cell(feature), cell(status), cell(records)];
  });
  const uncompared = rows.filter((row) => row[1] === FEATURE_STATUS.none).length;
  return [
    '\\section*{Where your features stand}',
    'Status describes only what the analysis compared against retrieved passages. '
      + 'It is not a patentability, novelty, or infringement assessment.',
    '',
    ...longtable('p{0.34\\textwidth} p{0.26\\textwidth} p{0.28\\textwidth}',
      ['Your feature', 'Status in this analysis', 'Records'], rows),
    ...(uncompared
      ? [`\\noindent\\textbf{${uncompared} of ${report.input.features.length} features were not `
        + 'compared in this run.} That is a gap in the research, not evidence that no patent '
        + 'covers them.', '']
      : []),
  ];
}

function analysisSections(report) {
  const { analysis } = report;
  if (analysis.status !== 'completed') {
    return ['\\section*{Analysis}', tex(analysis.message), '',
      ...(analysis.status === 'unavailable'
        ? ['The retrieved records and their passages below are unaffected.', ''] : [])];
  }

  const lines = ['\\section*{What this analysis concluded}', tex(analysis.summary), '',
    `\\emph{${tex(analysis.message)}}`, ''];

  const comparisons = analysis.comparisons ?? [];
  if (comparisons.length) {
    lines.push('\\section*{Feature-by-feature comparison}',
      'Each explanation is followed by the exact passage it relies on. Quote checking '
      + 'proves the text is genuine; it does not prove the interpretation.', '');
    const byFeature = new Map();
    for (const item of comparisons) {
      if (!byFeature.has(item.feature)) byFeature.set(item.feature, []);
      byFeature.get(item.feature).push(item);
    }
    for (const [feature, items] of byFeature) {
      lines.push(`\\subsection*{${cell(feature)}}`);
      for (const item of items) {
        lines.push(`\\noindent\\textbf{${cell(item.publicationNumber)}} --- `
          + `${FEATURE_STATUS[item.relationship]}.`, '', tex(item.explanation), '');
        for (const citation of item.citations) {
          lines.push(...quote(citation.quote),
            `\\noindent\\small Source: ${cell(citation.evidenceId)}\\normalsize`, '');
        }
      }
    }
  }

  if (analysis.alternatives?.length) {
    lines.push('\\section*{Alternative approaches for professional review}',
      'Technical hypotheses only. Engineering detail in these proposals goes beyond what '
      + 'the cited passages state. No alternative has been cleared for patentability or '
      + 'freedom to operate.', '');
    for (const alternative of analysis.alternatives) {
      lines.push(`\\subsection*{${cell(alternative.feature)}}`,
        tex(alternative.approach), '',
        `\\noindent\\textbf{Tradeoffs.} ${tex(alternative.tradeoffs)}`, '',
        '\\noindent\\textbf{Ask a patent professional.}', '',
        ...itemize(alternative.questionsForProfessional));
      for (const citation of alternative.citations) {
        lines.push('\\noindent Motivating passage:', '', ...quote(citation.quote),
          `\\noindent\\small Source: ${cell(citation.evidenceId)}\\normalsize`, '');
      }
    }
  }

  if (analysis.questions?.length) {
    lines.push('\\section*{Questions to investigate}', ...itemize(analysis.questions));
  }
  return lines;
}

function recordSection(report, shared) {
  if (!report.patents.length) {
    return ['\\section*{Records retrieved}',
      'No patent records were retrieved. Review search completion and coverage before '
      + 'interpreting this result. No retrieved match is not proof of novelty.', ''];
  }
  const rows = report.patents.map((patent) => [
    link(patent.sourceUrl, patent.publicationNumber),
    cell(DOC_TYPE[patent.documentType] ?? DOC_TYPE.unknown),
    cell(patent.title),
    cell(recordNote(patent, shared)),
  ]);
  return [
    '\\section*{Records retrieved}',
    'These records differ in how much of each was reviewed.',
    '',
    ...longtable('p{0.17\\textwidth} p{0.15\\textwidth} p{0.28\\textwidth} p{0.28\\textwidth}',
      ['Publication', 'Type', 'Title', 'What was reviewed'], rows),
  ];
}

function coverageSection(report) {
  const { coverage } = report;
  const lines = [
    '\\section*{Search coverage and limits}',
    ...longtable('p{0.45\\textwidth} p{0.35\\textwidth}', ['Scope', 'Value'], [
      ['Publication authority', cell(coverage.publicationAuthority)],
      ['Pages per query', cell(coverage.pagePerQuery)],
      ['Results per query', cell(coverage.resultsPerQuery)],
      ['Unique publications retrieved', cell(coverage.uniquePublicationsRetrieved)],
      ['Publications kept', cell(coverage.returnedPublications)],
      ['Full-text requests', cell(coverage.detailsRequested)],
      ['Exhaustive', coverage.exhaustive ? 'Yes' : 'No'],
    ]),
    '\\subsection*{Searches run}',
    ...itemize(report.searches.map((search) => (search.status === 'completed'
      ? `${search.query} --- completed, ${search.resultCount} results`
      : `${search.query} --- failed (${search.errorCode})`))),
  ];
  if (coverage.deduplication) lines.push(`\\noindent Deduplication: ${cell(coverage.deduplication)}`, '');
  if (report.warnings.length) lines.push('\\subsection*{Warnings}', ...itemize(report.warnings));
  lines.push('\\subsection*{Limitations}', ...itemize(report.limitations));
  return lines;
}

function appendix(report) {
  if (!report.patents.length) return [];
  const lines = ['\\appendix', '\\section*{Appendix: source passages}',
    'Full retrieved text for each record, kept verbatim so every quote above can be '
    + 'traced to its source. Passages may be longer than the quotes selected from them. '
    + 'Claim evidence identifiers use the position of the claim in the provider response, '
    + 'which does not always match the claim number printed in the text.', ''];
  for (const patent of report.patents) {
    lines.push(`\\subsection*{${cell(patent.publicationNumber)} --- ${cell(patent.title)}}`,
      `\\noindent ${link(patent.sourceUrl, 'Open source record')}`, '',
      ...longtable('p{0.28\\textwidth} p{0.6\\textwidth}', ['Field', 'Value'], [
        ['Type', cell(DOC_TYPE[patent.documentType] ?? DOC_TYPE.unknown)],
        ['Assignees', cell(patent.assignees.join(', ') || null)],
        ['Filed', cell(patent.filingDate)],
        ['Priority', cell(patent.priorityDate)],
        ['Published', cell(patent.publicationDate)],
        ['Granted', cell(patent.grantDate)],
        ['Legal status (unverified)', cell(patent.legalStatus.value)],
        ['Retrieved', cell(patent.retrievedAt)],
        ['Full text', cell(patent.detailsStatus)],
        ['Matched queries', cell(patent.matchedQueries.join('; ') || null)],
      ]));
    if (!patent.evidence.length) {
      lines.push('No passages were retained for this record.', '');
      continue;
    }
    for (const evidence of patent.evidence) {
      lines.push(`\\noindent\\textbf{${cell(evidence.id)}} (${cell(evidence.section)})`, '',
        ...quote(evidence.text));
    }
  }
  return lines;
}

export function toLatex(report) {
  const shared = duplicateTitles(report.patents);
  return [
    ...PREAMBLE,
    '\\begin{document}',
    ...header(report),
    ...overview(report),
    ...featureSection(report),
    ...analysisSections(report),
    ...recordSection(report, shared),
    ...coverageSection(report),
    ...appendix(report),
    '\\end{document}',
    '',
  ].join('\n');
}
