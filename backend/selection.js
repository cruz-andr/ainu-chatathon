// Local, deterministic retrieval heuristics; scores are not legal assessments.
const stop = new Set('a an and are as at be by can for from has in is it of on or said that the their this to user uses using wherein which with'.split(' '));
const words = (text) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .filter((word) => word.length > 1 && !stop.has(word))
  .map((word) => word.length > 4 ? word.replace(/s$/, '') : word);

function scorer(features, texts) {
  const documents = texts.map((text) => new Set(words(text)));
  const weight = (word) => 1 + Math.log(1 + documents.length / (1 + documents.filter((doc) => doc.has(word)).length));
  const targets = features.map((feature) => [...new Set(words(feature))]);
  return (text) => {
    const terms = new Set(words(text));
    return targets.map((target) => {
      if (!target.length) return 0;
      const overlap = target.filter((word) => terms.has(word));
      // Normalize for feature length and gently penalize long, catch-all passages.
      return overlap.reduce((sum, word) => sum + weight(word), 0)
        / target.reduce((sum, word) => sum + weight(word), 0)
        / (1 + Math.log(1 + terms.size / 40));
    });
  };
}

const titleKey = (patent) => patent.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function suspectedRepetition(a, b) {
  // Same title is a reason to diversify, never proof of a patent family.
  return Boolean(titleKey(a)) && titleKey(a) === titleKey(b);
}

export function rankCandidates(records, input) {
  const texts = records.map((patent) => [patent.title, ...patent.evidence
    .filter((entry) => entry.section === 'search_snippet').map((entry) => entry.text)].join(' '));
  const score = scorer(input.features?.length ? input.features : [input.idea], texts);
  const remaining = records.map((patent, index) => ({ patent, index, scores: score(texts[index]) }));
  const ranked = [], representedQueries = new Set();
  while (remaining.length) {
    const value = ({ patent, scores }) => {
      const relevance = scores.reduce((sum, item) => sum + item, 0) / Math.max(1, scores.length);
      const queryBonus = (patent.matchedQueries ?? []).some((query) => !representedQueries.has(query)) ? 0.12 : 0;
      const repeated = ranked.some((other) => suspectedRepetition(patent, other));
      return relevance * (repeated ? 0.25 : 1) + (repeated ? 0 : queryBonus);
    };
    remaining.sort((a, b) => value(b) - value(a) || a.index - b.index);
    const { patent } = remaining.shift();
    ranked.push(patent);
    for (const query of patent.matchedQueries ?? []) representedQueries.add(query);
  }
  return ranked;
}

function parentNumbers(text) {
  const numbers = new Set();
  for (const match of text.matchAll(/\bclaims?\s+(\d+(?:\s*(?:[-–]|to|through|,|and|or)\s*\d+)*)/gi)) {
    for (const part of match[1].matchAll(/(\d+)(?:\s*(?:[-–]|to|through)\s*(\d+))?/gi)) {
      const start = Number(part[1]), end = Number(part[2] ?? start);
      // Provider input is untrusted; cap range expansion.
      for (let n = start; n <= Math.min(end, start + 100); n++) numbers.add(n);
    }
  }
  return [...numbers];
}

export function selectEvidence(patent, features, { maxPassages = 12, maxChars = 3000 } = {}) {
  const evidence = patent.evidence;
  const score = scorer(features, evidence.map((entry) => entry.text));
  const rows = evidence.map((entry, index) => {
    // Choose a contiguous source window, never splice text into an invented quote.
    let text = entry.text.slice(0, maxChars), best = -1;
    for (let start = 0; start < entry.text.length; start += Math.max(1, Math.floor(maxChars / 2))) {
      const window = entry.text.slice(start, start + maxChars);
      const value = Math.max(0, ...score(window));
      if (value > best) { best = value; text = window; }
    }
    return { entry: { ...entry, text }, index, scores: score(text) };
  });
  // Parse actual printed claim numbers rather than assuming provider array positions.
  const claims = new Map();
  for (const row of rows) {
    const number = evidence[row.index].section === 'claim' && evidence[row.index].text.match(/^\s*(\d+)\s*[.)]/);
    if (number) claims.set(Number(number[1]), row);
  }
  const selected = new Map();
  const add = (row) => {
    const bundle = new Map();
    const visit = (candidate) => {
      if (bundle.has(candidate.index) || selected.has(candidate.index)) return;
      bundle.set(candidate.index, candidate);
      for (const number of parentNumbers(evidence[candidate.index].text)) {
        if (claims.has(number)) visit(claims.get(number));
      }
    };
    visit(row);
    if (selected.size + bundle.size > maxPassages) return false;
    for (const [index, candidate] of bundle) selected.set(index, candidate);
    return true;
  };
  // Give each feature a chance before filling the rest of the bounded context.
  for (let feature = 0; feature < features.length; feature++) {
    const candidates = [...rows].sort((a, b) => b.scores[feature] - a.scores[feature] || a.index - b.index);
    for (const row of candidates) {
      if (row.scores[feature] <= 0) break;
      if (add(row)) break;
    }
  }
  const relevance = (row) => Math.max(0, ...row.scores) + row.scores.reduce((sum, n) => sum + n, 0) * 0.1;
  const remaining = [...rows];
  while (remaining.length && selected.size < maxPassages) {
    const covered = new Set([...selected.values()].flatMap((row) => words(row.entry.text)));
    const value = (row) => {
      const novel = score(words(row.entry.text).filter((word) => !covered.has(word)).join(' '));
      return Math.max(0, ...novel) + relevance(row) * 0.05;
    };
    remaining.sort((a, b) => value(b) - value(a) || a.index - b.index);
    add(remaining.shift());
  }
  return [...selected.values()].sort((a, b) => a.index - b.index).map((row) => row.entry);
}
