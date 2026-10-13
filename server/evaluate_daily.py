"""Bounded daily-assistance evidence. Default execution makes zero provider calls."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import secrets
import sys
import time
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from .config import Settings
from .daily import (
    BriefOutput,
    CaptureOutput,
    DailyAssistRequest,
    DailyAssistResult,
    DailyAssistService,
    DailyResearchClient,
    check_dependencies,
    validate_brief_sources,
)
from .evaluate import redact
from .providers import NebiusClient, ProviderError

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
MAX_MODEL_CALLS = 5
MAX_COMPLETION_TOKENS = 1200
MAX_PAYLOAD_BYTES = 12000
FIXTURE_DATE = "2026-10-13"


@dataclass(frozen=True)
class Case:
    id: str
    request: DailyAssistRequest
    expectation: str


def cases() -> list[Case]:
    """Public synthetic inputs only; no user workspace or external fixture is read."""
    return [
        Case(
            "capture-explicit",
            DailyAssistRequest(
                action="capture",
                date=FIXTURE_DATE,
                text="Two tasks: Draft the project update, 45 minutes, due tomorrow. Reply to Jordan, 20 minutes. No dependencies.",
            ),
            "Exactly two tasks; project update keeps 45 minutes and 2026-10-14 deadline; Jordan reply keeps 20 minutes; no invented dependencies or other deadline.",
        ),
        Case(
            "capture-estimated",
            DailyAssistRequest(
                action="capture",
                date=FIXTURE_DATE,
                text="Outline a portfolio case study. I have not estimated the duration; suggest an estimate for me to review. No deadline or dependencies.",
            ),
            "One task; a clearly labeled duration estimate; no invented deadline or dependencies.",
        ),
        Case(
            "capture-dependencies",
            DailyAssistRequest(
                action="capture",
                date=FIXTURE_DATE,
                text='Three tasks: "Outline the article" takes 20 minutes. "Write the article" takes 45 minutes and must follow the outline. "Review the article" takes 15 minutes and must follow writing. No deadlines.',
            ),
            "Exactly three tasks with 20/45/15 minutes; outline before writing before review; no invented deadline.",
        ),
        Case(
            "task-breakdown",
            DailyAssistRequest(
                action="breakdown",
                date=FIXTURE_DATE,
                task={
                    "title": "Prepare a five-slide client project update",
                    "minutes": 45,
                    "notes": "Audience: a small design team. Use an existing outline and end with one decision.",
                },
            ),
            "Three to six distinct task-relevant starting steps; no task insertion, web search or external citations.",
        ),
        Case(
            "task-research",
            DailyAssistRequest(
                action="research",
                date=FIXTURE_DATE,
                task={
                    "title": "Find official guidance for keyboard-accessible web forms",
                    "minutes": 30,
                    "notes": "Prepare a short implementation checklist from primary web accessibility sources.",
                },
                useWeb=True,
            ),
            "One basic search and at most one model call; three to six steps, retrieved sources and citations that match those exact sources.",
        ),
    ]


def safe_error(exc: BaseException) -> dict:
    code = exc.code if isinstance(exc, ProviderError) else "unexpected_error"
    if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,50}", code):
        code = "provider_error"
    messages = {
        "provider_auth": "Provider authentication or model access failed.",
        "provider_limit": "Provider credit or rate limit reached; later cases were skipped.",
        "provider_request": "Provider rejected the bounded request; inspect model and schema support.",
        "provider_timeout": "Provider timed out. No automatic retry was made.",
        "provider_unavailable": "Provider could not be reached. No local result was substituted.",
        "not_configured": "A required private provider credential is missing.",
        "invalid_output": "Provider output failed the required schema.",
        "incomplete_output": "Provider output was incomplete within the configured token cap.",
        "ungrounded_output": "The proposed brief failed retrieved-source checks.",
        "search_failed": "The optional search failed; no sourced result was substituted.",
        "evaluation_budget": "The evaluation blocked an extra call or oversized request.",
    }
    return {
        "code": code,
        "message": messages.get(
            code,
            "The case could not complete; private exception details were withheld.",
        ),
    }


class RecordingModel:
    def __init__(self, delegate, settings: Settings):
        self.delegate, self.settings = delegate, settings
        self.calls: list[dict] = []
        self.case_start = 0
        self.expected_model = ""

    def begin_case(self, case: Case):
        self.case_start = len(self.calls)
        self.expected_model = (
            self.settings.nano_model
            if case.request.action == "capture"
            else self.settings.super_model
        )

    async def structured(self, **kwargs):
        if len(self.calls) >= MAX_MODEL_CALLS or len(self.calls) - self.case_start >= 1:
            raise ProviderError("evaluation_budget", "Model call limit reached.")
        if kwargs.get("model") != self.expected_model or kwargs.get("output") not in {
            CaptureOutput,
            BriefOutput,
        }:
            raise ProviderError(
                "evaluation_budget", "Unexpected model or output schema."
            )
        if (
            len(
                json.dumps(kwargs.get("payload", {}), ensure_ascii=False).encode(
                    "utf-8"
                )
            )
            > MAX_PAYLOAD_BYTES
            or len(kwargs.get("system", "")) > 3000
        ):
            raise ProviderError(
                "evaluation_budget", "Model input exceeds the evaluation bound."
            )
        record = {
            "provider": "Nebius Token Factory",
            "requestedModel": kwargs["model"],
            "returnedModel": None,
            "status": "error",
            "inputTokens": None,
            "outputTokens": None,
        }
        self.calls.append(record)
        start = time.perf_counter()
        try:
            output, trace = await self.delegate.structured(**kwargs)
            record.update(
                status="complete",
                returnedModel=(
                    None
                    if "Provider omitted model identity" in trace.detail
                    else trace.model
                ),
                inputTokens=trace.inputTokens,
                outputTokens=trace.outputTokens,
                trace=trace.model_dump(exclude_none=True),
            )
            return output, trace
        except asyncio.CancelledError:
            record["status"] = "interrupted"
            raise
        except Exception as exc:
            record["error"] = safe_error(exc)
            raise
        finally:
            record["durationMs"] = round((time.perf_counter() - start) * 1000)


class RecordingSearch:
    def __init__(self, delegate):
        self.delegate = delegate
        self.calls: list[dict] = []
        self.allowed = False
        self.case_start = 0

    def begin_case(self, case: Case):
        self.case_start = len(self.calls)
        self.allowed = case.request.action == "research" and case.request.useWeb

    async def search(self, query: str):
        if not self.allowed or self.calls or len(query) > 500:
            raise ProviderError(
                "evaluation_budget", "Search exceeds the evaluation bound."
            )
        record = {
            "provider": "Tavily",
            "operation": "basic search",
            "query": query,
            "status": "error",
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
        }
        self.calls.append(record)
        start = time.perf_counter()
        try:
            sources = await self.delegate.search(query)
            record.update(
                status="complete",
                sources=[source.model_dump() for source in sources],
                sourceCount=len(sources),
            )
            return sources
        except asyncio.CancelledError:
            record["status"] = "interrupted"
            raise
        except Exception as exc:
            record["error"] = safe_error(exc)
            raise
        finally:
            record["durationMs"] = round((time.perf_counter() - start) * 1000)


def assess(case: Case, result: DailyAssistResult, search_calls: list[dict]) -> dict:
    """Check contracts, fixture facts and lexical scope, never claimed trace success."""
    checks: list[dict] = []

    def check(name: str, passed: bool, detail: str):
        checks.append({"id": name, "passed": bool(passed), "detail": detail})

    try:
        result = DailyAssistResult.model_validate(result.model_dump())
    except (ValidationError, ValueError, AttributeError):
        return {
            "verdict": "fail",
            "checks": [
                {
                    "id": "schema",
                    "passed": False,
                    "detail": "The response does not match the daily result contract.",
                }
            ],
        }
    check(
        "live-mode",
        result.mode == "live",
        "The result must identify itself as live assistance.",
    )
    if case.request.action == "capture":
        check(
            "capture-shape",
            bool(result.tasks) and not result.steps and not result.sources,
            "Capture contains task drafts only, with no steps or invented research sources.",
        )
        try:
            check_dependencies(result.tasks)
            dependencies_valid = True
        except ValueError:
            dependencies_valid = False
        check(
            "dependencies-valid",
            dependencies_valid,
            "Dependency indices must reference other tasks without duplicates or cycles.",
        )

        def find(*words):
            matching = [
                task
                for task in result.tasks
                if all(word in task.title.casefold() for word in words)
            ]
            return matching[0] if len(matching) == 1 else None

        if case.id == "capture-explicit":
            update, reply = find("project", "update"), find("jordan")
            check(
                "preserved-estimates",
                len(result.tasks) == 2
                and update is not None
                and reply is not None
                and update.minutes == 45
                and reply.minutes == 20,
                "The update and Jordan reply retain their explicit 45- and 20-minute estimates.",
            )
            check(
                "relative-date",
                update is not None
                and update.dueDate == "2026-10-14"
                and reply is not None
                and reply.dueDate is None,
                "Tomorrow is resolved against the fixture date; the other task gets no deadline.",
            )
            check(
                "no-invented-dependencies",
                all(not task.dependsOnIndices for task in result.tasks),
                "Neither task was given a prerequisite.",
            )
        elif case.id == "capture-estimated":
            task = result.tasks[0] if len(result.tasks) == 1 else None
            # The service appends source text for human review. It cannot serve as
            # evidence that the model extracted the right task or context.
            extracted_notes = (
                re.split(
                    r"(?m)^Original capture \((?:full text;|excerpt:)[^\r\n]*\):[ \t]*$",
                    task.notes,
                    maxsplit=1,
                )[0]
                if task
                else ""
            )
            task_text = " ".join(
                re.findall(
                    r"[a-z0-9]+",
                    f"{task.title} {extracted_notes}".casefold() if task else "",
                )
            )
            check(
                "estimated-task-scope",
                bool(
                    re.search(r"\bportfolios?\b|\bcase stud(?:y|ies)\b", task_text)
                ),
                "The task title or extracted notes retain portfolio/case-study context, excluding the copied Original capture reference. This lexical scope check does not prove semantic faithfulness.",
            )
            check(
                "reviewable-estimate",
                task is not None and "Duration estimate:" in extracted_notes,
                "The single missing duration must be visibly labeled as an estimate.",
            )
            check(
                "no-invented-constraints",
                task is not None and task.dueDate is None and not task.dependsOnIndices,
                "No deadline or dependency was supplied.",
            )
        elif case.id == "capture-dependencies":
            outline, writing, review = find("outline"), find("write"), find("review")
            present = len(result.tasks) == 3 and all(
                task is not None for task in (outline, writing, review)
            )
            check(
                "preserved-estimates",
                present
                and [outline.minutes, writing.minutes, review.minutes] == [20, 45, 15],
                "The three named tasks retain their 20/45/15-minute estimates.",
            )
            chain = (
                present
                and not outline.dependsOnIndices
                and writing.dependsOnIndices == [result.tasks.index(outline)]
                and review.dependsOnIndices == [result.tasks.index(writing)]
            )
            check(
                "explicit-chain",
                chain,
                "The writing depends on the outline and the review depends on writing, regardless of response order.",
            )
            check(
                "no-invented-deadlines",
                all(task.dueDate is None for task in result.tasks),
                "No dates were supplied for this dependency chain.",
            )
    else:
        check(
            "brief-shape",
            not result.tasks and 3 <= len(result.steps) <= 6,
            "A brief contains three to six steps and does not insert tasks.",
        )
        check(
            "distinct-steps",
            len({step.title.strip().casefold() for step in result.steps})
            == len(result.steps),
            "Step titles are distinct.",
        )
        try:
            validate_brief_sources(
                BriefOutput(summary=result.summary, steps=result.steps), result.sources
            )
            sources_valid = True
        except (ProviderError, ValidationError):
            sources_valid = False
        check(
            "source-links",
            sources_valid,
            "Every cited URL belongs to the returned source set; no hidden unverified prose links.",
        )
        if case.request.action == "research":
            step_text = " ".join(
                re.findall(
                    r"[a-z0-9]+",
                    " ".join(
                        step.title + " " + step.detail for step in result.steps
                    ).casefold(),
                )
            )
            words = set(step_text.split())
            form_context = bool(
                words
                & {
                    "form", "forms", "input", "inputs", "field", "fields",
                    "control", "controls", "label", "labels", "button",
                    "buttons", "textbox", "textboxes", "checkbox", "checkboxes",
                }
            )
            access_context = bool(
                words
                & {
                    "keyboard", "keyboards", "keystroke", "keystrokes",
                    "tab", "tabbing", "tabindex", "accessible", "accessibility",
                    "a11y", "wcag", "aria", "assistive", "screenreader",
                }
                or re.search(
                    r"\bscreen readers?\b|\bfocus (?:order|indicators?|rings?|visibility)\b|\bvisible focus\b",
                    step_text,
                )
            )
            check(
                "research-task-scope",
                form_context and access_context,
                "The steps themselves retain form-control and keyboard/accessibility context. Summary text and source titles do not satisfy this lexical check; factual support still requires review.",
            )
            retrieved = [
                source
                for call in search_calls
                if call.get("status") == "complete"
                for source in call.get("sources", [])
            ]
            check(
                "retrieved-evidence",
                bool(result.sources)
                and len(search_calls) == 1
                and all(source.model_dump() in retrieved for source in result.sources),
                "Response sources must match the evidence actually returned by the one recorded search.",
            )
        else:
            prose = " ".join(
                step.title + " " + step.detail for step in result.steps
            ).casefold()
            check(
                "task-relevance",
                any(
                    word in prose for word in ("slide", "outline", "client", "decision")
                ),
                "At least one step refers to the task context; this is a narrow relevance check, not a quality score.",
            )
            check(
                "no-search",
                not search_calls
                and not result.sources
                and all(not step.sourceUrls for step in result.steps),
                "The breakdown case did not request research.",
            )
    return {
        "verdict": "pass" if all(item["passed"] for item in checks) else "fail",
        "checks": checks,
        "manualReview": "An automated pass covers contract, fixture and narrow lexical scope checks only. Review semantic faithfulness, usefulness, factual support and estimate realism separately; this is not a user-quality study.",
    }


def summarize(report: dict) -> None:
    model_calls = [call for case in report["cases"] for call in case["modelCalls"]]
    search_calls = [call for case in report["cases"] for call in case["searchCalls"]]
    report["liveExecuted"] = bool(model_calls or search_calls)
    report["summary"] = {
        "verdicts": dict(Counter(case["verdict"] for case in report["cases"])),
        "modelCallsAttempted": len(model_calls),
        "searchCallsAttempted": len(search_calls),
        "reportedInputTokens": sum(
            call.get("inputTokens") or 0 for call in model_calls
        ),
        "reportedOutputTokens": sum(
            call.get("outputTokens") or 0 for call in model_calls
        ),
        "callsWithUnknownUsage": sum(
            call.get("inputTokens") is None or call.get("outputTokens") is None
            for call in model_calls
        ),
        "usageNote": "Only provider-reported usage is summed. Missing usage and failed calls are not assumed free. No currency cost is estimated. Direct evaluation does not consume the API's SQLite allowance.",
        "assessmentNote": "Pass means the automated contract, fixture and lexical scope checks passed. It does not establish semantic faithfulness, usefulness, factual support or realistic estimates; review the saved outputs separately.",
    }


async def evaluate(
    settings: Settings,
    *,
    live: bool = False,
    confirm_paid_api_calls: bool = False,
    include_research: bool = False,
    case_id: str | None = None,
    nebius=None,
    research=None,
    service_factory=DailyAssistService,
    on_update=None,
) -> dict:
    if live != confirm_paid_api_calls:
        raise ValueError(
            "Use both --live and --confirm-paid-api-calls for paid execution, or neither for a dry run."
        )
    if live and (settings.mode != "live" or not settings.nebius_api_key.strip()):
        raise ValueError(
            "Live evaluation requires RIPPLE_MODE=live and a private NEBIUS_API_KEY."
        )
    bounded = replace(
        settings,
        max_completion_tokens=min(
            settings.max_completion_tokens, MAX_COMPLETION_TOKENS
        ),
        enable_ultra=False,
    )
    definitions = cases()
    if len(definitions) != MAX_MODEL_CALLS or any(
        len(case.request.model_dump_json()) > 2000 or len(case.request.text) > 1200
        for case in definitions
    ):
        raise ValueError("Evaluation fixtures exceed the fixed size or case bounds.")
    if case_id is not None:
        definitions = [case for case in definitions if case.id == case_id]
        if not definitions:
            raise ValueError("Select an existing daily evaluation case.")
    research_enabled = (
        include_research
        and settings.enable_tavily
        and bool(settings.tavily_api_key.strip())
        and any(case.request.action == "research" for case in definitions)
    )
    requests = [case.request.model_dump(exclude_none=True) for case in definitions]
    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "execution": "live" if live else "dry-run",
        "state": "running" if live else "complete",
        "liveExecuted": False,
        "selectedCase": case_id or "all",
        "scope": "Direct daily-assistance service evaluation using public synthetic fixtures; not proof of browser use, an HTTP API deployment or Nebius Cloud execution.",
        "fixture": {
            "name": "daily-synthetic-v1",
            "planningDate": FIXTURE_DATE,
            "sha256": hashlib.sha256(
                json.dumps(requests, sort_keys=True).encode()
            ).hexdigest(),
        },
        "bounds": {
            "modelCallsTotal": sum(
                case.request.action != "research" or research_enabled
                for case in definitions
            ),
            "modelCallsPerCase": 1,
            "completionTokensPerCall": bounded.max_completion_tokens,
            "modelPayloadBytes": MAX_PAYLOAD_BYTES,
            "searchCallsTotal": 1 if research_enabled else 0,
            "automaticRetries": 0,
            "concurrency": 1,
        },
        "requestedModels": {"nano": settings.nano_model, "super": settings.super_model},
        "cases": [
            {
                "id": case.id,
                "request": request,
                "expectation": case.expectation,
                "verdict": "not_run",
                "output": None,
                "modelCalls": [],
                "searchCalls": [],
            }
            for case, request in zip(definitions, requests)
        ],
    }
    if not research_enabled:
        for entry in report["cases"]:
            if entry["id"] == "task-research":
                entry.update(
                    verdict="skipped",
                    reasons=[
                        (
                            "Optional research not selected."
                            if not include_research
                            else "Tavily is disabled or its private key is missing; no search or model call was made for this case."
                        )
                    ],
                )

    def checkpoint():
        summarize(report)
        if on_update:
            on_update(redact(report, settings))

    checkpoint()
    if not live:
        return redact(report, settings)
    model = RecordingModel(nebius or NebiusClient(bounded), bounded)
    search = RecordingSearch(research or DailyResearchClient(bounded))
    service = service_factory(bounded, nebius=model, research=search)
    stop = False
    for case, entry in zip(definitions, report["cases"]):
        if entry["verdict"] == "skipped":
            continue
        if stop:
            entry.update(
                verdict="skipped",
                reasons=[
                    "Stopped after a provider authentication, request, allowance or evaluation-budget failure."
                ],
            )
            checkpoint()
            continue
        model.begin_case(case)
        search.begin_case(case)
        start = time.perf_counter()
        try:
            result = await service.assist(case.request.model_copy(deep=True))
            entry["output"] = result.model_dump(exclude_none=True)
            entry.update(assess(case, result, search.calls[search.case_start :]))
            if len(model.calls) - model.case_start != 1:
                entry["verdict"] = "fail"
                entry.setdefault("checks", []).append(
                    {
                        "id": "model-evidence",
                        "passed": False,
                        "detail": "This case did not record exactly one model call.",
                    }
                )
        except asyncio.CancelledError:
            report["state"] = "interrupted"
            entry.update(
                verdict="interrupted",
                error={
                    "code": "interrupted",
                    "message": "Execution was interrupted; no retry was started. Usage may be unknown.",
                },
            )
            raise
        except Exception as exc:
            error = safe_error(exc)
            entry.update(verdict="error", error=error)
            stop = error["code"] in {
                "provider_auth",
                "provider_limit",
                "provider_request",
                "not_configured",
                "evaluation_budget",
            }
        finally:
            entry.update(
                durationMs=round((time.perf_counter() - start) * 1000),
                modelCalls=model.calls[model.case_start :],
                searchCalls=search.calls[search.case_start :],
            )
            checkpoint()
    report["state"] = "complete"
    checkpoint()
    return redact(report, settings)


def report_destination(output: str | None, execution: str) -> Path:
    now = datetime.now(timezone.utc)
    destination = (
        Path(output).expanduser().resolve()
        if output
        else (
            ARTIFACTS
            / now.strftime("%Y-%m-%d")
            / f"daily-{execution}-{now.strftime('%H%M%S')}-{secrets.token_hex(3)}.json"
        ).resolve()
    )
    if (
        not destination.is_relative_to(ARTIFACTS.resolve())
        or destination.suffix != ".json"
    ):
        raise ValueError(
            "Use a JSON output path inside this repository's artifacts/ directory."
        )
    if destination.exists():
        raise FileExistsError("Existing evidence is never overwritten.")
    return destination


class ReportWriter:
    """Own one new private artifact, then replace only that run's checkpoints."""

    def __init__(self, destination: Path):
        self.destination = report_destination(str(destination), "dry-run")
        self.created = False

    def __call__(self, report: dict):
        self.destination.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
        if not self.created:
            descriptor = os.open(
                self.destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(content)
            self.created = True
            return
        temporary = self.destination.with_name(
            f".{self.destination.name}.{secrets.token_hex(4)}.tmp"
        )
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(content)
            os.replace(temporary, self.destination)
        finally:
            temporary.unlink(missing_ok=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Prepare daily-assistance evidence without provider calls. Both paid flags are required for bounded real execution."
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Request real provider execution; also requires --confirm-paid-api-calls.",
    )
    parser.add_argument(
        "--confirm-paid-api-calls",
        action="store_true",
        help="Acknowledge that this run can consume provider credits.",
    )
    parser.add_argument(
        "--research",
        action="store_true",
        help="Include the optional fifth case if Tavily is enabled and configured.",
    )
    parser.add_argument(
        "--case",
        choices=[case.id for case in cases()],
        help="Run or prepare just this case; useful for the first paid smoke check.",
    )
    parser.add_argument(
        "--output",
        help="New JSON path under artifacts/; defaults to a dated, unique file.",
    )
    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        destination = report_destination(
            args.output, "live" if args.live else "dry-run"
        )
        writer = ReportWriter(destination)
        report = asyncio.run(
            evaluate(
                settings,
                live=args.live,
                confirm_paid_api_calls=args.confirm_paid_api_calls,
                include_research=args.research,
                case_id=args.case,
                on_update=writer,
            )
        )
    except KeyboardInterrupt:
        print(
            "Evaluation interrupted. Any completed checkpoints remain in the private artifact; no retry was started.",
            file=sys.stderr,
        )
        return 130
    except (ValueError, FileExistsError, OSError):
        print(
            "Evaluation could not run or save. Check both paid flags, live mode, private credentials and a new writable JSON path under artifacts/. No private error details were printed.",
            file=sys.stderr,
        )
        return 2
    print(
        json.dumps(
            {
                "artifact": str(destination),
                "execution": report["execution"],
                "summary": report["summary"],
            },
            indent=2,
        )
    )
    return (
        1
        if args.live
        and any(
            case["verdict"] in {"fail", "error", "interrupted"}
            for case in report["cases"]
        )
        else 0
    )


if __name__ == "__main__":
    sys.exit(main())
