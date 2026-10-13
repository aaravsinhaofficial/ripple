# Ripple product guide

Ripple helps an individual turn a realistic amount of work into a day plan, then revise that plan when the day changes. Its useful output is a reviewable schedule and an explicit account of the work that still needs time.

## Who it serves

The primary audience is an independent knowledge worker or freelancer balancing several tasks, a few fixed appointments, and a firm time to stop. The recurring job is: “My original plan no longer fits. Help me decide what I can still finish without losing sight of the rest.”

A beginner needs only task names, rough estimates and working hours. Project labels, prerequisites, deadlines, recurrence and configurable focus blocks are available in task details and preferences when useful. These are controls for one person's day, not a team project-management system.

## A focused approach in an existing category

Automatic planning and rescheduling already exist. [Motion](https://www.usemotion.com/features/ai-task-manager) describes scheduling work around priorities, deadlines and dependencies. [Sunsama](https://help.sunsama.com/docs/usage-guides/daily-planning/) supports deliberate daily planning and realistic workload decisions. [Ellie](https://ellieplanner.com/) offers a simple task capture and timeboxing workflow.

Ripple does not claim to be the first AI planner or the only tool that handles interruptions. This MVP focuses on a short recovery interaction: preserve the boundaries the user supplied, show revised task times, and make overflow impossible to mistake for completed work. Low setup, review before applying, and visible minute accounting are design choices to evaluate with users, not demonstrated competitive superiority.

## Start and return each day

1. Add a few tasks with estimated remaining minutes. Quick capture accepts one task per line and creates drafts for review; unspecified local estimates start at 30 minutes.
2. Set working hours, planning start, timezone, preferred focus length and break length. Add fixed commitments with their exact dates and times.
3. Choose **Plan my day**. Review the blocks, checks, warnings and work that did not fit. Apply the plan when it reflects what you intend to do.
4. Use the focus timer if helpful. Mark completion yourself. Update a partially finished task's remaining estimate before making a fresh plan.
5. When the day changes, choose **Day changed?** and one of the four supported changes. Review and apply the revised plan.

Changing the selected date carries unfinished tasks forward; it does not declare them finished or change their deadlines. Future tasks wait for their earliest date. Repeating tasks create the next occurrence when explicitly completed, with duplicate protection. A repeat is not a background job that runs while the app is closed.

## Supported recovery choices

| Change | Effect on the proposed workspace |
| --- | --- |
| I lost some time | Moves the planning start to after the specified unavailable interval; unfinished estimates remain intact. |
| This needs longer | Increases the selected task's remaining estimate. |
| Something urgent came up | Adds a high-priority task due on the selected day. |
| I need to finish earlier | Moves the end of working hours earlier. Existing fixed commitments retain their own recorded times. |

The old and proposed task placements are visible before applying. A fresh plan is required after task or preference edits before schedule export is enabled. Recent workspace snapshots support undo and restore.

Ripple does not infer that planned minutes were actually worked. For example, if a 60-minute task has 20 minutes left, set its estimate to 20; leaving it at 60 correctly asks the planner to reserve another 60 minutes. A focus timer is a working aid, not evidence of completion.

## Scheduling contract

The browser compares three deterministic scheduling orders, considering priority, due dates, task lengths and prerequisite importance. It chooses from those evaluated candidates; it neither proves global optimality nor minimizes distance from the previous timeline.

The independent validator checks:

- Known task identities and valid time blocks.
- Every fixed commitment keeps its exact date, title and times.
- Every unfinished task minute appears in task blocks or explicit unscheduled minutes.
- Task blocks remain inside the selected planning window and avoid fixed commitments and each other.
- A same-day deadline with a time is a hard boundary; overdue calendar dates remain warnings.
- Uninterrupted tasks stay whole; splittable tasks respect the focus-block limit.
- Prerequisites are complete or fully planned before dependent work begins.
- Break gaps and reported totals agree with the actual blocks.

A future date or unfinished prerequisite can leave a task outside today's schedule. Lack of capacity or a deadline can leave some minutes unplaced. Those outcomes remain visible and do not change the task's original estimate. Existing conflicting fixed commitments are reported rather than silently moved.

The workspace supports up to 200 tasks and 50 fixed commitments. Individual task estimates are 1–720 minutes. This is a one-day planner, not a guarantee that a multiweek project will meet all future deadlines.

## Assistance that prepares the work

Optional assistance addresses two moments where language models can help: turning an untidy note into reviewable task drafts, and making an unclear task easier to start. Scheduling and its hard checks remain deterministic.

Capture uses NVIDIA Nemotron Nano through Nebius Token Factory. A starting brief uses Nemotron Super. Research additionally uses one explicitly requested basic Tavily search. Each daily action makes at most one model call and one optional search; no Ultra escalation or automatic paid retry is used by this endpoint.

The user reviews captured tasks before adding them. Estimates are labeled when the model supplies them. Deadline dates and dependency indices are validated; dependency loops are rejected. Capture drafts do not create fixed commitments or recurrence automatically, so those details belong in the task or commitment editor.

Starting briefs provide short proposed steps. They can be saved to task notes or downloaded; they do not execute the work. Source URLs must match retrieved sources. This checks citation provenance, not independent factual correctness. Without search, the brief is a suggested workflow and does not claim current facts were verified.

Local service mode makes rule-based drafts and starter checklists without calling either provider. Live provider failures are explicit errors, with no substituted local answer. Runtime traces retain the actual returned model identity and token usage when the provider supplies them.

### Daily assistance API

The existing FastAPI service exposes:

```text
POST /api/daily/assist
Authorization: Bearer <private app access token>
Content-Type: application/json
```

Request example:

```json
{
  "action": "capture",
  "text": "Write the project update 45m due tomorrow; Reply to the client 20m",
  "date": "2026-10-13",
  "useWeb": false
}
```

`action` is `capture`, `breakdown` or `research`. For a brief, supply `task: {title, minutes, notes}` and optional context in `text`. `useWeb: true` is accepted only for `research`. Dates use real ISO calendar dates; relative language is interpreted against the supplied planning date. Text is limited to 6,000 characters. A capture returns at most 12 drafts.

The response has `mode`, `summary`, `tasks`, `steps`, `sources` and `trace`. A task draft contains `title`, `minutes`, `priority`, `project`, `notes`, optional `dueDate`, and `dependsOnIndices`. Dependency indices are zero-based references to other drafts in the same response. Brief steps contain `title`, `detail` and `sourceUrls`. Capture returns tasks; breakdown and research return steps. A search with no usable sources returns an explicit empty outcome without calling the model.

The endpoint shares the app access token, 64 KiB request limit, rate limit, concurrency semaphore and persistent daily live-attempt allowance with the event API. Failed attempts count toward the allowance. The default limit is 25 live attempts per UTC day; this is a request guard, not a currency budget. No client-supplied model name or provider key is accepted.

Daily assistance is synchronous. The repository's asynchronous repair jobs and conditional Ultra path support the older event workspace, not this daily endpoint.

## Data and portability

Tasks, fixed commitments, preferences, the approved plan and recent history stay in the browser. JSON backups contain the workspace's tasks, commitments and preferences; they do not include provider credentials, timer state or the local undo history. Restore validates the whole backup before replacing the open workspace.

A plain-text plan includes the schedule, overflow and checks. ICS exports use the selected date and timezone. Downloading a file does not sync a calendar, send invitations or update an external account. Clearing browser data can remove local work; use a backup to move devices or keep a durable copy. Storage failures are shown while the open workspace remains downloadable.

The optional service connection exists only in memory. A requested AI action sends its task text to the private service and model provider. Explicit web research sends the selected task title or query to Tavily; it does not include private task notes or the rest of the workspace.

## MVP boundary and verification

There is no login, monetization, team collaboration, calendar account connection, autonomous external action, automatic time tracking or claimed energy-based optimization. The earlier event tool remains at `?workspace=events`, with separate local storage.

Local behavior and mocked provider orchestration are implemented. Real Nano capture and Super task briefs were verified on October 13, 2026: ten Token Factory attempts produced nine completed responses and one explicit timeout, including two browser/API runs through a private local backend. The [redacted evidence](evidence/daily-live-2026-10-13.json) and [human findings](feedback.md) document this small synthetic sample, its quality problems and subsequent fixes; they do not establish general model quality or user benefit.

Tavily runtime and Cloud hosting remain pending. Cloud authentication succeeded, but no tenant or project is accessible and no Cloud resources have been created. Before making impact claims, observe whether a person can capture their own work, recover from an interruption, understand overflow and return the next day without assistance. Record friction as carefully as successful actions.
