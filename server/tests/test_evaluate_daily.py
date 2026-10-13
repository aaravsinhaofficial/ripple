"""No paid API calls: exercise the daily harness with synthetic provider responses."""

import asyncio
import json
import stat
from dataclasses import replace

import pytest

from server.config import Settings
from server.daily import BriefOutput, CaptureOutput, DailyAssistService, DailyStep
from server.evaluate_daily import (
    RecordingModel,
    RecordingSearch,
    ReportWriter,
    assess,
    cases,
    evaluate,
    main,
    report_destination,
)
from server.models import Source, TraceStep
from server.providers import ProviderError


def live_settings(**changes):
    return replace(
        Settings(mode="live", nebius_api_key="private-nebius-key"), **changes
    )


def draft(title, minutes, **changes):
    return {
        "title": title,
        "minutes": minutes,
        "priority": "normal",
        "project": "",
        "notes": "",
        "dueDate": None,
        "dependsOnIndices": [],
        "durationSource": "explicit",
    } | changes


class MockModel:
    def __init__(self):
        self.calls = []

    async def structured(self, **kwargs):
        self.calls.append(kwargs)
        text = kwargs["payload"].get("text", "")
        if kwargs["output"] is CaptureOutput:
            if text.startswith("Two tasks"):
                tasks = [
                    draft("Draft the project update", 45, dueDate="2026-10-14"),
                    draft("Reply to Jordan", 20),
                ]
            elif text.startswith("Three tasks"):
                tasks = [
                    draft("Outline the article", 20),
                    draft("Write the article", 45, dependsOnIndices=[0]),
                    draft("Review the article", 15, dependsOnIndices=[1]),
                ]
            else:
                tasks = [
                    draft(
                        "Outline a portfolio case study", 30, durationSource="estimate"
                    )
                ]
            body = {
                "summary": "Review the task drafts before adding them.",
                "tasks": tasks,
            }
        else:
            sources = kwargs["payload"].get("sources", [])
            body = {
                "summary": "A proposed starting brief for review.",
                "steps": [
                    {
                        "title": "Open the outline",
                        "detail": "Check the outline and the client decision you need to explain.",
                        "sourceUrls": [sources[0]["url"]] if sources else [],
                    },
                    {
                        "title": "Prepare the first draft",
                        "detail": "Make a short draft with the information available.",
                        "sourceUrls": [],
                    },
                    {
                        "title": "Review the result",
                        "detail": "Check it against the intended outcome and record what remains.",
                        "sourceUrls": [],
                    },
                ],
            }
            if sources:
                body["steps"] = [
                    {
                        "title": "Check keyboard navigation",
                        "detail": "Tab through each form field and control; check that focus follows the reading order.",
                        "sourceUrls": [sources[0]["url"]],
                    },
                    {
                        "title": "Connect visible labels",
                        "detail": "Associate each visible label with its input so the control has a clear name.",
                        "sourceUrls": [],
                    },
                    {
                        "title": "Exercise validation errors",
                        "detail": "Submit invalid form data with the keyboard and check that each error is identified.",
                        "sourceUrls": [],
                    },
                ]
        return kwargs["output"].model_validate(body), TraceStep(
            id="mock",
            label=kwargs["label"],
            detail="Mock provider response for automated tests only.",
            status="complete",
            model="actual-returned-model",
            provider="Mock transport",
            inputTokens=100,
            outputTokens=50,
        )


class MockSearch:
    def __init__(self):
        self.calls = []

    async def search(self, query):
        self.calls.append(query)
        return [
            Source(
                title="Synthetic official guide",
                url="https://example.org/keyboard",
                snippet="Test evidence for keyboard operation; not a real research result.",
            )
        ]


def test_default_dry_run_never_constructs_services_even_with_real_mode_and_keys():
    def forbidden(*args, **kwargs):
        pytest.fail("Dry run must not construct a service")

    report = asyncio.run(evaluate(live_settings(), service_factory=forbidden))
    assert report["execution"] == "dry-run" and not report["liveExecuted"]
    assert report["summary"]["modelCallsAttempted"] == 0
    assert report["summary"]["searchCallsAttempted"] == 0
    assert report["summary"]["verdicts"] == {"not_run": 4, "skipped": 1}
    assert all(case["request"]["date"] == "2026-10-13" for case in report["cases"])
    assert "private-nebius-key" not in json.dumps(report)


