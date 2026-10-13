import { describe, expect, it } from "vitest";
import {
  applyImport,
  IMPORT_MAX_BYTES,
  inspectTaskCSV,
  parseActionNotes,
  parseConnectorPack,
  parseICS,
  parseTaskCSV,
  previewImport,
  type ImportBatch,
  type ImportTask,
  type ICSOptions,
} from "../src/daily/imports";
import {
  completeTask,
  createWorkspace,
  parseWorkspace,
} from "../src/daily/storage";

const DATE = "2030-06-14";
const options: ICSOptions = {
  timezone: "America/Chicago",
  from: DATE,
  to: DATE,
  allDay: "skip",
  namespace: "calendar-one",
  sourceLabel: "My calendar",
};
const calendar = (...events: string[]) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Ripple Tests//EN\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const event = (lines: string, uid = "stable-event") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\n${lines.replace(/\n/g, "\r\n")}\r\nEND:VEVENT`;
const timed =
  "DTSTART:20300614T150000Z\nDTEND:20300614T153000Z\nSUMMARY:Design review";
const initial = () => createWorkspace(DATE, "America/Chicago");
function allNew(batch: ImportBatch, workspace = initial()) {
  const preview = previewImport(workspace, batch);
  return applyImport(
    workspace,
    preview,
    {
      add: preview.rows
        .filter((row) => row.status === "added")
        .map((row) => row.key),
      replace: [],
    },
    new Date(`${DATE}T12:00:00Z`),
  );
}
const task = (extras: Partial<ImportTask> = {}): ImportTask => ({
  kind: "task",
  externalId: "record-1",
  title: "Prepare project update",
  notes: "Use the existing outline.",
  minutes: 45,
  priority: "normal",
  project: "Client",
  status: "todo",
  ...extras,
});
const pack = (...items: ImportTask[]): ImportBatch => ({
  version: 1,
  source: { provider: "notion", label: "My tasks", namespace: "page-1" },
  items,
  skipped: [],
  warnings: [],
});

