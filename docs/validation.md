# Validation record

This record concerns the local implementation. No real Nebius or Tavily credentials were available during this build. Mock-provider tests verify orchestration and failure handling; they do not establish model quality, latency, cost, or availability.

## Observed results — October 12, 2026

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
- Cross-runtime contract: 15 feasible and adversarial schedule cases must produce the same verdict in the TypeScript and Python validators.
- Browser: choose and inspect a repair; apply, export, and undo it; import and persist a custom plan; refuse impossible input; respect repair-from time; fit a 390 px viewport; restore dialog focus; complete an actual HTTP background job using the local demo API; and expose provider failure without leaking the organizer token into storage.

The public demo's examples are fictional. Local search is bounded and returns the lowest-disruption plans it evaluated; no global optimality claim is made. Passing these checks does not validate facts omitted from an event plan.

## Remaining evidence before submission

1. Run the same representative incidents through real Nano and Super models on Token Factory. Save redacted provider trace and independent validator outcomes.
2. Exercise one real Ultra escalation, or describe Ultra honestly as configured but not demonstrated.
3. Trigger Tavily on an infeasible room closure; record source URLs and retrieval time. Confirm that no lead is presented as a confirmed booking.
4. Deploy the Endpoint and execute a real Serverless Job, if claiming either integration. Record actual identifiers, statuses, and output.
5. Ask an organizer to try the workflow. Record observed benefit and friction without inventing impact metrics.
6. Record the final live workflow for the public YouTube submission and keep judge access available through the published judging period.

Use the [provider feedback template](feedback.md) to turn observed live behavior into reproducible feedback. Keep the [submission evidence ledger](hackathon.md) aligned with what actually ran.
