import asyncio
import json

import pytest

from server.config import Settings
from server.demo import interpret_demo, solve_demo
from server.evaluate import FIXTURE, assess, cases_for, evaluate, report_destination, write_report
from server.models import Candidate, CandidateBatch, EventPlan, Interpretation, RepairRequest, SessionUpdate, Source, TraceStep
from server.providers import ProviderError
from server.service import RepairService


class MockNebius:
    """Exercises the real orchestration with local structured provider responses."""
    calls = 0

    async def structured(self, **kwargs):
        self.calls += 1
        plan = EventPlan.model_validate(kwargs["payload"]["plan"])
        if kwargs["output"] is Interpretation:
            output = interpret_demo(plan, kwargs["payload"]["disruption"])
        else:
            interpretation = Interpretation.model_validate(kwargs["payload"]["interpretation"])
            candidates = solve_demo(plan, interpretation)
            output = CandidateBatch(candidates=[Candidate(updates=[SessionUpdate(sessionId=s.id, start=s.start, duration=s.duration, roomId=s.roomId, ownerId=s.ownerId) for s in candidate]) for candidate in candidates] or [Candidate(updates=[])])
        return output, TraceStep(id="mock", label="Test provider", detail="Mock response; automated test only.", status="complete", model="mock-returned-model", inputTokens=100, outputTokens=50, provider="Mock")


def test_default_dry_plan_never_constructs_or_calls_service():
    def forbidden(*args, **kwargs):
        pytest.fail("A dry plan must not construct a provider service")
    report = asyncio.run(evaluate(Settings(mode="live", nebius_api_key="private-key"), service_factory=forbidden))
    assert report["execution"] == "dry-run" and not report["liveExecuted"]
    assert len(report["cases"]) == 5
    assert report["summary"]["verdicts"] == {"not_run": 5}
    assert report["summary"]["modelCallsAttempted"] == 0
    assert "private-key" not in json.dumps(report)


@pytest.mark.parametrize("settings", [Settings(), Settings(mode="live"), Settings(mode="live", nebius_api_key="key", enable_tavily=True)])
def test_live_opt_in_refuses_missing_mode_or_keys_before_calls(settings):
    with pytest.raises(ValueError):
        asyncio.run(evaluate(settings, run_live=True))


def test_all_five_cases_record_calls_and_independently_pass_with_mock_provider():
    provider = MockNebius()
    report = asyncio.run(evaluate(Settings(mode="live", nebius_api_key="private-key"), run_live=True, nebius=provider))
    assert report["summary"]["verdicts"] == {"pass": 5}
    assert 0 < provider.calls == report["summary"]["modelCallsAttempted"] <= 10
    assert report["summary"]["reportedInputTokens"] == provider.calls * 100
    assert report["summary"]["reportedOutputTokens"] == provider.calls * 50
    assert report["summary"]["callsWithUnknownUsage"] == 0
    assert all(call["returnedModel"] == "mock-returned-model" for case in report["cases"] for call in case["modelCalls"])
    assert all("durationMs" in case for case in report["cases"])


def test_auth_failure_stops_remaining_cases_and_redacts_exception_body():
    class FailingProvider:
        calls = 0
        async def structured(self, **kwargs):
            self.calls += 1
            raise ProviderError("provider_auth", "private-key Bearer leaked-token")
    provider = FailingProvider()
    report = asyncio.run(evaluate(Settings(mode="live", nebius_api_key="private-key"), run_live=True, nebius=provider))
    assert provider.calls == 1
    assert report["summary"]["verdicts"] == {"error": 1, "skipped": 4}
    assert report["summary"]["callsWithUnknownUsage"] == 1
    assert "private-key" not in json.dumps(report) and "leaked-token" not in json.dumps(report)


def test_optional_search_records_source_urls_and_retrieval_time():
    class MockTavily:
        async def alternatives(self, venue):
            return [Source(title="Unverified venue lead", url="https://example.com/venue", snippet="Test evidence only")]
    report = asyncio.run(evaluate(Settings(mode="live", nebius_api_key="private-key", enable_tavily=True, tavily_api_key="private-search-key"), run_live=True, nebius=MockNebius(), tavily=MockTavily()))
    calls = [call for case in report["cases"] for call in case["searchCalls"]]
    assert calls
    assert all(call["sources"][0]["url"] == "https://example.com/venue" and call["retrievedAt"] for call in calls)
    assert all(not case["searchCalls"] for case in report["cases"] if case["expectedOutcome"] == "feasible")
    assert "private-search-key" not in json.dumps(report)


def test_evaluation_does_not_trust_forged_interpretation_or_passed_checks():
    plan = EventPlan.model_validate_json(FIXTURE.read_text())
    case = cases_for(plan)[0]
    result = asyncio.run(RepairService(Settings()).repair(case.request))
    result.mode = "live"
    result.options[0].sessions = plan.sessions  # Disruption was not repaired.
    assert all(check.passed for check in result.options[0].checks)  # Forged evidence.
    result.interpretation.minutes = 1  # Would make a weaker comparison easier to pass.
    assessment = assess(case, result)
    assert assessment["verdict"] == "fail"
    assert not assessment["options"][0]["passed"]
    assert any("Interpretation" in reason for reason in assessment["reasons"])


def test_artifact_boundary_and_existing_evidence_preserved(tmp_path, monkeypatch):
    import server.evaluate as evaluation
    artifacts = tmp_path / "artifacts"
    monkeypatch.setattr(evaluation, "ARTIFACTS", artifacts)
    report = {"execution": "dry-run", "cases": []}
    path = write_report(report, str(artifacts / "evidence.json"))
    with pytest.raises(FileExistsError):
        write_report(report, str(path))
    with pytest.raises(ValueError):
        report_destination(str(tmp_path / "outside.json"), "live")
    assert json.loads(path.read_text()) == report
