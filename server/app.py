from __future__ import annotations

import asyncio
import hmac
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import Field

from .config import Settings
from .constraints import failure_details, validate
from .daily import DailyAssistRequest, DailyAssistResult, DailyAssistService
from .jobs import JobStore, QueueError
from .models import RepairRequest, RepairResult, StrictModel
from .providers import ProviderError
from .service import RepairService


class WorkerCompletion(StrictModel):
    leaseToken: str = Field(min_length=20, max_length=200)
    result: RepairResult | None = None
    error: str | None = Field(default=None, max_length=500)


async def execute_claim(store: JobStore, service: RepairService, claimed: dict):
    try:
        result = await service.repair(RepairRequest.model_validate(claimed["request"]))
        store.finish(claimed["id"], claimed["leaseToken"], result=result)
    except ProviderError as exc:
        store.finish(claimed["id"], claimed["leaseToken"], error={"code": exc.code, "message": exc.message})
    except asyncio.CancelledError:
        store.finish(claimed["id"], claimed["leaseToken"], error={"code": "worker_interrupted", "message": "The worker stopped before completing this repair. No automatic paid retry was started."})
        raise
    except Exception:
        # Internal exceptions are not returned with prompts, keys, or stack traces.
        store.finish(claimed["id"], claimed["leaseToken"], error={"code": "repair_failed", "message": "The repair could not complete. The current schedule was not changed."})


