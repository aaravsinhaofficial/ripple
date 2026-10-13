import type { EventPlan } from './types'

export const SAMPLE_PLAN: EventPlan = {
  id: 'fieldnotes-2026',
  name: 'Fieldnotes Community Day',
  date: '2026-10-24',
  timezone: 'America/Chicago',
  venue: 'The Assembly, Chicago',
  start: 540,
  end: 990,
  rooms: [
    { id: 'hall', name: 'Assembly Hall', capacity: 160, equipment: ['screen', 'microphone', 'wifi', 'tables'] },
    { id: 'studio', name: 'Workshop Studio', capacity: 90, equipment: ['screen', 'wifi', 'tables'] },
  ],
  people: [
    { id: 'maya', name: 'Maya Chen', role: 'Keynote speaker', initials: 'MC', color: '#c7bce7', availableFrom: 540, availableUntil: 990 },
    { id: 'leo', name: 'Leo Park', role: 'Workshop lead', initials: 'LP', color: '#c5d4c4', availableFrom: 540, availableUntil: 990 },
    { id: 'imani', name: 'Imani Brooks', role: 'Community host', initials: 'IB', color: '#ecc9a9', availableFrom: 540, availableUntil: 990 },
    { id: 'niko', name: 'Niko Patel', role: 'Build facilitator', initials: 'NP', color: '#bfcedf', availableFrom: 540, availableUntil: 990 },
    { id: 'sara', name: 'Sara Ellis', role: 'Event producer', initials: 'SE', color: '#dac4cb', availableFrom: 540, availableUntil: 990 },
  ],
  sessions: [
    { id: 'welcome', title: 'Coffee & good company', start: 540, duration: 20, roomId: 'hall', ownerId: 'sara', attendees: 144, kind: 'fixed', locked: true, notes: 'Doors open. Name tags, coffee, and a little catching up.', requiredEquipment: [], setupMinutes: 0 },
    { id: 'keynote', title: 'The future is a group project', start: 570, duration: 40, roomId: 'hall', ownerId: 'maya', attendees: 144, kind: 'session', locked: false, notes: 'Opening keynote · a few big ideas to start the day.', requiredEquipment: ['screen', 'microphone'], setupMinutes: 10 },
    { id: 'workshop', title: 'Turn a spark into something', start: 620, duration: 60, roomId: 'studio', ownerId: 'leo', attendees: 72, kind: 'session', locked: false, notes: 'Hands-on workshop · bring your laptop and an unfinished idea.', requiredEquipment: ['screen', 'wifi', 'tables'], setupMinutes: 10 },
    { id: 'conversation', title: 'Make room for the unexpected', start: 690, duration: 40, roomId: 'hall', ownerId: 'imani', attendees: 144, kind: 'session', locked: false, notes: 'A conversation about building things that bring people together.', requiredEquipment: ['microphone'], setupMinutes: 10 },
    { id: 'lunch', title: 'Lunch, together', start: 740, duration: 50, roomId: 'hall', ownerId: 'sara', attendees: 144, kind: 'break', locked: true, notes: 'Catering arrival is fixed. A real break is part of the plan.', requiredEquipment: [], setupMinutes: 0 },
    { id: 'build', title: 'A little less talk, a little more make', start: 800, duration: 60, roomId: 'studio', ownerId: 'niko', attendees: 72, kind: 'session', locked: false, notes: 'Open build session · test the small version of your big idea.', requiredEquipment: ['wifi', 'tables'], setupMinutes: 10 },
    { id: 'showcase', title: 'Show us what you made', start: 880, duration: 50, roomId: 'hall', ownerId: 'imani', attendees: 144, kind: 'session', locked: false, notes: 'Community demos · five minutes, one thing you learned.', requiredEquipment: ['screen', 'microphone'], setupMinutes: 10 },
    { id: 'closing', title: 'See you at the next one', start: 970, duration: 20, roomId: 'hall', ownerId: 'sara', attendees: 144, kind: 'fixed', locked: true, notes: 'A few thank-yous and something to take into tomorrow.', requiredEquipment: ['microphone'], setupMinutes: 10 },
  ],
}

export const EXAMPLE_DISRUPTIONS = [
  { label: 'A speaker is running late', text: 'Maya is running 40 minutes late for her keynote.', icon: 'clock' },
  { label: 'We lost a room', text: 'The Workshop Studio is unavailable for the rest of the day.', icon: 'room' },
  { label: 'A session needs more time', text: 'The build session needs 25 more minutes.', icon: 'time' },
]

export const clonePlan = (plan: EventPlan): EventPlan => JSON.parse(JSON.stringify(plan)) as EventPlan
