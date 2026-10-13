"""Deterministic authority: model confidence never overrides these invariants."""
from __future__ import annotations

from collections import Counter
from itertools import combinations

from .models import Candidate, ConstraintCheck, EventPlan, Handoff, Interpretation, PlanChange, RepairOption, Session


def clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return max(a_start, b_start) < min(a_end, b_end)


def affected_ids(plan: EventPlan, disruption: Interpretation) -> set[str]:
    return {s.id for s in plan.sessions if s.id == disruption.targetId or (disruption.kind == "absence" and s.ownerId == disruption.targetId)}


def ongoing_extension(plan: EventPlan, disruption: Interpretation | None, session: Session) -> bool:
    as_of = plan.asOf if plan.asOf is not None else plan.start
    return bool(disruption and disruption.kind == "duration" and disruption.targetId == session.id and not session.locked and session.start < as_of < session.end)


def disruption_errors(plan: EventPlan, disruption: Interpretation) -> list[str]:
    if disruption.kind == "unknown" or disruption.targetId is None:
        return ["Name one affected person, room, or session and describe the change."]
    if disruption.kind == "room":
        if disruption.minutes != 0:
            return ["A room closure uses zero minutes and applies through the remaining event."]
        return [] if disruption.targetId in {r.id for r in plan.rooms} else ["The affected room is not in this event."]
    affected = affected_ids(plan, disruption)
    if not affected:
        return ["The affected person or session is not in this event."]
    if disruption.kind in {"delay", "duration"} and disruption.minutes <= 0:
        return ["Specify a positive number of minutes for this timing change."]
    if disruption.kind in {"duration", "delay"} and disruption.targetId not in {s.id for s in plan.sessions}:
        return ["A timing change must identify one session."]
    if disruption.kind in {"duration", "delay"}:
        target = next(s for s in plan.sessions if s.id == disruption.targetId)
        if target.locked:
            return [f"{target.title} is locked. A producer must revise that commitment before it can change."]
        if disruption.kind == "duration" and target.duration + disruption.minutes > 720:
            return ["The requested total duration exceeds the 720-minute activity limit."]
        if target.start < (plan.asOf if plan.asOf is not None else plan.start) and not ongoing_extension(plan, disruption, target):
            return ["The affected activity has already started. Its start cannot change; a completed activity cannot be extended. Select an upcoming activity or extend an unlocked activity still in progress."]
    return []


def apply_candidate(plan: EventPlan, candidate: Candidate) -> list[Session]:
    ids = [u.sessionId for u in candidate.updates]
    known = {s.id for s in plan.sessions}
    if len(ids) != len(set(ids)) or any(i not in known for i in ids):
        raise ValueError("The proposal contains duplicate or unknown session IDs.")
    by_id = {u.sessionId: u for u in candidate.updates}
    return [s.model_copy(update=by_id[s.id].model_dump(exclude={"sessionId"})) if s.id in by_id else s.model_copy() for s in plan.sessions]


