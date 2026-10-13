# Validation record

This record concerns the local implementation. No real Nebius or Tavily credentials were available during this build. Mock-provider tests verify orchestration and failure handling; they do not establish model quality, latency, cost, or availability.

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