@pytest.mark.parametrize("live,confirm", [(True, False), (False, True)])
def test_both_paid_flags_are_required_before_constructing_service(live, confirm):
    with pytest.raises(ValueError, match="both"):
        asyncio.run(
            evaluate(
                live_settings(),
                live=live,
                confirm_paid_api_calls=confirm,
                service_factory=lambda *a, **k: pytest.fail(
                    "Must not construct service"
                ),
            )
        )


@pytest.mark.parametrize(
    "settings",
    [
        Settings(),
        Settings(mode="live"),
        Settings(mode="demo", nebius_api_key="private-key"),
    ],
)
def test_live_requires_private_key_and_live_configuration(settings):
    with pytest.raises(ValueError):
        asyncio.run(evaluate(settings, live=True, confirm_paid_api_calls=True))


def test_all_five_cases_use_one_model_each_and_record_actual_trace_usage_and_retrieval():
    model, search = MockModel(), MockSearch()
    config = live_settings(
        enable_tavily=True,
        tavily_api_key="private-search-key",
        max_completion_tokens=4096,
        enable_ultra=True,
    )
    observed_settings = []

    def factory(settings, **kwargs):
        observed_settings.append(settings)
        return DailyAssistService(settings, **kwargs)

    report = asyncio.run(
        evaluate(
            config,
            live=True,
            confirm_paid_api_calls=True,
            include_research=True,
            nebius=model,
            research=search,
            service_factory=factory,
        )
    )
    assert report["summary"]["verdicts"] == {"pass": 5}
    assert len(model.calls) == report["summary"]["modelCallsAttempted"] == 5
    assert len(search.calls) == report["summary"]["searchCallsAttempted"] == 1
    assert report["summary"]["reportedInputTokens"] == 500
    assert report["summary"]["reportedOutputTokens"] == 250
    assert report["summary"]["callsWithUnknownUsage"] == 0
    assert (
        observed_settings[0].max_completion_tokens == 1200
        and not observed_settings[0].enable_ultra
    )
    assert [call["model"] for call in model.calls] == [config.nano_model] * 3 + [
        config.super_model
    ] * 2
    assert all(
        entry["output"]["mode"] == "live" and entry["durationMs"] >= 0
        for entry in report["cases"]
    )
    assert all(
        entry["modelCalls"][0]["returnedModel"] == "actual-returned-model"
        for entry in report["cases"]
    )
    assert report["cases"][-1]["searchCalls"][0]["retrievedAt"]
    assert (
        report["cases"][-1]["searchCalls"][0]["sources"]
        == report["cases"][-1]["output"]["sources"]
    )
    assert "private-nebius-key" not in json.dumps(
        report
    ) and "private-search-key" not in json.dumps(report)


@pytest.mark.parametrize(
    "enabled,key", [(False, "configured-but-disabled"), (True, "")]
)
def test_missing_or_disabled_tavily_skips_research_without_failing_four_core_cases(
    enabled, key
):
    search, model = MockSearch(), MockModel()
    report = asyncio.run(
        evaluate(
            live_settings(enable_tavily=enabled, tavily_api_key=key),
            live=True,
            confirm_paid_api_calls=True,
            include_research=True,
            nebius=model,
            research=search,
        )
    )
    assert report["summary"]["verdicts"] == {"pass": 4, "skipped": 1}
    assert not search.calls and len(model.calls) == 4
    assert report["bounds"]["modelCallsTotal"] == 4


