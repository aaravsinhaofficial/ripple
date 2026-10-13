"""Five bounded live-model checks. The default is a dry plan with no provider calls."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import secrets
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .config import Settings
from .constraints import failure_details, validate
from .models import EventPlan, Interpretation, RepairRequest, RepairResult
from .providers import NebiusClient, ProviderError, TavilyClient
from .service import RepairService

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "examples" / "community-day.json"
ARTIFACTS = ROOT / "artifacts"
MAX_CASES = 5


@dataclass(frozen=True)
class Case:
    id: str
    request: RepairRequest
    expected: Interpretation
    outcome: str


def cases_for(plan: EventPlan) -> list[Case]:
    """Known answers are independent of the model's interpretation and confidence."""
    sessions = {s.id: s for s in plan.sessions}
    rooms = {r.id: r for r in plan.rooms}
    people = {p.id: p for p in plan.people}
    keynote, build = sessions["keynote"], sessions["build"]
    definitions = [
        ("speaker-delay", f"{people[keynote.ownerId].name} is running 40 minutes late for the keynote.", "delay", "keynote", 40, "feasible", plan.start),
        ("room-reassignment", f"{rooms['studio'].name} is unavailable for the rest of the day.", "room", "studio", 0, "feasible", plan.start),
        ("longer-session", "The build session needs 25 more minutes.", "duration", "build", 25, "feasible", plan.start),
        ("locked-room-conflict", f"{rooms['hall'].name} is unavailable for the rest of the day.", "room", "hall", 0, "blocked", plan.start),
        ("in-progress-room-closure", f"{rooms['studio'].name} is unavailable for the rest of the day.", "room", "studio", 0, "blocked", build.start + min(10, build.duration - 1)),
    ]
    return [Case(case_id, RepairRequest(plan=plan.model_copy(deep=True, update={"asOf": as_of}), disruption=text), Interpretation(kind=kind, targetId=target, minutes=minutes, description="Evaluation expectation"), outcome) for case_id, text, kind, target, minutes, outcome, as_of in definitions]


def safe_error(exc: Exception) -> dict:
    # Even unexpected errors must not serialize headers, response bodies or secrets.
    code = exc.code if isinstance(exc, ProviderError) else "unexpected_error"
    if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,50}", code):
        code = "provider_error"
    messages = {
        "provider_auth": "Provider authentication or model access failed.",
        "provider_limit": "Provider credit or rate limit reached.",
        "not_configured": "A required private credential is missing.",
        "provider_timeout": "Provider request timed out; no retry was made.",
        "invalid_output": "Provider output failed schema validation.",
        "incomplete_output": "The provider did not finish within the output limit.",
        "evaluation_budget": "The evaluation's per-case call bound was reached.",
    }
    return {"code": code, "message": messages.get(code, "The case could not complete. Error details were withheld.")}


class RecordingNebius:
    def __init__(self, delegate):
        self.delegate, self.calls = delegate, []
        self.case_start = 0

    def begin_case(self):
        self.case_start = len(self.calls)

    async def structured(self, **kwargs):
        if len(self.calls) - self.case_start >= 3 or len(self.calls) >= MAX_CASES * 3:
            raise ProviderError("evaluation_budget", "Model call bound reached.")
        record = {"provider": "Nebius Token Factory", "requestedModel": kwargs["model"], "status": "error", "returnedModel": None, "inputTokens": None, "outputTokens": None}
        self.calls.append(record)
        start = time.perf_counter()
        try:
            output, trace = await self.delegate.structured(**kwargs)
            # The runtime explicitly marks its fallback if a provider omits model identity.
            returned_model = None if "Provider omitted model identity" in trace.detail else trace.model
            record.update(status="complete", returnedModel=returned_model, inputTokens=trace.inputTokens, outputTokens=trace.outputTokens)
            return output, trace
        except Exception as exc:
            record["error"] = safe_error(exc)
            raise
        finally:
            record["durationMs"] = round((time.perf_counter() - start) * 1000)


