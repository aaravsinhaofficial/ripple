# Bring your own event

Ripple supports a single event day with one activity at a time. The group can move between rooms. Parallel conference tracks, overnight programs, replacement-speaker qualifications, and external bookings are outside this version's scope.

1. Choose **Create event**. Enter its name, date, location, day boundaries, and first room's capacity. The time zone defaults to your browser's zone; change it for an event elsewhere.
2. Choose **Build the agenda**. Add titles, start times, durations, owners, rooms, and attendance. Room and owner names can be reused. Fixed times, setup gaps, equipment, and availability are available when needed. New rooms require a confirmed capacity.
3. Choose **Save event**. Ripple identifies conflicts before replacing the current plan. **Edit event** changes the source commitments later; saving an edit clears its old repair history. Your previous event stays in **Your events**, including when you create another one. Recent-event storage is limited to six, so export JSON for a long-term backup.
4. Set **Repair from** to the point from which the schedule may change. Earlier activities are treated as already started. Choose the change, exact activity/room, and number of minutes. Inspect alternatives and checks, then apply the repair. An ongoing unlocked activity can be extended without moving its start, owner, or room. A completed activity cannot be extended.
5. Copy an approved handoff, **Download schedule**, or **Add to calendar**. The calendar button downloads an `.ics` file to import into your calendar app. It is a snapshot, not a live subscription; no invitations are sent. Date, timezone, venue, and before/after changes accompany handoff drafts.

For unusual changes, use **Describe in words**. The local parser supports one named delay, closure, or duration change; guided controls avoid ambiguity. Live prose interpretation requires a configured model service.

## Optional JSON import

The three-dot **Schedule actions** menu can download a sample, export the current event JSON, or import an existing file. Start with [community-day.json](../examples/community-day.json), preserve its field names and stable IDs, and make sure `ownerId` and `roomId` reference listed people and rooms. Ripple validates the full baseline before importing. JSON is useful for backups and bulk editing; it is not required for everyday use.

## Essential fields

| Part | What to enter |
| --- | --- |
| Event | `id`, `name`, `venue`, an ISO `date` such as `2026-10-24`, and an IANA `timezone` such as `America/Chicago`. |
| Time | `start`, `end`, and optional `asOf` are whole minutes after local midnight. For example 9:30 a.m. is 570 and 1:20 p.m. is 800. |
| Rooms | Each room has a unique `id`, `name`, positive `capacity`, and an `equipment` list. Equipment names must match session requirements exactly. |
| People | Each person has a unique `id`, `name`, `role`, `initials`, and a CSS `color`. Optional `availableFrom` and `availableUntil` are minutes after midnight. |
| Sessions | Preserve every sample field: `id`, `title`, `start`, `duration`, `roomId`, `ownerId`, `attendees`, `kind`, `locked`, `notes`, and `requiredEquipment`. Optional `setupMinutes` reserves a gap before the activity. |
| Fixed commitments | Set `locked: true` to preserve time, duration, room, and owner. A closure of a locked activity's room may require a human decision rather than a feasible repair. |

Use `kind: "session"`, `"break"`, or `"fixed"`; `locked` controls whether an activity can move. The baseline must already fit its time boundaries, capacities, equipment, availability, and setup gaps. Limits are 36 activities, 12 rooms, and 60 people. The live API also limits the serialized request to 64 KiB.

Your active plan and latest 12 repairs stay in this browser's local storage. **Your events** switches between recently used plans. **Export this event JSON** saves a reusable backup; a handoff download saves a readable proposal or approved update. Clearing browser storage removes local plans/history. No message is sent by either action.

Connected live mode sends the plan and incident to the configured backend and model provider. Begin with fictional data while testing. The account-free local planner performs repairs on your device.

Calendar export uses UTC timestamps derived from the event's IANA time zone, escaped text, stable activity identities, and folded UTF-8 content lines following [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545). Ambiguous or nonexistent times during daylight-saving clock changes are rejected with guidance; the text export remains available.
