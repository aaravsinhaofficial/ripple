# Run Ripple and connect the real services

GitHub Pages serves only the interface. All provider credentials and live requests belong to the private API. The frontend's built-in demo needs no accounts. These instructions prepare a real deployment; no Nebius resource or provider call has been run with real credentials yet.

## 1. Run the private API locally

From the repository root, with Python 3.12+:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
```

The server loads root `.env` without overriding existing environment variables. `RIPPLE_MODE=demo` uses a local parser and bounded schedule search; no provider calls are simulated. Visit `http://127.0.0.1:8000/health`. The API docs are at `/docs` only in demo mode.

```sh
curl http://127.0.0.1:8000/api/repair \
  -H 'Content-Type: application/json' \
  --data-binary @examples/repair-request.json
.venv/bin/python -m pytest server/tests -q
```

The browser and server use `src/lib/types.ts` and `server/models.py`. Times are integer minutes after midnight in one local event day. `asOf` defaults to event opening; earlier-started activities cannot change. This is a single-track planner. Changeover gaps apply between activities even across rooms. No activity, owner, duration, capacity, equipment requirement, or hard lock can be silently removed. Only an explicit duration disruption extends that target's duration.

## 2. Create accounts and redeem credits

1. Join the [Nebius Builder Program](https://dev.nebius.com/) and redeem any current offers. Create a [Token Factory](https://tokenfactory.nebius.com/) account and API key. Promo codes can be applied without a card; grants are not guaranteed by this project. [Billing guide](https://docs.tokenfactory.nebius.com/other-capabilities/billing)
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

Start with one sample repair. `/health` reports configuration, not a successful provider test. A live repair should show Nano and Super trace entries with the actual returned model identity and usage when the provider supplies it, plus independently passed constraint checks. Authentication failures, exhausted credits, malformed output and timeouts remain visible errors; the server never replaces them with demo output.

For repeatable submission evidence, the [evaluation command](live-evaluation.md) prepares five cases without making calls by default. Its explicit `--run-live` option consumes credits and saves model identity, usage, latency, independent checks, and failures to a private local artifact.

After checking credits/model access, set `RIPPLE_ENABLE_ULTRA=true` to permit one Ultra correction when every Super candidate fails validation. Set `RIPPLE_ENABLE_TAVILY=true` and the private `TAVILY_API_KEY` to allow venue leads only when a room disruption has no feasible repair. Confirm Ultra JSON-schema support with a small real request before relying on it for a judged demo. [Model/API research](platform-research.md)

Default per-repair limits are two model calls (three with conditional Ultra), 2,000 completion tokens per call, and one optional basic Tavily search. The HTTP API allows 25 live repair submissions per UTC day, persisted in SQLite, 12 requests/minute per direct client address, and two local concurrent repairs. Failed attempts also consume the daily submission allowance; this is a conservative guard, not a dollar budget. Provider pricing and input tokens still determine the bill. Input is limited to 64 KiB and 36 sessions. There are no automatic paid retries.

## 4. Deploy the API to a Nebius Endpoint

First review current regional Compute and disk pricing. Serverless Endpoints are billed while running, not only while answering requests. The documented CPU preset is sufficient because NVIDIA inference runs in Token Factory. [Pricing](https://docs.nebius.com/serverless/pricing-quotas)

Build and push a Linux image to a registry you control:

```sh
docker build --platform linux/amd64 -f server/Dockerfile -t YOUR_REGISTRY/ripple:1 .
docker push YOUR_REGISTRY/ripple:1
```

Create a SecretStash secret with payload keys `NEBIUS_API_KEY`, `RIPPLE_ACCESS_TOKEN`, `RIPPLE_WORKER_TOKEN` (a different random token), and `TAVILY_API_KEY` (empty when disabled, or omit that mapping from the deployment script). Use a public image, a same-project Nebius Container Registry, or configure private registry credentials with `--registry-secret` as documented. [Endpoint secret/registry options](https://docs.nebius.com/serverless/endpoints/manage)

Inspect `infra/deploy-endpoint.sh`, set `RIPPLE_IMAGE`, `NEBIUS_SUBNET_ID`, `RIPPLE_SECRET_SELECTOR`, and `RIPPLE_WEB_ORIGIN`, then run it when deployment is authorized. It creates a **billable** CPU Endpoint. It uses application-level auth so browser OPTIONS preflight remains unauthenticated; mutation routes still require the organizer token. No static public IP is requested. Copy the managed HTTPS URL from `nebius ai endpoint get ENDPOINT_ID --format json` or the console into the UI connection dialog.

The container runs one Uvicorn process and one SQLite queue. It survives Python process restarts while its disk exists. Do not assume data persists across endpoint recreation or cloud disk lifecycle changes. For a production deployment use a backed-up persistent volume or managed database, retention/access controls, and proper user identity. This hackathon build is one organizer workspace, not a multi-tenant service.

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
