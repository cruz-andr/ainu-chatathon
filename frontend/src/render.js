// Report rendering. Every value from the API, the model, or a patent record is
// written with textContent. Never assign provider text to innerHTML.

import { briefUrl } from './api.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const block = (title, lead) => {
  const wrap = el('section', 'block');
  wrap.append(el('h2', null, title));
  if (lead) wrap.append(el('p', 'lead', lead));
  return wrap;
};

const list = (items, className = 'bullets') => {
  const ul = el('ul', className);
  for (const item of items) ul.append(el('li', null, item));
  return ul;
};

const DOC_TYPE = {
  granted_patent: 'Granted patent',
  published_application: 'Published application',
  unknown: 'Document type unknown',
};

const STATUS_NOTE = {
  completed: 'All searches completed.',
  partial: 'Some searches or detail lookups failed. Coverage is incomplete.',
  no_matches: 'These searches returned no records. That is not evidence that your idea is new.',
};

function evidenceLabel(entry) {
  if (entry.section === 'abstract') return 'Abstract';
  if (entry.section === 'search_snippet') return 'Search snippet';
  const claim = entry.id.split(':claim:')[1];
  return claim ? `Claim ${claim}` : 'Claim';
}

function dateRow(patent) {
  const pairs = [
    ['Filed', patent.filingDate],
    ['Priority', patent.priorityDate],
    ['Published', patent.publicationDate],
    ['Granted', patent.grantDate],
  ].filter(([, value]) => value);
  if (!pairs.length) return null;
  const row = el('dl', 'dates');
  for (const [label, value] of pairs) {
    row.append(el('dt', null, label), el('dd', null, value));
  }
  return row;
}

function patentCard(patent) {
  const card = el('article', 'patent');

  const head = el('header', 'patent-head');
  const number = el('a', 'pub-number', patent.publicationNumber);
  number.href = patent.sourceUrl;
  number.target = '_blank';
  number.rel = 'noopener noreferrer';
  head.append(number, el('span', `tag tag-${patent.documentType}`, DOC_TYPE[patent.documentType]));
  card.append(head, el('h3', 'patent-title', patent.title));

  const meta = el('p', 'meta');
  meta.textContent = patent.assignees.length
    ? `Assigned to ${patent.assignees.join(', ')}`
    : 'No assignee listed on this record';
  card.append(meta);

  const dates = dateRow(patent);
  if (dates) card.append(dates);

  if (patent.legalStatus?.value) {
    card.append(el('p', 'meta', `Provider-reported legal status: ${patent.legalStatus.value} — not independently verified.`));
  }

  if (patent.matchedQueries.length) {
    card.append(el('p', 'meta', `Found by: ${patent.matchedQueries.join(' · ')}`));
  }

  if (patent.detailsStatus === 'unavailable') {
    card.append(el('p', 'warn', 'Full text could not be retrieved. Only the search snippet is shown below.'));
  }

  if (patent.evidence.length) {
    const details = el('details', 'evidence');
    details.append(el('summary', null, `Source text from this patent (${patent.evidence.length})`));
    for (const entry of patent.evidence) {
      const item = el('div', 'passage');
      item.append(el('span', 'passage-label', evidenceLabel(entry)), el('p', null, entry.text));
      details.append(item);
    }
    card.append(details);
  }

  return card;
}

function comparisonGroup(publicationNumber, comparisons) {
  const group = el('article', 'comparison');
  group.append(el('h3', 'comparison-head', publicationNumber));
  for (const item of comparisons) {
    const row = el('div', 'comparison-row');
    const head = el('p', 'comparison-feature');
    head.append(
      el('span', `tag tag-${item.relationship}`, item.relationship === 'related' ? 'Related' : 'Uncertain'),
      el('span', null, item.feature),
    );
    row.append(head, el('p', null, item.explanation));
    for (const citation of item.citations) {
      row.append(el('blockquote', null, citation.quote));
    }
    group.append(row);
  }
  return group;
}

function alternativeCard(alternative) {
  const card = el('article', 'alternative');
  card.append(el('span', 'tag tag-proposed', 'Proposed for review'));
  card.append(el('h3', null, alternative.feature));
  card.append(el('p', null, alternative.approach));
  card.append(el('p', 'label', 'Trade-offs'));
  card.append(el('p', null, alternative.tradeoffs));
  card.append(el('p', 'label', 'Ask a patent professional'));
  card.append(list(alternative.questionsForProfessional));
  for (const citation of alternative.citations) {
    card.append(el('blockquote', null, citation.quote));
  }
  return card;
}

