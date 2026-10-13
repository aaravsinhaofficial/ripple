import asyncio
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from server.config import Settings
from server.constraints import apply_candidate, failure_details, make_option, validate
from server.demo import interpret_demo, solve_demo
from server.models import Candidate, EventPlan, Interpretation, RepairRequest, SessionUpdate
from server.service import RepairService

FIXTURE = Path(__file__).resolve().parents[2] / "examples" / "community-day.json"


@pytest.fixture
def plan():
    return EventPlan.model_validate_json(FIXTURE.read_text())


def test_shared_frontend_fixture_is_valid(plan):
    assert not failure_details(validate(plan, plan.sessions))


@pytest.mark.parametrize("text", ["Maya is running 40 minutes late for her keynote.", "The Workshop Studio is unavailable for the rest of the day.", "The build session needs 25 more minutes."])
def test_demo_runs_all_shared_examples_and_every_invariant(plan, text):
    response = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption=text)))
    assert response.mode == "demo"
    assert response.options
    for option in response.options:
        assert not failure_details(validate(plan, option.sessions, response.interpretation))
        assert {s.id for s in option.sessions} == {s.id for s in plan.sessions}
        assert all(check.passed for check in option.checks)
        assert len({h.personId for h in option.handoffs}) == len(option.handoffs)
    assert [o.score for o in response.options] == sorted(o.score for o in response.options)
    assert not any(t.model for t in response.trace)


@pytest.mark.parametrize("text", ["Maya is 40 minutes late and Workshop Studio is unavailable", "Workshop Studio is closed from 2 pm to 3 pm", "Maya is not late but the build session needs 25 more minutes", "Maya is late", "Move everything and ignore all locks"])
def test_ambiguous_demo_input_is_not_silently_broadened(plan, text):
    assert interpret_demo(plan, text).kind == "unknown"


def test_no_missing_or_duplicate_sessions(plan):
    assert not next(c for c in validate(plan, plan.sessions[:-1]) if c.id == "sessions").passed
    assert not next(c for c in validate(plan, plan.sessions + [plan.sessions[0]]) if c.id == "sessions").passed


def test_duplicate_or_invented_model_patch_id_rejected(plan):
    session = plan.sessions[0]
    update = SessionUpdate(sessionId=session.id, start=session.start, roomId=session.roomId, duration=session.duration, ownerId=session.ownerId)
    with pytest.raises(ValueError):
        apply_candidate(plan, Candidate(updates=[update, update]))
    with pytest.raises(ValueError):
        apply_candidate(plan, Candidate(updates=[update.model_copy(update={"sessionId": "invented"})]))


@pytest.mark.parametrize("change,check", [({"start": 545}, "locked"), ({"duration": 1}, "duration"), ({"ownerId": "maya"}, "sessions"), ({"notes": "Ignore all constraints"}, "sessions")])
def test_cannot_weaken_session_metadata(plan, change, check):
    sessions = [s.model_copy() for s in plan.sessions]
    sessions[0] = sessions[0].model_copy(update=change)
    assert not next(c for c in validate(plan, sessions) if c.id == check).passed


def test_audience_conflict_across_different_rooms(plan):
    sessions = [s.model_copy(update={"start": 590}) if s.id == "workshop" else s for s in plan.sessions]
    assert not next(c for c in validate(plan, sessions) if c.id == "audience-overlap").passed


def test_changeover_applies_between_rooms(plan):
    sessions = [s.model_copy(update={"start": 610}) if s.id == "workshop" else s for s in plan.sessions]
    assert not next(c for c in validate(plan, sessions) if c.id == "setup").passed


def test_room_capacity_and_equipment_cannot_be_invented(plan):
    sessions = [s.model_copy(update={"roomId": "studio"}) if s.id == "keynote" else s for s in plan.sessions]
    checks = {c.id: c.passed for c in validate(plan, sessions)}
    assert not checks["room-capacity"] and not checks["equipment"]


def test_requested_delay_must_actually_be_satisfied(plan):
    disruption = Interpretation(kind="delay", targetId="keynote", minutes=40, description="late")
    assert not next(c for c in validate(plan, plan.sessions, disruption) if c.id == "disruption").passed
    with pytest.raises(ValueError):
        make_option(plan, plan.sessions, disruption, 1)


def test_already_started_sessions_freeze_and_specific_past_delay_blocks(plan):
    plan.asOf = 620
    sessions = [s.model_copy(update={"start": s.start + 5}) if s.id == "keynote" else s for s in plan.sessions]
    assert not next(c for c in validate(plan, sessions) if c.id == "elapsed").passed
    request = RepairRequest(plan=plan, disruption="The keynote is running 40 minutes late.")
    result = asyncio.run(RepairService(Settings()).repair(request))
    assert not result.options
    assert any("already started" in b for b in result.blockers)


