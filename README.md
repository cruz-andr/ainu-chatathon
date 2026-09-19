# ainu-chatathon

Founder patent research API — Misneach track.

An AI patent-research assistant that helps early-stage founders find relevant
patent applications and granted patents, understand technical similarities through
cited passages, and explore alternative approaches to discuss with a patent
professional.

"Idea to market" is the broader vision. This demo addresses the patent-research
step: idea → reviewed search plan → retrieved evidence → cited comparisons →
proposed alternatives → exportable brief for professional review.

For Misneach, the specific user is a first-time product founder without an in-house
research specialist. The bottleneck is turning a technical idea into a sourced
patent shortlist and useful follow-up questions. Measure research completion time,
source accuracy, and search cost. Legal-fee savings remain an unmeasured hypothesis.
The app does not issue patentability, infringement, novelty, or freedom-to-operate verdicts.

## Run

Node.js 22+ is required. There are no runtime dependencies to install.

```sh
npm start
```

The API listens at `http://127.0.0.1:3001`. Without a search key, health works and
research returns `503 SEARCH_NOT_CONFIGURED`; it never substitutes fake records.
Create a local `.env` using the settings in `.env.example`, and add your SerpApi
key as `SERPAPI_API_KEY`. Restart the server after changing configuration.
Never put the key in frontend code, chat, or version control.

```sh
npm run dev
npm test
```

## Frontend

`frontend/` is a zero-dependency static app: ES modules, no build step, no
framework, nothing to install. Serve it alongside the API:

```sh
npm run frontend
```

It listens on `http://localhost:5173`, matching the default `FRONTEND_ORIGIN`.
Run `npm start` in a second shell so the API is up.

The flow is idea → reviewed search plan → confirmed search → report, matching the
integration sequence in `CLAUDE.md`. Consent for the search provider and for the
model provider are separate checkboxes; AI comparison is offered only when at
least one feature is present, because the backend requires one. If `/api/plan`
returns `AI_NOT_CONFIGURED`, the founder can still write queries by hand and run
the search without analysis.

The report leads with publication numbers linked to their source records, then
shows quoted comparisons, proposed alternatives, questions for a professional,
and the coverage limits. All API, model, and patent text is written with
`textContent`; nothing from a provider reaches `innerHTML`. See `SKILLS.md` for
the rules that apply to changes in this directory.

## Frontend contract

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Reports server health and provider configuration (not proof of valid credentials) |
| POST | `/api/plan` | Uses headless Codex on the Mac mini to suggest editable features and queries |
| POST | `/api/research` | Runs up to three searches and returns a report |
| GET | `/api/research/:id` | Retrieves a completed in-memory report |
| GET | `/api/research/:id/brief.md` | Downloads the source-linked Markdown brief |

Start with `POST /api/plan` (fictional invention):

```json
{
  "idea": "A plant container that measures moisture and controls watering.",
  "allowExternalAi": true
}
```

Response: `{ features: string[], queries: string[], questions: string[],
mode: "ai", provider: "codex_cli_ssh", requiresReview: true }`.
Let the founder edit/confirm the features and queries, then `POST /api/research`:

```json
{
  "idea": "A plant container that measures moisture and controls watering.",
  "features": ["moisture sensing", "water delivery"],
  "queries": ["plant container moisture automatic watering"],
  "country": "US",
  "maxResults": 5,
  "allowExternalSearch": true,
  "analyze": true,
  "allowExternalAi": true
}
```

Send JSON with `Content-Type: application/json`. Before submission, show the
queries and obtain the founder's agreement to send them to the search provider.
Only queries and the publication-authority filter are sent to SerpApi. When AI
planning or comparison is requested, the idea, features, and selected evidence
are sent through the Mac mini to Codex's model provider. The model does not run
locally on the Mac mini. Queries can themselves reveal an invention. Use
fictional/non-confidential ideas for the hackathon demo.

`country` is a publication-authority filter, not a legal jurisdiction assessment.
Supported values: US (default), EP, WO, GB, CA, AU, JP, CN, KR, DE, FR.
`features` may be omitted. `queries` is required and contains 1–3 entries.
`maxResults` defaults to 5 and must be 1–10. `analyze` defaults to false. AI
comparison requires at least one confirmed feature and `allowExternalAi: true`.

Successful HTTP responses use status 201 and include:

- `id`, `createdAt`, `mode: "live"`, and `provider`.
- `status`: `completed`, `partial`, or `no_matches`.
- `searches`: the actual queries and whether each completed or failed.
- `patents`: normalized records with publication numbers, source URLs, dates,
  assignees, matched queries, detail-retrieval status, and evidence.
