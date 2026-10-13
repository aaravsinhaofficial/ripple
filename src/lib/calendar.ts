import type { EventPlan } from "./types";
import { formatTimeFull } from "./planner";

const escape = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

function localParts(time: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const value = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value);
  return Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
  );
}

/** Resolve a wall-clock event time without assuming the browser's timezone. */
export function eventTime(
  date: string,
  minutes: number,
  timezone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = wall + hours * 3600000;
    offsets.add(localParts(probe, timezone) - probe);
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((time) => localParts(time, timezone) === wall);
  if (matches.length !== 1)
    throw new Error(
      "A calendar time falls in a daylight-saving clock change. Adjust that activity’s time before exporting, or download the text schedule.",
    );
  return new Date(matches[0]);
}

function fold(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  for (const character of line) {
    if (encoder.encode(current + character).length > 75) {
      lines.push(current);
      current = " ";
    }
    current += character;
  }
  lines.push(current);
  return lines.join("\r\n");
}

export function exportCalendar(plan: EventPlan, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ripple//Event schedule//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escape(plan.name)}`,
  ];
  for (const session of [...plan.sessions].sort((a, b) => a.start - b.start)) {
    const owner =
      plan.people.find((person) => person.id === session.ownerId)?.name ?? "";
    const room =
      plan.rooms.find((item) => item.id === session.roomId)?.name ?? "";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${encodeURIComponent(plan.id)}.${encodeURIComponent(session.id)}@ripple.local`,
      `DTSTAMP:${stamp(now)}`,
      `LAST-MODIFIED:${stamp(now)}`,
      `DTSTART:${stamp(eventTime(plan.date, session.start, plan.timezone))}`,
      `DTEND:${stamp(eventTime(plan.date, session.start + session.duration, plan.timezone))}`,
      `SUMMARY:${escape(session.title)}`,
      `LOCATION:${escape([room, plan.venue].filter(Boolean).join(" · "))}`,
      `DESCRIPTION:${escape(`${plan.name}\nOwner: ${owner}\nEvent timezone: ${plan.timezone}\n${session.notes}\nExported from the current Ripple plan. This file sends no invitations.`)}`,
      "END:VEVENT",
    );
  }
  return [...lines, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}

export function exportCurrentSchedule(plan: EventPlan): string {
  return `RIPPLE · CURRENT RUN OF SHOW\n${plan.name}\n${plan.date} · ${plan.timezone}\n${plan.venue}\n\n${[
    ...plan.sessions,
  ]
    .sort((a, b) => a.start - b.start)
    .map(
      (session) =>
        `${formatTimeFull(session.start)}–${formatTimeFull(session.start + session.duration)} | ${session.title}\n${plan.rooms.find((room) => room.id === session.roomId)?.name} · ${plan.people.find((person) => person.id === session.ownerId)?.name}${session.locked ? " · Fixed" : ""}${session.notes ? `\n${session.notes}` : ""}`,
    )
    .join(
      "\n\n",
    )}\n\nSnapshot of the current saved plan. No messages or invitations have been sent.\n`;
}
