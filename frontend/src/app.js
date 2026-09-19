import { plan, research, ApiFailure } from './api.js';
import { renderReport } from './render.js';

const $ = (id) => document.getElementById(id);
const steps = {
  idea: $('step-idea'),
  plan: $('step-plan'),
  running: $('step-running'),
  report: $('step-report'),
};

const state = { idea: '', features: [], queries: [], questions: [] };

function show(name) {
  for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
  if (name !== 'idea') steps[name].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showError(message, hint) {
  const box = $('error');
  box.replaceChildren();
  const text = document.createElement('p');
  text.textContent = message;
  box.append(text);
  if (hint) {
    const note = document.createElement('p');
    note.className = 'meta';
    note.textContent = hint;
    box.append(note);
  }
  box.hidden = false;
}

const clearError = () => { $('error').hidden = true; };

const HINTS = {
  AI_NOT_CONFIGURED: 'The host needs to check the Mac mini AI worker. Visitors do not need SSH or an API key.',
  SEARCH_NOT_CONFIGURED: 'The host needs to configure patent search. Visitors do not need an API key.',
  AI_BUSY: 'The Mac mini runs one AI request at a time. Wait a few seconds and run it again.',
  BUSY: 'Two searches are already running. Wait a few seconds and run it again.',
  AI_UNAVAILABLE: 'The Mac mini could not be reached, or the request timed out.',
  SEARCH_PROVIDER_UNAVAILABLE: 'The patent provider did not respond in time. Running it again usually works.',
  NETWORK: 'Check your connection or contact the host. Avoid resubmitting while a job may still be running.',
  QUEUE_FULL: 'The shared worker has a bounded queue. Wait for a current job to finish.',
  USAGE_LIMIT: 'The host has set a daily demo budget. Ask them before running more searches.',
};

// --- editable plan -----------------------------------------------------------

function renderFeatures() {
  const wrap = $('features');
  wrap.replaceChildren();
  state.features.forEach((feature, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = feature;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.setAttribute('aria-label', `Remove ${feature}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.features.splice(index, 1);
      renderFeatures();
    });
    chip.append(remove);
    wrap.append(chip);
  });
  $('feature-add').disabled = state.features.length >= 8;
  syncAiConsent();
}

// AI comparison needs at least one feature, so don't offer it when there are none.
function syncAiConsent() {
  const box = $('consent-ai');
  const possible = state.features.length > 0;
  box.disabled = !possible;
  if (!possible) box.checked = false;
  $('ai-consent-note').hidden = possible;
}

function renderQueries() {
  const wrap = $('queries');
  wrap.replaceChildren();
  state.queries.forEach((query, index) => {
    const row = document.createElement('div');
    row.className = 'query-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = query;
    input.maxLength = 300;
    input.setAttribute('aria-label', `Search ${index + 1}`);
    input.addEventListener('input', () => { state.queries[index] = input.value; });
    row.append(input);
    if (state.queries.length > 1) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.setAttribute('aria-label', `Remove search ${index + 1}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        state.queries.splice(index, 1);
        renderQueries();
      });
      row.append(remove);
    }
    wrap.append(row);
  });
  $('query-add').disabled = state.queries.length >= 3;
}

function renderQuestions() {
  const wrap = $('plan-questions');
  wrap.hidden = !state.questions.length;
  const ul = $('plan-questions-list');
  ul.replaceChildren();
  for (const question of state.questions) {
    const li = document.createElement('li');
    li.textContent = question;
    ul.append(li);
  }
}

// --- flow --------------------------------------------------------------------

async function startPlan(event) {
  event.preventDefault();
  clearError();
  const idea = $('idea').value.trim();
  if (idea.length < 20) {
    showError('Describe the idea in at least 20 characters.', 'A sentence or two about what it does and how it works gives the search something to work with.');
    return;
  }
  state.idea = idea;
  const button = $('plan-submit');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Reading your idea…';
  try {
    const result = await plan(idea);
    state.features = result.features;
    state.queries = result.queries;
    state.questions = result.questions;
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'AI_NOT_CONFIGURED') {
      // Codex is down; the founder can still drive the search by hand.
      state.features = [];
      state.queries = [idea.split(/\s+/).slice(0, 12).join(' ')];
      state.questions = [];
      showError('The AI step is not connected, so nothing was suggested for you.', 'You can still run the patent search: write your own keywords below.');
    } else {
      showError(error.message, HINTS[error.code]);
      return;
    }
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
  $('plan-idea').textContent = state.idea;
  renderFeatures();
  renderQueries();
  renderQuestions();
  show('plan');
}

let timer = null;

function startProgress() {
  const started = Date.now();
  const stage = $('progress-stage');
  const clock = $('progress-clock');
  stage.textContent = 'Queued or processing your patent research…';
  clock.textContent = '0s elapsed';
  timer = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    clock.textContent = `${seconds}s elapsed`;
    if (seconds >= 180) stage.textContent = 'Still waiting for the shared worker. Keep this page open.';
  }, 1000);
}

const stopProgress = () => { clearInterval(timer); timer = null; };

async function runResearch(event) {
  event.preventDefault();
  clearError();
  state.queries = state.queries.map((query) => query.trim()).filter(Boolean);
  if (!state.queries.length) {
    showError('Add at least one search before running.', 'One line of keywords is enough, for example "soil moisture sensor automatic watering".');
    renderQueries();
    return;
  }
  const analyze = $('consent-ai').checked && state.features.length > 0;
  show('running');
  startProgress();
  try {
    const report = await research({
      idea: state.idea,
      features: state.features,
      queries: state.queries,
      country: $('country').value,
      maxResults: Number($('max-results').value),
      analyze,
    });
    renderReport(report, $('report'));
    show('report');
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    show('plan');
    showError(error.message, HINTS[error.code]);
  } finally {
    stopProgress();
  }
}

function reset() {
  clearError();
  $('report').replaceChildren();
  show('idea');
  $('idea').focus();
}

$('form-idea').addEventListener('submit', startPlan);
$('form-plan').addEventListener('submit', runResearch);
$('plan-back').addEventListener('click', reset);
$('report-restart').addEventListener('click', reset);

$('feature-add').addEventListener('click', () => {
  const input = $('feature-input');
  const value = input.value.trim();
  if (value.length < 2 || state.features.length >= 8) return;
  state.features.push(value.slice(0, 300));
  input.value = '';
  renderFeatures();
});

$('query-add').addEventListener('click', () => {
  if (state.queries.length >= 3) return;
  state.queries.push('');
  renderQueries();
});

for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    $('idea').value = button.dataset.example;
    $('idea').focus();
  });
}

$('consent-search').addEventListener('change', () => {
  $('plan-submit-run').disabled = !$('consent-search').checked;
});
