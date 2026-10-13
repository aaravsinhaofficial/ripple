# Evaluate the live models before recording the submission

`server/evaluate.py` creates an evidence artifact for five fixed incidents in `examples/community-day.json`. Its default is a **dry plan with zero provider calls**, even if your environment already contains live keys:

```sh
.venv/bin/python -m server.evaluate
```

The command prints the path of a new JSON file under `artifacts/`. It labels every case `not_run`, records the fixture's SHA-256, and lists the intended model IDs and call limits. A dry artifact is preparation, not evidence that Nemotron ran.

The five cases cover a late keynote speaker, loss of the studio, an extended build session, loss of a room needed by locked activities, and a room closure during an activity already in progress. The first three must produce a feasible option; the last two must return blockers without an unchecked repair. The evaluator compares the model's interpretation to the known incident and independently runs the Python constraint validator against each returned schedule. It never trusts the model's checkmarks or a weaker interpretation of the disruption.

## Explicit live execution

Only run this after reviewing available credits and authorizing provider usage. Set `RIPPLE_MODE=live` and `NEBIUS_API_KEY` privately in `.env`. If Tavily is enabled, its key must also be present. Ultra and Tavily retain the explicit feature flags documented in [deployment.md](deployment.md).

```sh
.venv/bin/python -m server.evaluate --run-live
```

**`--run-live` consumes provider credits.** It permits at most five sequential repair workflows, each with Nano and Super plus one conditional Ultra call when enabled. There are no retries. A model authentication or credit/rate-limit failure stops the remaining cases. Each workflow can perform at most one optional basic Tavily search, only for an infeasible room disruption. Optional search failures are recorded separately. Output-token and request-timeout limits come from the server settings.

This command calls the service directly and **bypasses the HTTP API's SQLite daily allowance**. Its five-workflow cap is per command invocation; repeatedly invoking it creates additional usage. It does not create cloud resources, deploy an Endpoint, or start a Nebius Job.

## Read the artifact

Each attempted case records its verdict, independently computed checks, proposed timeline, actual returned model identity when supplied, requested model, provider, reported input/output tokens, and measured call/case latency. Failed calls keep redacted error codes; missing usage is marked unknown and is not assumed free. Raw provider responses, credentials and exception bodies are excluded.

Successful Tavily calls also record source titles, URLs, and retrieval time. These remain unverified venue leads, not availability or booking evidence.

`pass` means the case met these fixture expectations, not that the application is universally safe or optimal. `fail` includes incorrect interpretations, unsafe plans and no solution for a known feasible incident. `error` means execution failed; `skipped` means evaluation stopped early. Exit codes are `0` for a dry plan or all live cases passing, `1` for live failures/errors/skips, and `2` for invalid setup or output configuration.

Files are never overwritten. An optional `--output artifacts/your-new-name.json` must point to a new JSON file inside this repository's artifact directory. Artifacts are ignored by Git by default; inspect them before intentionally sharing one. A model record with no returned ID means the provider omitted its identity; the evaluator does not convert a requested model ID into claimed execution evidence.

The local test suite uses a mock provider to verify all five cases, refusal before missing-key calls, failure redaction, and detection of forged “passed” checks. Those tests do not constitute live API verification. To claim a live submission, collect an actual `--run-live` artifact, retain an honest account of failures, and record the real UI/provider flow. Endpoint/Job deployment requires separate execution evidence.
