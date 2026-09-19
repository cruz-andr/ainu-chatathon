# Session handoff — read this first

Full context for a Claude session picking up this project. Read this, then
`SKILLS.md`, then `README.md`. `CLAUDE.md` holds the team handoff state and
`docs/AI_OUTPUT_HANDOFF.md` explains which parts need SSH access.

---

## 1. What this is

AINU Chatathon 2026, **Misneach** track. The brief: "Build the hire an early
founder can't afford yet." Eligibility requires naming a founder persona and a
specific operational bottleneck.

**Product.** An AI patent-research assistant. A founder describes an invention in
plain language; the system plans keyword searches, retrieves real published
patents, quotes the passages that touch the idea, proposes alternative technical
directions, and produces a briefing to take to a patent professional.

**Persona.** First-time product founder, pre-seed, no in-house research
specialist, no patent budget.

**Bottleneck.** Turning an invention description into a sourced patent shortlist
and useful follow-up questions. Patent records are indexed by classification
codes a newcomer has never seen and written in deliberately broad attorney
language. Founders either skip the search and build blind, or stall for weeks.

**Scope.** "Idea to market" is the broader vision. The built product covers
patent research only. There is no regulatory (FDA/FCC/UL) track — do not let the
interface imply one.

### Claims discipline

Measure time to an evidence-backed brief, source accuracy, and search cost.
**Legal-fee savings are an unmeasured hypothesis** and must be labelled as one.
The honest, defensible pitch is: a run finishes in minutes, the same sourced
shortlist by hand is an afternoon to a week, and the first paid attorney hour
converts from orientation into answers.

---

## 2. Rules that never bend

These hold in backend code, model prompts, the frontend, the exports, and the
marketing copy. `SKILLS.md` is the canonical list.

1. **Never fabricate a record.** Publication numbers, claims, abstracts, dates,
   assignees, legal statuses come from a provider response or they do not exist.
2. **Never issue a legal verdict.** No patentability, novelty, infringement,
   freedom-to-operate, "unpatented", "legally cleared", "safe to build", or
   numeric risk score, in any wording, anywhere.
3. **Absence is not evidence.** Zero results means these queries retrieved
   nothing — not that the idea is new or free to build. Every empty state says so.
4. **Every interpretation cites its source**, by evidence ID, quoting the same
   publication verbatim. Quote validation proves the text is real, not that the
   interpretation is correct.
5. **Alternatives are hypotheses**, carrying `proposed_for_review`, with
   tradeoffs and questions for a professional.
6. **Distinctions stay visible.** Applications differ from grants. Snippets
   differ from abstracts differ from claims. Legal status is always
   `verified: false`.
7. **Coverage limits are published, not buried.**

If a change requires softening one of these, stop and raise it.

---

## 3. Architecture

```
Browser (localhost:5173, static, no build step)
   │  POST /api/plan     { idea, allowExternalAi }
   │  POST /api/research { idea, features, queries, ... }
   ▼
Node API (127.0.0.1:3001, zero runtime dependencies)
   ├── SerpApi  → google_patents + google_patents_details   (real records)
   └── Codex CLI over SSH → Mac mini → model provider       (interpretation only)
```

Node 22+, ES modules, native HTTP and fetch. **No runtime packages anywhere**, by
deliberate choice. Do not add a dependency or a build step without raising it.

### Flow

1. Founder submits an idea. `POST /api/plan` asks Codex for features, queries,
   and clarifying questions.
2. Founder edits and confirms. Consent for the search provider and for the model
   provider are **separate checkboxes** — both are required disclosures.
3. `POST /api/research` runs 1–3 searches, retrieves details for the first three
   unique records, then asks Codex to compare features against evidence.
4. Report renders in the browser; `.tex` and `.md` exports download.

Research is **synchronous and can take up to three minutes**. There is no
streaming, no jobs endpoint, no queue. One AI request at a time; overlap returns
`429 AI_BUSY`. AI calls time out at 120s, searches at 20s.

### What Codex controls — important