describe("calendar file import", () => {
  it("converts UTC into the workspace timezone and preserves unfolded, escaped notes and source links", () => {
    const batch = parseICS(
      calendar(
        event(
          `${timed}\nDESCRIPTION:First line\\nSecond\\, line\\; details\n continued\nLOCATION:Studio\nURL:https://calendar.example/event/1`,
        ),
      ),
      options,
    );
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({
      kind: "commitment",
      title: "Design review",
      date: DATE,
      start: 600,
      end: 630,
      notes: "First line\nSecond, line; detailscontinued\n\nLocation: Studio",
      url: "https://calendar.example/event/1",
    });
  });
  it("resolves IANA TZIDs without a VTIMEZONE block across a daylight-saving boundary", () => {
    const text = calendar(
      event(
        "DTSTART;TZID=America/New_York:20300308T090000\nDTEND;TZID=America/New_York:20300308T100000\nRRULE:FREQ=DAILY;COUNT=4\nSUMMARY:Daily review",
      ),
    );
    const batch = parseICS(text, {
      ...options,
      timezone: "UTC",
      from: "2030-03-08",
      to: "2030-03-11",
    });
    expect(
      batch.items.map(
        (item) =>
          item.kind === "commitment" && [item.date, item.start, item.end],
      ),
    ).toEqual([
      ["2030-03-08", 840, 900],
      ["2030-03-09", 840, 900],
      ["2030-03-10", 780, 840],
      ["2030-03-11", 780, 840],
    ]);
  });
  it("uses embedded VTIMEZONE definitions for non-IANA Outlook-style timezone names", () => {
    const zone =
      "BEGIN:VTIMEZONE\r\nTZID:Custom Standard Time\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE";
    const batch = parseICS(
      calendar(
        zone,
        event(
          "DTSTART;TZID=Custom Standard Time:20300614T090000\nDTEND;TZID=Custom Standard Time:20300614T100000\nSUMMARY:Custom zone",
        ),
      ),
      { ...options, timezone: "UTC" },
    );
    expect(batch.items[0]).toMatchObject({ start: 420, end: 480 });
  });
  it("honors RRULE, EXDATE and a moved recurrence exception without adding the original occurrence", () => {
    const master = event(
      "DTSTART;TZID=America/Chicago:20300613T100000\nDTEND;TZID=America/Chicago:20300613T103000\nRRULE:FREQ=DAILY;COUNT=4\nEXDATE;TZID=America/Chicago:20300615T100000\nSUMMARY:Daily review",
    );
    const exception = event(
      "RECURRENCE-ID;TZID=America/Chicago:20300614T100000\nDTSTART;TZID=America/Chicago:20300614T130000\nDTEND;TZID=America/Chicago:20300614T133000\nSUMMARY:Moved review",
    );
    const batch = parseICS(calendar(master, exception), {
      ...options,
      from: "2030-06-13",
      to: "2030-06-16",
    });
    expect(
      batch.items.map(
        (item) => item.kind === "commitment" && [item.date, item.start],
      ),
    ).toEqual([
      ["2030-06-13", 600],
      ["2030-06-14", 780],
      ["2030-06-16", 600],
    ]);
    expect(batch.items[1].title).toBe("Moved review");
    expect(batch.items[1].externalId).toContain("2030-06-14T15:00:00Z");
  });
  it("gives equivalent UTC and TZID recurrence IDs one stable occurrence without double-importing an override", () => {
    const master = event(
      "DTSTART;TZID=America/Chicago:20300613T100000\nDTEND;TZID=America/Chicago:20300613T103000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Daily review",
    );
    const localException = event(
      "RECURRENCE-ID;TZID=America/Chicago:20300614T100000\nDTSTART;TZID=America/Chicago:20300614T130000\nDTEND;TZID=America/Chicago:20300614T133000\nSUMMARY:Moved review",
    );
    const utcException = localException.replace(
      "RECURRENCE-ID;TZID=America/Chicago:20300614T100000",
      "RECURRENCE-ID:20300614T150000Z",
    );
    const local = parseICS(calendar(master, localException), options);
    const utc = parseICS(calendar(master, utcException), options);
    expect(utc.items).toHaveLength(1);
    expect(utc.items[0].externalId).toBe(local.items[0].externalId);
    expect(utc.items[0]).toMatchObject({ start: 780, end: 810 });
  });
  it("honors additional RDATEs and a UTC UNTIL bound with an IANA recurrence zone", () => {
    const additions = parseICS(
      calendar(
        event(
          "DTSTART:20300613T150000Z\nDTEND:20300613T153000Z\nRDATE:20300614T150000Z,20300615T150000Z\nSUMMARY:Extra dates",
        ),
      ),
      { ...options, to: "2030-06-15" },
    );
    expect(additions.items).toHaveLength(2);
    const until = parseICS(
      calendar(
        event(
          "DTSTART;TZID=America/New_York:20300308T090000\nDTEND;TZID=America/New_York:20300308T100000\nRRULE:FREQ=DAILY;UNTIL=20300310T130000Z\nSUMMARY:Until inclusive",
        ),
      ),
      { ...options, timezone: "UTC", from: "2030-03-08", to: "2030-03-12" },
    );
    expect(
      until.items.map((item) => item.kind === "commitment" && item.date),
    ).toEqual(["2030-03-08", "2030-03-09", "2030-03-10"]);
  });
  it("applies elapsed duration across spring-forward for DURATION and recurring DTEND events", () => {
    const single = parseICS(
      calendar(
        event(
          "DTSTART;TZID=America/New_York:20300310T013000\nDURATION:PT1H\nSUMMARY:One real hour",
        ),
      ),
      {
        ...options,
        timezone: "America/New_York",
        from: "2030-03-10",
        to: "2030-03-10",
      },
    );
    expect(single.items[0]).toMatchObject({ start: 90, end: 210 });
    const repeating = parseICS(
      calendar(
        event(
          "DTSTART;TZID=America/New_York:20300309T013000\nDTEND;TZID=America/New_York:20300309T023000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:One hour daily",
        ),
      ),
      {
        ...options,
        timezone: "America/New_York",
        from: "2030-03-10",
        to: "2030-03-10",
      },
    );
    expect(repeating.items[0]).toMatchObject({ start: 90, end: 210 });
  });
  it("includes an exception moved into the window from a later original date", () => {
    const master = event(
      "DTSTART;TZID=America/Chicago:20300613T100000\nDTEND;TZID=America/Chicago:20300613T103000\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Weekly review",
    );
    const exception = event(
      "RECURRENCE-ID;TZID=America/Chicago:20300627T100000\nDTSTART;TZID=America/Chicago:20300614T110000\nDTEND;TZID=America/Chicago:20300614T113000\nSUMMARY:Moved from next week",
    );
    expect(parseICS(calendar(master, exception), options).items).toMatchObject([
      { title: "Moved from next week", date: DATE, start: 660, end: 690 },
    ]);
  });
  it("materializes THISANDFUTURE overrides shifted backward into the import window", () => {
    const master = event(
      "DTSTART;TZID=America/Chicago:20300601T100000\nDTEND;TZID=America/Chicago:20300601T103000\nRRULE:FREQ=DAILY;COUNT=30\nSUMMARY:Daily review",
    );
    const exception = event(
      "RECURRENCE-ID;TZID=America/Chicago;RANGE=THISANDFUTURE:20300620T100000\nDTSTART;TZID=America/Chicago:20300613T110000\nDTEND;TZID=America/Chicago:20300613T113000\nSUMMARY:Shifted series",
    );
    const batch = parseICS(calendar(master, exception), options);
    expect(batch.items).toMatchObject([
      { date: DATE, start: 600 },
      { date: DATE, start: 660 },
    ]);
    expect(batch.items[1].externalId).toContain("2030-06-21");
  });
  it("treats all-day ends as exclusive and makes skipping versus whole-day blocking explicit", () => {
    const text = calendar(
      event(
        "DTSTART;VALUE=DATE:20300614\nDTEND;VALUE=DATE:20300616\nSUMMARY:Out of office",
      ),
    );
    const skipped = parseICS(text, { ...options, to: "2030-06-17" });
    expect(skipped.items).toHaveLength(0);
    expect(skipped.skipped[0].reason).toContain("All-day");
    const block = parseICS(text, {
      ...options,
      to: "2030-06-17",
      allDay: "block",
    });
    expect(
      block.items.map(
        (item) =>
          item.kind === "commitment" && [
            item.date,
            item.start,
            item.end,
            item.allDay,
          ],
      ),
    ).toEqual([
      [DATE, 0, 1440, true],
      ["2030-06-15", 0, 1440, true],
    ]);
  });
  it("gives an all-day event without DTEND exactly one day", () => {
    expect(
      parseICS(
        calendar(event("DTSTART;VALUE=DATE:20300614\nSUMMARY:Holiday")),
        { ...options, allDay: "block" },
      ).items,
    ).toMatchObject([{ date: DATE, start: 0, end: 1440 }]);
  });
  it("splits overnight busy time and keeps stable segment IDs when the import window changes", () => {
    const text = calendar(
      event(
        "DTSTART:20300615T040000Z\nDTEND:20300615T070000Z\nSUMMARY:Late shift",
      ),
    );
    const both = parseICS(text, { ...options, to: "2030-06-15" });
    expect(both.items).toMatchObject([
      { date: DATE, start: 1380, end: 1440 },
      { date: "2030-06-15", start: 0, end: 120 },
    ]);
    const second = parseICS(text, {
      ...options,
      from: "2030-06-15",
      to: "2030-06-15",
    });
    expect(second.items[0].externalId).toBe(both.items[1].externalId);
  });
  it("does not create a zero-minute segment on an exclusive midnight end", () => {
    const text = calendar(
      event(
        "DTSTART:20300615T040000Z\nDTEND:20300615T050000Z\nSUMMARY:Late shift",
      ),
    );
    expect(
      parseICS(text, { ...options, to: "2030-06-15" }).items,
    ).toMatchObject([{ date: DATE, start: 1380, end: 1440 }]);
  });
  it("skips canceled, transparent and self-declined events but not another attendee declining", () => {
    const batch = parseICS(
      calendar(
        event(`${timed}\nSTATUS:CANCELLED`, "cancel"),
        event(`${timed}\nTRANSP:TRANSPARENT`, "free"),
        event(
          `${timed}\nATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com`,
          "self",
        ),
        event(
          `${timed}\nATTENDEE;PARTSTAT=DECLINED:mailto:other@example.com`,
          "other",
        ),
      ),
      { ...options, attendeeEmail: "me@example.com" },
    );
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].externalId).toContain("other");
    expect(batch.skipped).toHaveLength(3);
  });
  it("canceled recurrence exceptions without DTSTART do not become meetings", () => {
    const batch = parseICS(
      calendar(
        event(
          "DTSTART:20300613T150000Z\nDTEND:20300613T153000Z\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Daily",
        ),
        event("RECURRENCE-ID:20300614T150000Z\nSTATUS:CANCELLED"),
      ),
      options,
    );
    expect(batch.items).toHaveLength(0);
    expect(batch.skipped.some((row) => row.reason.includes("Canceled"))).toBe(
      true,
    );
  });
  it("reports invalid dates, unsupported timezones and zero duration without guessing", () => {
    for (const lines of [
      "DTSTART:20300230T150000Z\nDTEND:20300230T153000Z",
      "DTSTART;TZID=Unrecognized/Place:20300614T100000\nDTEND;TZID=Unrecognized/Place:20300614T110000",
      "DTSTART:20300614T150000Z",
    ]) {
      const batch = parseICS(
        calendar(event(`${lines}\nSUMMARY:Invalid`)),
        options,
      );
      expect(batch.items).toHaveLength(0);
      expect(batch.skipped.length).toBeGreaterThan(0);
    }
  });
  it("resolves repeated local times to the first occurrence and rejects nonexistent local times", () => {
    const fall = parseICS(
      calendar(
        event(
          "DTSTART;TZID=America/New_York:20301103T013000\nDTEND;TZID=America/New_York:20301103T014500\nSUMMARY:Early fold",
        ),
      ),
      { ...options, timezone: "UTC", from: "2030-11-03", to: "2030-11-03" },
    );
    expect(fall.items[0]).toMatchObject({ start: 330, end: 345 });
    const spring = parseICS(
      calendar(
        event(
          "DTSTART;TZID=America/New_York:20300310T023000\nDTEND;TZID=America/New_York:20300310T033000\nSUMMARY:Missing hour",
        ),
      ),
      { ...options, timezone: "UTC", from: "2030-03-10", to: "2030-03-10" },
    );
    expect(spring.items).toHaveLength(0);
    expect(spring.skipped[0].reason).toContain("does not exist");
  });
  it("does not compress a UTC event spanning both occurrences of a repeated workspace clock hour", () => {
    const batch = parseICS(
      calendar(
        event(
          "DTSTART:20301103T061500Z\nDTEND:20301103T074500Z\nSUMMARY:Both occurrences of 1am",
        ),
      ),
      { ...options, from: "2030-11-03", to: "2030-11-03" },
    );
    expect(batch.items).toHaveLength(0);
    expect(batch.skipped[0].reason).toContain("ambiguous repeated clock hour");
  });
  it("does not silently shorten a counted series when one occurrence falls in a nonexistent DST hour", () => {
    const batch = parseICS(
      calendar(
        event(
          "DTSTART;TZID=America/New_York:20300309T023000\nDTEND;TZID=America/New_York:20300309T033000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Counted early meeting",
        ),
      ),
      { ...options, timezone: "UTC", from: "2030-03-09", to: "2030-03-12" },
    );
    expect(batch.items).toHaveLength(0);
    expect(
      batch.skipped.some((row) =>
        row.reason.includes("occurrence count is preserved"),
      ),
    ).toBe(true);
  });
  it("bounds the date range, file bytes and emitted occurrences with explicit outcomes", () => {
    expect(() =>
      parseICS(calendar(event(timed)), { ...options, to: "2030-08-01" }),
    ).toThrow("1–31");
    expect(() =>
      parseICS("é".repeat(IMPORT_MAX_BYTES / 2 + 1), options),
    ).toThrow("1 MB");
    const batch = parseICS(
      calendar(
        event(
          "DTSTART:20300614T000000Z\nDURATION:PT30M\nRRULE:FREQ=HOURLY;COUNT=250\nSUMMARY:Many events",
        ),
      ),
      { ...options, timezone: "UTC", to: "2030-06-30" },
    );
    expect(batch.items).toHaveLength(200);
    expect(
      batch.warnings.some((warning) => warning.includes("incomplete")),
    ).toBe(true);
    const dense = parseICS(
      calendar(event(`${timed}\nRRULE:FREQ=MINUTELY;COUNT=3`)),
      options,
    );
    expect(dense.items).toHaveLength(0);
    expect(dense.skipped[0].reason).toContain("more frequent than hourly");
  });
});

