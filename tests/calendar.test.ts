import { describe, expect, it } from "vitest";
import {
  eventTime,
  exportCalendar,
  exportCurrentSchedule,
} from "../src/lib/calendar";
import { clonePlan, SAMPLE_PLAN } from "../src/lib/data";

describe("portable schedule exports", () => {
  it("uses the event timezone rather than the computer timezone", () => {
    expect(eventTime("2026-10-24", 570, "America/Chicago").toISOString()).toBe(
      "2026-10-24T14:30:00.000Z",
    );
    expect(eventTime("2026-12-24", 570, "America/Chicago").toISOString()).toBe(
      "2026-12-24T15:30:00.000Z",
    );
    expect(eventTime("2026-10-24", 570, "Asia/Kolkata").toISOString()).toBe(
      "2026-10-24T04:00:00.000Z",
    );
  });
  it("rejects ambiguous or nonexistent daylight-saving wall times", () => {
    expect(() => eventTime("2026-11-01", 90, "America/Chicago")).toThrow(
      "clock change",
    );
    expect(() => eventTime("2026-03-08", 150, "America/Chicago")).toThrow(
      "clock change",
    );
  });
  it("exports every activity with unique stable identities and escaped fields", () => {
    const plan = clonePlan(SAMPLE_PLAN);
    plan.sessions[0].title = "Welcome, team; hello\nBEGIN:VEVENT";
    const calendar = exportCalendar(plan, new Date("2026-10-12T12:00:00Z"));
    expect(calendar.match(/^BEGIN:VEVENT\r?$/gm)).toHaveLength(8);
    expect(new Set(calendar.match(/^UID:.+/gm)).size).toBe(8);
    expect(calendar).toContain(
      "SUMMARY:Welcome\\, team\\; hello\\nBEGIN:VEVENT",
    );
    expect(calendar).toContain("DTSTART:20261024T140000Z");
    expect(calendar).not.toContain("ATTENDEE:");
    expect(calendar).toContain("DTSTAMP:20261012T120000Z");
  });
  it("folds long unicode lines without splitting codepoints", () => {
    const plan = clonePlan(SAMPLE_PLAN);
    plan.sessions[0].title = "Community 🌿 ".repeat(15);
    const calendar = exportCalendar(plan);
    expect(calendar).not.toContain("\uFFFD");
    expect(
      calendar
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
    expect(calendar.replace(/\r\n /g, "")).toContain(plan.sessions[0].title);
  });
  it("text export carries the actual current times and complete event context", () => {
    const plan = clonePlan(SAMPLE_PLAN);
    plan.sessions[1].start = 640;
    const output = exportCurrentSchedule(plan);
    expect(output).toContain("10:40 am–11:20 am");
    expect(output).toContain(plan.date);
    expect(output).toContain(plan.timezone);
    expect(output).toContain(plan.venue);
  });
});
