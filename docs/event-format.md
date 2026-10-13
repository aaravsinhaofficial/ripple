# Bring your own event

Ripple supports a single event day with one activity at a time. The group can move between rooms. Parallel conference tracks, overnight programs, replacement-speaker qualifications, and external bookings are outside this version's scope.

1. Open the three-dot **Schedule actions** menu beside “The run of show.” Choose **Download sample JSON**, or start with [community-day.json](../examples/community-day.json).
2. Edit the event, people, rooms, and sessions in a text editor. Keep the JSON field names and stable IDs. References such as `ownerId` and `roomId` must match a listed person and room.
3. Choose **Import an event plan** in the same menu. Ripple checks the baseline before replacing the current local plan. Export your current event first if you want to keep it.
4. Set **Repair from** to the current event time. Activities that have already started cannot move. Describe one disruption, inspect the checked alternatives, then apply a repair.

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

Your active plan stays in this browser's local storage. Undo history lasts for the current session. **Export this event JSON** saves a reusable plan; a handoff download instead saves a readable proposal or approved update. No message is sent by either action.

Connected live mode sends the plan and incident to the configured backend and model provider. Begin with fictional data while testing. The account-free demo performs its repairs locally.