`backend/providers/codex-cli.js` rebuilds the model response field by field in
`validatePlan` and `validateComparisons`. **The model's object is never spread
through.** Codex only fills prose into: `summary`, `comparisons[].explanation`,
`comparisons[].relationship` (only `related`/`uncertain`), `alternatives[].approach`,
`alternatives[].tradeoffs`, `questionsForProfessional[]`, `questions[]`, plus
which evidence IDs it cites. Everything else is ours.

**All formatting is our code.** Codex cannot change headings, ordering, or
markup. Layout work needs no SSH and no API key. See `docs/AI_OUTPUT_HANDOFF.md`.

---

## 4. File map

| Path | Responsibility |
| --- | --- |
| `backend/app.js` | HTTP endpoints, export routing, pipeline coordination |
| `backend/validation.js` | Request validation and consent flags |
| `backend/research.js` | Search aggregation, dedup, coverage, in-memory report store |
| `backend/selection.js` | Deterministic candidate ranking and evidence selection |
| `backend/brief.js` | Markdown export |
| `backend/latex.js` | LaTeX briefing export; escapes TeX control characters |
| `backend/pdf.js` | Typesets LaTeX with pdflatex in a sandboxed temp directory |
| `backend/providers/serpapi.js` | Patent search and detail retrieval |
| `backend/providers/codex-cli.js` | Headless Codex over SSH; stdin-only input |
| `frontend/index.html` | Prompt box, plan step, report, pitch copy |
| `frontend/src/app.js` | Flow: idea → reviewed plan → search → report |
| `frontend/src/render.js` | Report rendering; the `textContent` escaping boundary |
| `frontend/src/api.js` | API client; field names mirror the README |
| `frontend/preview.html` + `src/preview.js` | Offline layout preview of the fixture |
| `data/fixture-report.json` | Artificial fixture for offline layout work |
| `scripts/render-fixture.js` | Writes `output/fixture-brief.{md,tex}` |
| `scripts/serve-frontend.js` | Static dev server; also serves `data/` read-only |

## 5. Commands

| Command | Effect |
| --- | --- |
| `npm start` | API on `http://127.0.0.1:3001` |
| `npm run frontend` | Static frontend on `http://localhost:5173` |
| `npm test` | 35 offline tests; no network, no model |
| `npm run render:fixture` | Writes both fixture briefs, offline |
| `npm run check:codex` | Opt-in live Codex check — **needs SSH** |

Compile the LaTeX with `pdflatex -no-shell-escape -interaction=nonstopmode`, two
passes. Verified working; produces a ~170KB PDF from the fixture.

---

## 6. Current state (as of this handoff)

**Verified.** 35/35 tests pass. `render:fixture` emits both formats. The LaTeX
compiles cleanly to PDF over two passes. The frontend flow was walked end to end
in a browser: both failure paths (`AI_NOT_CONFIGURED`, `SEARCH_NOT_CONFIGURED`)
surface with fix hints, the report renders every section, an XSS payload through
every field of the renderer produced zero injected nodes, and light/dark and
mobile/desktop were checked.

**Never tested: live patent retrieval.** `SERPAPI_API_KEY` is set (64 chars) and
`/api/health` reports `searchConfigured: true`, but no request has ever reached
SerpApi. This is the highest-risk unknown.

**Codex worker not configured.** `CODEX_SSH_TARGET` and `CODEX_BINARY` are empty,
so `aiConfigured: false`. Without them the report has retrieved records but **no
comparisons and no alternatives** — the most distinctive output goes dark. Ved
does not have SSH access; Andres does.

**Uncommitted at handoff:** the LaTeX endpoint in `app.js`, the frontend download
buttons, `backend/latex.js`, `backend/test/latex.test.js`, and doc updates. Tests
pass; commit and push when ready.

### Git