- `evidence` within each patent: stable `id`, `section` (`search_snippet`,
  `abstract`, or `claim`), and original provider text. Render it as escaped text.
- `coverage`, `warnings`, `limitations`, and `elapsedMs`.
- `analysis.status`: `completed`, `not_requested`, `no_evidence`, or `unavailable`.
  Completed analysis includes a summary, comparisons, alternatives, research
  questions, and analysis coverage. Each comparison has a publication number,
  an exact founder feature, a `related`/`uncertain` relationship, an explanation,
  and citations with `evidenceId` and an exact `quote`.
- `analysis.alternatives`: proposed technical approaches with an exact founder
  feature, tradeoffs, questions for a patent professional, and motivating citations
  already used in comparisons. Each is labeled `proposed_for_review`.

A partial response may contain zero records if some queries failed and the
completed queries found nothing. Display the partial status and warnings.
Errors use `{ "error": { "code": "...", "message": "..." } }` with HTTP
400/413/415 for invalid input, 429 when two jobs are active, 503 for absent
configuration, or 502 for upstream failures. Failed searches never become a
successful zero-result report.

The frontend origin defaults to `http://localhost:5173`; change `FRONTEND_ORIGIN`
to match your dev server exactly. Both localhost and 127.0.0.1 work as API host
addresses, but browser origins are matched exactly.

## Search scope and provider seam

`backend/providers/serpapi.js` implements `search(query, country)` and
`details(patent)`. A different patent source can implement the same interface.
Requests use the documented `google_patents` and `google_patents_details` engines.
One report makes 1–3 search requests plus up to three detail requests. Each request
has a 20-second timeout. No retries silently spend additional API quota.

Only the first ten results per query are retrieved. Search results use the
provider's default family grouping within each query; cross-query records are
deduplicated by publication number. Full family reconciliation is not implemented.
The first three unique returned records get detail requests. Missing details
leave search snippets visible with an explicit warning. Source ranking is
preserved; this is not an AI relevance ranking.

Legal status is provider-reported and always marked `verified: false`. Document
type is inferred only for US A1/B publication kinds; other kinds remain unknown.
No-result searches do not establish novelty or permission to build.

## Mac mini AI worker

`CODEX_SSH_TARGET` selects an SSH user@host; `CODEX_BINARY` is the absolute remote
Codex executable path. The Mac mini must be reachable over Tailscale, have its SSH
host key trusted, and already be signed into Codex. The backend never copies login
tokens. It pipes data through stdin to a fresh `codex exec` process and validates
the returned JSON. User config is ignored, sessions are ephemeral, and shell,
browser, app, plugin, and agent delegation features are disabled for these calls.

One AI request runs at a time; overlapping calls return `429 AI_BUSY`. Calls have
a 120-second timeout. There is no job queue yet. Research may take the patent
retrieval time plus AI time; allow up to three minutes in the frontend.
If comparison fails, the patent evidence is still returned as a partial report.

Comparison uses the first three patent records and up to twelve passages per
record, each capped at 3000 characters. Missing/truncated text must remain an
uncertainty. Citation IDs and exact quotes are validated against the supplied
record; that check verifies provenance, not the correctness of an interpretation
or a proposed alternative. The founder and a patent professional review these.

## What comes next

Connect the frontend, add a real patent-search key, and measure time to a verified
research shortlist against the same manual task. Do not claim live search has
been tested until the configured provider completes a real request.

## Storage and deployment limits

This is a local hackathon backend. Reports expire after one hour, are capped at
100, and disappear on restart. Report IDs act as unguessable access links.
There is no user authentication, persistent database, or production rate limiter.
Keep the default loopback binding; add authentication, access controls, and cost
limits before exposing it publicly. Requests and invention text are not logged.

The 18 automated tests pass using artificial provider responses and no external
API calls. The separate live Mac mini check passed query planning and comparison
(two cited comparisons and one proposed alternative using artificial evidence).
Run `npm run check:codex` to repeat that opt-in check. Real patent-provider
credentials, patent retrieval, and frontend integration remain to be tested.

## Provider documentation

- [SerpApi patent search](https://serpapi.com/google-patents-api)
- [SerpApi patent details](https://serpapi.com/google-patents-details-api)
- [USPTO: patent infringement and rights](https://www.uspto.gov/patents/basics/manage)
- [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
