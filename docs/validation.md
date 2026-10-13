# Validation record

This record concerns the local implementation. No real Nebius or Tavily credentials were available during this build. Mock-provider tests verify orchestration and failure handling; they do not establish model quality, latency, cost, or availability.

## Daily MVP — v0.3.0 · October 13, 2026

The default product is now the daily recovery workspace. The earlier event workspace is retained at `?workspace=events`; its test history below remains scoped to that workflow.

Local verification on the release working tree passed **137 frontend tests**, **123 Python tests**, **23 cross-runtime event cases**, **23 browser workflows** (10 daily and 13 retained event cases), and the production build. The frontend total includes 53 daily planner/storage/capture/export tests and 10 daily client-boundary tests. The Python total includes 38 daily assistance cases. Provider calls are mocked; the browser's actual HTTP service tests use rule-based mode.

Daily browser coverage starts with an empty workspace, captures reviewed tasks, adds fixed appointments, previews without mutating the saved day, approves, loses time, and keeps all unscheduled minutes visible. It verifies dependencies, same-day deadlines, explicit completion, recurring-task duplicate prevention, focus timing, validated backup replacement, undo, TXT/ICS exports, phone layouts, keyboard/focus behavior, unavailable storage, unreadable data recovery and forged saved-plan rejection. Assistant checks cover the real local HTTP route, token isolation, visible capture metadata and cancellation without stale draft replacement.

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

1. Run real daily capture through Nano and task briefs through Super on Token Factory; preserve redacted request/response, actual model identity, usage and review outcome.
2. Run one explicitly requested Tavily research case and retain the retrieved source URLs and resulting brief. Citation matching alone does not verify every claim.
3. Deploy the Nebius Endpoint if claiming cloud hosting; record a successful actual workload. Serverless Jobs and Ultra currently belong to the retained event workflow and must remain described that way.
4. Ask intended users to enter their real workday and recover from an interruption. Record observed usefulness and friction; no willingness to pay or impact is established by automated tests.
5. Record the under-three-minute public YouTube demonstration using actual provider execution. Keep demo access available through judging.

The [submission draft](submission.md) and [product guide](product.md) describe the current daily scope. Use the [provider feedback template](feedback.md) for actual runtime observations. No provider credentials or paid infrastructure were used during this iteration.
