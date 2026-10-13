"""Wire contract shared with src/lib/types.ts. Times are local minutes after midnight."""
from __future__ import annotations

from typing import Literal
from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Room(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=150)
    capacity: int = Field(ge=1, le=100000)
    equipment: list[str] = Field(max_length=20)


class Person(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=150)
    role: str = Field(max_length=150)
    initials: str = Field(max_length=8)
    color: str = Field(max_length=50)
    availableFrom: int | None = Field(default=None, ge=0, le=1440)
    availableUntil: int | None = Field(default=None, ge=0, le=1440)


class Session(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    start: int = Field(ge=0, lt=1440)
    duration: int = Field(ge=1, le=720)
    roomId: str = Field(min_length=1, max_length=80)
    ownerId: str = Field(min_length=1, max_length=80)
    attendees: int = Field(ge=0, le=100000)
    kind: Literal["session", "break", "fixed"]
    locked: bool
    notes: str = Field(max_length=2000)
    requiredEquipment: list[str] = Field(max_length=20)
    setupMinutes: int = Field(default=0, ge=0, le=120)

    @property
    def end(self) -> int:
        return self.start + self.duration


class EventPlan(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    timezone: str = Field(min_length=1, max_length=80)
    venue: str = Field(min_length=1, max_length=200)
    start: int = Field(ge=0, lt=1440)
    end: int = Field(gt=0, le=1440)
    asOf: int | None = Field(default=None, ge=0, le=1440)
    sessions: list[Session] = Field(min_length=1, max_length=36)
    rooms: list[Room] = Field(min_length=1, max_length=12)
    people: list[Person] = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def check_references(self) -> EventPlan:
        try:
            date.fromisoformat(self.date)
            ZoneInfo(self.timezone)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Use a real ISO date and an IANA time zone.") from exc
        if self.end <= self.start:
            raise ValueError("Event closing time must be after opening time.")
        if self.asOf is not None and not self.start <= self.asOf <= self.end:
            raise ValueError("Repair-from time must be within the event window.")
        for label, records in (("session", self.sessions), ("room", self.rooms), ("person", self.people)):
            ids = [record.id for record in records]
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {label} IDs are not allowed.")
        room_ids, person_ids = {r.id for r in self.rooms}, {p.id for p in self.people}
        for session in self.sessions:
            if session.roomId not in room_ids or session.ownerId not in person_ids:
                raise ValueError("Every session must reference an existing room and person.")
        return self


class RepairRequest(StrictModel):
    plan: EventPlan
    disruption: str = Field(min_length=3, max_length=2000)


class Interpretation(StrictModel):
    kind: Literal["delay", "room", "duration", "absence", "unknown"]
    targetId: str | None
    minutes: int = Field(ge=0, le=720)
    description: str = Field(max_length=500)


class PlanChange(StrictModel):
    sessionId: str
    field: Literal["start", "roomId", "duration", "ownerId"]
    before: str
    after: str
    reason: str


class ConstraintCheck(StrictModel):
    id: str
    label: str
    passed: bool
    detail: str


class Handoff(StrictModel):
    personId: str
    title: str
    message: str


class TraceStep(StrictModel):
    id: str
    label: str
    detail: str
    status: Literal["complete", "running", "pending"]
    model: str | None = None
    durationMs: int | None = None
    inputTokens: int | None = None
    outputTokens: int | None = None
    provider: str | None = None


class Source(StrictModel):
    title: str
    url: str
    snippet: str


class RepairOption(StrictModel):
    id: str
    title: str
    description: str
    sessions: list[Session]
    changes: list[PlanChange]
    checks: list[ConstraintCheck]
    handoffs: list[Handoff]
    score: int
    tradeoff: str


class RepairResult(StrictModel):
    id: str
    mode: Literal["demo", "live"]
    summary: str
    interpretation: Interpretation
    options: list[RepairOption]
    blockers: list[str]
    trace: list[TraceStep]
    sources: list[Source] = Field(default_factory=list)


class SessionUpdate(StrictModel):
    sessionId: str
    start: int = Field(ge=0, lt=1440)
    roomId: str
    duration: int = Field(ge=1, le=720)
    ownerId: str


class Candidate(StrictModel):
    updates: list[SessionUpdate] = Field(max_length=36)


class CandidateBatch(StrictModel):
    candidates: list[Candidate] = Field(min_length=1, max_length=3)