describe("reviewed task CSV and action-note import", () => {
  it("maps common Notion headers and parses quoted commas, escaped quotes and multiline notes", () => {
    const text =
      '\uFEFFName,Estimate,Description,Due date,URL\r\n"Draft, then review",45,"Line one\nA ""quoted"" note",2030-06-15,https://notion.so/page-1\r\n';
    const inspected = inspectTaskCSV(text);
    expect(inspected.mapping).toMatchObject({
      title: "Name",
      minutes: "Estimate",
      notes: "Description",
      dueDate: "Due date",
      url: "URL",
    });
    const batch = parseTaskCSV(text, { mapping: inspected.mapping });
    expect(batch.items[0]).toMatchObject({
      title: "Draft, then review",
      minutes: 45,
      notes: 'Line one\nA "quoted" note',
      dueDate: "2030-06-15",
      url: "https://notion.so/page-1",
    });
  });
  it("supports user-selected mappings and semicolon or tab separated files", () => {
    for (const separator of [";", "\t"]) {
      const text = `Work${separator}Effort\nReview imports${separator}1h 15m`;
      const batch = parseTaskCSV(text, {
        mapping: { title: "Work", minutes: "Effort" },
      });
      expect(batch.items[0]).toMatchObject({
        title: "Review imports",
        minutes: 75,
      });
    }
  });
  it("handles Todoist task rows, duration units and documented CSV priority order", () => {
    const text =
      "TYPE,CONTENT,DESCRIPTION,PRIORITY,DURATION,DURATION UNIT\nsection,Work,,, ,\ntask,Prepare outline,,1,1,hour\nnote,Extra note,,,,";
    const batch = parseTaskCSV(text, { mapping: inspectTaskCSV(text).mapping });
    expect(batch.source.provider).toBe("todoist");
    expect(batch.items).toMatchObject([
      { title: "Prepare outline", minutes: 60, priority: "high" },
    ]);
    expect(batch.skipped).toHaveLength(2);
    const unsupported = text.replace(",1,hour", ",1,week");
    expect(
      parseTaskCSV(unsupported, {
        mapping: inspectTaskCSV(unsupported).mapping,
      }).items,
    ).toHaveLength(0);
  });
  it("labels unknown estimates and rejects ambiguous dates rather than guessing deadlines", () => {
    const text = "Task,Due\nFirst,06/07/2030\nSecond,2030-06-20";
    const batch = parseTaskCSV(text, {
      mapping: inspectTaskCSV(text).mapping,
      defaultMinutes: 25,
    });
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({
      title: "Second",
      minutes: 25,
      notes: expect.stringContaining("Duration estimate: 25"),
    });
    expect(batch.skipped[0].reason).toContain("unambiguous");
    expect(
      parseTaskCSV(text, {
        mapping: inspectTaskCSV(text).mapping,
        dateFormat: "dmy",
      }).items[0],
    ).toMatchObject({ dueDate: "2030-07-06" });
  });
  it("rejects malformed CSV, duplicate headers and missing selected columns", () => {
    for (const text of [
      'Task,Notes\nOne,"unclosed',
      "Task,Task\nOne,Two",
      "Task,Notes\nOne,Two,Three",
    ])
      expect(() => inspectTaskCSV(text)).toThrow();
    expect(() =>
      parseTaskCSV("Task\nOne", { mapping: { title: "Missing" } }),
    ).toThrow("title");
  });
  it("extracts explicit action items while excluding transcript prose, completed boxes and code blocks", () => {
    const text =
      "# Meeting notes\nWe discussed three ideas.\n- A general discussion point.\n## Action items\n- [ ] Alex: Draft five slides 45m due:2030-06-15\n- [x] Send the old agenda\n- Review the outline\n## Discussion\n- This is not an action.\nTODO: Book a room 15m\n```\n- [ ] Example only\n```";
    const batch = parseActionNotes(text, {
      provider: "granola",
      namespace: "document-one",
      sourceUrl: "https://notes.example/document-one",
      sourceDate: DATE,
    });
    expect(batch.items.map((item) => item.title)).toEqual([
      "Alex: Draft five slides",
      "Review the outline",
      "Book a room",
    ]);
    expect(batch.items[0]).toMatchObject({
      dueDate: "2030-06-15",
      minutes: 45,
      url: "https://notes.example/document-one",
      sourceDate: DATE,
    });
    expect(batch.items[1].notes).toContain("Duration estimate: 30");
    expect(batch.skipped[0].reason).toContain("already checked off");
    expect(batch.items[0].notes).toContain("Alex: Draft five slides");
  });
  it("keeps an explicit block ID stable across title edits and warns when only content identity is available", () => {
    const a = parseActionNotes(
      "- [ ] Write a draft <!-- block-id: abc-123 -->",
    );
    const b = parseActionNotes(
      "- [ ] Revise the draft <!-- block-id: abc-123 -->",
    );
    expect(a.items[0].externalId).toBe("abc-123");
    expect(b.items[0].externalId).toBe(a.items[0].externalId);
    expect(parseActionNotes("- [ ] Write a draft").warnings[0]).toContain(
      "edited action appears as new",
    );
  });
  it("requires a supplied reference date for relative deadlines and never turns plain meeting prose into tasks", () => {
    expect(
      parseActionNotes("- [ ] Draft outline due:tomorrow").skipped[0].reason,
    ).toContain("reference date");
    expect(
      parseActionNotes("- [ ] Draft outline due:tomorrow", { date: DATE })
        .items[0],
    ).toMatchObject({ dueDate: "2030-06-15" });
    const empty = parseActionNotes(
      "Jordan said the design needs discussion.\nWe agreed the goal sounds useful.",
    );
    expect(empty.items).toHaveLength(0);
    expect(empty.warnings[0]).toContain("No unfinished explicit action");
    expect(
      parseActionNotes(
        "Action items:\n- Draft the outline\nDiscussion:\n- A point raised in the meeting",
      ).items.map((item) => item.title),
    ).toEqual(["Draft the outline"]);
  });
});