def validate(plan: EventPlan, sessions: list[Session], disruption: Interpretation | None = None) -> list[ConstraintCheck]:
    errors: dict[str, list[str]] = {key: [] for key in (
        "sessions", "locked", "duration", "event-window", "audience-overlap", "room-overlap",
        "people-overlap", "room-capacity", "equipment", "setup", "availability", "disruption", "elapsed",
    )}
    originals = {s.id: s for s in plan.sessions}
    as_of = plan.asOf if plan.asOf is not None else plan.start
    rooms, people = {r.id: r for r in plan.rooms}, {p.id: p for p in plan.people}
    if Counter(s.id for s in sessions) != Counter(s.id for s in plan.sessions):
        errors["sessions"].append("Every original session must appear exactly once.")
    for s in sessions:
        old = originals.get(s.id)
        if old is None:
            continue
        if old.locked and old.model_dump() != s.model_dump():
            errors["locked"].append(f"{old.title} is locked.")
        permitted = {"duration"} if ongoing_extension(plan, disruption, old) else set()
        if old.start < as_of and old.model_dump(exclude=permitted) != s.model_dump(exclude=permitted):
            errors["elapsed"].append(f"{old.title} has already started. Only an explicit extension of the ongoing unlocked target may change its duration; its start, room and owner stay fixed.")
        elif old.start >= as_of and s.start < as_of:
            errors["elapsed"].append(f"{old.title} cannot move before the repair-from time.")
        immutable = ("id", "title", "attendees", "kind", "locked", "notes", "requiredEquipment", "setupMinutes")
        if any(getattr(old, k) != getattr(s, k) for k in immutable) or old.ownerId != s.ownerId:
            errors["sessions"].append(f"{old.title}: people, attendees, and session details must be preserved.")
        expected_duration = old.duration
        if disruption and disruption.kind == "duration" and disruption.targetId == s.id:
            expected_duration += disruption.minutes
        if s.duration != expected_duration or s.duration <= 0:
            errors["duration"].append(f"{old.title} must last {expected_duration} minutes.")
        if s.start < plan.start or s.end > plan.end:
            errors["event-window"].append(f"{old.title} falls outside {clock(plan.start)}–{clock(plan.end)}.")
        if s.start - s.setupMinutes < plan.start:
            errors["setup"].append(f"{old.title} needs setup before the venue opens.")
        room = rooms.get(s.roomId)
        if room is None:
            errors["sessions"].append(f"{old.title} uses an unknown room.")
        else:
            if s.attendees > room.capacity:
                errors["room-capacity"].append(f"{room.name} holds {room.capacity}; {old.title} needs {s.attendees}.")
            missing = set(s.requiredEquipment) - set(room.equipment)
            if missing:
                errors["equipment"].append(f"{room.name} lacks {', '.join(sorted(missing))} for {old.title}.")
        person = people.get(s.ownerId)
        if person is None:
            errors["sessions"].append(f"{old.title} has an unknown owner.")
        elif (person.availableFrom is not None and s.start < person.availableFrom) or (person.availableUntil is not None and s.end > person.availableUntil):
            errors["availability"].append(f"{person.name} is unavailable for {old.title} at the proposed time.")
    for a, b in combinations(sessions, 2):
        collides = overlap(a.start, a.end, b.start, b.end)
        if collides:
            errors["audience-overlap"].append(f"{a.title} overlaps {b.title} in this single-track event.")
        if a.roomId == b.roomId:
            if collides:
                errors["room-overlap"].append(f"{a.title} and {b.title} occupy the same room.")
            if overlap(a.start - a.setupMinutes, a.end, b.start - b.setupMinutes, b.end):
                errors["setup"].append(f"Room turnover is too short between {a.title} and {b.title}.")
        if a.ownerId == b.ownerId and collides:
            errors["people-overlap"].append(f"{a.title} and {b.title} double-book one person.")
    ordered = sorted(sessions, key=lambda s: s.start)
    for a, b in zip(ordered, ordered[1:]):
        if a.end + b.setupMinutes > b.start:
            errors["setup"].append(f"{b.title} needs {b.setupMinutes} minutes of changeover after {a.title}.")
    if disruption:
        errors["disruption"].extend(disruption_errors(plan, disruption))
        affected = affected_ids(plan, disruption)
        if disruption.kind == "room":
            if any(s.roomId == disruption.targetId and originals.get(s.id) and originals[s.id].end > as_of for s in sessions):
                errors["disruption"].append("The unavailable room is still used by an upcoming or in-progress activity.")
        elif disruption.kind == "absence":
            errors["disruption"].append("An absent person requires a human-approved replacement; Ripple cannot invent one.")
        elif disruption.kind == "delay" and affected:
            available = min(s.start for s in plan.sessions if s.id in affected) + disruption.minutes
            if any(s.start < available for s in sessions if s.id in affected):
                errors["disruption"].append(f"The affected person/session cannot start before {clock(available)}.")
    labels = {
        "sessions": "Every session and owner preserved", "locked": "Locked moments unchanged",
        "duration": "Required durations preserved", "event-window": "Event opens and closes on time",
        "audience-overlap": "No audience conflicts", "room-overlap": "No room conflicts",
        "people-overlap": "No people double-booked", "room-capacity": "Every room has enough space",
        "equipment": "Required equipment available", "setup": "Changeover time preserved",
        "availability": "People's availability respected", "disruption": "Disruption resolved",
        "elapsed": "Started activities keep their commitments",
    }
    return [ConstraintCheck(id=k, label=labels[k], passed=not v, detail=" ".join(v[:4]) if v else "Verified against the event constraints.") for k, v in errors.items()]


