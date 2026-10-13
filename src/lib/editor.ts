import { formatTimeFull, parseImportedPlan } from "./planner";
import type { EventPlan, Person, Room, Session } from "./types";

export interface ActivityDraft {
  source: Session;
  title: string;
  start: string;
  duration: string;
  owner: string;
  room: string;
  attendees: string;
  locked: boolean;
  setup: string;
  equipment: string;
  notes: string;
  kind: Session["kind"];
}
export interface SpaceDraft {
  source: Room;
  name: string;
  capacity: string;
  equipment: string;
  generated?: boolean;
}
export interface PersonDraft {
  source: Person;
  name: string;
  role: string;
  from: string;
  until: string;
  generated?: boolean;
}
export interface EventDraft {
  source: EventPlan;
  name: string;
  date: string;
  venue: string;
  timezone: string;
  start: string;
  end: string;
  asOf: string;
  activities: ActivityDraft[];
  spaces: SpaceDraft[];
  people: PersonDraft[];
}
export interface EditorIssue {
  field: string;
  message: string;
  section: "basics" | "agenda" | "resources";
}
export class EditorValidationError extends Error {
  issues: EditorIssue[];
  constructor(issues: EditorIssue[]) {
    super(issues[0]?.message ?? "Please check the event details.");
    this.issues = issues;
  }
}

