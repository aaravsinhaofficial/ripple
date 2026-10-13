# Run Ripple and connect the real services

GitHub Pages serves the daily workspace and local rule-based planner. Task entry, planning, recovery, focus and exports need no account or backend. All provider credentials and optional live assistance requests belong to the private API. The earlier event workspace remains at `?workspace=events` and uses the same service. Real Nano capture and Super task briefs have been verified through Token Factory, including a local browser and authenticated HTTP API. A hosted Nebius Endpoint and Tavily search have not yet been verified. These instructions prepare that deployment.

## 1. Run the private API locally

From the repository root, with Python 3.12+:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
```

The server loads root `.env` without overriding existing environment variables. `RIPPLE_MODE=demo` makes rule-based task drafts and starting checklists; the event API uses its local parser and bounded schedule search. Neither path calls a provider in demo mode. Visit `http://127.0.0.1:8000/health`. The API docs are at `/docs` only in demo mode.

### Daily assistance

In the daily workspace, connect `http://127.0.0.1:8000` from the assistance settings. The service URL and app access token remain in memory and clear on reload. The core planner continues to work without this connection.

```sh
curl http://127.0.0.1:8000/api/daily/assist \
  -H 'Content-Type: application/json' \
  --data '{"action":"capture","text":"Write the project update 45m due tomorrow; Reply to the client 20m","date":"2026-10-13","useWeb":false}'
```

