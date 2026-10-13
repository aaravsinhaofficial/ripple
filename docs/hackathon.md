# Ripple submission checklist

Target: **Best Apps and Agents**, Nebius x NVIDIA Global AI Hackathon. Ripple's main product is the daily recovery planner; the earlier event workspace remains secondary. The requirements below were checked against the official pages on October 13, 2026. This checklist is a preparation aid; completing source code does not mean the submission is eligible or submitted.

## Dates and gates

Submit by **October 30, 2026 at 12:00 p.m. Chicago time** (10:00 a.m. PDT). Keep judge access available through **December 15, 2026 at 2:00 p.m. Chicago time** (12:00 p.m. PST), the published judging close. [Official rules](https://nebiusglobalaihackathon.devpost.com/rules)

The required platform use is a runtime Token Factory call or execution on Nebius AI Cloud, together with an NVIDIA open source model. Hosting Ripple's frontend on GitHub Pages is compatible with a live Nebius backend path. An NVIDIA model called exclusively through another provider does not satisfy the platform requirement. [Official FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs)

## Submission package

- [ ] Confirm the entrant and every team member meet the full eligibility rules; appoint a representative if entering as a team.
- [ ] Join the event on Devpost and select Best Apps and Agents.
- [ ] Provide the functioning app/test-build URL and clear judge instructions.
- [x] Record real NVIDIA-model runtime through Nebius: Nano capture and Super task briefs ran on Token Factory on October 13. See the [redacted evidence](evidence/daily-live-2026-10-13.json).
- [x] Publish the complete repository with a detectable open source license and runnable README.
- [x] Draft the problem, audience, workflow, model roles, and actual Nebius service use in the [submission copy](submission.md).
- [ ] Upload a public YouTube demonstration shorter than three minutes. Show the app functioning and its live model integration.
- [ ] Supply useful feedback based on services actually tried, using the [feedback log](feedback.md).
- [ ] If any work predates August 26, 2026, explain the significant changes made during the submission period.
- [ ] Test every submitted link in a fresh browser session without a developer login.
- [ ] Keep the app accessible without charging judges until judging closes; include test credentials if access is private.

These package requirements are drawn from the supplied event brief and checked against the [official rules](https://nebiusglobalaihackathon.devpost.com/rules). Registering, publishing the final submission, and uploading the final video remain user actions unless separately authorized.

## Rubric and the evidence Ripple should show

The event uses an initial pass/fail viability check, followed by four equally weighted criteria scored 1–5. Its judging update encourages Apps and Agents entries that connect multiple tools into an end-to-end workflow. The evidence targets below are our review standard, not an additional official scoring formula. [Judging update](https://nebiusglobalaihackathon.devpost.com/updates/46204-here-s-how-judging-works)

| Criterion | Ripple's strongest proof | Weakness to fix before recording |
| --- | --- | --- |
| Technological implementation | Live Nano capture → reviewed task drafts → independently checked day plan → reviewed recovery; Super turns a selected task into starting steps. Add Tavily evidence only after a real research request. | Treating a valid schema as proof of useful model output, or presenting mocks and container builds as provider execution. |
| Design | Start with a task name and estimate, see work around fixed commitments, and review changed times and unfinished minutes before applying a recovery. | Hiding overflow, implying a passed time block is completed work, or leaving the assistance mode unclear. |
| Potential impact | A freelancer enters a realistic day, loses time and can decide what to do or defer without extending the chosen stop time. | No observed user trial yet; intended usefulness is not measured time saving or productivity. |
| Quality of the idea | Combine low setup, explicit unfinished work and minute accounting in a reviewable recovery workflow. Explain the tradeoffs in a real changed day. | Claiming a new product category, global scheduling optimality, or an advantage over other planners without evidence. |

## Honest evidence ledger

Fill in the evidence column only after observing the behavior on the final revision.

| Item | Evidence needed before making a claim |
| --- | --- |
| Daily application | Revision `264fdc3` passed CI, Pages deployment, 10 public daily browser cases and the public smoke check. The [validation record](validation.md) identifies each result and its scope. Local planning needs no connected service. |
| Nano capture | Real inputs, returned model identity, structured drafts and failures are in the October 13 [redacted record](evidence/daily-live-2026-10-13.json). Draft review and preservation of original context remain necessary. |
| Super task brief | Real selected-task requests and returned steps are recorded. Human review found and prompted fixes for budget and context problems; structural checks are not semantic proof. |
| Tavily research | Pending: a real explicit research request, retrieved source URLs and the resulting source-linked brief. Mock tests do not qualify as runtime evidence. |
| Serverless Endpoint | The image is built and checked, but no Ripple Endpoint has been deployed. Cloud sign-in succeeded but returned no accessible tenant. Claim deployment only with an actual resource and completed app request. |
| Serverless Jobs and Ultra | Implemented only for the retained event workflow and not runtime-verified. They are not part of the daily assistance path. |
| Reliability or cost | Test-set description and raw measured results; distinguish estimates from provider-reported usage. |
| Human benefit | Observed user trial or measured task comparison; otherwise describe intended benefit. |

## Daily product acceptance checklist

Recheck these on the exact build and inputs used for the final recording. Automated coverage is linked in the validation record; a checked test suite does not replace this rehearsal.

- [ ] Start with an empty workspace; add tasks and fixed commitments without loading the sample.
- [ ] Preview a plan without changing saved work; apply only after reviewing times and overflow.
- [ ] Account for every unfinished task minute as either scheduled work or explicit overflow.
- [ ] Preserve fixed commitments, working hours, same-day time deadlines, prerequisites and the supported break/splitting rules. Report existing commitment conflicts.
- [ ] Recover from lost time, a longer task, urgent work and an earlier stop; show the actual changes and any unfinished work.
- [ ] Keep completion explicit. A timer ending or a scheduled block passing must not mark a task done.
- [ ] Reject invalid edits, imports and stale proposals without losing the saved workspace; demonstrate history or undo.
- [ ] Check that text, ICS and backup exports match the current workspace and selected day.
- [ ] Show live capture and task-brief review, accurate mode labels, visible failures, and no task changes before approval.
- [ ] If demonstrating research, verify that citations match retrieved sources and review whether the sources support the steps.
- [ ] Inspect final screenshots, video, exports and submission artifacts for credentials and private task details.

Use “one of the evaluated plans” unless an optimizer proves a global best. Describe checks for the supported constraints, rather than a blanket guarantee of correctness. The earlier single-track event checks remain in their own tests and documentation.

## Bonus awards and feedback

The Tavily bonus requires a functional runtime API call. A mocked search or link to Tavily does not qualify. The City Winner rules and FAQ require attendance at the relevant in-person event, despite a conflicting sentence on the resources page; do not claim attendance or eligibility without evidence. [Official rules](https://nebiusglobalaihackathon.devpost.com/rules) · [FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs)

Complete the [feedback template](feedback.md) after actual use: service/model, date, expected behavior, observed behavior, reproducible input, effect on Ripple, and suggested improvement. Separate documentation observations from runtime findings. Do not invent latency, stability, support interactions, or deployment experience.

See [account and credit setup](resources.md), [submission working copy](submission.md), and [demo storyboard](demo-script.md).