describe("atomic import review and source provenance", () => {
  it("adds only explicitly selected items and makes reimport idempotent after local edits and completion", () => {
    const batch = pack(
      task(),
      task({ externalId: "record-2", title: "Reply to Jordan" }),
    );
    const original = initial(),
      preview = previewImport(original, batch);
    expect(original.tasks).toHaveLength(0);
    const imported = applyImport(original, preview, {
      add: [preview.rows[0].key],
      replace: [],
    });
    expect(imported.tasks).toHaveLength(1);
    imported.tasks[0].title = "My locally edited title";
    imported.tasks[0].status = "done";
    const repeated = previewImport(imported, pack(task()));
    expect(repeated.rows[0]).toMatchObject({
      status: "duplicate",
      selected: false,
      localEdited: true,
    });
    expect(applyImport(imported, repeated, { add: [], replace: [] })).toEqual(
      imported,
    );
  });
  it("requires explicit replacement for source changes and keeps completed tasks completed", () => {
    const imported = allNew(pack(task()));
    imported.tasks[0].title = "Local edit";
    imported.tasks[0].status = "done";
    imported.tasks[0].completedAt = `${DATE}T14:00:00Z`;
    const preview = previewImport(
      imported,
      pack(task({ title: "Changed source title", minutes: 60 })),
    );
    expect(preview.rows[0]).toMatchObject({
      status: "changed",
      selected: false,
      localEdited: true,
    });
    expect(
      preview.rows[0].diffs.some(
        (diff) => diff.field === "title" && diff.before === "Local edit",
      ),
    ).toBe(true);
    expect(() =>
      applyImport(imported, preview, {
        add: [preview.rows[0].key],
        replace: [],
      }),
    ).toThrow("selection");
    const changed = applyImport(imported, preview, {
      add: [],
      replace: [preview.rows[0].key],
    });
    expect(changed.tasks[0]).toMatchObject({
      id: imported.tasks[0].id,
      title: "Changed source title",
      minutes: 60,
      status: "done",
      completedAt: `${DATE}T14:00:00Z`,
    });
    expect(imported.tasks[0].title).toBe("Local edit");
    expect(
      previewImport(
        changed,
        pack(task({ title: "Changed source title", minutes: 60 })),
      ).counts.duplicate,
    ).toBe(1);
  });
  it("uses namespace as well as record ID to separate two connected sources", () => {
    const imported = allNew(pack(task()));
    const other = pack(task());
    other.source.namespace = "another-page";
    expect(previewImport(imported, other).counts.added).toBe(1);
  });
  it("detects changed calendar event times using the same UID instead of duplicating", () => {
    const first = parseICS(calendar(event(timed)), options),
      imported = allNew(first);
    const next = parseICS(
      calendar(
        event(timed.replace("150000", "160000").replace("153000", "163000")),
      ),
      options,
    );
    const preview = previewImport(imported, next);
    expect(preview.counts.changed).toBe(1);
    const changed = applyImport(imported, preview, {
      add: [],
      replace: [preview.rows[0].key],
    });
    expect(changed.commitments).toHaveLength(1);
    expect(changed.commitments[0]).toMatchObject({
      id: imported.commitments[0].id,
      start: 660,
      end: 690,
    });
  });
  it("rejects stale previews and forged selection keys without mutating the workspace", () => {
    const original = initial(),
      preview = previewImport(original, pack(task()));
    original.settings.end = 1000;
    const snapshot = JSON.stringify(original);
    expect(() =>
      applyImport(original, preview, {
        add: [preview.rows[0].key],
        replace: [],
      }),
    ).toThrow("changed after");
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(() =>
      applyImport(initial(), preview, { add: ["invented-key"], replace: [] }),
    ).toThrow("selection");
  });
  it("validates selected capacity atomically and lets the reviewer select fewer meetings", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      kind: "commitment",
      externalId: `event-${i}`,
      title: `Meeting ${i}`,
      notes: "",
      date: DATE,
      start: 600,
      end: 630,
    }));
    const batch = parseConnectorPack({
      version: 1,
      source: { provider: "json", label: "Events", namespace: "events" },
      items,
    });
    const original = initial(),
      preview = previewImport(original, batch);
    expect(preview.warnings[0]).toContain("50 more fixed commitments");
    expect(() =>
      applyImport(original, preview, {
        add: preview.rows.map((row) => row.key),
        replace: [],
      }),
    ).toThrow("50 fixed commitments");
    expect(original.commitments).toHaveLength(0);
    expect(
      applyImport(original, preview, {
        add: preview.rows.slice(0, 50).map((row) => row.key),
        replace: [],
      }).commitments,
    ).toHaveLength(50);
  });
  it("skips ambiguous conflicting IDs in the same pack and keeps exact duplicates single", () => {
    const duplicate = previewImport(initial(), pack(task(), task()));
    expect(duplicate.counts).toMatchObject({ added: 1, skipped: 1 });
    const conflict = previewImport(
      initial(),
      pack(task(), task({ title: "Different title" })),
    );
    expect(conflict.counts).toMatchObject({ added: 0, skipped: 2 });
  });
  it("validates metadata in backups and detaches locally generated recurrence from the imported source identity", () => {
    const imported = allNew(
      pack(task({ url: "https://notion.so/task", sourceDate: DATE })),
    );
    expect(parseWorkspace(JSON.stringify(imported))).toEqual(imported);
    imported.tasks[0].recurrence = "daily";
    imported.tasks[0].earliestDate = DATE;
    const next = completeTask(
      imported,
      imported.tasks[0].id,
      new Date(`${DATE}T15:00:00Z`),
    );
    expect(next.tasks[0].source?.externalId).toBe("record-1");
    expect(next.tasks[1].source).toBeUndefined();
    for (const bad of [
      { url: "javascript:alert(1)" },
      { importedAt: "not a timestamp" },
      { provider: "invented-provider" },
      { fingerprint: "bad" },
    ]) {
      const copy = structuredClone(imported);
      Object.assign(copy.tasks[0].source!, bad);
      expect(() => parseWorkspace(copy)).toThrow("source");
    }
  });
  it("rejects unsupported connector fields, unsafe URLs, impossible dates and oversized item lists", () => {
    for (const changed of [
      { ...pack(task()), secret: "not-accepted" },
      pack(task({ url: "javascript:alert(1)" })),
      pack(task({ dueDate: "2030-02-30" })),
      pack(
        ...Array.from({ length: 201 }, (_, index) =>
          task({ externalId: `item-${index}` }),
        ),
      ),
    ])
      expect(() => parseConnectorPack(changed)).toThrow();
  });
});
