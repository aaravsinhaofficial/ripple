# Validation record

This record separates local and mocked checks from actual provider execution. Real Nano and Super calls were verified on October 13, 2026. Tavily and Cloud hosting remain unverified. Mock tests alone do not establish model quality, latency, cost, or availability.

## Connections and imports — v0.4.0 · October 13, 2026

The release working tree passed **200 frontend tests**, **203 Python tests**, **33 browser workflows**, **23 retained event-contract cases**, and the production build. The new coverage includes 37 import-engine cases, 10 Google adapter cases, 7 connector-client cases, 32 backend connector cases, and 9 browser workflows. Desktop and 390 px phone layouts were also visually inspected without horizontal overflow.

Browser checks cover reviewed calendar imports becoming protected planning time, repeat-import deduplication, explicit changed-item selection, atomic rejection of malformed input, preserved task completion, History undo, CSV column mapping, and explicit action items from notes. Synthetic Google and MCP flows verify pagination, temporary credential isolation, popup origin/source checks, and cancellation of an in-flight authorization. ICS tests include recurrence exceptions, timezone conversion, second rounding and ambiguous clock changes.

Revision [`00b96e4`](https://github.com/aaravsinhaofficial/ripple/commit/00b96e4) passed [GitHub Actions verification](https://github.com/aaravsinhaofficial/ripple/actions/runs/38445039311) and [deployed to Pages](https://github.com/aaravsinhaofficial/ripple/actions/runs/38445039176). The published site then passed **19 daily/connector browser cases**, with the local HTTP-service case skipped, plus the public smoke check. Account flows in those public browser cases still use fixtures. The real local frontend-to-API session and provider readiness check also passed without starting provider authorization.

The updated [Linux AMD64 image workflow](https://github.com/aaravsinhaofficial/ripple/actions/runs/38445090418) passed its network-disabled demo check. The downloaded archive's checksum was verified; image identity is `sha256:bd3e1844b98d456f325cd22a046ff7f3c396226580f17733f336222e8b784f29`. This image includes the connector backend. It has not been deployed to Nebius Cloud.

These checks made no paid calls and imported no private account data. File imports work without external setup. Google requires a public OAuth client ID and user consent; Notion, Granola and Otter require the private connector service and separate provider consent. Real account authorization and selected-document compatibility remain unverified. [Setup and evidence boundary](connectors.md).

## Hosted connection readiness — October 13, 2026

The connection dialog now validates the app access code through authenticated `GET /api/session` before reporting a connection. An optional public URL preset fills the address only; it does not connect or transfer task data. Closing a pending check cancels it. Allowed-origin responses retain CORS headers for early request-size and rate-limit errors, so the browser can show the actual failure.

Revision [`264fdc3`](https://github.com/aaravsinhaofficial/ripple/commit/264fdc3) passed [GitHub Actions verification](https://github.com/aaravsinhaofficial/ripple/actions/runs/38358458404): **146 frontend tests**, **171 Python tests**, **24 browser workflows**, **23 retained event-contract cases**, and the production build. Browser coverage includes the real local rules API, rejected/accepted access-code flow without task transfer, and cancellation. The deployment script now repeats each `--env` and `--env-secret` argument as required by the installed CLI. These checks made no paid provider calls.

The same revision [deployed to GitHub Pages](https://github.com/aaravsinhaofficial/ripple/actions/runs/38358458374), then passed **10 public daily browser cases** and the public smoke check. Only the real local HTTP-service case was excluded. Public connection checks use mocked services; they do not establish availability of a hosted AI backend.

Its [Linux AMD64 container workflow](https://github.com/aaravsinhaofficial/ripple/actions/runs/38358467887) also succeeded. The downloaded archive's checksum was verified, and the image identity is `sha256:4f2c3b37717253785068535f08b69431f69e3cdd5ca1cb46fb3aa1babb9bd706`. The workflow checks demo mode with networking disabled and no configured providers. This verifies the build artifact, not a Nebius deployment.

Cloud browser federation authentication succeeded, but the signed-in account's tenant list was empty. No Cloud resources were created. Account onboarding/billing or access to an existing tenant is still required before the tested image can be deployed.

## Real daily assistance — October 13, 2026

[Redacted synthetic evidence](evidence/daily-live-2026-10-13.json) records **10 actual Token Factory attempts: 9 completed and 1 timed out**. No automatic retries or search calls were made. Returned identities were `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` and `nvidia/nemotron-3-super-120b-a12b`. Every call was capped at 1,200 completion tokens and one choice.

The direct cases cover explicit durations, tomorrow's date, a clearly labeled missing-duration estimate, an explicit dependency chain and task-specific steps. The initial timeout and imperfect outputs remain in the evidence. Human review led to Nano's non-thinking setting, preservation of original capture context, clearer budget instructions and application-derived review summaries. See the [provider findings](feedback.md); automated structural passes are not full quality approval.

Two separate fresh Chromium runs exercised the real browser → authenticated local HTTP API → Token Factory route. Both checked that capture requires review, only approved tasks persist, model actions do not complete tasks, app credentials stay out of browser storage, reload clears the connection and no browser errors occur. The final run retained the five-slide limit and design-team audience; its brief used four content slides plus the fifth decision slide. Final provider durations were **2.70 seconds for capture** and **3.42 seconds for the brief**, observations from one run rather than a benchmark. [Capture screenshot](assets/ripple-live-capture.png) · [Brief screenshot](assets/ripple-live-brief.png).

Reported usage estimates to **$0.00285738** at the published Nano/Super rates. One timed-out call has unknown usage; this is not an account billing total. No ongoing Cloud resources were created. The published GitHub Pages app still serves the local planner; these live flows used a private local backend.

After the live-integration fixes, **163 Python tests** pass, including 41 daily-service and 34 evaluation-harness cases. These automated tests use mocks; actual live evidence is recorded separately above.

The repeatable [daily evaluator](daily-live-evaluation.md) defaults to zero provider calls. Its explicit live mode permits one selected case at a time, checkpoints failures, and never substitutes a local answer for a provider error.

## Daily MVP — v0.3.0 · October 13, 2026

The default product is now the daily recovery workspace. The earlier event workspace is retained at `?workspace=events`; its test history below remains scoped to that workflow.

Local verification on the release working tree passed **137 frontend tests**, **123 Python tests**, **23 cross-runtime event cases**, **23 browser workflows** (10 daily and 13 retained event cases), and the production build. The frontend total includes 53 daily planner/storage/capture/export tests and 10 daily client-boundary tests. The Python total includes 38 daily assistance cases. Provider calls are mocked; the browser's actual HTTP service tests use rule-based mode.

Daily browser coverage starts with an empty workspace, captures reviewed tasks, adds fixed appointments, previews without mutating the saved day, approves, loses time, and keeps all unscheduled minutes visible. It verifies dependencies, same-day deadlines, explicit completion, recurring-task duplicate prevention, focus timing, validated backup replacement, undo, TXT/ICS exports, phone layouts, keyboard/focus behavior, unavailable storage, unreadable data recovery and forged saved-plan rejection. Assistant checks cover the real local HTTP route, token isolation, visible capture metadata and cancellation without stale draft replacement.

Revision [`791aaf8`](https://github.com/aaravsinhaofficial/ripple/commit/791aaf8) passed [GitHub Actions](https://github.com/aaravsinhaofficial/ripple/actions/runs/38355208307) and [deployed to Pages](https://github.com/aaravsinhaofficial/ripple/actions/runs/38355208531). The published daily app then passed **9 browser cases**, with the local-HTTP case correctly skipped, plus the public HTTP/assets/approval/persistence/mobile smoke check. No provider calls were made by these public checks.

Public daily-only checks require no local backend or provider calls:

```sh
RIPPLE_TEST_BASE_URL=https://aaravsinhaofficial.github.io/ripple/ npx playwright test tests/e2e/daily.spec.ts
node scripts/check-public.mjs
```

The daily HTTP-service test skips for the public static site. All other daily tests exercise the published frontend directly. Screenshots in `docs/assets/ripple-daily.png` show the implemented sample workspace, not a product mockup.

## Earlier event workspace: observed results — October 12, 2026

The final local checks passed on October 12, 2026, in the America/Chicago timezone. The tested snapshot was the working tree immediately before the initial commit; no commit SHA had been assigned to that snapshot when these checks ran.

| Check | Observed result | Evidence boundary |
| --- | --- | --- |
| Frontend unit tests (`npm test`) | 44 passed | Local parser, planner, validator, import, and export behavior. |
| Python tests (`.venv/bin/python -m pytest server/tests -q`) | 53 passed | Backend contracts and orchestration, including mock provider responses. |
| Cross-runtime contracts (`npm run test:contracts`) | 15 cases passed | TypeScript and Python validator agreement on the repository's cases. |
| Playwright (`npm run test:e2e`) | 8 passed | Browser workflows, including an actual HTTP background job against the local demo API. |
| Production build (`npm run build`) | Passed | TypeScript checking and frontend asset generation. |
| Dependency audit (`npm audit`) | 0 vulnerabilities reported | Repeated after publication; an advisory check is not a security guarantee. |

These are local implementation results. They do not verify public deployment, an NVIDIA model call, Nebius cloud execution, Tavily runtime, model quality, or an organizer trial. No live latency, token cost, or impact measurement has been recorded. Re-run the relevant checks after implementation changes and identify the tested commit in the next record.

## Published application — October 12, 2026

Revision [`5816807`](https://github.com/aaravsinhaofficial/ripple/commit/5816807) passed the [GitHub Actions frontend, backend, and browser checks](https://github.com/aaravsinhaofficial/ripple/actions/runs/38346942167) and [deployed to GitHub Pages](https://github.com/aaravsinhaofficial/ripple/actions/runs/38346942059). GitHub detected the public repository's MIT license.

A fresh Chromium session then checked the [public demo](https://aaravsinhaofficial.github.io/ripple/): HTTP 200, loaded frontend assets and favicon, delayed-speaker repair with two alternatives, all 11 constraint checks passing, successful local approval, no horizontal overflow at 390 px, and no browser runtime errors. Reproduce with `node scripts/check-public.mjs` after installing Playwright Chromium. This exercises the public deterministic demo; it makes no provider calls.

The follow-up evaluation harness added nine mock-only tests. The complete Python suite then passed **62 tests**, and the production build passed again. Running `.venv/bin/python -m server.evaluate` produced five `not_run` cases with **zero model calls and zero search calls**. It verified the dry-run path only. See the [live evaluation guide](live-evaluation.md) for the explicit credit-consuming command and evidence format.

## Reproduce

### Usability iteration — v0.2.0

The v0.2.0 checks passed: **74 frontend tests, 85 Python tests, 23 cross-runtime cases, and 13 browser workflows**, plus a production build. All provider tests use mocks or the actual local demo API; no provider credits were consumed.

New browser coverage creates a custom event entirely through the editor, chooses the second of two activities owned by the same person, repairs only the intended activity, and downloads context-complete handoffs, a current schedule, and a correctly timed calendar file. It then reloads, checks preserved repair history, switches events on a phone-sized viewport, and returns to the approved plan. Other cases reject invalid edits without changing the baseline, preserve a fixed lunch when an ongoing extension is too large, accept an extension that fits, and keep the open plan downloadable when browser storage fails.

The guided API accepts exact organizer selections through `confirmedChange`, skips Nano honestly, and rejects altered worker interpretations. Freeform live input continues to use Nano. The local planner now supports real user-created events; `demo` remains the wire enum for the rule-based engine.

The new editor and repair workflow can also be checked against the published static app, without starting a local server or submitting provider jobs:

```sh
RIPPLE_TEST_BASE_URL=https://aaravsinhaofficial.github.io/ripple/ npx playwright test tests/e2e/usability.spec.ts
```

### Local commands

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
npm test
.venv/bin/python -m pytest server/tests -q
npm run test:contracts
npx playwright install chromium
npm run test:e2e
npm run build
```

The browser tests start an isolated local demo API and Vite server when they are not already running. If port 8000 is already in use, the integration test requires it to report demo mode before submitting any work. `RIPPLE_TEST_PYTHON` can select a Python executable with the backend dependencies installed.

## What is checked

- Frontend parsing and planning: all three sample disruptions, impossible changes, ambiguous/combined input, room and equipment requirements, full durations, preserved owners and notes, fixed moments, elapsed activities, ongoing room closures, and import validation.
- Backend: strict schemas, provider response envelopes, actual returned model identity, invalid candidate rejection, conditional escalation, optional Tavily lookup, authentication, queue lifecycle, worker leases, independent worker-result validation, and request limits.
- Cross-runtime contract: 23 feasible and adversarial schedule cases must produce the same verdict in the TypeScript and Python validators.
- Browser: choose and inspect a repair; apply, export, and undo it; import and persist a custom plan; refuse impossible input; respect repair-from time; fit a 390 px viewport; restore dialog focus; complete an actual HTTP background job using the local demo API; and expose provider failure without leaking the organizer token into storage.

The public demo's examples are fictional. Local search is bounded and returns the lowest-disruption plans it evaluated; no global optimality claim is made. Passing these checks does not validate facts omitted from an event plan.

## Remaining evidence before submission

1. Recheck the final submitted revision with the published daily cases if provider or prompt changes follow the October 13 live evidence.
2. Run one explicitly requested Tavily research case and retain the retrieved source URLs and resulting brief. Citation matching alone does not verify every claim.
3. Deploy the Nebius Endpoint if claiming cloud hosting; record a successful actual workload. Serverless Jobs and Ultra currently belong to the retained event workflow and must remain described that way.
4. Ask intended users to enter their real workday and recover from an interruption. Record observed usefulness and friction; no willingness to pay or impact is established by automated tests.
5. Record the under-three-minute public YouTube demonstration using actual provider execution. Keep demo access available through judging.

The [submission draft](submission.md) and [product guide](product.md) describe the current daily scope. Use the [provider feedback log](feedback.md) for actual runtime observations. Local and CI verification use mocks or the rules service; actual Token Factory usage is recorded separately above.
