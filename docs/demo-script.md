# Ripple daily demo storyboard

Target runtime: **2:50**, below the three-minute limit. This is a recording plan, not a completed video. The main story is a freelancer recovering a workday. Keep the actual assistance mode visible and show the user reviewing every generated draft.

## Prepare the exact build

Use a fresh browser session and the daily workspace at the final public URL. Record the commit and verify the complete workflow before the take. The earlier event workspace at `?workspace=events` is optional context, not the central product story.

Start with the sample day or a small realistic day of your own. Include fixed commitments, a stop time, one time deadline and one dependent task. Make the initial plan feasible. Rehearse a changed planning start that leaves some work unplaced. The sample's project outline is due at noon and the slides depend on it; restarting after noon creates a useful deadline-and-dependency case if neither task has been completed. Explain that those tasks remain unfinished instead of implying that scheduled time was work actually done.

For the live take, connect the real private API first. Verify a Nano capture, a Super brief and a Tavily research request with current credentials. Prepare a short task such as “Prepare the client website accessibility checklist, about 30 minutes” so source discovery serves the actual work. Use the observed output and timing; never narrate a canned model result as if it just ran.

Have a redacted execution trace ready with actual returned model identifiers, provider usage and request outcome. A service health check, mock response, replay or configuration screen is not proof of inference. If waiting is cut for video length, make the edit clear and avoid a latency claim.

## Main take

| Time | Show | Narration |
| --- | --- | --- |
| 0:00–0:15 | The daily workspace, several tasks, fixed commitments and working hours. | “My task list fits until the day changes. Ripple helps me make a realistic plan and keep the unfinished work visible.” |
| 0:15–0:40 | Quick capture with a short messy note; run the verified live capture, review its estimate and add the task. | “I can start with a task name and an estimate. With a connected service, Nemotron Nano turns a messy note into task drafts. I check the assumptions before adding them.” |
| 0:40–1:00 | Plan my day, the preview, a fixed meeting and the stop time. Apply the initial plan. | “The planner puts work around my commitments. It checks the times and accounts for every estimated minute. I choose when the proposal becomes my plan.” |
| 1:00–1:25 | Day changed? → lost time, then review the revised plan. | “Now an interruption means I cannot restart until this time. These tasks are still unfinished, so their remaining estimates stay in the plan.” |
| 1:25–1:50 | Before/after changes, explicit unplaced minutes and the reason; apply the revised plan. | “Some work no longer fits. Ripple shows exactly what still needs time and which deadline or prerequisite is affected. It does not extend my stop time or pretend the work is done.” Use the actual displayed outcome. |
| 1:50–2:15 | Open the selected task's assistance, request useful sources and show the verified result. | “When I need a way into a task, Super prepares actionable steps. This research action uses Tavily. The links must come from the retrieved sources, and I still review what they support.” |
| 2:15–2:35 | Save a useful brief, show the focus timer and manual completion, then text or ICS export. | “I can keep the steps with the task, focus on the work, and mark it complete myself. The plan and my workspace are downloadable.” Do not mark an uncompleted demonstration task done as a real work claim. |
| 2:35–2:50 | Compact runtime evidence and repository link. | “The core planner works locally without an account. Optional NVIDIA models run through Nebius Token Factory, with credentials on the private service. [State only the cloud deployment status actually verified.]” |

The complete feature list is not the story. Keep projects, recurrence, history and advanced preferences to a brief glimpse unless they explain the selected day. The useful moment is the reviewed recovery and visible unfinished work.

## If real provider access is still pending

Record a clearly labeled development preview using local capture and a local checklist. Replace the live integration lines with:

> “This preview uses the local planner and rule-based assistance. The Nebius and Tavily integrations are implemented and mock-tested; real provider execution has not yet been demonstrated.”

Do not present that preview as proof of the required NVIDIA-on-Nebius runtime. Complete real provider verification before the final submission. A local preview can still demonstrate the useful product workflow honestly.

## Infrastructure claims

Daily assistance is a synchronous API call. The repository's background Job worker and conditional Ultra escalation currently serve event repair. Do not describe the daily workflow as executing either. Only mention an Endpoint deployment when the actual daily API has served a successful request from it, and show the corresponding deployment evidence.

## Final review

- The public YouTube video is shorter than three minutes.
- Every narrated user action appears on screen and succeeds.
- Task drafts, proposed plans and completed work are clearly distinguished.
- The stop time, fixed commitments and overflow agree with the shown inputs.
- Model identities and search citations come from the recorded live run.
- Credentials, access tokens and private task details are redacted.
- The video, README and submission text report the same verified status.