`POST /api/daily/assist` accepts `action: capture | breakdown | research`, `text` (up to 6,000 characters), a real ISO planning `date`, optional `task: {title, minutes, notes}`, and `useWeb` (default false). Brief requests can use an empty `text` with a selected task. Capture returns up to 12 reviewable drafts; other actions return proposed steps. See the [full contract](product.md#daily-assistance-api).

In live mode, capture makes one Nano call and a task brief makes one Super call. Explicit research with `useWeb: true` adds one basic Tavily search before Super; no useful sources means an explicit empty result and no model call. Search receives only the task title or explicit query. `useWeb: true` is rejected for other actions. Web research requires both `RIPPLE_ENABLE_TAVILY=true` and `TAVILY_API_KEY`; missing configuration is an error, not a simulated search.

The response contains `mode`, `summary`, `tasks`, `steps`, `sources` and the actual execution `trace`. Dates, estimates and dependency graphs are validated, and cited URLs must match retrieved sources. Drafts do not modify the user's saved day. Live failures remain explicit. This endpoint uses the same authentication, rate limit, request-size limit, concurrency bound and persistent live-attempt allowance as the event routes. It is synchronous and does not use the repair job queue or Ultra escalation.

For a first real integration check, connect the live API and capture a short note, then request a starting brief. Check the actual returned model identity and usage in the response. Test explicit source research separately. A successful `/health` response confirms configuration only; it does not establish successful inference or search.

### Earlier event API

The following contract and repair examples apply to `?workspace=events`:

```sh
curl http://127.0.0.1:8000/api/repair \
  -H 'Content-Type: application/json' \
  --data-binary @examples/repair-request.json
.venv/bin/python -m pytest server/tests -q
```

The browser and server use `src/lib/types.ts` and `server/models.py`. Times are integer minutes after midnight in one local event day. `asOf` defaults to event opening; earlier-started activities stay fixed except an explicit duration extension of an ongoing unlocked target. That exception preserves its original start, room, and owner. Completed targets cannot be extended. This is a single-track planner. Changeover gaps apply between activities even across rooms. No activity, owner, duration, capacity, equipment requirement, or hard lock can be silently removed.

Requests may include `confirmedChange` with `kind`, `targetId`, `minutes`, and `description`. The guided form uses this exact selection; the server validates it instead of reparsing the organizer's choices. Supported guided kinds are `delay`, `duration`, and `room`. Omit it to use prose interpretation. Worker results and the browser independently reject a different confirmed kind, target, or number of minutes.

## 2. Create accounts and redeem credits

1. Join the [Nebius Builder Program](https://dev.nebius.com/) and redeem any current offers. Create a [Token Factory](https://tokenfactory.nebius.com/) account and API key. Check the current onboarding and billing terms before redeeming credits. Credits are not a hard spending cap: card billing can continue beyond a positive balance. Grants are not guaranteed by this project. [Billing guide](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)
2. Optional: create a [Tavily](https://app.tavily.com/) account. Its free plan documents 1,000 credits/month; keep pay-as-you-go disabled if spending is not wanted. [Tavily pricing](https://docs.tavily.com/documentation/api-credits)
3. For deployment, create a [Nebius AI Cloud](https://console.nebius.com/) project and configure its CLI, region, subnet and quota. Token Factory credentials alone do not create an AI Cloud project. [CLI installation](https://docs.nebius.com/cli/install)

Never put `NEBIUS_API_KEY` or `TAVILY_API_KEY` into `VITE_*`, browser storage, source files, GitHub Pages configuration, URL query parameters, or container build arguments.

## 3. Enable live inference locally

Set the private `.env` values:

```dotenv
RIPPLE_MODE=live
NEBIUS_API_KEY=your-private-key
RIPPLE_ACCESS_TOKEN=your-random-organizer-token
RIPPLE_ENABLE_ULTRA=false
RIPPLE_ENABLE_TAVILY=false
```

Generate an organizer token with `python -c 'import secrets; print(secrets.token_urlsafe(32))'`. This is an app token distinct from all provider keys. Live API routes require it. In Ripple's connection dialog, enter the API origin and organizer token; keep the token in session memory only. Restart the API after edits. Configure `RIPPLE_ALLOWED_ORIGINS` to exactly the local UI origins or the final GitHub Pages origin (for example `https://you.github.io`, without the repository path).

For the daily workspace, start with a short capture and a selected-task brief as described above. For the earlier event workspace, use one sample repair with **Describe in words**. That event path should show Nano and Super trace entries with actual returned model identity and usage when supplied, plus independently passed constraint checks. Its guided path skips Nano and shows an organizer-confirmed change followed by Super. Authentication failures, exhausted credits, malformed output and timeouts remain visible errors in both workspaces; the server never replaces them with rule-based output.

For daily capture and brief evidence, use the [bounded daily evaluation](daily-live-evaluation.md), which makes zero calls by default and supports selecting one paid case at a time.

For repeatable event-repair evidence, the [evaluation command](live-evaluation.md) prepares five event cases without making calls by default. Its explicit `--run-live` option consumes credits and saves model identity, usage, latency, independent checks, and failures to a private local artifact. It does not evaluate daily capture or task briefs; use the separate daily command for those.

After checking credits/model access, the event workspace can use `RIPPLE_ENABLE_ULTRA=true` to permit one Ultra correction when every Super candidate fails validation. This setting does not add an Ultra call to daily assistance. Setting `RIPPLE_ENABLE_TAVILY=true` with the private `TAVILY_API_KEY` enables explicitly requested daily research and the event API's optional venue search for an infeasible room disruption. Confirm Ultra JSON-schema support with a small real event request before relying on it for a judged demo. [Model/API research](platform-research.md)

Daily assistance makes at most one Nano **or** Super call and one optional basic Tavily search. Event repair allows two model calls, or three with conditional Ultra. Each call defaults to at most 2,000 completion tokens. The HTTP API shares an allowance of 25 live attempts per UTC day across daily assistance, direct repairs and queued repairs, persisted in SQLite. It also shares 12 submitted requests/minute per direct client address and two local concurrent operations. Failed attempts consume the live allowance; this is a conservative request guard, not a dollar budget. Provider pricing and input tokens still determine the bill. Request bodies are limited to 64 KiB; daily text to 6,000 characters and event plans to 36 sessions. There are no automatic paid retries.

## 4. Deploy the API to a Nebius Endpoint

First review current regional Compute and disk pricing. Serverless Endpoints are billed while running, not only while answering requests. The template uses the documented `cpu-d3 / 2vcpu-8gb` preset because NVIDIA inference runs in Token Factory. With its 100 GiB Network SSD, October 13, 2026 list prices imply roughly $1.82 per day before inference, taxes or other resources. Confirm account quotas and current rates; Token Factory balances are not assumed transferable to AI Cloud. [Compute and disk prices](https://docs.nebius.com/compute/resources/pricing) [Pricing](https://docs.nebius.com/serverless/pricing-quotas)

The manually dispatched **Build backend container** GitHub Action builds and checks a Linux AMD64 image without provider access, then saves it with a checksum as a two-day artifact. Download it and use the included `LOAD.txt` instructions if Docker is unavailable on the development machine. The check runs with container networking disabled and verifies demo mode with no configured providers. This is an image-build check, not Cloud deployment.

Build and push a Linux image to a registry you control:

```sh
docker build --platform linux/amd64 -f server/Dockerfile -t YOUR_REGISTRY/ripple:1 .
docker push YOUR_REGISTRY/ripple:1
```

Create a SecretStash secret with payload keys `NEBIUS_API_KEY`, `RIPPLE_ACCESS_TOKEN`, `RIPPLE_WORKER_TOKEN` (a different random token), and `TAVILY_API_KEY` (empty when disabled, or omit that mapping from the deployment script). Use a public image, a same-project Nebius Container Registry, or configure private registry credentials with `--registry-secret` as documented. [Endpoint secret/registry options](https://docs.nebius.com/serverless/endpoints/manage)

Inspect `infra/deploy-endpoint.sh`, set `RIPPLE_IMAGE`, `NEBIUS_SUBNET_ID`, `RIPPLE_SECRET_SELECTOR`, and `RIPPLE_WEB_ORIGIN`, then run it when deployment is authorized. It creates a **billable** CPU Endpoint. It uses application-level auth so browser OPTIONS preflight remains unauthenticated; mutation routes still require the organizer token. No static public IP is requested. Copy the managed HTTPS URL from `nebius ai endpoint get ENDPOINT_ID --format json` or the console into the UI connection dialog.

The container runs one Uvicorn process and one SQLite queue. It survives Python process restarts while its disk exists. Do not assume data persists across endpoint recreation or cloud disk lifecycle changes. For a production deployment use a backed-up persistent volume or managed database, retention/access controls, and proper user identity. This hackathon API uses one shared app access token, not per-user accounts or a multi-tenant identity system.

Stop an idle deployment with `nebius ai endpoint stop ENDPOINT_ID`, and delete unused resources with `nebius ai endpoint delete ENDPOINT_ID`. Stopped endpoints do not incur compute/container-disk charges, but separately mounted storage still can. [Lifecycle and pricing](https://docs.nebius.com/serverless/pricing-quotas)

## 5. Use Nebius Jobs for background repairs

The built-in queue is useful for preparing repair alternatives without keeping a browser request open:

```text
POST /api/jobs                 → 202 {id,status:"queued",pollUrl}
GET  /api/jobs/{id}            → {id,status,createdAt,result,error}
status: queued | running | completed | failed
```

These routes use the same organizer token as `/api/repair`. Polling does not consume the repair-rate limit. IDs are cryptographically random; entries expire after 24 hours by default.

`RIPPLE_INLINE_JOBS=true` processes jobs inside the API. To demonstrate real Nebius Jobs instead, set it **false on the Endpoint**, and give the API and worker the same distinct private `RIPPLE_WORKER_TOKEN`. The worker also receives provider credentials through SecretStash. Set `RIPPLE_WORKER_API_URL` to the API HTTPS origin. Then review and run `infra/run-job.sh`; this creates one **billable** finite CPU Job. Its authenticated `/api/worker/claim` and completion calls move requests/results between machines. SQLite is not mounted across containers. An independent validation pass checks worker results before accepting them.

The worker stops claiming after five repairs or 300 seconds; an in-flight repair may finish afterward within provider timeouts. The cloud timeout is one hour because that is the documented minimum, and the process normally exits much sooner. Failed or interrupted work is not automatically retried; an expired lease becomes a visible failure. Read logs/status through `nebius ai job logs JOB_ID` and `nebius ai job get JOB_ID`. Completed Jobs release their compute/container disk. [Job guide](https://docs.nebius.com/serverless/jobs/manage)

For local reproduction without a cloud queue:

```sh
.venv/bin/python -m server.worker \
  --input examples/repair-request.json \
  --output /tmp/ripple-result.json
```

This file command performs one repair in the configured mode. Its output is a local artifact, not evidence of a Nebius Job deployment. To record the cloud integration, save the real job ID/status and resulting API result after running the deployment. Do not label local runs as cloud execution.
