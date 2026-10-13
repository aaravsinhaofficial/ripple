# Ripple — Make today workable

**Working submission copy: Best Apps and Agents.** The current product is a daily recovery planner. The earlier event planner remains available at `?workspace=events`. Nano capture and Super task briefs have run on Token Factory, including the real local browser/API flow. Cloud hosting, Tavily, the final public video and user evaluation remain pending. Update the evidence below against the exact submitted revision.

## Short description

Ripple turns tasks and fixed commitments into a realistic day plan, then helps you recover when the day changes. It protects the stop time you set, shows unfinished work explicitly, and uses optional AI to turn messy notes into task drafts and difficult tasks into actionable starting briefs.

## Inspiration

A to-do list can hold more work than a day can contain. When a meeting runs over or something urgent arrives, moving all the remaining tasks later disguises that mismatch. The person still needs to choose what to do, what to defer, and which deadline needs attention.

Ripple focuses on that repeated decision. It starts with a small amount of information and makes the consequences of a changed day visible before the user accepts a new plan.

## What it does

A person can start with an empty workspace, add task names and rough estimates, record fixed commitments and choose a finish time. Quick capture turns a multiline list into editable drafts. The planner creates time blocks with breaks, shows work that does not fit and exposes the checks behind the proposal. Nothing is marked done because a scheduled block has passed.

When the day changes, a guided form handles four concrete cases: lost time, a task needing longer, urgent work, or an earlier finish. Ripple displays the old and proposed task times and keeps all unplaced minutes visible. Applying the proposal updates the local plan. History makes recent changes reversible.

For more complex days, task details add projects, priorities, due dates and times, prerequisites, recurrence and a choice of uninterrupted or split work. A focus timer supports doing the work. Text, ICS and validated workspace backups make it portable. The core product needs no account or connected service.

## Where AI helps

The daily API uses NVIDIA Nemotron Nano on Nebius Token Factory to turn a messy note into structured task drafts. The user reviews those drafts before adding them; assumed durations are labeled. Real dates, bounded estimates and dependency references are validated independently.

Nemotron Super produces a concise starting brief for a selected task. When the user explicitly chooses research, a bounded Tavily search supplies sources for actionable steps. The service rejects citations that do not match retrieved URLs. Users can save the reviewed steps into task notes or download the brief. The service does not execute those steps.

This division keeps hard scheduling constraints in deterministic code while using models for language interpretation and task preparation. A daily assistance request makes at most one model call and one optional basic search. Failures remain explicit; a local result is never substituted for a failed live request.

**Runtime evidence:** ten real Token Factory attempts produced nine completed responses and one explicit timeout. Synthetic cases and two browser runs are preserved in the [redacted record](evidence/daily-live-2026-10-13.json), including quality problems and subsequent fixes. The final browser run preserved the selected task's deliverable count and audience. Tavily and Cloud hosting remain unverified; these calls used a local private API.

## How it is built

React, TypeScript and Vite provide the static browser workspace. Its local planner evaluates three scheduling orders, then independently checks the resulting blocks. Task minutes, fixed commitments, working hours, same-day time deadlines, prerequisites, splitting and breaks must remain consistent. Overflow remains part of the output.

Python and FastAPI provide `POST /api/daily/assist`, server-side provider credentials, authenticated access, request and concurrency limits, and a persistent daily live-attempt allowance. The returned trace preserves the actual served model and usage where supplied. App connection details remain in browser memory; the normal workspace is saved locally.

The repository also contains Nebius Serverless Endpoint deployment templates. The existing Serverless Job worker and conditional Ultra escalation serve the retained event-repair API. Daily assistance currently uses a synchronous endpoint; the daily workflow must not be described as running a cloud Job unless a corresponding implementation and verified execution are added.

## The focused contribution

Daily planning, task breakdown and automatic rescheduling are established features in existing products. Ripple does not claim a new category. Its MVP combines a low-setup personal workspace with reviewed recovery, explicit overflow and independently checked minute accounting.

That design may help people trust and act on a revised day, but this remains a hypothesis until observed with users. There is no claimed time saving, productivity increase or measured model advantage. The selected plan is one of the evaluated candidates, not a proof of the best possible schedule or smallest possible change.

## Evidence before submission

| Item | Current evidence and remaining work |
| --- | --- |
| Public app | [GitHub Pages](https://aaravsinhaofficial.github.io/ripple/) serves the daily MVP. Revision `791aaf8` passed CI and 9 public daily browser checks plus the public smoke check. |
| Public source | [Repository](https://github.com/aaravsinhaofficial/ripple) includes setup instructions and an MIT license. Record the final commit. |
| Core daily workflow | Implemented and browser-tested: capture, edit, plan, recover, review/apply, completion, recurrence, history and exports. See the [validation record](validation.md). |
| Local correctness | 137 frontend tests, 23 browser workflows, 23 retained event-contract cases and the production build passed for v0.3.0; the live-integration update passes 163 Python tests, including 41 daily-service and 34 harness cases. Provider tests use mocks or the local rules service. |
| NVIDIA on Nebius | Real Nano and Super calls verified October 13, including two browser/API runs. [Evidence and limitations](validation.md#real-daily-assistance--october-13-2026). |
| Tavily | Pending real search. Show the explicit user action, retrieved sources and accepted source-linked brief. |
| Nebius infrastructure | Templates are prepared. No Endpoint or Job deployment is claimed without a completed workload and actual resource evidence. |
| Public video | Pending. Use the [under-three-minute storyboard](demo-script.md). |
| User feedback | Pending. Record observed friction and usefulness, not invented impact. |

Mock tests do not measure model quality, runtime latency, cost or service availability. A health response proves configuration only. The existing event evaluation harness tests event repair and cannot stand in for daily assistance evaluation.

## Suggested final evaluation

Use a small published set of daily cases: a simple day, an overfull day, a prerequisite that cannot fit, a lost-time recovery, and an earlier stop time. Confirm that all estimated work stays accounted for, fixed commitments remain intact, and rejected imports or edits preserve the saved workspace.

For the live API, capture an explicit-duration list, a note with missing estimates, a note with an explicit dependency and a selected-task brief. Add one sourced research case. Save the actual request, mode, model trace, accepted output and any failure, with secrets removed. Include malformed provider output and rate/credit failure behavior using mocks separately from live quality results.

Before claiming benefit, ask a person from the intended audience to enter their real day, react to an interruption and explain the resulting overflow. Observe whether they can decide what to do next without coaching. Record where the interface or estimates caused confusion.

Use the [provider feedback log](feedback.md) for actual runtime findings. Keep the README, video and submission evidence consistent with what ran.
