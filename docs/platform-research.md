# Platform findings · checked 2026-10-12

Ripple uses a static GitHub Pages frontend and a private Python service. The documented integrations below are implemented; **no live inference or Nebius deployment has been verified with account credentials**. No paid resources were created during development.

## Token Factory and Nemotron

The official Nebius cookbook supplies these exact, case-sensitive model IDs. The US API base is `https://api.tokenfactory.us-central1.nebius.com/v1/`.

| Role in Ripple | Model ID | Evidence |
| --- | --- | --- |
| Interpret one disruption | `nvidia/nvidia-nemotron-3-nano-30b-a3b` | [Nano cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-nano-30b.md) |
| Propose schedule changes | `nvidia/nemotron-3-super-120b-a12b` | [Super cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-super-120B.md) |
| Retry only when all Super proposals violate constraints | `nvidia/Nemotron-3-Ultra-550b-a55b` | [Ultra cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-ultra-550b-a55b.md) |

Nano and Super are documented with function calling and structured output. Ultra is documented with reasoning/tool calling, US availability, and a quoted price of **$1 per million input tokens / $3 per million output tokens**. Its structured-output behavior still needs an authenticated smoke test. Current model cards and account access must be checked before recording the final demo; the implementation makes IDs configurable and never silently substitutes another model. The old Llama Nemotron Ultra 253B and Nano Omni were listed for August 31, 2026 removal, so they are not used. [Deprecation notice](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice)

The API accepts OpenAI-compatible chat completions and `response_format` with `json_schema`. Our requests use a bounded schema and validate JSON again with Pydantic, then validate schedule constraints in Python. Schema support alone does not prove a plan is feasible. [Structured output](https://docs.tokenfactory.nebius.com/ai-models-inference/json)

Function calling returns proposed function names/arguments; the application executes them. Ripple does not expose arbitrary shell, URL-fetch, messaging, or booking tools. Its orchestration calls only fixed Token Factory and Tavily hosts. We use structured proposals instead of a model-controlled execution loop because scheduling constraints and budgets need deterministic enforcement. [Function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)

## Nebius Serverless Endpoints and Jobs

Current guides use **`nebius ai endpoint create`** and **`nebius ai job create`**. Older search results for `msp serverless v1alpha1` are stale. The corresponding REST control-plane paths are `POST https://api.nebius.cloud/ai/v1/endpoints` and `/ai/v1/jobs`; creation returns a `resourceId`. GET by ID reports status. The CLI deployment scripts in `infra/` follow the current guides. [Endpoint quickstart](https://docs.nebius.com/serverless/quickstart/endpoints), [Job quickstart](https://docs.nebius.com/serverless/quickstart/jobs)

A CPU container can call Token Factory; no dedicated GPU is needed for Ripple's orchestration. The endpoint quickstart documents `cpu-d3` / `4vcpu-16gb`. Managed HTTPS access does not require a static public IP. Container ports, image, subnet, disk, environment variables, and SecretStash-injected variables are supported. The `--env-secret KEY=secret_selector` payload key must match the environment variable name. [Endpoint management](https://docs.nebius.com/serverless/endpoints/manage)

Jobs support the same container and secret injection, plus command/arguments and timeout. Documented job timeout minimum is one hour, but a worker process may exit earlier; completed jobs release their VM and container disk. Our worker stops taking work after five repairs or 300 seconds and allows an in-flight request to finish. It claims work from the API over authenticated HTTPS; it does not pretend that a local SQLite file is shared between Nebius machines. [Job management](https://docs.nebius.com/serverless/jobs/manage)

**“Serverless” here is not per-request function billing.** Running endpoints/jobs use Compute VM and disk prices. Stopped endpoints have no compute or container-disk charge; externally mounted storage still has separate charges. Actual regional CPU/disk rates and quotas must be reviewed in the account before deployment. [Serverless pricing](https://docs.nebius.com/serverless/pricing-quotas), [Compute pricing](https://docs.nebius.com/compute/resources/pricing)

## Tavily's specific job

If a room closure has no feasible local repair, optional Tavily Search finds nearby venue leads for the producer. It performs **one basic search**, at most three results, with `auto_parameters=false`. The returned URLs/snippets are evidence for manual outreach, never proof of capacity, equipment, booking availability, or permission to change the schedule. They cannot add rooms or override constraints. [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)

Tavily documents 1,000 free credits monthly without a card. A basic search costs one credit, advanced two; pay-as-you-go is $0.008 per credit. Free-credit availability should still be checked in the user's account. [Credits and pricing](https://docs.tavily.com/documentation/api-credits)

## Account and credit setup

The free [Nebius AI Builder Program](https://dev.nebius.com/) offers credits/discounts across participating services; exact grants depend on the current offer. Token Factory supports applying promo codes without adding a bank card. A linked AI Cloud account and appropriate project/VM/subnet quotas are needed for Serverless. These are distinct from simply having a Token Factory API key. [Token Factory billing](https://docs.tokenfactory.nebius.com/other-capabilities/billing)

Start with the local demo, then redeem credits and run a small authenticated test. Only after reviewing real usage should Ultra, Tavily, a public Endpoint, or a finite Job be enabled. Nothing in the repository claims that signup, credits, model access, or a deployment has already happened.