@pytest.mark.parametrize(
    "code", ["provider_auth", "provider_limit", "provider_request"]
)
def test_provider_auth_credit_or_request_failure_stops_later_paid_cases_and_hides_error_text(
    code,
):
    class FailingModel:
        calls = 0

        async def structured(self, **kwargs):
            self.calls += 1
            raise ProviderError(code, "private-nebius-key Bearer unknown-secret-token")

    model = FailingModel()
    report = asyncio.run(
        evaluate(live_settings(), live=True, confirm_paid_api_calls=True, nebius=model)
    )
    assert model.calls == 1 and report["summary"]["verdicts"] == {
        "error": 1,
        "skipped": 4,
    }
    assert report["summary"]["callsWithUnknownUsage"] == 1
    assert "private-nebius-key" not in json.dumps(
        report
    ) and "unknown-secret-token" not in json.dumps(report)


def test_assessment_checks_fixture_facts_independently_of_claimed_trace():
    definition = cases()[0]
    result = asyncio.run(
        DailyAssistService(live_settings(), MockModel()).assist(definition.request)
    )
    assert assess(definition, result, [])["verdict"] == "pass"
    result.tasks[0].minutes = 1
    result.tasks[0].dueDate = "2026-10-15"
    result.trace[-1].detail = "Everything passed perfectly"
    assessment = assess(definition, result, [])
    failed = {check["id"] for check in assessment["checks"] if not check["passed"]}
    assert (
        assessment["verdict"] == "fail"
        and {"preserved-estimates", "relative-date"} <= failed
    )


@pytest.mark.parametrize(
    "title", ["Water a houseplant", "Study biology", "File a court case"]
)
def test_estimated_capture_rejects_unrelated_work_even_with_an_on_topic_summary(title):
    definition = cases()[1]
    result = asyncio.run(
        DailyAssistService(live_settings(), MockModel()).assist(definition.request)
    )
    result.tasks[0].title = title
    result.summary = "Review the portfolio case-study task."
    assert "Original capture (full text;" in result.tasks[0].notes
    assessment = assess(definition, result, [])
    assert assessment["verdict"] == "fail"
    assert {check["id"] for check in assessment["checks"] if not check["passed"]} == {
        "estimated-task-scope"
    }


def test_estimated_capture_cannot_pass_using_topic_words_in_a_preserved_excerpt():
    definition = cases()[1]
    definition = replace(
        definition,
        request=definition.request.model_copy(
            update={
                "text": definition.request.text + " More reference context." * 80
            }
        ),
    )
    result = asyncio.run(
        DailyAssistService(live_settings(), MockModel()).assist(definition.request)
    )
    result.tasks[0].title = "Water a houseplant"
    assert "Original capture (excerpt:" in result.tasks[0].notes
    assert "portfolio case study" in result.tasks[0].notes
    assessment = assess(definition, result, [])
    assert assessment["verdict"] == "fail"
    assert {check["id"] for check in assessment["checks"] if not check["passed"]} == {
        "estimated-task-scope"
    }


@pytest.mark.parametrize(
    "title,context",
    [
        ("Sketch the portfolio outline", ""),
        ("Structure the CASE–STUDY", ""),
        ("Outline the project story", "This is a case study for my portfolio."),
        ("Outline two case studies", ""),
    ],
)
def test_estimated_capture_allows_context_in_notes_and_natural_title_variations(
    title, context
):
    definition = cases()[1]
    result = asyncio.run(
        DailyAssistService(live_settings(), MockModel()).assist(definition.request)
    )
    result.tasks[0].title = title
    if context:
        result.tasks[0].notes = context + "\n\n" + result.tasks[0].notes
    assessment = assess(definition, result, [])
    assert assessment["verdict"] == "pass"
    assert "does not prove semantic faithfulness" in next(
        check["detail"]
        for check in assessment["checks"]
        if check["id"] == "estimated-task-scope"
    )


def research_assessment_fixture():
    definition = cases()[-1]
    result = asyncio.run(
        DailyAssistService(
            live_settings(enable_tavily=True, tavily_api_key="private-search-key"),
            MockModel(),
            MockSearch(),
        ).assist(definition.request)
    )
    recorded = [{"status": "complete", "sources": [s.model_dump() for s in result.sources]}]
    return definition, result, recorded


