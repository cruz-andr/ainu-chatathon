# Who controls the report: formatting vs. AI output

Short version: Codex does not format anything. Report layout is entirely in this
repo and can be changed by anyone, offline, with no SSH and no API key. Only the
*prose inside five fields* comes from Codex, and only changes to that contract
need someone with Mac mini access.

## What Codex actually returns

`backend/providers/codex-cli.js` asks Codex for one JSON object and then rebuilds
it field by field in `validatePlan` and `validateComparisons`. The model's output
is never spread into the response. Anything Codex returns that is not on this
whitelist is discarded:

| Call | Fields kept from Codex |
| --- | --- |
| `plan` | `features[]`, `queries[]`, `questions[]` |
| `compare` | `summary`, `comparisons[].explanation`, `comparisons[].relationship` (only `related` or `uncertain`), `comparisons[].feature` (must equal a founder feature exactly), `comparisons[].citations[]` (evidence ID must exist on that publication and the quote must appear verbatim in it), `alternatives[].approach`, `alternatives[].tradeoffs`, `alternatives[].questionsForProfessional[]`, `questions[]` |

Everything else — `publicationNumber`, `status`, `provider`, evidence text, dates,
legal status — is taken from the retrieved record or set by our code, not by the
model. If Codex emits Markdown, headings, or a `format` field, none of it reaches
the page: the frontend writes every string with `textContent` and the Markdown
exporter escapes link and emphasis syntax.

## What you can change without SSH

All of this is layout and wording in our own code, developed offline:

- Section order, headings, tables, badges, labels, what is shown or hidden.
- The feature status table, coverage table, record table, evidence appendix.
- The Markdown export in `backend/brief.js`.
- The web report in `frontend/src/render.js`.
- Every error, empty, and partial state.

Two offline commands drive this. Neither contacts a provider or a model:

```sh
npm run render:fixture   # writes output/fixture-brief.md
npm run frontend         # then open http://localhost:5173/preview.html
```

Both read `data/fixture-report.json`, an artificial fixture built to exercise the
awkward cases: a feature with no comparison, a `related` and an `uncertain`
comparison on one feature, two publications sharing a title, a record whose full
text failed, a record whose full text was never requested, a failed search, and a
`partial` status. Its identifiers are deliberately not real patent numbers and its
links point at `example.invalid`. It is labelled on every surface that renders it.
Never show `preview.html` in a demo.

## What needs someone with SSH access

Only changes to the AI contract itself:

1. **Changing the prompt** in `codex-cli.js` (`plan`, `compare`) to alter the tone,
   length, or focus of the model's prose. The edit is offline; confirming Codex
   still returns valid JSON needs `npm run check:codex`, which uses the SSH worker.
2. **Adding a new field** to the AI response — for example a per-feature coverage
   note. This needs three coordinated edits and then a verification run:
   - the required output shape in the `invoke` call,
   - a matching rule in `validateComparisons` (reject the response if the field is
     missing or malformed; never default it silently),
   - the renderer changes, which can be written and previewed offline first.
3. **Anything about latency, `AI_BUSY`, or the 120-second timeout**, which only
   appear against the real worker.

A practical split: whoever lacks SSH can write the prompt change, the validator
change, and the renderer change, and prove the rendering against an updated
fixture. The person with access then runs `npm run check:codex` and reports
whether the model actually produces the new shape.

## Rules that still apply to any of this

Adding a field does not add permission to assert something. The constraints in
`SKILLS.md` hold: no patentability, novelty, infringement, or freedom-to-operate
conclusions; no invented records, passages, or dates; every interpretation cites
evidence that exists on the same publication; an absent comparison is reported as
absent, never as an absence of relevant prior art.