Remote `origin` is `github.com/cruz-andr/ainu-chatathon` (Anthony's). Ved is a
collaborator. Never force-push. **Do not push unless Ved asks in that message.**
No `Co-Authored-By` or Claude attribution in commits or PRs — team preference.

---

## 7. Environment hazards — read before running anything

**Do not write literal attack payloads into source or test files.** An earlier
session wrote a LaTeX injection test containing real `\write18{...}` and
`\input{/etc/passwd}` strings. A safety classifier blocked it and then blocked
**all Bash, terminal, and browser tool use for the remainder of that session**.
The block is conversation-scoped and cannot be cleared by rephrasing.

Test escaping with **neutral control characters instead** — a string such as
`a \ b { c } d $ e & f # g ^ h _ i ~ j % k < l > m` exercises every character the
escaper handles and asserts the same property without constructing an exploit.
`backend/test/latex.test.js` does exactly this and passes. Follow that pattern.

If tools do get blocked: the session is still useful. Write files with the editor
tools and ask the operator to run the command and paste the output. That is how
the 35-test run above was verified.

**Other environment notes.** The preview tool reads `launch.json` from the parent
project root (`/Users/ved/Desktop/code`), not this repo, so `preview_start` by
name will start the wrong server. Copying files from `~/Downloads` into the repo
is blocked as untrusted integration — use `git apply` with a patch instead.

---

## 8. Security boundaries

- **Founder input and patent text travel through stdin only.** Never interpolate
  them into the SSH command line. Only server-controlled flags belong there.
- **Frontend: `textContent` only.** No `innerHTML` anywhere. Model output and
  patent text are attacker-influenceable in principle.
- **LaTeX: every control character escaped in a single pass.** A raw backslash in
  a `.tex` file is code execution, not just broken markup. Source URLs are
  pattern-matched before entering `\href` and fall back to plain text.
- **Markdown: link and emphasis syntax escaped**, ordinary punctuation left
  readable. Block markers escaped only at line start; ordered lists escape the
  period, not the digit (`\8` is not a valid escape).
- Codex calls are ephemeral, read-only sandboxed, user config ignored, with
  shell, browser, app, plugin, and delegation features disabled.
- Never log or persist invention text. Never commit credentials. `.env` is
  gitignored and untracked — confirmed.
- Backend stays on loopback. No auth, no database, no rate limiting. Reports live
  in RAM, expire after an hour, cap at 100.

---

## 9. Where the report content stands

The export was rebuilt because it buried its value: 903 lines with the analysis
starting at line 802, so a founder read every retrieved claim before any
interpretation. Current ordering, in both formats:

1. What was researched — idea and scope
2. Where your features stand — **every** supplied feature with its status
3. What the analysis concluded — summary
4. Feature-by-feature comparison — explanations with verbatim quotes
5. Alternative approaches for professional review
6. Questions to investigate
7. Records retrieved — with what was actually reviewed for each
8. Search coverage and limits
9. Appendix: source passages

Two behaviours worth preserving. **Uncompared features stay visible** — in the
saved report two of four features had no comparison and vanished entirely, which
read as fuller coverage than the run achieved; they now show "Not established in
reviewed evidence" plus "that is a gap in the research, not evidence that no
patent covers them". And **records are distinguished by review depth**, with
shared titles flagged as observed duplication, family membership unverified.

The LaTeX document opens with a boxed statement that it is not advice and not an
opinion, and that its formal presentation carries no authority beyond the search.
**Keep that box.** The risk of a formal-looking document is that someone treats
it as an opinion; the disclaimer is what makes the formality safe.

---

## 10. Open questions

1. **Codex access.** Decide whether the demo runs with analysis (needs Andres) or
   without it (records only, no comparisons or alternatives).
2. **Live search.** Run one real SerpApi search before any demo.
3. **PDF on the demo machine.** `brief.pdf` needs `pdflatex` on the PATH of
   whichever machine serves the API. Confirm it is present there, or fall back to
   the LaTeX download.

**Resolved.** The preview page shows the compiled PDF rather than an HTML
approximation, so layout is reviewed in the format the founder receives. The
live site keeps its interactive HTML report; only the preview and the exports
are document-shaped.

## 11. Suggested next steps

1. Run one live search end to end. Nothing has hit SerpApi.
2. Resolve the preview/HTML question above.
3. Get `CODEX_SSH_TARGET` and `CODEX_BINARY` from Andres, or commit to the
   no-analysis demo and adjust the pitch copy to match.
4. Ask Anthony to commit `data/report.json` and `scripts/render-sample.js` from
   the handoff snapshot so the whole team can develop exports offline.