def test_research_rejects_unrelated_steps_despite_a_valid_citation_and_on_topic_summary():
    definition, result, recorded = research_assessment_fixture()
    result.summary = "Official guidance for keyboard-accessible web forms."
    result.steps = [
        DailyStep(
            title="Focus on watering plants",
            detail="Pour water into the soil.",
            sourceUrls=[result.sources[0].url],
        ),
        DailyStep(title="Control the room temperature", detail="Open a window.", sourceUrls=[]),
        DailyStep(title="Label the pots", detail="Write a name on each pot.", sourceUrls=[]),
    ]
    assessment = assess(definition, result, recorded)
    assert assessment["verdict"] == "fail"
    assert {check["id"] for check in assessment["checks"] if not check["passed"]} == {
        "research-task-scope"
    }


@pytest.mark.parametrize(
    "title,detail",
    [
        ("Walk through every field", "Use Tab and Shift+Tab, then activate buttons without a mouse."),
        ("Audit accessible labels", "Check each form input has a clear programmatic name."),
        ("Inspect visible focus", "Every native control needs an indicator that can be seen while navigating."),
        ("Check names with a screen reader", "Each textbox and checkbox should expose its visible label."),
    ],
)
def test_research_scope_accepts_concrete_accessibility_phrasing(title, detail):
    definition, result, recorded = research_assessment_fixture()
    result.steps = [
        DailyStep(title=title, detail=detail, sourceUrls=[result.sources[0].url]),
        DailyStep(title="Record an issue", detail="Write down an observed problem.", sourceUrls=[]),
        DailyStep(title="Retest the change", detail="Repeat the check after updating the implementation.", sourceUrls=[]),
    ]
    assert assess(definition, result, recorded)["verdict"] == "pass"


def test_summary_does_not_present_automated_pass_as_semantic_or_quality_proof():
    report = asyncio.run(
        evaluate(live_settings(), live=True, confirm_paid_api_calls=True, nebius=MockModel())
    )
    assert report["summary"]["verdicts"] == {"pass": 4, "skipped": 1}
    assert "does not establish semantic faithfulness" in report["summary"]["assessmentNote"]
    assert all(
        "narrow lexical scope checks only" in case["manualReview"]
        for case in report["cases"]
        if case["verdict"] == "pass"
    )


def test_recorders_block_additional_calls_before_delegate_and_limit_total_calls():
    async def run():
        delegate = MockModel()
        recorder = RecordingModel(delegate, live_settings())
        arguments = {
            "model": live_settings().nano_model,
            "output": CaptureOutput,
            "system": "Small test instruction",
            "payload": {"text": "Two tasks"},
            "label": "Test",
        }
        for _ in range(5):
            recorder.begin_case(cases()[0])
            await recorder.structured(**arguments)
        recorder.begin_case(cases()[0])
        with pytest.raises(ProviderError, match="limit"):
            await recorder.structured(**arguments)
        assert len(delegate.calls) == 5
        second = RecordingModel(MockModel(), live_settings())
        second.begin_case(cases()[0])
        await second.structured(**arguments)
        with pytest.raises(ProviderError, match="limit"):
            await second.structured(**arguments)
        search = RecordingSearch(MockSearch())
        search.begin_case(cases()[-1])
        await search.search("Public query")
        with pytest.raises(ProviderError, match="bound"):
            await search.search("Second query")

    asyncio.run(run())


def test_oversized_payload_and_unrequested_model_are_blocked_without_provider_use():
    async def run():
        delegate = MockModel()
        recorder = RecordingModel(delegate, live_settings())
        recorder.begin_case(cases()[0])
        kwargs = {
            "model": live_settings().nano_model,
            "output": CaptureOutput,
            "system": "Small instruction",
            "payload": {"text": "x" * 13000},
            "label": "Test",
        }
        with pytest.raises(ProviderError, match="bound"):
            await recorder.structured(**kwargs)
        kwargs.update(model="unrequested-expensive-model", payload={})
        with pytest.raises(ProviderError, match="Unexpected"):
            await recorder.structured(**kwargs)
        assert not delegate.calls

    asyncio.run(run())