function analysisSection(analysis) {
  if (analysis.status !== 'completed') {
    const wrap = block('Reading the results');
    wrap.append(el('p', 'notice', analysis.message));
    if (analysis.status === 'unavailable') {
      wrap.append(el('p', 'meta', 'The patent records above were still retrieved and are unaffected.'));
    }
    return [wrap];
  }

  const sections = [];

  const summary = block('What the search found');
  summary.append(el('p', 'summary', analysis.summary));
  sections.push(summary);

  if (analysis.comparisons.length) {
    const grouped = new Map();
    for (const item of analysis.comparisons) {
      if (!grouped.has(item.publicationNumber)) grouped.set(item.publicationNumber, []);
      grouped.get(item.publicationNumber).push(item);
    }
    const wrap = block(
      'How your idea lines up with what exists',
      'Each point below quotes the patent word for word. The quotes were checked against the source record before you saw them.',
    );
    for (const [publicationNumber, items] of grouped) {
      wrap.append(comparisonGroup(publicationNumber, items));
    }
    sections.push(wrap);
  }

  if (analysis.alternatives.length) {
    const wrap = block(
      'Directions worth exploring',
      'Different technical routes to the same goal, each one prompted by something in the patents above. These are conversation starters, not verdicts — nobody here is telling you a change is novel or clears you to build.',
    );
    for (const alternative of analysis.alternatives) wrap.append(alternativeCard(alternative));
    sections.push(wrap);
  }

  if (analysis.questions.length) {
    const wrap = block(
      'Take these questions to a patent attorney',
      'Bring this list to your first consultation so the meeting starts on your specifics instead of the basics.',
    );
    wrap.append(list(analysis.questions, 'bullets numbered'));
    sections.push(wrap);
  }

  return sections;
}

function coverageSection(report) {
  const wrap = block('What this did not cover');
  const { coverage } = report;
  wrap.append(list([
    `Publication authority searched: ${coverage.publicationAuthority} only.`,
    `${report.searches.length} search${report.searches.length === 1 ? '' : 'es'}, first page each, up to ${coverage.resultsPerQuery} records per search.`,
    `${coverage.uniquePublicationsRetrieved} unique publications retrieved; ${coverage.returnedPublications} shown; full text requested for ${coverage.detailsRequested}.`,
    'Unpublished applications are not searchable and are not covered.',
  ]));

  const failed = report.searches.filter((item) => item.status === 'failed');
  if (failed.length) {
    wrap.append(el('p', 'label', 'Searches that failed'));
    wrap.append(list(failed.map((item) => `${item.query} — ${item.errorCode}`)));
  }

  if (report.warnings.length) {
    wrap.append(el('p', 'label', 'Warnings'));
    wrap.append(list(report.warnings));
  }

  wrap.append(el('p', 'label', 'Limits of this report'));
  wrap.append(list(report.limitations));
  return wrap;
}

export function renderReport(report, mount) {
  mount.replaceChildren();

  const head = el('header', 'report-head');
  head.append(el('h1', null, 'Your patent research brief'));
  const badges = el('p', 'badges');
  badges.append(
    el('span', `tag tag-${report.status}`, report.status.replace('_', ' ')),
    el('span', 'meta', `${report.patents.length} record${report.patents.length === 1 ? '' : 's'}`),
    el('span', 'meta', `${Math.round(report.elapsedMs / 1000)}s`),
  );
  head.append(badges, el('p', 'notice', STATUS_NOTE[report.status] ?? ''));

  const downloads = el('p', 'downloads');
  const latex = el('a', 'button', 'Download the briefing (LaTeX)');
  latex.href = briefUrl(report.id, 'tex');
  const pdf = el('a', 'button ghost', 'View as PDF');
  pdf.href = briefUrl(report.id, 'pdf');
  pdf.target = '_blank';
  pdf.rel = 'noopener noreferrer';
  const markdown = el('a', 'button ghost', 'Markdown');
  markdown.href = briefUrl(report.id, 'md');
  downloads.append(latex, pdf, markdown);
  head.append(downloads);
  head.append(el('p', 'meta', 'The LaTeX source is the version to take to a patent professional. The PDF is typeset from it on the server and needs pdflatex installed.'));
  mount.append(head);

  if (report.patents.length) {
    const wrap = block(
      'Patents already on file near your idea',
      'Real publication numbers, linked to the source record. Open any one to read the passages the search matched.',
    );
    for (const patent of report.patents) wrap.append(patentCard(patent));
    mount.append(wrap);
  } else {
    const wrap = block('No records retrieved');
    wrap.append(el('p', 'notice', 'These searches returned nothing. That means these keywords found nothing — it is not evidence that your idea is unclaimed. Try different wording before drawing any conclusion.'));
    mount.append(wrap);
  }

  for (const section of analysisSection(report.analysis)) mount.append(section);
  mount.append(coverageSection(report));

  const footer = el('p', 'disclaimer', 'Research assistance only. This is not legal advice, and it is not a patentability, novelty, infringement, or freedom-to-operate opinion. A registered patent attorney or agent has to make those calls.');
  mount.append(footer);
}