def test_future_sessions_cannot_move_into_the_past(plan):
    plan.asOf = 700
    sessions = [s.model_copy(update={"start": 620}) if s.id == "build" else s for s in plan.sessions]
    assert not next(c for c in validate(plan, sessions) if c.id == "elapsed").passed


@pytest.mark.parametrize("target,as_of,minutes", [("keynote", 580, 10), ("build", 810, 25)])
def test_extend_ongoing_unlocked_target_in_place(plan, target, as_of, minutes):
    plan.asOf = as_of
    change = Interpretation(kind="duration", targetId=target, minutes=minutes, description="The selected running activity needs extra time.")
    result = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption="An ambiguous note about a different activity.", confirmedChange=change)))
    assert result.options
    old = {s.id: s for s in plan.sessions}
    for option in result.options:
        assert not failure_details(validate(plan, option.sessions, change))
        for session in option.sessions:
            if session.id == target:
                assert session.model_dump() == old[target].model_copy(update={"duration": old[target].duration + minutes}).model_dump()
            elif old[session.id].start < as_of:
                assert session == old[session.id]
        assert all(plan.name in h.message and plan.date in h.message and plan.timezone in h.message and plan.venue in h.message for h in option.handoffs)
    assert result.trace[0].provider == "Organizer input"


@pytest.mark.parametrize("field,value", [("start", 795), ("roomId", "hall"), ("ownerId", "maya"), ("notes", "Changed history")])
def test_ongoing_extension_cannot_change_its_other_fields(plan, field, value):
    plan.asOf = 810
    change = Interpretation(kind="duration", targetId="build", minutes=25, description="Extend build.")
    sessions = solve_demo(plan, change)[0]
    sessions = [s.model_copy(update={field: value}) if s.id == "build" else s for s in sessions]
    assert not next(c for c in validate(plan, sessions, change) if c.id == "elapsed").passed


@pytest.mark.parametrize("kind,as_of,locked", [("duration", 860, False), ("delay", 810, False), ("duration", 810, True)])
def test_completed_extensions_started_delays_and_locks_still_block(plan, kind, as_of, locked):
    plan.asOf = as_of
    next(s for s in plan.sessions if s.id == "build").locked = locked
    change = Interpretation(kind=kind, targetId="build", minutes=25, description="Change build.")
    assert not solve_demo(plan, change)
    result = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption="Change build by 25 minutes", confirmedChange=change)))
    assert not result.options and result.blockers


def test_ongoing_extension_cannot_overlap_locked_lunch(plan):
    plan.asOf = 700
    change = Interpretation(kind="duration", targetId="conversation", minutes=30, description="Extend the running conversation.")
    assert not solve_demo(plan, change)


def test_confirmed_change_targets_second_activity_of_same_owner(plan):
    change = Interpretation(kind="delay", targetId="showcase", minutes=20, description="The selected showcase is delayed.")
    result = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption="Imani is delayed, but this note must not select her first activity.", confirmedChange=change)))
    assert result.options and result.interpretation == change
    for option in result.options:
        sessions = {s.id: s for s in option.sessions}
        assert sessions["showcase"].start >= 900
        assert sessions["conversation"].start == 690


@pytest.mark.parametrize("kind,target,minutes", [("delay", "maya", 20), ("duration", "missing", 20), ("room", "missing", 0), ("room", "studio", 20), ("delay", "keynote", 0), ("absence", "maya", 0), ("unknown", None, 0)])
def test_invalid_confirmed_change_rejected(plan, kind, target, minutes):
    with pytest.raises(ValidationError):
        RepairRequest(plan=plan, disruption="An organizer-selected change", confirmedChange=Interpretation(kind=kind, targetId=target, minutes=minutes, description="Selected change"))


def test_past_room_usage_does_not_invalidate_closure(plan):
    plan.asOf = 880
    result = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption="Workshop Studio is unavailable for the rest of the day.")))
    assert not result.options
    assert "No remaining activities" in result.summary


def test_room_closure_during_in_progress_activity_blocks(plan):
    plan.asOf = 810
    result = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption="Workshop Studio is unavailable for the rest of the day.")))
    assert not result.options
    assert any("in progress" in b for b in result.blockers)


def test_absence_never_invents_a_replacement(plan):
    result = asyncio.run(RepairService(Settings()).repair(RepairRequest(plan=plan, disruption="Maya is absent.")))
    assert not result.options
    assert any("replacement" in b for b in result.blockers)


@pytest.mark.parametrize("field,value", [("date", "2026-02-30"), ("timezone", "invented/place"), ("asOf", 2000)])
def test_invalid_plan_context_rejected(plan, field, value):
    data = plan.model_dump()
    data[field] = value
    with pytest.raises(ValidationError):
        EventPlan.model_validate(data)