export const editorId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
export const timeInput = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const minutesFromInput = (value: string): number => {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 &&
    hours <= 24 &&
    minutes >= 0 &&
    minutes < 60 &&
    (hours !== 24 || minutes === 0)
    ? hours * 60 + minutes
    : NaN;
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const equipmentList = (text: string, original: string[]): string[] =>
  text === original.join(", ")
    ? [...original]
    : text
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
const integer = (value: string): number =>
  value.trim() && /^\d+$/.test(value.trim()) ? Number(value) : NaN;

export function activityDraft(
  session: Session,
  plan: EventPlan,
): ActivityDraft {
  return {
    source: copy(session),
    title: session.title,
    start: timeInput(session.start),
    duration: String(session.duration),
    owner:
      plan.people.find((person) => person.id === session.ownerId)?.name ?? "",
    room: plan.rooms.find((room) => room.id === session.roomId)?.name ?? "",
    attendees: String(session.attendees),
    locked: session.locked,
    setup:
      session.setupMinutes === undefined ? "" : String(session.setupMinutes),
    equipment: session.requiredEquipment.join(", "),
    notes: session.notes,
    kind: session.kind,
  };
}

export function createEventDraft(
  plan: EventPlan | null,
  today = new Date(),
): EventDraft {
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const source: EventPlan = plan
    ? copy(plan)
    : {
        id: editorId("event"),
        name: "",
        date: localDate,
        venue: "",
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
        start: 540,
        end: 1020,
        sessions: [],
        rooms: [
          {
            id: editorId("room"),
            name: "Main room",
            capacity: 25,
            equipment: [],
          },
        ],
        people: [
          {
            id: editorId("person"),
            name: "Organizer",
            role: "Event organizer",
            initials: "OR",
            color: "#c7bce7",
          },
        ],
      };
  if (!source.sessions.length)
    source.sessions = [
      {
        id: editorId("activity"),
        title: "",
        start: source.start,
        duration: 30,
        ownerId: source.people[0].id,
        roomId: source.rooms[0].id,
        attendees: 25,
        kind: "session",
        locked: false,
        notes: "",
        requiredEquipment: [],
      },
    ];
  return {
    source,
    name: source.name,
    date: source.date,
    venue: source.venue,
    timezone: source.timezone,
    start: timeInput(source.start),
    end: timeInput(source.end),
    asOf: source.asOf === undefined ? "" : timeInput(source.asOf),
    activities: source.sessions.map((session) =>
      activityDraft(session, source),
    ),
    spaces: source.rooms.map((room) => ({
      source: copy(room),
      name: room.name,
      capacity: String(room.capacity),
      equipment: room.equipment.join(", "),
    })),
    people: source.people.map((person) => ({
      source: copy(person),
      name: person.name,
      role: person.role,
      from:
        person.availableFrom === undefined
          ? ""
          : timeInput(person.availableFrom),
      until:
        person.availableUntil === undefined
          ? ""
          : timeInput(person.availableUntil),
      ...(!plan ? { generated: true } : {}),
    })),
  };
}

export function addActivity(draft: EventDraft): ActivityDraft {
  const lastEnd = Math.max(
    minutesFromInput(draft.start),
    ...draft.activities
      .map(
        (activity) =>
          minutesFromInput(activity.start) + Number(activity.duration),
      )
      .filter(Number.isFinite),
  );
  const last = draft.activities[draft.activities.length - 1];
  const source: Session = {
    id: editorId("activity"),
    title: "",
    start: Math.min(lastEnd, 1410),
    duration: 30,
    ownerId: last?.source.ownerId ?? draft.people[0]?.source.id ?? "",
    roomId: last?.source.roomId ?? draft.spaces[0]?.source.id ?? "",
    attendees: Number(last?.attendees ?? draft.spaces[0]?.capacity) || 25,
    kind: "session",
    locked: false,
    notes: "",
    requiredEquipment: [],
  };
  return {
    source,
    title: "",
    start: timeInput(source.start),
    duration: "30",
    owner: last?.owner ?? draft.people[0]?.name ?? "Organizer",
    room: last?.room ?? draft.spaces[0]?.name ?? "Main room",
    attendees: String(source.attendees),
    locked: false,
    setup: "",
    equipment: "",
    notes: "",
    kind: "session",
  };
}

/** Create stable resource records after a name is entered, without inventing room capacity. */
export function materializeResources(draft: EventDraft): EventDraft {
  const next = {
    ...draft,
    spaces: draft.spaces.filter(
      (space) =>
        !space.generated ||
        draft.activities.some((activity) =>
          sameName(activity.room, space.name),
        ),
    ),
    people: draft.people.filter(
      (person) =>
        !person.generated ||
        draft.activities.some((activity) =>
          sameName(activity.owner, person.name),
        ),
    ),
  };
  for (const activity of draft.activities) {
    const roomName = activity.room.trim();
    if (
      roomName &&
      !next.spaces.some((room) => sameName(room.name, roomName))
    ) {
      const source: Room = {
        id: editorId("room"),
        name: roomName,
        capacity: 0,
        equipment: [],
      };
      next.spaces.push({
        source,
        name: roomName,
        capacity: "",
        equipment: "",
        generated: true,
      });
    }
    const personName = activity.owner.trim();
    if (
      personName &&
      !next.people.some((person) => sameName(person.name, personName))
    ) {
      const source: Person = {
        id: editorId("person"),
        name: personName,
        role: "Activity owner",
        initials: personName
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase(),
        color: "#c7bce7",
      };
      next.people.push({
        source,
        name: personName,
        role: source.role,
        from: "",
        until: "",
        generated: true,
      });
    }
  }
  return next;
}

export function basicIssues(draft: EventDraft): EditorIssue[] {
  const issues: EditorIssue[] = [];
  const add = (field: string, message: string) =>
    issues.push({ field, message, section: "basics" });
  if (!draft.name.trim()) add("event-name", "Give your event a name.");
  if (!draft.venue.trim())
    add("event-venue", "Add the venue or meeting location.");
  const date = new Date(`${draft.date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== draft.date
  )
    add("event-date", "Choose a valid event date.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: draft.timezone }).format(
      new Date(),
    );
  } catch {
    add(
      "event-timezone",
      "Choose a valid time zone, for example America/Chicago or Europe/London.",
    );
  }
  if (!draft.timezone.trim())
    add("event-timezone", "Choose the time zone for your event.");
  const start = minutesFromInput(draft.start);
  const end = minutesFromInput(draft.end);
  if (!Number.isFinite(start) || start >= 1440)
    add("event-start", "Choose the time the day starts.");
  if (!Number.isFinite(end) || end <= start)
    add("event-end", "The day must end after it starts, within the same day.");
  if (
    draft.asOf &&
    (!Number.isFinite(minutesFromInput(draft.asOf)) ||
      minutesFromInput(draft.asOf) < start ||
      minutesFromInput(draft.asOf) > end)
  )
    add(
      "event-asof",
      "The repair-from time must be inside the event’s opening and closing times.",
    );
  return issues;
}

/** Build a fresh candidate. Validation never mutates the plan currently used by the app. */
export function buildEditorPlan(input: EventDraft): EventPlan {
  const draft = materializeResources(input);
  const issues = basicIssues(draft);
  const add = (
    field: string,
    message: string,
    section: EditorIssue["section"] = "agenda",
  ) => issues.push({ field, message, section });
  if (!draft.activities.length)
    add("add-activity", "Add at least one activity to the agenda.");
  if (draft.activities.length > 36)
    add(
      "add-activity",
      "Keep this single-day agenda to 36 activities or fewer.",
    );
  if (draft.spaces.length > 12)
    add(
      "resource-heading",
      "Use 12 spaces or fewer for this event.",
      "resources",
    );
  if (draft.people.length > 60)
    add(
      "resource-heading",
      "Use 60 people or fewer for this event.",
      "resources",
    );
  const rooms: Room[] = draft.spaces.map((space) => {
    if (!space.name.trim())
      add(
        `room-${space.source.id}-name`,
        "Give this space a name.",
        "resources",
      );
    const capacity = integer(space.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)
      add(
        `room-${space.source.id}-capacity`,
        `Confirm how many people “${space.name || "this space"}” can hold.`,
        "resources",
      );
    return {
      ...space.source,
      name: space.name.trim(),
      capacity,
      equipment: equipmentList(space.equipment, space.source.equipment),
    };
  });
  const people: Person[] = draft.people.map((person) => {
    if (!person.name.trim())
      add(
        `person-${person.source.id}-name`,
        "Give this person a name.",
        "resources",
      );
    const value = {
      ...person.source,
      name: person.name.trim(),
      role: person.role,
    };
    if (person.from) value.availableFrom = minutesFromInput(person.from);
    else delete value.availableFrom;
    if (person.until) value.availableUntil = minutesFromInput(person.until);
    else delete value.availableUntil;
    if (
      (value.availableFrom !== undefined &&
        !Number.isFinite(value.availableFrom)) ||
      (value.availableUntil !== undefined &&
        !Number.isFinite(value.availableUntil)) ||
      (value.availableFrom !== undefined &&
        value.availableUntil !== undefined &&
        value.availableUntil < value.availableFrom)
    )
      add(
        `person-${person.source.id}-from`,
        `Check ${person.name || "this person"}’s availability. The end must come after the start.`,
        "resources",
      );
    return value;
  });
  const sessions: Session[] = draft.activities.map((activity, index) => {
    const label = activity.title.trim() || `Activity ${index + 1}`;
    const field = (part: string) => `activity-${activity.source.id}-${part}`;
    if (!activity.title.trim())
      add(field("title"), `Give activity ${index + 1} a title.`);
    const preferredRoom = rooms.find(
      (room) =>
        room.id === activity.source.roomId &&
        sameName(room.name, activity.room),
    );
    const room =
      preferredRoom ?? rooms.find((item) => sameName(item.name, activity.room));
    const preferredOwner = people.find(
      (person) =>
        person.id === activity.source.ownerId &&
        sameName(person.name, activity.owner),
    );
    const person =
      preferredOwner ??
      people.find((item) => sameName(item.name, activity.owner));
    if (!room) add(field("room"), `Choose a space for “${label}”.`);
    if (!person)
      add(field("owner"), `Add the person responsible for “${label}”.`);
    const start = minutesFromInput(activity.start);
    const duration = integer(activity.duration);
    const attendees = integer(activity.attendees);
    if (!Number.isFinite(start) || start >= 1440)
      add(field("start"), `Choose a start time for “${label}”.`);
    if (!Number.isInteger(duration) || duration < 1 || duration > 720)
      add(field("duration"), `Give “${label}” a duration of 1–720 minutes.`);
    if (!Number.isInteger(attendees) || attendees < 0 || attendees > 100000)
      add(
        field("attendees"),
        `Enter a whole number of attendees for “${label}”.`,
      );
    const session: Session = {
      ...activity.source,
      title: activity.title.trim(),
      start,
      duration,
      roomId: room?.id ?? "",
      ownerId: person?.id ?? "",
      attendees,
      locked: activity.locked,
      notes: activity.notes,
      requiredEquipment: equipmentList(
        activity.equipment,
        activity.source.requiredEquipment,
      ),
      kind: activity.kind,
    };
    if (activity.setup.trim()) session.setupMinutes = integer(activity.setup);
    else delete session.setupMinutes;
    if (
      session.setupMinutes !== undefined &&
      (!Number.isInteger(session.setupMinutes) || session.setupMinutes > 120)
    )
      add(
        field("setup"),
        `Use 0–120 minutes of changeover time before “${label}”.`,
      );
    return session;
  });
  if (issues.length) throw new EditorValidationError(issues);
  const start = minutesFromInput(draft.start);
  const end = minutesFromInput(draft.end);
  const ordered = [...sessions].sort((a, b) => a.start - b.start);
  for (let index = 0; index < ordered.length; index++) {
    const session = ordered[index];
    const previous = ordered[index - 1];
    const room = rooms.find((item) => item.id === session.roomId)!;
    const owner = people.find((item) => item.id === session.ownerId)!;
    const before = previous ? previous.start + previous.duration : start;
    if (session.start < start || session.start + session.duration > end)
      add(
        `activity-${session.id}-start`,
        `“${session.title}” must fit between ${formatTimeFull(start)} and ${formatTimeFull(end)}.`,
      );
    if (previous && session.start < before)
      add(
        `activity-${session.id}-start`,
        `“${session.title}” overlaps “${previous.title}”. Start it at ${formatTimeFull(before)} or later, or shorten the earlier activity.`,
      );
    else if (session.start < before + (session.setupMinutes ?? 0))
      add(
        `activity-${session.id}-start`,
        `“${session.title}” needs ${session.setupMinutes} minutes of changeover. Its earliest start is ${formatTimeFull(before + (session.setupMinutes ?? 0))}.`,
      );
    if (session.attendees > room.capacity)
      add(
        `room-${room.id}-capacity`,
        `“${session.title}” has ${session.attendees} attendees, but ${room.name} holds ${room.capacity}. Confirm a larger capacity, choose another space, or reduce the attendee count.`,
        "resources",
      );
    const missing = session.requiredEquipment.filter(
      (item) => !room.equipment.includes(item),
    );
    if (missing.length)
      add(
        `room-${room.id}-equipment`,
        `“${session.title}” needs ${missing.join(", ")}. Add it to ${room.name} only if it is available there, or update the activity’s requirements.`,
        "resources",
      );
    if (
      session.start < (owner.availableFrom ?? start) ||
      session.start + session.duration > (owner.availableUntil ?? end)
    )
      add(
        `person-${owner.id}-from`,
        `“${session.title}” falls outside ${owner.name}’s availability. Adjust their confirmed hours or the activity’s time.`,
        "resources",
      );
  }
  if (issues.length) throw new EditorValidationError(issues);
  const result: EventPlan = {
    ...draft.source,
    name: draft.name.trim(),
    date: draft.date,
    timezone: draft.timezone.trim(),
    venue: draft.venue.trim(),
    start,
    end,
    sessions,
    rooms,
    people,
  };
  if (draft.asOf) result.asOf = minutesFromInput(draft.asOf);
  else delete result.asOf;
  try {
    return parseImportedPlan(result);
  } catch (error) {
    throw new EditorValidationError([
      {
        field: "editor-error-summary",
        message:
          error instanceof Error
            ? error.message
                .replace(
                  "The imported baseline needs attention:",
                  "Please check:",
                )
                .replace(
                  "Download the sample to see the expected shape.",
                  "Check the activity details and try again.",
                )
            : "Please check the event details.",
        section: "agenda",
      },
    ]);
  }
}
