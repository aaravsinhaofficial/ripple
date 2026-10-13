# Ripple submission checklist

Target: **Best Apps and Agents**, Nebius x NVIDIA Global AI Hackathon. Verified against the supplied event brief and official pages on October 12, 2026. This checklist is a preparation aid; completing source code does not mean the submission is eligible or submitted.

## Dates and gates

Submit by **October 30, 2026 at 12:00 p.m. Chicago time** (10:00 a.m. PDT). Keep judge access available through **December 15, 2026 at 2:00 p.m. Chicago time** (12:00 p.m. PST), the published judging close. [Official rules](https://nebiusglobalaihackathon.devpost.com/rules)

The required platform use is a runtime Token Factory call or execution on Nebius AI Cloud, together with an NVIDIA open source model. Hosting Ripple's frontend on GitHub Pages is compatible with a live Nebius backend path. An NVIDIA model called exclusively through another provider does not satisfy the platform requirement. [Official FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs)

## Submission package

- [ ] Confirm the entrant and every team member meet the full eligibility rules; appoint a representative if entering as a team.
- [ ] Join the event on Devpost and select Best Apps and Agents.
- [ ] Provide the functioning app/test-build URL and clear judge instructions.
- [ ] Prove a real NVIDIA-model runtime through Nebius; record the exact models used.
- [x] Publish the complete repository with a detectable open source license and runnable README.
- [ ] Explain the problem, audience, workflow, model roles, and actual Nebius service use.
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
| Technological implementation | Incident extraction → structured alternatives → independent checks → approved handoff; live NVIDIA/Nebius records and one meaningful Tavily path. | A polished timeline with only fixtures; a provider badge with no successful call; an LLM approving its own unchecked plan. |
| Design | An organizer sees what changed, what stayed valid, and whom to notify; recovery and rejection states are as clear as success. | Unexplained numbers, hidden constraints, disabled controls presented as features, or an ambiguous demo/live state. |
| Potential impact | One specific event disruption, a usable repair, and a handoff that another volunteer can act on. | Unsupported time-saving claims or a broad “for every team” audience. |
| Quality of the idea | Repair an existing commitment with small, inspectable changes; compare alternatives and explain when no safe repair exists. | A general event chatbot or text generation detached from the run of show. |

## Honest evidence ledger

Fill in the evidence column only after observing the behavior on the final revision.

| Item | Evidence needed before making a claim |
| --- | --- |
| Local application | The [October 12 validation record](validation.md) documents passing local and CI tests, GitHub Pages deployment, and a fresh-browser walkthrough. The public demo is labeled as local simulation. |
| Nano extraction | Redacted successful runtime, actual model ID, input incident, parsed result. |
| Super repair | Successful runtime tied to alternatives that the independent validator accepted. |
| Ultra escalation | A difficult case that actually routed to the configured model; otherwise list it as configured or planned, not demonstrated. |
| Tavily | Real API request within the workflow, returned source URLs, and retrieval time. |
| Serverless Endpoint | Deployment identifier, healthy HTTPS URL, and completed app request. |
| Serverless Job | Job identifier, terminal completion status, and its useful output. |
| Reliability or cost | Test-set description and raw measured results; distinguish estimates from provider-reported usage. |
| Human benefit | Observed user trial or measured task comparison; otherwise describe intended benefit. |

## Product acceptance checklist

- [ ] A disruption changes the intended sessions and affected handoff recipients.
- [ ] The validator checks the original session set, valid times, durations, room conflicts, relevant people/resource conflicts, and the hard constraints actually supported.
- [ ] The single-track scope is visible. Activities before the repair-from time stay fixed; future activities cannot move into the past.
- [ ] No session disappears or duplicates while making the plan look feasible.
- [ ] Infeasible input returns a blocked explanation; the app does not silently loosen requirements.
- [ ] The chosen alternative is validated again before approval against the current plan.
- [ ] Exports match the approved alternative and include its provenance and operating mode.
- [ ] Drafts stay local until the organizer intentionally sends them through a separate channel.
- [ ] Provider failures, malformed model output, and unavailable models are visible and recoverable.
- [ ] Search content cannot change tool permissions or establish that a supplier is available.
- [ ] No provider key appears in frontend assets, browser storage, logs, exports, or the video.

Use “lowest-disruption among the evaluated plans” unless exhaustive search or an optimizer proves a global minimum. Use “checks the supported constraints” rather than a blanket claim of correctness or safety.

## Bonus awards and feedback

The Tavily bonus requires a functional runtime API call. A mocked search or link to Tavily does not qualify. The City Winner rules and FAQ require attendance at the relevant in-person event, despite a conflicting sentence on the resources page; do not claim attendance or eligibility without evidence. [Official rules](https://nebiusglobalaihackathon.devpost.com/rules) · [FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs)

Complete the [feedback template](feedback.md) after actual use: service/model, date, expected behavior, observed behavior, reproducible input, effect on Ripple, and suggested improvement. Separate documentation observations from runtime findings. Do not invent latency, stability, support interactions, or deployment experience.

See [account and credit setup](resources.md), [submission working copy](submission.md), and [demo storyboard](demo-script.md).