def failure_details(checks: list[ConstraintCheck]) -> list[str]:
    return [c.detail for c in checks if not c.passed]


def make_option(plan: EventPlan, sessions: list[Session], disruption: Interpretation, index: int) -> RepairOption:
    checks = validate(plan, sessions, disruption)
    if failure_details(checks):
        raise ValueError("An invalid proposal cannot become a repair option.")
    old = {s.id: s for s in plan.sessions}
    rooms = {r.id: r.name for r in plan.rooms}
    changes: list[PlanChange] = []
    total_shift = 0
    for s in sessions:
        for field in ("start", "roomId", "duration", "ownerId"):
            before, after = getattr(old[s.id], field), getattr(s, field)
            if before != after:
                if field == "start":
                    total_shift += abs(before - after)
                render = clock if field == "start" else (lambda v: rooms.get(v, str(v))) if field == "roomId" else (lambda v: f"{v} min") if field == "duration" else str
                reason = "Extend the selected activity by the requested additional time." if field == "duration" else "Resolve the disruption while preserving the event's hard constraints."
                changes.append(PlanChange(sessionId=s.id, field=field, before=render(before), after=render(after), reason=reason))
    changed_ids = {c.sessionId for c in changes}
    changed = [s for s in sessions if s.id in changed_ids]
    room_moves = sum(c.field == "roomId" for c in changes)
    handoffs = []
    field_labels = {"start": "Start time", "duration": "Duration", "roomId": "Room", "ownerId": "Owner"}
    for owner in dict.fromkeys(s.ownerId for s in changed):
        owned = [s for s in changed if s.ownerId == owner]
        lines = []
        for s in owned:
            details = "; ".join(f"{field_labels[c.field]}: {c.before} → {c.after}" for c in changes if c.sessionId == s.id)
            lines.append(f"{s.title}: {clock(s.start)}–{clock(s.end)} in {rooms[s.roomId]} ({details}). Allow {s.setupMinutes} minutes for changeover.")
        context = f"Timing and room details to confirm for {plan.name}:\n{plan.date} · {plan.timezone}\nVenue: {plan.venue}\n\n"
        handoffs.append(Handoff(personId=owner, title=f"Run-of-show update · {len(owned)} activit{'y' if len(owned) == 1 else 'ies'}", message=context + "\n".join(lines) + "\nPlease confirm these details. Nothing has been sent."))
    score = len(changed_ids) * 100 + total_shift + room_moves * 45
    return RepairOption(
        id=f"option-{index}", title="Smallest ripple" if index == 1 else f"Another way · {index}",
        description=f"Adjust {len(changed_ids)} session{'s' if len(changed_ids) != 1 else ''}; protect every locked moment and the {clock(plan.end)} finish.",
        sessions=sorted(sessions, key=lambda s: (s.start, s.id)), changes=changes, checks=checks, handoffs=handoffs,
        score=score, tradeoff=f"{total_shift} total minutes of time changes; {room_moves} room move{'s' if room_moves != 1 else ''}. Ranked among evaluated options, not a guarantee of a global optimum.",
    )
