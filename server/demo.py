"""A real local constraint search for the clearly labeled, account-free demo mode."""
from __future__ import annotations

import re

from .constraints import affected_ids, disruption_errors, failure_details, ongoing_extension, overlap, validate
from .models import EventPlan, Interpretation, Session


def interpret_demo(plan: EventPlan, text: str) -> Interpretation:
    lower = text.lower()
    unknown = Interpretation(kind="unknown", targetId=None, minutes=0, description="The local demo needs one unambiguous supported change. Use a single named target and a positive duration, or a room closure for the rest of the day.")
    if re.search(r"\b(?:not|isn't|isnt|no|never)\b|\b(?:until|between|from\s+\d|temporary|temporarily)\b", lower):
        return unknown
    categories = sum(bool(re.search(pattern, lower)) for pattern in (
        r"\b(?:late|delay|delayed)\b", r"\b(?:unavailable|closed|unusable|lost|flood)\b", r"\b(?:more|extra|longer|overrun)\b",
    ))
    if categories > 1:
        return unknown
    # Deliberately narrow: demo does not pretend to understand arbitrary natural language.
    numbers = re.findall(r"\b(\d{1,3})\s*(?:more\s+|extra\s+)?(?:minutes?|mins?)\b", lower)
    minutes = min(int(numbers[0]), 720) if len(numbers) == 1 else 0
    rooms = [r for r in plan.rooms if r.name.lower() in lower or re.search(rf"\b{re.escape(r.id.lower())}\b", lower)]
    people = [p for p in plan.people if p.name.lower() in lower or re.search(rf"\b{re.escape(p.name.split()[0].lower())}\b", lower)]
    sessions = [s for s in plan.sessions if s.title.lower() in lower or re.search(rf"\b{re.escape(s.id.lower())}\b", lower)]
    if len(rooms) == 1 and any(word in lower for word in ("unavailable", "closed", "unusable", "lost", "flood", "cannot use")):
        return Interpretation(kind="room", targetId=rooms[0].id, minutes=0, description=f"{rooms[0].name} is unavailable for the remaining event; earlier activities stay fixed.")
    if any(word in lower for word in ("late", "delay")) and minutes and (len(people) == 1 or len(sessions) == 1):
        upcoming = sorted((s for s in plan.sessions if len(people) == 1 and s.ownerId == people[0].id and s.start >= (plan.asOf if plan.asOf is not None else plan.start)), key=lambda s: s.start)
        target = sessions[0].id if len(sessions) == 1 else upcoming[0].id if upcoming else None
        return Interpretation(kind="delay", targetId=target, minutes=minutes, description=f"The named person/session starts at least {minutes} minutes later than originally planned.")
    if any(word in lower for word in ("more", "extra", "longer", "overrun")) and minutes and len(sessions) == 1:
        return Interpretation(kind="duration", targetId=sessions[0].id, minutes=minutes, description=f"{sessions[0].title} needs {minutes} additional minutes.")
    if len(people) == 1 and any(word in lower for word in ("absent", "can't come", "cannot come", "cancelled", "canceled")):
        return Interpretation(kind="absence", targetId=people[0].id, minutes=0, description=f"{people[0].name} cannot attend.")
    return unknown


def _compatible(a: Session, b: Session) -> bool:
    if overlap(a.start, a.end, b.start, b.end):
        return False
    earlier, later = (a, b) if a.start <= b.start else (b, a)
    return earlier.end + later.setupMinutes <= later.start


def solve_demo(plan: EventPlan, disruption: Interpretation) -> list[list[Session]]:
    if disruption_errors(plan, disruption) or disruption.kind == "absence":
        return []
    affected = affected_ids(plan, disruption)
    earliest = min((s.start for s in plan.sessions if s.id in affected), default=plan.start) + disruption.minutes
    as_of = plan.asOf if plan.asOf is not None else plan.start
    locked = [s.model_copy(update={"duration": s.duration + disruption.minutes}) if ongoing_extension(plan, disruption, s) else s.model_copy() for s in plan.sessions if s.locked or s.start < as_of]
    # A hard lock cannot be relaxed to make a demonstration succeed.
    if any(
        (disruption.kind == "room" and s.roomId == disruption.targetId and s.end > as_of)
        or (disruption.kind == "delay" and s.id in affected and s.start < earliest)
        or (disruption.kind == "duration" and s.id == disruption.targetId and not ongoing_extension(plan, disruption, next(old for old in plan.sessions if old.id == s.id)))
        for s in locked
    ):
        return []
    room_by_id = {r.id: r for r in plan.rooms}
    people = {p.id: p for p in plan.people}
    choices: dict[str, list[tuple[int, Session]]] = {}
    for old in plan.sessions:
        if old.locked or old.start < as_of:
            continue
        duration = old.duration + (disruption.minutes if disruption.kind == "duration" and old.id == disruption.targetId else 0)
        minimum = max(as_of, plan.start + old.setupMinutes, people[old.ownerId].availableFrom or plan.start)
        if disruption.kind == "delay" and old.id in affected:
            minimum = max(minimum, earliest)
        maximum = min(plan.end, people[old.ownerId].availableUntil or plan.end) - duration
        times = {old.start, minimum, *range(((minimum + 4) // 5) * 5, maximum + 1, 5)}
        choices[old.id] = []
        for room in room_by_id.values():
            if disruption.kind == "room" and room.id == disruption.targetId:
                continue
            if room.capacity < old.attendees or not set(old.requiredEquipment) <= set(room.equipment):
                continue
            for start in sorted(times):
                if start < minimum or start > maximum:
                    continue
                candidate = old.model_copy(update={"start": start, "duration": duration, "roomId": room.id})
                if all(_compatible(candidate, s) for s in locked):
                    cost = abs(start - old.start) + (30 if room.id != old.roomId else 0) + (15 if start != old.start or room.id != old.roomId else 0)
                    choices[old.id].append((cost, candidate))
        choices[old.id].sort(key=lambda entry: (entry[0], entry[1].start, entry[1].roomId))
        if not choices[old.id]:
            return []
    # Bounded beam search: enough for a real event preview, explicitly not an optimality proof.
    beam: list[tuple[int, list[Session]]] = [(0, locked)]
    for session_id in sorted(choices, key=lambda i: (len(choices[i]), i)):
        next_beam = []
        for cost, placed in beam:
            for addition, candidate in choices[session_id][:150]:
                if all(_compatible(candidate, other) for other in placed):
                    next_beam.append((cost + addition, [*placed, candidate]))
        next_beam.sort(key=lambda item: item[0])
        beam = next_beam[:80]
        if not beam:
            return []
    results: list[list[Session]] = []
    for _, sessions in beam:
        if not failure_details(validate(plan, sessions, disruption)):
            # Avoid presenting near-identical five-minute variants as separate strategies.
            if not results or any(s.roomId != next(t.roomId for t in results[0] if t.id == s.id) or abs(s.start - next(t.start for t in results[0] if t.id == s.id)) >= 15 for s in sessions):
                results.append(sessions)
        if len(results) == 3:
            break
    return results
