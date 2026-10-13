# Evaluate daily assistance on real providers

This command evaluates the daily task-capture and starting-brief service. It is separate from the earlier [event-repair evaluation](live-evaluation.md). The default run makes **zero provider calls**, even if `.env` already contains live credentials.

## Prepare a zero-call plan

From the repository root, with the backend dependencies installed:

```sh
.venv/bin/python -m server.evaluate_daily
```

The command writes a private JSON report under `artifacts/YYYY-MM-DD/`. It contains public synthetic requests, expected outcomes and `not_run` verdicts. Optional research is marked `skipped` until explicitly selected and configured. The printed summary reports zero model and search calls; it is not inference evidence.

To inspect only the first case:

```sh
.venv/bin/python -m server.evaluate_daily --case capture-explicit
```

The inputs are defined in `server/evaluate_daily.py`. Their planning date is fixed at **2026-10-13**, so “tomorrow” always means **2026-10-14**, regardless of when the command runs. The report records a fixture hash and the exact selected requests. It never reads a user's browser workspace.

## Start with one paid smoke check

Keep `RIPPLE_MODE=live`, `NEBIUS_API_KEY` and any model overrides in the ignored private `.env` file or environment. Use the exact model IDs available to the account. Do not put a provider key in a command argument, example file or committed artifact.

Both execution flags are required:

```sh
.venv/bin/python -m server.evaluate_daily \
  --live --confirm-paid-api-calls \
  --case capture-explicit
```

This permits at most **one model call**. Inspect its outcome before paying for the other cases. Missing credentials or non-live server configuration are rejected before provider use. A health check or catalog lookup is useful preparation, but neither establishes that a model completed this request.

The command returns exit code `0` for a dry run or a completed run without failed cases, `1` when an executed case fails or errors, `2` for configuration or artifact-path errors, and `130` when interrupted. A skipped research case is not a failure and is not evidence that research worked.

## The bounded case set

| Case selector | What it checks | Maximum provider calls |
| --- | --- | --- |
| `capture-explicit` | Two explicit estimates, a relative deadline and no invented prerequisites | One Nano call |
| `capture-estimated` | A missing duration becomes a clearly labeled reviewable estimate | One Nano call |
| `capture-dependencies` | Three estimates and an explicit outline → writing → review chain | One Nano call |
| `task-breakdown` | Three to six distinct task-relevant steps without web citations | One Super call |
| `task-research` | Retrieved evidence and source-linked proposed steps | One basic Tavily search, then at most one Super call |

Run a selected remaining case by changing `--case`, or run all four ordinary cases by omitting it:

```sh
.venv/bin/python -m server.evaluate_daily \
  --live --confirm-paid-api-calls
```

Running this after the first smoke check repeats that first case and can consume credits again. There is no automatic resume or deduplication across invocations. Use the selectors to avoid an unintended repeat.

Research additionally requires `RIPPLE_ENABLE_TAVILY=true`, a private `TAVILY_API_KEY` and the `--research` flag:

```sh
.venv/bin/python -m server.evaluate_daily \
  --live --confirm-paid-api-calls \
  --case task-research --research
```

To include it in the full five-case run, omit `--case` and retain `--research`. If Tavily is disabled or missing its key, the research case is skipped before search or model use. If search returns no usable sources, no model call follows; the report records an unsuccessful evidence outcome instead of inventing research.

## Cost and execution bounds

The harness independently enforces these limits:

- At most five model calls per invocation and one model call per case. Selecting one ordinary case lowers the effective bound to one.
- At most one basic search, only in the explicitly enabled research case.
- At most 1,200 completion tokens per model request, or a lower configured limit. The provider's `max_completion_tokens` cap includes reasoning tokens.
- Fixed synthetic request bodies under 2,000 characters, capture text under 1,200 characters, model data payloads under 12,000 UTF-8 bytes, and bounded system instructions.
- Sequential execution, no Ultra escalation and no automatic retries.
- Remaining cases stop after an authentication, credit/rate-limit, rejected provider request or evaluation-budget failure.

Incomplete or malformed output remains an error; it does not become a local answer. A low completion cap may expose a model's output or reasoning requirements. Inspect the recorded outcome before deciding whether a separate change or run is justified.

These are per-invocation request limits, **not a currency budget**. This direct-provider command does not consume the HTTP API's SQLite daily allowance. Repeated invocations can incur further charges. Token totals include only usage actually reported by the provider; missing usage and failed requests are not assumed free. The report does not infer a dollar cost or remaining balance.

## Read and preserve the evidence

Each case records its exact synthetic request and expectation, the accepted output including its `mode`, independent checks, elapsed time, model-call records and search-call records. Model records distinguish the requested model from the actual returned identity. If the provider omits identity, `returnedModel` is null instead of treating the requested name as proof. Available token usage is preserved.

Search records include the submitted query, retrieval time and returned sources. The research assessment compares response sources with the actual recorded retrieval, then checks every cited URL. Matching citations establishes provenance; it does not independently verify every factual claim.

Reports are checkpointed after each case and written with owner-only file permissions. A later failure does not erase earlier evidence. An interruption records incomplete execution and unknown usage where applicable. Known provider and app credentials are redacted from structured report values, bearer strings are scrubbed, and arbitrary exception text is withheld. The command does not print prompts, responses, keys or private provider error bodies to the terminal.

Use `--output artifacts/your-new-name.json` for a chosen filename. Existing evidence is never overwritten by another run, and output paths outside `artifacts/` are rejected. The directory is ignored by Git. Review any report before selectively publishing a redacted evidence excerpt, especially if the synthetic fixtures are later replaced with personal data.

## What a passing result means

The checks verify schemas, the fixture's explicit estimates and dates, dependency graphs, narrow task relevance, source provenance and real recorded call attempts. They do not prove that an estimate is realistic, a brief is excellent, or a claim in a source is true. Read the outputs and record useful steps, mistakes and uncertainty separately.

This is a direct service evaluation on the machine running the command. It does not prove browser integration, HTTP authentication behavior, a deployed Nebius Endpoint, a Serverless Job or measured benefit to users. Record those outcomes with their own evidence. Do not substitute a mock-test result or dry artifact for successful live inference.

## Reproduce harness checks without spending

```sh
.venv/bin/python -m pytest server/tests/test_evaluate_daily.py -q
```

The harness tests use synthetic model and search responses. They cover the two-flag gate, a zero-call default, single-case selection, input/output bounds, routing, independent assessments, missing-search skips, early stops, redaction, interrupted checkpoints and private artifact boundaries. They make no paid calls.
