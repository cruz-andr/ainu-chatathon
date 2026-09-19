# Project handoff for Claude and teammates

## Product and scope

We are entering the **Misneach** track of AINU Chatathon 2026.
The official prompt is "Build the hire an early founder can't afford yet."
Eligibility requires naming a founder persona AND a specific operational bottleneck.

Accepted product description:

> An AI patent-research assistant that helps early-stage founders find relevant
> patent applications and granted patents, understand technical similarities
> through cited passages, and explore alternative approaches to discuss with a
> patent professional.

"Idea to market" is the broader vision; the current demo covers patent research.
Founder persona: first-time product founder without an in-house research specialist.
Bottleneck: converting an invention description into a useful patent shortlist,
technical comparisons, and questions for professional review.

Measure time to an evidence-backed research brief, source accuracy, and search
cost. Legal-fee savings and reduced wasted development are hypotheses until measured.
The earlier WHOOP beacon and hardware concepts are out of the current scope.

## Architecture and commands

- Node.js 22+, native HTTP/fetch, ES modules, no runtime packages.
- `npm start`: API on `http://127.0.0.1:3001`.
- `npm run dev`: restart on source changes.
- `npm test`: isolated unit and HTTP tests; no live model or patent calls.
- `npm run check:codex`: opt-in real Codex check using artificial test data. Uses
  the configured account; it is not a live patent-retrieval test.
- Frontend is not implemented in this commit. Default allowed browser origin:
  `http://localhost:5173` (change `FRONTEND_ORIGIN` if needed).

Read README.md for the full API contract. Key files:

| File | Responsibility |
| --- | --- |
| `backend/app.js` | HTTP endpoints, input handling, pipeline coordination |
| `backend/validation.js` | Request validation and external-processing flags |
| `backend/providers/serpapi.js` | Real patent search, detail retrieval, normalized evidence |
| `backend/providers/codex-cli.js` | Headless Codex via SSH; planning, comparison, alternatives, citation validation |
| `backend/research.js` | Search aggregation, deduplication, coverage, ephemeral report store |
| `backend/brief.js` | Markdown report export |

## Frontend integration sequence

1. Collect an idea, with a disclosure that AI processing sends it to a model provider.
2. `POST /api/plan` with `{ idea, allowExternalAi: true }`.
   Display returned `features`, `queries`, and clarification `questions` for editing.
3. Founder confirms the query/feature list and external search.
4. `POST /api/research` with:

```json
{
  "idea": "A container that measures soil moisture and controls watering.",
  "features": ["soil moisture sensor", "automatic water valve"],
  "queries": ["soil moisture sensor automatic watering container"],
  "country": "US",
  "maxResults": 5,
  "allowExternalSearch": true,
  "analyze": true,
  "allowExternalAi": true
}
```

5. Render `patents` with source links and `evidence` passages. Show `analysis`
   comparisons and alternative approaches alongside their citations and questions.
6. `GET /api/research/:id` retrieves the report; `/api/research/:id/brief.md` downloads it.

Use a loading state for the synchronous research request (allow up to three
minutes). There is no streaming/progress/jobs endpoint. `GET /api/health` says
whether search/AI are configured, not whether credentials are valid.

Handle `partial`, `no_matches`, and unsuccessful HTTP responses separately.
Do not present missing evidence or failed requests as a clean search.
AI status may be `completed`, `not_requested`, `no_evidence`, or `unavailable`.
A failed AI response leaves patent evidence available in a partial report.
Render all idea, model, and patent text safely as text, never raw HTML.

## Evidence and alternative-approach rules

- Never fabricate publication numbers, patent records, claims, passages, or dates.
- Keep snippets, abstracts, and claims visibly distinct.
- Every comparison cites evidence from the same publication, using exact quotes.
- Alternatives must reference compared evidence and include tradeoffs and questions
  for a patent professional. Their status is `proposed_for_review`.
- Exact-quote validation proves text provenance, not that the AI interpretation is correct.
- No "safe to build", "legally cleared", "unpatented", guaranteed novelty,
  infringement verdicts, or percentage legal-risk scores.
- Missing results mean no matches in the performed searches, not an absence of rights.
- Applications and granted patents are different. Legal status is unverified provider
  data; a grant date does not prove that rights are currently enforceable.
- Scope is limited to retrieved published documents; do not promise all legal boundaries.

## Provider setup and known limits

Use a local `.env` based on `.env.example`. Never commit credentials or copy Codex
login tokens. The patent source is currently SerpApi's `google_patents` search and
`google_patents_details` engines. Another source may replace the provider adapter.

The AI runs through Codex CLI on the owner's Mac mini using an existing ChatGPT
login. The Mac mini hosts the CLI; inference still uses the model provider.
Set `CODEX_SSH_TARGET` and absolute `CODEX_BINARY` privately. Teammates need an
authorized SSH route or should run the backend on a machine that already has it.
Don't assume the Mac mini is reachable from every teammate's laptop.
Don't change SSH trust settings or disable sandbox controls to get it working.

AI calls are ephemeral, use read-only sandboxing, ignore user configuration, and
disable shell, browser, app/plugin, and delegation capabilities. One AI request
runs at a time; overlap returns AI_BUSY. There is no queue. Each AI call times out
after 120 seconds. Search calls time out after 20 seconds.

Search makes at most three first-page requests (ten records each) plus details
for the first three unique returned records. Cross-query deduplication is by
publication number, not full patent family. AI gets only three records, twelve
passages each, at most 3000 characters per passage; surface these coverage limits.

Reports live in RAM, expire after one hour, cap at 100, and disappear on restart.
The server is a local hackathon prototype with no accounts/database. Don't expose
it publicly without authentication, access controls, and spending limits.

## Collaboration

Verified at handoff: all 18 automated tests passed. A real Mac mini Codex check
completed query planning, two comparisons, and one proposed alternative, with
citations validated against artificial evidence. Live patent retrieval has not
been tested; the local patent API key is still unset.

Preserve the agreed API field names so frontend work can proceed independently.
Keep backend changes in `backend/`; a frontend teammate can own `frontend/`.
Coordinate root `package.json` edits rather than replacing the existing scripts.
Keep genuine provider errors visible; use any frontend fixture only with an
explicit demo label. Do not add a silent simulated fallback to live endpoints.
Run the relevant tests before committing. Never force-push over teammate work.
