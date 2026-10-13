#!/usr/bin/env bash
# Creates one billable CPU Job. Stops claiming after 5 repairs or 300 seconds;
# an in-flight repair is allowed to finish (the provider calls have timeouts).
set -euo pipefail
: "${RIPPLE_IMAGE:?Set your published linux/amd64 container image reference}"
: "${NEBIUS_SUBNET_ID:?Set your Nebius subnet ID}"
: "${RIPPLE_SECRET_SELECTOR:?Set the worker SecretStash secret selector}"
: "${RIPPLE_WORKER_API_URL:?Set the API's managed HTTPS origin}"

# The API must have RIPPLE_INLINE_JOBS=false. API and worker share the distinct
# RIPPLE_WORKER_TOKEN, but no cloud control-plane credential goes into the app.
nebius ai job create \
  --name "ripple-repair-worker-$(date +%s)" \
  --image "$RIPPLE_IMAGE" \
  --container-command python \
  --args "-m server.worker --max-jobs 5 --max-seconds 300" \
  --platform cpu-d3 \
  --preset 4vcpu-16gb \
  --disk-size 100Gi \
  --subnet-id "$NEBIUS_SUBNET_ID" \
  --timeout 1h \
  --env "RIPPLE_MODE=live,RIPPLE_WORKER_API_URL=$RIPPLE_WORKER_API_URL,RIPPLE_ENABLE_ULTRA=${RIPPLE_ENABLE_ULTRA:-false},RIPPLE_ENABLE_TAVILY=${RIPPLE_ENABLE_TAVILY:-false}" \
  --env-secret "NEBIUS_API_KEY=$RIPPLE_SECRET_SELECTOR,RIPPLE_WORKER_TOKEN=$RIPPLE_SECRET_SELECTOR,TAVILY_API_KEY=$RIPPLE_SECRET_SELECTOR"
