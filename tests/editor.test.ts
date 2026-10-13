import { describe, expect, it } from "vitest";
import { SAMPLE_PLAN } from "../src/lib/data";
import {
  addActivity,
  buildEditorPlan,
  createEventDraft,
  EditorValidationError,
  materializeResources,
  minutesFromInput,
} from "../src/lib/editor";
import type { EventDraft } from "../src/lib/editor";

function customEvent(): EventDraft {
  const draft = createEventDraft(null, new Date(2026, 10, 14));
  draft.name = "Neighborhood Skills Exchange";
  draft.venue = "Civic Studio";
  draft.timezone = "America/Chicago";
  draft.end = "12:00";
  draft.spaces[0].capacity = "30";
  draft.activities[0] = {
    ...draft.activities[0],
    title: "Opening circle",
    start: "09:10",
    owner: "Jordan Lee",
  };
  const second = addActivity(draft);
  draft.activities.push({
    ...second,
    title: "Closing circle",
    start: "10:00",
    owner: "Jordan Lee",
  });
  return materializeResources(draft);
}

describe("event editor", () => {
  it("round-trips the complete existing event without losing metadata", () => {
    const source = structuredClone(SAMPLE_PLAN);
    source.asOf = 575;
    source.people[0].role = "Keynote speaker and community member";
    source.people[0].initials = "M.C.";
    source.people[0].color = "#123456";
    source.sessions[0].notes = "Bring name tags. Preserve this note.";
    expect(buildEditorPlan(createEventDraft(source))).toEqual(source);
    expect(SAMPLE_PLAN.sessions[0].notes).not.toBe(source.sessions[0].notes);
  });

  it("creates a usable custom event and gives repeated owner names the same stable ID", () => {
    const draft = customEvent();
    const first = buildEditorPlan(draft);
    const second = buildEditorPlan(draft);
    expect(first.name).toBe("Neighborhood Skills Exchange");
    expect(first.sessions).toHaveLength(2);
    expect(first.people).toHaveLength(1);
    expect(first.sessions[0].ownerId).toBe(first.sessions[1].ownerId);
    expect(first.sessions.map((session) => session.id)).toEqual(
      second.sessions.map((session) => session.id),
    );
    expect(
      first.people.find((person) => person.id === first.sessions[0].ownerId)
        ?.name,
    ).toBe("Jordan Lee");
    expect(first.rooms[0].capacity).toBe(30);
  });

  it("reports the conflicting activity and keeps the input draft unchanged", () => {
    const draft = customEvent();
    draft.activities[1].start = "09:20";
    const snapshot = structuredClone(draft);
    let failure: unknown;
    try {
      buildEditorPlan(draft);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(EditorValidationError);
    const issues = (failure as EditorValidationError).issues;
    expect(issues[0].field).toBe(
      `activity-${draft.activities[1].source.id}-start`,
    );
    expect(issues[0].message).toContain("overlaps “Opening circle”");
    expect(issues[0].message).toContain("9:40 am");
    expect(draft).toEqual(snapshot);
  });

  it("requires confirmed capacity for a newly named space", () => {
    const draft = customEvent();
    draft.activities[1].room = "Upstairs studio";
    const expanded = materializeResources(draft);
    const room = expanded.spaces.find(
      (item) => item.name === "Upstairs studio",
    )!;
    expect(room.capacity).toBe("");
    expect(() => buildEditorPlan(expanded)).toThrow(
      "Confirm how many people “Upstairs studio” can hold.",
    );
    room.capacity = "30";
    const saved = buildEditorPlan(expanded);
    expect(saved.sessions[1].roomId).toBe(room.source.id);
    expect(
      saved.rooms.find((item) => item.id === room.source.id)?.capacity,
    ).toBe(30);
  });

  it("does not leave abandoned typed names in a new event", () => {
    let draft = customEvent();
    draft.activities.forEach((activity) => {
      activity.owner = "Jordan Rivera";
    });
    draft = materializeResources(draft);
    expect(draft.people.map((person) => person.name)).toEqual([
      "Jordan Rivera",
    ]);
    expect(buildEditorPlan(draft).people.map((person) => person.name)).toEqual([
      "Jordan Rivera",
    ]);
  });

  it("makes capacity, equipment, and availability failures actionable", () => {
    const draft = customEvent();
    draft.spaces[0].capacity = "10";
    expect(() => buildEditorPlan(draft)).toThrow("has 25 attendees");
    draft.spaces[0].capacity = "30";
    draft.activities[1].equipment = "projector";
    expect(() => buildEditorPlan(draft)).toThrow("needs projector");
    draft.spaces[0].equipment = "projector";
    const jordan = draft.people.find((person) => person.name === "Jordan Lee")!;
    jordan.until = "10:15";
    expect(() => buildEditorPlan(draft)).toThrow(
      "falls outside Jordan Lee’s availability",
    );
    jordan.until = "11:00";
    expect(buildEditorPlan(draft).sessions).toHaveLength(2);
  });

  it("preserves locked activities and validates required changeover time", () => {
    const draft = customEvent();
    draft.activities[0].locked = true;
    draft.activities[1].start = "09:45";
    draft.activities[1].setup = "10";
    expect(() => buildEditorPlan(draft)).toThrow("earliest start is 9:50 am");
    draft.activities[1].start = "09:50";
    expect(buildEditorPlan(draft).sessions[0].locked).toBe(true);
  });

  it("accepts day-end midnight without silently changing existing plan data", () => {
    const plan = structuredClone(SAMPLE_PLAN);
    plan.end = 1440;
    expect(minutesFromInput("24:00")).toBe(1440);
    expect(Number.isNaN(minutesFromInput("24:01"))).toBe(true);
    expect(buildEditorPlan(createEventDraft(plan))).toEqual(plan);
  });

  it("keeps a known day-of repair time and rejects it outside an edited day", () => {
    const plan = structuredClone(SAMPLE_PLAN);
    plan.asOf = 570;
    const draft = createEventDraft(plan);
    expect(buildEditorPlan(draft).asOf).toBe(570);
    draft.start = "10:00";
    expect(() => buildEditorPlan(draft)).toThrow(
      "repair-from time must be inside",
    );
  });
});
