"""Finite worker for Nebius Jobs, or a one-file repair for recordings and evaluation."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .config import Settings
from .models import RepairRequest
from .providers import ProviderError
from .service import RepairService


async def run(args) -> int:
    settings = Settings.from_env()
    service = RepairService(settings)
    if args.input:
        request = RepairRequest.model_validate_json(Path(args.input).read_text())
        result = await service.repair(request)
        serialized = result.model_dump_json(indent=2, exclude_none=True)
        if args.output:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_text(serialized + "\n")
        else:
            print(serialized)
        return 0
    endpoint = args.api_url or os.getenv("RIPPLE_WORKER_API_URL", "")
    parts = urlsplit(endpoint)
    if not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or (parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1"})):
        raise ValueError("Set RIPPLE_WORKER_API_URL to the HTTPS API origin (HTTP is permitted only for localhost).")
    if not settings.worker_token:
        raise ValueError("RIPPLE_WORKER_TOKEN is required for a remote worker.")
    deadline, completed = time.monotonic() + args.max_seconds, 0
    async with httpx.AsyncClient(base_url=endpoint.rstrip("/"), timeout=30, follow_redirects=False, headers={"Authorization": f"Bearer {settings.worker_token}"}) as client:
        while time.monotonic() < deadline and completed < args.max_jobs:
            response = await client.post("/api/worker/claim")
            response.raise_for_status()
            job = response.json().get("job")
            if not job:
                if args.once:
                    return 0
                await asyncio.sleep(min(args.poll_seconds, max(0, deadline - time.monotonic())))
                continue
            body = {"leaseToken": job["leaseToken"]}
            try:
                result = await service.repair(RepairRequest.model_validate(job["request"]))
                body["result"] = result.model_dump(exclude_none=True)
            except ProviderError as exc:
                body["error"] = exc.code
            response = await client.post(f"/api/worker/{job['id']}/complete", json=body)
            response.raise_for_status()
            completed += 1
            print(json.dumps({"job": job["id"], "status": "completed" if "result" in body else "failed"}), flush=True)
            if args.once:
                break
    return 0


def main():
    parser = argparse.ArgumentParser(description="Run a bounded Ripple repair worker. Live mode consumes configured provider credits.")
    parser.add_argument("--input", help="RepairRequest JSON input. No cloud queue is used.")
    parser.add_argument("--output", help="Write the result locally instead of stdout.")
    parser.add_argument("--api-url", help="Private API origin; defaults to RIPPLE_WORKER_API_URL.")
    parser.add_argument("--once", action="store_true", help="Claim at most one queued job, then exit.")
    parser.add_argument("--max-jobs", type=int, default=5)
    parser.add_argument("--max-seconds", type=int, default=300)
    parser.add_argument("--poll-seconds", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.max_jobs <= 25 or not 1 <= args.max_seconds <= 3300 or not 1 <= args.poll_seconds <= 60:
        parser.error("Bounds: max-jobs 1–25, max-seconds 1–3300, poll-seconds 1–60.")
    try:
        sys.exit(asyncio.run(run(args)))
    except (ProviderError, ValueError, httpx.HTTPError) as exc:
        # Never print HTTP bodies, headers, or credentials from failed provider calls.
        print(exc.message if isinstance(exc, ProviderError) else "Worker could not complete. Check its private configuration and input.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