class RecordingTavily:
    def __init__(self, delegate):
        self.delegate, self.calls = delegate, []
        self.case_start = 0

    def begin_case(self):
        self.case_start = len(self.calls)

    async def alternatives(self, venue):
        if len(self.calls) - self.case_start >= 1 or len(self.calls) >= MAX_CASES:
            raise ProviderError("evaluation_budget", "Search call bound reached.")
        record = {"provider": "Tavily", "operation": "basic search", "status": "error", "retrievedAt": datetime.now(timezone.utc).isoformat()}
        self.calls.append(record)
        start = time.perf_counter()
        try:
            sources = await self.delegate.alternatives(venue)
            record.update(status="complete", sourceCount=len(sources), sources=[source.model_dump(include={"title", "url"}) for source in sources])
            return sources
        except Exception as exc:
            record["error"] = safe_error(exc)
            raise
        finally:
            record["durationMs"] = round((time.perf_counter() - start) * 1000)


def assess(case: Case, result: RepairResult) -> dict:
    expected = case.expected.model_dump(include={"kind", "targetId", "minutes"})
    actual = result.interpretation.model_dump(include={"kind", "targetId", "minutes"})
    reasons = []
    if result.mode != "live":
        reasons.append("A live evaluation received non-live output.")
    if actual != expected:
        reasons.append("Interpretation differs from the known incident.")
    options = []
    for option in result.options:
        # Recompute against the known incident, not model-supplied checks or interpretation.
        checks = validate(case.request.plan, option.sessions, case.expected)
        failures = failure_details(checks)
        if failures:
            reasons.append("A proposed option failed independent schedule validation.")
        options.append({"id": option.id, "passed": not failures, "checks": [c.model_dump() for c in checks], "timeline": [{"id": s.id, "start": s.start, "duration": s.duration, "roomId": s.roomId, "ownerId": s.ownerId} for s in option.sessions]})
    if case.outcome == "feasible" and not options:
        reasons.append("No feasible option was returned for a known feasible case.")
    if case.outcome == "blocked" and (options or not result.blockers):
        reasons.append("The impossible case did not return a clear blocker without options.")
    return {"verdict": "fail" if reasons else "pass", "reasons": reasons, "actualInterpretation": actual, "options": options, "blockerCount": len(result.blockers), "sourceCount": len(result.sources)}


def redact(value, settings: Settings):
    private_values = [v for v in (settings.nebius_api_key, settings.tavily_api_key, settings.access_token, settings.worker_token) if v]
    if isinstance(value, str):
        for private in private_values:
            value = value.replace(private, "[REDACTED]")
        return re.sub(r"(?i)\bBearer\s+[^\s\"']+", "Bearer [REDACTED]", value)
    if isinstance(value, list):
        return [redact(item, settings) for item in value]
    if isinstance(value, dict):
        return {key: redact(item, settings) for key, item in value.items()}
    return value


