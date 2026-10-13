import { useEffect, useState } from "react";
import { formatTimeFull } from "../lib/planner";
import type { EventPlan, Interpretation } from "../lib/types";

export interface GuidedChange {
  text: string;
  interpretation: Interpretation;
}

export default function GuidedRepair({
  plan,
  busy,
  onChange,
}: {
  plan: EventPlan;
  busy: boolean;
  onChange: (change: GuidedChange | null) => void;
}) {
  const [kind, setKind] = useState<"delay" | "room" | "duration">("delay");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("20");
  const eligible = plan.sessions
    .filter(
      (session) =>
        !session.locked &&
        (kind === "duration"
          ? session.start + session.duration > (plan.asOf ?? plan.start)
          : session.start >= (plan.asOf ?? plan.start)),
    )
    .sort((a, b) => a.start - b.start);
  const options = kind === "room" ? plan.rooms : eligible;
  const selectedId = options.some((option) => option.id === target)
    ? target
    : (options[0]?.id ?? "");
  const minutes = Number(amount);
  const valid =
    !!selectedId &&
    (kind === "room" ||
      (amount !== "" &&
        Number.isInteger(minutes) &&
        minutes > 0 &&
        minutes <= 480));
  const session = plan.sessions.find((item) => item.id === selectedId);
  const room = plan.rooms.find((item) => item.id === selectedId);
  const text =
    kind === "room"
      ? `${room?.name} is unavailable from ${formatTimeFull(plan.asOf ?? plan.start)} for the rest of the day.`
      : kind === "delay"
        ? `“${session?.title}” is delayed by ${minutes} minutes; it cannot start before ${formatTimeFull((session?.start ?? 0) + minutes)}.`
        : `“${session?.title}” needs ${minutes} extra minutes, for a total of ${(session?.duration ?? 0) + minutes} minutes.`;
  useEffect(() => {
    onChange(
      valid
        ? {
            text,
            interpretation: {
              kind,
              targetId: selectedId,
              minutes: kind === "room" ? 0 : minutes,
              description: text,
            },
          }
        : null,
    );
  }, [kind, selectedId, minutes, text, valid, onChange]);
  return (
    <div className="guided-repair">
      <label>
        Choose a change
        <select
          aria-label="Choose a change"
          value={kind}
          disabled={busy}
          onChange={(event) => {
            setKind(event.target.value as typeof kind);
            setTarget("");
          }}
        >
          <option value="delay">A speaker or activity is late</option>
          <option value="room">A room is unavailable</option>
          <option value="duration">An activity needs more time</option>
        </select>
      </label>
      <label>
        {kind === "room" ? "Room unavailable" : "Activity to change"}
        <select
          aria-label={
            kind === "room" ? "Room unavailable" : "Activity to change"
          }
          value={selectedId}
          disabled={busy || !options.length}
          onChange={(event) => setTarget(event.target.value)}
        >
          {!options.length && (
            <option value="">No upcoming movable activities</option>
          )}
          {kind === "room"
            ? plan.rooms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))
            : eligible.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatTimeFull(item.start)} · {item.title}
                </option>
              ))}
        </select>
      </label>
      {kind !== "room" && (
        <label>
          {kind === "delay" ? "Minutes later" : "Extra minutes"}
          <input
            type="number"
            min="1"
            max="480"
            step="1"
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      )}
      {valid ? (
        <p className="guided-summary">{text}</p>
      ) : (
        <p className="guided-summary">
          {!options.length
            ? "Fixed activities and activities that have begun stay protected. Edit the event if a person needs to revise those commitments."
            : "Enter a whole number from 1 to 480 minutes."}
        </p>
      )}
      <p className="guided-boundary">
        Repair from {formatTimeFull(plan.asOf ?? plan.start)}. Earlier
        activities stay fixed
        {kind === "duration"
          ? "; a running activity can be extended without moving its start"
          : ""}
        .
      </p>
    </div>
  );
}
