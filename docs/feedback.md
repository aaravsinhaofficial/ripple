# Findings from real provider use

On October 13, 2026, Ripple ran synthetic daily tasks through NVIDIA Nemotron Nano and Super on Nebius Token Factory's US endpoint. These findings concern the daily workspace. Tavily, a hosted Nebius Endpoint, Serverless Jobs and Ultra have not been runtime-verified for this release.

## Nano: bounded capture without unnecessary reasoning

The initial explicit-estimate capture preserved both durations and the relative deadline, but took 52.65 seconds. A missing-estimate case then timed out at 75.2 seconds. No local answer replaced that failure, and no automatic retry occurred.

Ripple now sends `chat_template_kwargs: {enable_thinking: false}` for Nano extraction. Token Factory accepted the requests. The same explicit case took 21.33 seconds; the following estimated-duration, dependency and browser-capture requests took about 2.6, 3.5 and 2.7 seconds at the provider boundary. Output tokens on the repeated explicit case fell from 638 to 169. This small, uncontrolled sample does not isolate queueing, caching or model reasoning and is not a latency benchmark.

NVIDIA documents the setting in its [Nano model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8). A useful provider documentation improvement would be a per-model table of accepted reasoning controls, defaults and structured-output examples. The authenticated model catalog also used different Nano capitalization from the cookbook; Ripple now uses the catalog's exact identifier.

## Super: schema validity does not establish a useful plan

The first 45-minute slide brief returned in 4.44 seconds and passed structural checks. Human review found a time-budget contradiction: nine minutes for each of five slides already spends 45 minutes, leaving no additional review time. The brief prompt now explicitly reserves preparation and review inside the total, checks repeated allocations, and asks for a stopping point.

A real browser run exposed a second issue: capture omitted the original five-slide limit and audience. The subsequent brief could not reliably recover that missing context. Ripple now preserves a clearly labeled original-capture excerpt in each draft's notes, independently of model-written notes. The brief must use only details belonging to the selected task. Generated status summaries are replaced with accurate review instructions from the application. Long source notes are explicitly labeled as excerpts, not represented as complete.

The final browser retest preserved the five-slide count and small design-team audience. Its brief covered slides 1–4 plus the fifth decision slide without including the unrelated reply task. Provider durations were 2.70 seconds for capture and 3.42 seconds for the brief.

These are observed integration problems and application changes, not claims that prompts guarantee semantic correctness. Draft review remains part of the workflow. The automated evaluator checks contracts and narrow fixture content; factual quality, context fidelity and usefulness still need human inspection.

## Cost and evidence

Each live call in this initial pass was limited to 1,200 completion tokens, including reasoning, with one choice and no automatic retries. Reports retain the actual returned model, usage when provided, latency, accepted output and failures. The timeout's usage is unknown and must not be counted as free.

Cost estimates use the published [Nemotron rates](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference): Nano $0.06 per million input tokens and $0.24 per million output tokens; Super $0.30 and $0.90 respectively. These are token-based estimates, not observed account charges. See the [validation record](validation.md) for the completed run and its scope, and [daily evaluation guide](daily-live-evaluation.md) to reproduce selected cases.

Cloud deployment is awaiting separate AI Cloud authentication. The Token Factory key does not establish Cloud management access. No ongoing cloud resource has been created, and no Cloud or Tavily runtime finding is claimed.
