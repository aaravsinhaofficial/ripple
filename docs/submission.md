# Ripple — Keep the day moving

**Submission working copy.** Best Apps and Agents track. The application is being built for this hackathon. Live provider calls, cloud deployment, measured evaluation, and the final public video are still pending. Reconcile this document with the final verified build before entering it on Devpost.

## Short description

Ripple helps community-event organizers repair a disrupted run of show: compare practical alternatives, inspect constraint checks, and prepare handoffs for the people affected.

## Inspiration

A speaker running late is rarely just a calendar edit. The next session may need the same room, a workshop may need equipment that cannot move, and lunch may already be fixed. For a volunteer organizer, the hard part is finding a workable change and making sure everyone acts on the same plan.

Ripple focuses on that moment: the day is already planned, something changes, and the organizer needs a repair they can understand quickly.

## What it does

The demo starts with Fieldnotes Community Day, a fictional single-track event with two rooms, assigned people, equipment requirements, setup time, and fixed commitments. An organizer enters an incident such as “Maya is running 40 minutes late for her keynote.” Ripple interprets the disruption, evaluates repair alternatives, and shows the changes beside the run of show.

Each proposal carries explicit constraint checks. The organizer compares the alternatives, chooses one, and applies it to the local plan. Targeted handoff drafts explain what changed for each affected person. The organizer controls any communication outside Ripple.

The browser demo runs locally without accounts. It is labeled as a deterministic simulation and does not represent an NVIDIA model response.

## How it is built

The frontend uses React and TypeScript and is designed for GitHub Pages. The Python service provides the live orchestration path and keeps provider credentials on the server.

The intended live routing gives Nemotron Nano the bounded extraction task and Nemotron Super the repair-planning task through Nebius Token Factory. Difficult cases can escalate to the configured Ultra model. Deterministic validation checks the proposals independently of the model; rejected proposals do not become feasible merely because a model describes them confidently.

The Tavily adapter searches for venue leads when a room closure has no feasible repair. Its results are leads with sources, not confirmed availability or reservations. The optional Nebius Serverless deployment paths separate the request-serving Endpoint from background processing in Jobs.

**Verification boundary:** adapters and deployment instructions alone do not establish successful runtime use. The final submission must include the actual model IDs, live execution evidence, and deployment status. See the [evidence checklist](hackathon.md).

## What makes the approach useful

Ripple keeps an existing plan as the reference point. It makes the change visible, preserves supported hard constraints, and turns the chosen repair into a handoff. The useful output is a plan that the organizer can inspect and act on.

The disruption score compares evaluated alternatives; it is not a proof of global optimality. This version models one single-track day with an explicit repair-from time. It is scoped to the constraints in the event model. It does not infer unrecorded commitments, confirm external resources, or establish that a real event is safe to run.

## Challenges and learning to complete after live testing

Record one concrete example for each item that was actually encountered:

- A model proposal the validator rejected, and the constraint it violated.
- A model or API behavior that changed the implementation.
- A meaningful difference between Nano, Super, and any escalation used.
- An external resource search that helped the organizer decide what to do.
- A measured latency, token-usage, or reliability tradeoff, with the underlying run.

Do not replace these with invented experience or promotional claims.

## Evidence to attach before submission

| Field | Current status |
| --- | --- |
| Public application URL | Planned: [aaravsinhaofficial.github.io/ripple](https://aaravsinhaofficial.github.io/ripple). Publication and a fresh-browser check are pending. |
| Public repository URL | [github.com/aaravsinhaofficial/ripple](https://github.com/aaravsinhaofficial/ripple). Publication is being finalized; confirm public access, complete source, license detection, and setup instructions. |
| Public YouTube URL | Not recorded or uploaded. Use the [demo storyboard](demo-script.md). |
| Live NVIDIA on Nebius | Not verified; requires an account, credited balance, credentials, and an end-to-end run. |
| Tavily runtime | Not verified; requires an account, key, and an appropriate search case. |
| Serverless Endpoint / Job | Do not claim deployment until each workload has run successfully. |
| Evaluation results | Add measured results only after executing the final test set. |
| User validation | No user-study or time-saving claim is made. |

## Suggested evaluation before recording

Independent local contract spot checks accepted the sample in both TypeScript and Python and rejected unknown event fields, 37 activities, an 800-minute activity, and a room capacity above the shared limit. The three sample incidents were also run through the Python demo service: all returned candidates passed the TypeScript validator and produced handoff exports without missing fields. These checks exercise validation and integration boundaries; they do not measure model quality or demonstrate provider runtime. Re-run the repository's tests on the final revision.

Use a small, published set of incident cases: a speaker delay, an unavailable room, extra session time, an unknown target, and an infeasible change against fixed commitments. For each, save the interpretation, candidate outcome, validator result, affected sessions, and handoff. Include one malformed provider response and one provider failure.

Report how many cases were attempted and passed, what failed, and which modes were tested. Separate local tests from live model evaluation. For impact, a short organizer trial with the same incident is more persuasive than an estimated “hours saved” figure.