def create_app(settings: Settings | None = None, service: RepairService | None = None, daily_service: DailyAssistService | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    service = service or RepairService(settings)
    daily_service = daily_service or DailyAssistService(settings, nebius=service.nebius)
    store = JobStore(settings.database_path, settings.job_retention_hours)
    semaphore = asyncio.Semaphore(settings.max_concurrent_repairs)
    visits: dict[str, deque] = defaultdict(deque)

    async def dispatch():
        while True:
            async with semaphore:
                claimed = store.claim()
                if claimed:
                    await execute_claim(store, service, claimed)
            if not claimed:
                await asyncio.sleep(0.5)

    @asynccontextmanager
    async def lifespan(app):
        tasks = [asyncio.create_task(dispatch()) for _ in range(settings.max_concurrent_repairs)] if settings.inline_jobs else []
        yield
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    app = FastAPI(title="Ripple private API", version="1.0.0", lifespan=lifespan, docs_url="/docs" if settings.mode == "demo" else None, redoc_url=None)
    app.state.store, app.state.service, app.state.settings = store, service, settings
    app.state.daily_service = daily_service
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "Authorization"], max_age=600)

    @app.middleware("http")
    async def limits(request: Request, call_next):
        if request.method == "POST":
            # The limit also applies to chunked transfer; Content-Length alone is insufficient.
            data = bytearray()
            limit = 250000 if request.url.path.startswith("/api/worker/") else 65536
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > limit:
                    return JSONResponse(status_code=413, content={"error": {"code": "too_large", "message": "The request is too large."}})
            request._body = bytes(data)
            if request.url.path in {"/api/repair", "/api/jobs", "/api/daily/assist"}:
                now = time.monotonic()
                key = request.client.host if request.client else "unknown"
                for stale in [k for k, q in visits.items() if not q or q[-1] < now - 60]:
                    visits.pop(stale, None)
                queue = visits[key]
                while queue and queue[0] <= now - 60:
                    queue.popleft()
                if len(queue) >= settings.max_requests_per_minute:
                    return JSONResponse(status_code=429, content={"error": {"code": "rate_limit", "message": "Too many requests. Please wait a minute."}}, headers={"Retry-After": "60"})
                queue.append(now)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    async def authorize(authorization: str | None = Header(default=None)):
        if settings.mode == "live" and not settings.access_token:
            raise HTTPException(status_code=503, detail="Set RIPPLE_ACCESS_TOKEN before enabling the live API.")
        if settings.access_token and not hmac.compare_digest(authorization or "", f"Bearer {settings.access_token}"):
            raise HTTPException(status_code=401, detail="An organizer access token is required.")

    async def authorize_worker(authorization: str | None = Header(default=None)):
        if not settings.worker_token:
            raise HTTPException(status_code=503, detail="Remote workers are not configured.")
        if not hmac.compare_digest(authorization or "", f"Bearer {settings.worker_token}"):
            raise HTTPException(status_code=401, detail="A worker token is required.")

    def reserve():
        if settings.mode == "live":
            if not settings.nebius_api_key:
                raise ProviderError("not_configured", "Live mode requires a server-side NEBIUS_API_KEY.", 503)
            store.reserve_live(settings.max_live_repairs_per_day)

    @app.exception_handler(ProviderError)
    async def provider_error(request, exc):
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(QueueError)
    async def queue_error(request, exc):
        return JSONResponse(status_code=429, content={"error": {"code": "allowance", "message": str(exc)}})

    @app.get("/health")
    async def health():
        return {"status": "ok", "mode": settings.mode, "configured": {"nebius": bool(settings.nebius_api_key), "tavily": bool(settings.enable_tavily and settings.tavily_api_key)}, "requiresAuth": bool(settings.access_token) or settings.mode == "live", "models": {"nano": settings.nano_model, "super": settings.super_model, "ultra": settings.ultra_model if settings.enable_ultra else None}, "queue": "inline" if settings.inline_jobs else "remote-worker"}

    @app.post("/api/repair", response_model=RepairResult, response_model_exclude_none=True, dependencies=[Depends(authorize)])
    async def repair(payload: RepairRequest):
        async with semaphore:
            reserve()
            return await service.repair(payload)

    @app.post("/api/daily/assist", response_model=DailyAssistResult, response_model_exclude_none=True, dependencies=[Depends(authorize)])
    async def daily_assist(payload: DailyAssistRequest):
        async with semaphore:
            reserve()
            return await daily_service.assist(payload)

    @app.post("/api/jobs", status_code=202, dependencies=[Depends(authorize)])
    async def enqueue(payload: RepairRequest):
        reserve()
        job_id = store.create(payload)
        return {"id": job_id, "status": "queued", "pollUrl": f"/api/jobs/{job_id}"}

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(authorize)])
    async def get_job(job_id: str):
        result = store.get(job_id)
        if not result:
            raise HTTPException(status_code=404, detail="Job not found or expired.")
        return result

    @app.post("/api/worker/claim", dependencies=[Depends(authorize_worker)])
    async def claim_job():
        # Credentials sent by the browser can never claim provider work.
        if settings.inline_jobs:
            raise HTTPException(status_code=409, detail="Set RIPPLE_INLINE_JOBS=false to use remote workers.")
        return {"job": store.claim(max_running=settings.max_concurrent_repairs)}

    @app.post("/api/worker/{job_id}/complete", dependencies=[Depends(authorize_worker)])
    async def complete_job(job_id: str, payload: WorkerCompletion):
        request = store.original_request(job_id)
        if request is None:
            raise HTTPException(status_code=404, detail="Job not found.")
        if (payload.result is None) == (payload.error is None):
            raise HTTPException(status_code=422, detail="Provide exactly one result or error.")
        if payload.result:
            if payload.result.mode != settings.mode:
                raise HTTPException(status_code=422, detail="Worker mode does not match the API mode.")
            if request.confirmedChange is not None and any(getattr(request.confirmedChange, field) != getattr(payload.result.interpretation, field) for field in ("kind", "targetId", "minutes")):
                raise HTTPException(status_code=422, detail="The worker result changed the organizer's confirmed change.")
            for option in payload.result.options:
                if failure_details(validate(request.plan, option.sessions, payload.result.interpretation)):
                    raise HTTPException(status_code=422, detail="The worker result failed independent schedule validation.")
            store.finish(job_id, payload.leaseToken, result=payload.result)
        else:
            # The private worker may see credentials; do not echo arbitrary worker error text.
            store.finish(job_id, payload.leaseToken, error={"code": "worker_failed", "message": "The background worker could not complete the repair. See private worker logs."})
        return {"status": "accepted"}

    return app


app = create_app()
