#!/usr/bin/env bash
# Creates billable Nebius resources when run. This script has not been deployed.
set -euo pipefail
: "${RIPPLE_IMAGE:?Set your published linux/amd64 container image reference}"
: "${NEBIUS_SUBNET_ID:?Set the subnet ID in your configured Nebius project}"
: "${RIPPLE_SECRET_SELECTOR:?Set the SecretStash secret name or ID}"
: "${RIPPLE_WEB_ORIGIN:?Set one GitHub Pages origin, e.g. https://you.github.io}"

if [[ "$RIPPLE_WEB_ORIGIN" == *,* ]]; then
  echo 'Use one production origin in this CLI template.' >&2
  exit 1
fi

# The application handles Bearer auth so browser CORS preflight can succeed.
# Provider and app credentials are injected from SecretStash, never the image.
nebius ai endpoint create \
  --name ripple-api \
  --image "$RIPPLE_IMAGE" \
  --platform cpu-d3 \
  --preset 4vcpu-16gb \
  --disk-size 100Gi \
  --subnet-id "$NEBIUS_SUBNET_ID" \
  --container-port 8000 \
  --env "RIPPLE_MODE=live,RIPPLE_ALLOWED_ORIGINS=$RIPPLE_WEB_ORIGIN,RIPPLE_INLINE_JOBS=${RIPPLE_INLINE_JOBS:-true},RIPPLE_ENABLE_ULTRA=${RIPPLE_ENABLE_ULTRA:-false},RIPPLE_ENABLE_TAVILY=${RIPPLE_ENABLE_TAVILY:-false},RIPPLE_DAILY_LIVE_LIMIT=${RIPPLE_DAILY_LIVE_LIMIT:-25}" \
  --env-secret "NEBIUS_API_KEY=$RIPPLE_SECRET_SELECTOR,RIPPLE_ACCESS_TOKEN=$RIPPLE_SECRET_SELECTOR,RIPPLE_WORKER_TOKEN=$RIPPLE_SECRET_SELECTOR,TAVILY_API_KEY=$RIPPLE_SECRET_SELECTOR"