async def evaluate(settings: Settings, *, run_live: bool = False, nebius=None, tavily=None, service_factory=RepairService) -> dict:
    if run_live and (settings.mode != "live" or not settings.nebius_api_key.strip()):
        raise ValueError("--run-live requires RIPPLE_MODE=live and a private NEBIUS_API_KEY.")
    if run_live and settings.enable_tavily and not settings.tavily_api_key.strip():
        raise ValueError("Tavily is enabled; configure TAVILY_API_KEY or disable it before evaluating.")
    raw = FIXTURE.read_bytes()
    plan = EventPlan.model_validate_json(raw)
    if failure_details(validate(plan, plan.sessions)):
        raise ValueError("The shared fixture has baseline conflicts. No provider call was made.")
    cases = cases_for(plan)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "execution": "live" if run_live else "dry-run", "liveExecuted": False,
        "scope": "Direct provider evaluation on this machine; not evidence of a Nebius Endpoint or Job deployment.",
        "fixture": {"path": "examples/community-day.json", "sha256": hashlib.sha256(raw).hexdigest()},
        "bounds": {"workflows": MAX_CASES, "modelCallsPerWorkflow": 3 if settings.enable_ultra else 2, "completionTokensPerCall": settings.max_completion_tokens, "searchCallsPerWorkflow": 1 if settings.enable_tavily else 0, "automaticRetries": 0},
        "requestedModels": {"nano": settings.nano_model, "super": settings.super_model, "ultra": settings.ultra_model if settings.enable_ultra else None},
        "cases": [{"id": c.id, "disruption": c.request.disruption, "asOf": c.request.plan.asOf, "expectedInterpretation": c.expected.model_dump(include={"kind", "targetId", "minutes"}), "expectedOutcome": c.outcome, "verdict": "not_run", "modelCalls": [], "searchCalls": []} for c in cases],
    }
    if run_live:
        recorded_nebius = RecordingNebius(nebius or NebiusClient(settings))
        recorded_tavily = RecordingTavily(tavily or TavilyClient(settings))
        service = service_factory(settings, nebius=recorded_nebius, tavily=recorded_tavily)
        stopped = False
        for case, entry in zip(cases, report["cases"]):
            if stopped:
                entry.update(verdict="skipped", reasons=["Stopped after an authentication or credit/rate-limit failure."])
                continue
            recorded_nebius.begin_case()
            recorded_tavily.begin_case()
            start = time.perf_counter()
            try:
                result = await service.repair(case.request.model_copy(deep=True))
                entry.update(assess(case, result))
                if len(recorded_nebius.calls) == recorded_nebius.case_start:
                    entry.update(verdict="fail", reasons=[*entry["reasons"], "No model-call evidence was recorded for this live case."])
            except Exception as exc:
                error = safe_error(exc)
                entry.update(verdict="error", error=error)
                stopped = error["code"] in {"provider_auth", "provider_limit", "not_configured"}
            entry.update(durationMs=round((time.perf_counter() - start) * 1000), modelCalls=recorded_nebius.calls[recorded_nebius.case_start:], searchCalls=recorded_tavily.calls[recorded_tavily.case_start:])
        report["liveExecuted"] = bool(recorded_nebius.calls or recorded_tavily.calls)
    calls = [call for case in report["cases"] for call in case["modelCalls"]]
    search_calls = [call for case in report["cases"] for call in case["searchCalls"]]
    report["summary"] = {
        "verdicts": dict(Counter(case["verdict"] for case in report["cases"])),
        "modelCallsAttempted": len(calls), "searchCallsAttempted": len(search_calls),
        "reportedInputTokens": sum(call["inputTokens"] or 0 for call in calls),
        "reportedOutputTokens": sum(call["outputTokens"] or 0 for call in calls),
        "callsWithUnknownUsage": sum(call["inputTokens"] is None or call["outputTokens"] is None for call in calls),
        "usageNote": "Totals include only reported usage; missing usage and failed requests are not assumed free. This command does not enforce the API's SQLite daily allowance.",
    }
    return redact(report, settings)


def report_destination(output: str | None, execution: str) -> Path:
    destination = Path(output).expanduser().resolve() if output else (ARTIFACTS / f"evaluation-{execution}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(3)}.json").resolve()
    if not destination.is_relative_to(ARTIFACTS.resolve()) or destination.suffix != ".json":
        raise ValueError("Evaluation output must be a .json file inside this repository's artifacts/ directory.")
    if destination.exists():
        raise FileExistsError("Evaluation output already exists.")
    return destination


def write_report(report: dict, output: str | None) -> Path:
    destination = report_destination(output, report["execution"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Never replace earlier evidence, including when a caller names the same file twice.
    with destination.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return destination


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Write a five-case dry evaluation plan. --run-live explicitly permits bounded provider calls that can consume credits.")
    parser.add_argument("--run-live", action="store_true", help="Run up to five real workflows; requires live mode and private keys.")
    parser.add_argument("--output", help="New JSON artifact path under artifacts/; existing files are never overwritten.")
    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        destination = report_destination(args.output, "live" if args.run_live else "dry-run")
        report = asyncio.run(evaluate(settings, run_live=args.run_live))
        destination = write_report(report, str(destination))
    except FileExistsError:
        print("Choose a new artifact filename; existing evidence was not overwritten.", file=sys.stderr)
        return 2
    except ValueError:
        print("Evaluation not run or saved. Check live mode, required keys, fixture validity, and an unused JSON output path under artifacts/.", file=sys.stderr)
        return 2
    print(json.dumps({"artifact": str(destination), "execution": report["execution"], "summary": report["summary"]}, indent=2))
    return 1 if args.run_live and any(c["verdict"] != "pass" for c in report["cases"]) else 0


if __name__ == "__main__":
    sys.exit(main())