def test_checkpoints_redact_results_and_preserve_progress_on_interruption():
    snapshots = []

    class InterruptedModel(MockModel):
        async def structured(self, **kwargs):
            if len(self.calls) == 1:
                raise asyncio.CancelledError()
            output, trace = await super().structured(**kwargs)
            output.tasks[0].notes = "private-nebius-key Bearer unexpected-secret-token"
            return output, trace

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            evaluate(
                live_settings(),
                live=True,
                confirm_paid_api_calls=True,
                nebius=InterruptedModel(),
                on_update=lambda report: snapshots.append(
                    json.loads(json.dumps(report))
                ),
            )
        )
    last = snapshots[-1]
    assert last["state"] == "interrupted" and last["cases"][0]["verdict"] == "pass"
    assert last["cases"][1]["verdict"] == "interrupted"
    assert last["summary"]["modelCallsAttempted"] == 2
    assert "private-nebius-key" not in json.dumps(
        last
    ) and "unexpected-secret-token" not in json.dumps(last)
    assert "[REDACTED] Bearer [REDACTED]" in last["cases"][0]["output"]["tasks"][0]["notes"]


def test_artifacts_stay_private_under_dated_artifact_path_and_never_overwrite_other_evidence(
    tmp_path, monkeypatch
):
    import server.evaluate_daily as module

    artifacts = tmp_path / "artifacts"
    monkeypatch.setattr(module, "ARTIFACTS", artifacts)
    path = report_destination(None, "dry-run")
    assert path.parent.parent == artifacts and path.name.startswith("daily-dry-run-")
    writer = ReportWriter(path)
    writer({"state": "running"})
    writer({"state": "complete"})
    assert json.loads(path.read_text()) == {"state": "complete"}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    with pytest.raises(FileExistsError):
        ReportWriter(path)
    with pytest.raises(ValueError):
        report_destination(str(tmp_path / "outside.json"), "live")


def test_cli_requires_both_flags_and_default_writes_only_zero_call_artifact(
    tmp_path, monkeypatch, capsys
):
    import server.evaluate_daily as module

    monkeypatch.setattr(module, "ARTIFACTS", tmp_path / "artifacts")
    monkeypatch.setattr(
        module.Settings, "from_env", classmethod(lambda cls: live_settings())
    )
    assert main(["--live"]) == 2
    assert main(["--confirm-paid-api-calls"]) == 2
    assert main([]) == 0
    output = capsys.readouterr()
    assert "private-nebius-key" not in output.out + output.err
    saved = list((tmp_path / "artifacts").rglob("*.json"))
    assert len(saved) == 1
    report = json.loads(saved[0].read_text())
    assert (
        report["summary"]["modelCallsAttempted"] == 0
        and report["summary"]["searchCallsAttempted"] == 0
    )


def test_single_case_smoke_selector_makes_exactly_one_call():
    model = MockModel()
    report = asyncio.run(
        evaluate(
            live_settings(),
            live=True,
            confirm_paid_api_calls=True,
            case_id="capture-explicit",
            nebius=model,
        )
    )
    assert len(model.calls) == 1 and report["bounds"]["modelCallsTotal"] == 1
    assert report["selectedCase"] == "capture-explicit"
    assert [case["id"] for case in report["cases"]] == ["capture-explicit"]
    assert report["summary"]["verdicts"] == {"pass": 1}
    with pytest.raises(ValueError, match="existing"):
        asyncio.run(
            evaluate(
                live_settings(),
                live=True,
                confirm_paid_api_calls=True,
                case_id="invented-case",
                nebius=model,
            )
        )
    assert len(model.calls) == 1


def test_research_selector_still_requires_explicit_search_opt_in():
    model, search = MockModel(), MockSearch()
    report = asyncio.run(
        evaluate(
            live_settings(enable_tavily=True, tavily_api_key="private-search-key"),
            live=True,
            confirm_paid_api_calls=True,
            case_id="task-research",
            nebius=model,
            research=search,
        )
    )
    assert report["summary"]["verdicts"] == {"skipped": 1}
    assert (
        report["bounds"]["modelCallsTotal"] == 0
        and not model.calls
        and not search.calls
    )
