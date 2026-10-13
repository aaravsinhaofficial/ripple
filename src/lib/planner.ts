import type { ConstraintCheck, EventPlan, Interpretation, PlanChange, RepairOption, RepairResult, Session } from './types'

export const formatTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`
}

export const formatTimeFull = (minutes: number): string => `${formatTime(minutes)} ${minutes < 720 ? 'am' : 'pm'}`

const copySessions = (sessions: Session[]): Session[] => sessions.map(session => ({ ...session, requiredEquipment: [...session.requiredEquipment] }))
const normalized = (text: string): string => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const ongoingExtension = (plan: EventPlan, interpretation: Interpretation, session: Session): boolean => interpretation.kind === 'duration' && interpretation.targetId === session.id && !session.locked && session.start < (plan.asOf ?? plan.start) && session.start + session.duration > (plan.asOf ?? plan.start)

export function interpretDisruption(plan: EventPlan, text: string): Interpretation {
  const value = normalized(text)
  const unknown = (): Interpretation => ({ kind: 'unknown', targetId: null, minutes: 0, description: 'The local demo handles one change at a time: a named speaker delayed by a number of minutes, a room unavailable from the repair-from time, or a named session needing extra minutes. Temporary closures and ambiguous or combined changes need clarification.' })
  const amount = text.toLowerCase().match(/(-?\d+(?:\.\d+)?)\s*(?:(?:more|extra|additional)\s+)?(minute|min|hour|hr)/)
  const minutes = amount ? Number(amount[1]) * (/hour|hr/.test(amount[2]) ? 60 : 1) : /half an hour/.test(value) ? 30 : /an hour|one hour/.test(value) ? 60 : 0
  const person = plan.people.find(item => value.includes(normalized(item.name)) || value.split(' ').includes(normalized(item.name).split(' ')[0]))
  const scored = plan.sessions.map(session => {
    const aliases = [session.id, session.title, session.notes.split('·')[0]].map(normalized)
    const score = aliases.reduce((best, alias) => Math.max(best, value.includes(alias) ? alias.length + 5 : alias.split(' ').filter(word => word.length > 3 && value.split(' ').includes(word)).length), 0)
    return { session, score }
  }).sort((a, b) => b.score - a.score)
  const target = person ? [...plan.sessions].sort((a, b) => a.start - b.start).find(session => session.ownerId === person.id && !session.locked && session.start >= (plan.asOf ?? plan.start)) : scored[0]?.score > 0 ? scored[0].session : undefined
  const room = plan.rooms.find(item => value.includes(normalized(item.name)) || value.split(' ').includes(normalized(item.id)) || normalized(item.name).split(' ').some(word => word.length > 3 && value.split(' ').includes(word)))
  const isDelay = /\b(late|delayed|delay|arriving|arrival)\b/.test(value)
  const isExtension = /\b(more|extra|longer|overrun|extend|additional)\b/.test(value)
  const isClosure = !!room && /unavailable|closed|lost|cannot use|can t use|not available|out of action|no longer/.test(value)
  const namedPeople = plan.people.filter(item => value.includes(normalized(item.name)) || value.split(' ').includes(normalized(item.name).split(' ')[0]))
  const namedSessions = plan.sessions.filter(item => [item.id, item.title].some(alias => normalized(alias).length > 1 && ` ${value} `.includes(` ${normalized(alias)} `)))
  if (Number(isDelay) + Number(isExtension) + Number(isClosure) > 1 || namedPeople.length > 1 || ((isDelay || isExtension) && namedSessions.length > 1) || /\b(not|isn t|wasn t|is not|no longer)\s+(?:\w+\s+){0,3}(late|delayed|closed|unavailable)\b/.test(value)) return unknown()
  if (isClosure && (/\b(until|between|temporarily|temporary)\b|\bfrom\b.+\b(to|through)\b/.test(value) || /\b\d{1,2}(?::\d\d)?\s*(am|pm)\b/i.test(text))) return unknown()
  if (isClosure && room) {
    return { kind: 'room', targetId: room.id, minutes: 0, description: `${room.name} is unavailable from ${formatTimeFull(plan.asOf ?? plan.start)}. Move its remaining activities to an existing suitable space; earlier activities stay fixed.` }
  }
  if (person && /can t make|cannot make|cancelled|canceled|not coming|unavailable|absent/.test(value)) {
    return { kind: 'absence', targetId: person.id, minutes: 0, description: `${person.name} is unavailable. A qualified replacement needs to be confirmed.` }
  }
  if (target && /late|delay|arriv/.test(value) && Number.isInteger(minutes) && minutes > 0 && minutes <= 480) {
    return { kind: 'delay', targetId: target.id, minutes, description: `${person?.name ?? target.title} is delayed by ${minutes} minutes. The earliest start is ${formatTimeFull(target.start + minutes)}.` }
  }
  if (target && /more|extra|longer|overrun|extend|additional/.test(value) && Number.isInteger(minutes) && minutes > 0 && minutes <= 480) {
    return { kind: 'duration', targetId: target.id, minutes, description: `“${target.title}” needs ${minutes} additional minutes. Its full ${target.duration + minutes}-minute duration must be preserved.` }
  }
  return unknown()
}

export function validateCandidate(plan: EventPlan, sessions: Session[], interpretation: Interpretation): ConstraintCheck[] {
  const ordered = [...sessions].sort((a, b) => a.start - b.start)
  const original = new Map(plan.sessions.map(session => [session.id, session]))
  const rooms = new Map(plan.rooms.map(room => [room.id, room]))
  const people = new Map(plan.people.map(person => [person.id, person]))
  const check = (id: string, label: string, passed: boolean, detail: string): ConstraintCheck => ({ id, label, passed, detail })
  const identity = sessions.length === plan.sessions.length && new Set(sessions.map(session => session.id)).size === sessions.length && sessions.every(session => original.has(session.id))
  const preserved = sessions.every(session => {
    const before = original.get(session.id)
    return before && session.title === before.title && session.ownerId === before.ownerId && session.notes === before.notes && session.attendees === before.attendees && session.requiredEquipment.join('|') === before.requiredEquipment.join('|') && session.locked === before.locked && session.kind === before.kind && (session.setupMinutes ?? 0) === (before.setupMinutes ?? 0)
  })
  const target = plan.sessions.find(session => session.id === interpretation.targetId)
  const affected = target ? [target] : []
  const validMinutes = Number.isInteger(interpretation.minutes) && interpretation.minutes > 0 && interpretation.minutes <= 720
  const disruption = interpretation.kind === 'delay' && affected.length > 0 && validMinutes
    ? affected.every(item => item.start >= (plan.asOf ?? plan.start)) && affected.every(item => (sessions.find(session => session.id === item.id)?.start ?? -1) >= Math.min(...affected.map(s => s.start)) + interpretation.minutes)
    : interpretation.kind === 'duration' && target && validMinutes
      ? (target.start >= (plan.asOf ?? plan.start) || ongoingExtension(plan, interpretation, target)) && sessions.find(session => session.id === target.id)?.duration === target.duration + interpretation.minutes
      : interpretation.kind === 'room'
      ? rooms.has(interpretation.targetId ?? '') && sessions.every(session => { const before = original.get(session.id); return !!before && (before.start + before.duration <= (plan.asOf ?? plan.start) || session.roomId !== interpretation.targetId) })
        : interpretation.kind === 'unknown' && interpretation.targetId === null
  return [
    check('identity', 'Every activity stays in the plan', identity && preserved, `${sessions.length} activities; no invented sessions or changed requirements.`),
    check('event-window', 'The day starts and ends on time', sessions.every(session => Number.isInteger(session.start) && session.start >= plan.start && session.start + session.duration <= plan.end), `${formatTimeFull(plan.start)}–${formatTimeFull(plan.end)} event window.`),
    check('duration', 'Full session durations preserved', sessions.every(session => Number.isInteger(session.duration) && session.duration > 0 && session.duration === (original.get(session.id)?.duration ?? -1) + (interpretation.kind === 'duration' && session.id === interpretation.targetId ? interpretation.minutes : 0)), 'No sessions are silently shortened to make the plan fit.'),
    check('locked', 'Fixed moments stay fixed', sessions.every(session => { const before = original.get(session.id); return !before?.locked || ['start', 'duration', 'roomId', 'ownerId'].every(field => session[field as keyof Session] === before[field as keyof Session]) }), `${plan.sessions.filter(session => session.locked).length} locked activities keep their time, owner, room, and duration.`),
    check('elapsed', 'Started activities keep their commitments', sessions.every(session => { const before = original.get(session.id); return !!before && (before.start < (plan.asOf ?? plan.start) ? (ongoingExtension(plan, interpretation, before) ? ['start', 'roomId', 'ownerId'] : ['start', 'duration', 'roomId', 'ownerId']).every(field => session[field as keyof Session] === before[field as keyof Session]) : session.start >= (plan.asOf ?? plan.start)) }), `Only the selected ongoing, unlocked activity may gain time; its start, room, and owner stay fixed. Every other activity begun before ${formatTimeFull(plan.asOf ?? plan.start)} stays unchanged.`),
    check('program-overlap', 'One thing at a time', ordered.every((session, index) => index === 0 || ordered[index - 1].start + ordered[index - 1].duration <= session.start), 'This single-track day never asks the audience to be in two places.'),
    check('setup', 'Time to make the changeover', ordered.every((session, index) => (index === 0 ? plan.start : ordered[index - 1].start + ordered[index - 1].duration) + (session.setupMinutes ?? 0) <= session.start), 'The setup buffer before every activity is preserved.'),
    check('room-capacity', 'Enough room for everyone', sessions.every(session => (rooms.get(session.roomId)?.capacity ?? -1) >= session.attendees), 'All selected spaces meet the activity’s attendance requirement.'),
    check('equipment', 'The right equipment is in the room', sessions.every(session => session.requiredEquipment.every(item => rooms.get(session.roomId)?.equipment.includes(item))), 'Screens, microphones, Wi-Fi, and tables are checked against each room.'),
    check('people-availability', 'The right people are available', sessions.every(session => { const owner = people.get(session.ownerId); return !!owner && session.start >= (owner.availableFrom ?? plan.start) && session.start + session.duration <= (owner.availableUntil ?? plan.end) }), 'Owners exist in the plan and stay within their availability.'),
    check('disruption', 'The reported change is resolved', !!disruption, interpretation.description),
  ]
}

function permutations<T>(items: T[], limit = 120): T[][] {
  const result: T[][] = []
  const visit = (remaining: T[], prefix: T[]) => {
    if (result.length >= limit) return
    if (!remaining.length) { result.push(prefix); return }
    remaining.forEach((item, index) => { if (result.length < limit) visit(remaining.filter((_, i) => i !== index), [...prefix, item]) })
  }
  visit(items, [])
  return result
}

function repairOrders(items: Session[], targetId: string | null, plan: EventPlan): Session[][] {
  const orders: Session[][] = []
  const seen = new Set<string>()
  const add = (order: Session[]) => {
    const key = JSON.stringify(order.map(item => item.id))
    if (!seen.has(key) && orders.length < 120) { seen.add(key); orders.push(order) }
  }
  add(items)
  const target = items.find(item => item.id === targetId)
  if (target) {
    const remaining = items.filter(item => item.id !== targetId)
    // Try every position for the selected activity before spending the bounded
    // permutation budget. A long unchanged prefix must not trap a late speaker.
    for (let position = 0; position <= remaining.length; position++) {
      add([...remaining.slice(0, position), target, ...remaining.slice(position)])
    }
  }
  const people = new Map(plan.people.map(person => [person.id, person]))
  add([...items].sort((a, b) => (people.get(a.ownerId)?.availableUntil ?? plan.end) - (people.get(b.ownerId)?.availableUntil ?? plan.end) || a.start - b.start))
  add([...items].sort((a, b) => (people.get(a.ownerId)?.availableFrom ?? plan.start) - (people.get(b.ownerId)?.availableFrom ?? plan.start) || a.start - b.start))
  for (const order of permutations(items, 120 - orders.length)) add(order)
  return orders
}

function scheduleVariants(plan: EventPlan, seed: Session[], interpretation: Interpretation): Session[][] {
  const ordered = [...seed].sort((a, b) => a.start - b.start)
  const target = seed.find(session => session.id === interpretation.targetId)
  const group: Session[] = []
  const groups: { items: Session[]; lower: number; upper: number }[] = []
  let lower = Math.max(plan.start, plan.asOf ?? plan.start)
  for (const session of ordered) {
    if (session.locked || session.start < (plan.asOf ?? plan.start)) {
      if (group.length) groups.push({ items: group.splice(0), lower, upper: session.start - (session.setupMinutes ?? 0) })
      lower = Math.max(session.start + session.duration, plan.asOf ?? plan.start)
    } else group.push(session)
  }
  if (group.length) groups.push({ items: group.splice(0), lower, upper: plan.end })
  let combinations: Session[][] = [copySessions(ordered.filter(session => session.locked || session.start < (plan.asOf ?? plan.start)))]
  for (const block of groups) {
    const originalTarget = plan.sessions.find(session => session.id === interpretation.targetId)
    const touched = block.items.some(session => session.id === interpretation.targetId) || !!(originalTarget && target && ongoingExtension(plan, interpretation, originalTarget) && block.lower === target.start + target.duration)
    const orders = touched ? repairOrders(block.items, interpretation.targetId, plan) : [block.items]
    const variants: Session[][] = []
    for (const order of orders) {
      for (const preserve of touched ? [true, false] : [true]) {
        let cursor = block.lower
        const scheduled: Session[] = []
        for (const item of order) {
          const person = plan.people.find(owner => owner.id === item.ownerId)
          const earliest = interpretation.kind === 'delay' && item.id === target?.id ? (plan.sessions.find(original => original.id === target.id)?.start ?? item.start) + interpretation.minutes : plan.start
          const start = Math.max(cursor + (item.setupMinutes ?? 0), preserve ? item.start : plan.start, earliest, person?.availableFrom ?? plan.start)
          scheduled.push({ ...item, start })
          cursor = start + item.duration
        }
        if (cursor <= block.upper) variants.push(scheduled)
      }
    }
    if (!variants.length) return []
    combinations = combinations.flatMap(base => variants.map(variant => [...base, ...variant])).slice(0, 240)
  }
  return combinations.map(sessions => sessions.sort((a, b) => a.start - b.start))
}

function roomVariants(plan: EventPlan, interpretation: Interpretation): Session[][] {
  let variants = [copySessions(plan.sessions)]
  for (const session of plan.sessions.filter(item => item.roomId === interpretation.targetId && item.start >= (plan.asOf ?? plan.start))) {
    if (session.locked) return []
    const alternatives = plan.rooms.filter(room => room.id !== interpretation.targetId && room.capacity >= session.attendees && session.requiredEquipment.every(item => room.equipment.includes(item)))
    variants = variants.flatMap(base => alternatives.map(room => base.map(item => item.id === session.id ? { ...item, roomId: room.id } : item))).slice(0, 120)
  }
  return variants
}

function describeChanges(plan: EventPlan, sessions: Session[], interpretation: Interpretation): PlanChange[] {
  const changes: PlanChange[] = []
  for (const session of sessions) {
    const before = plan.sessions.find(item => item.id === session.id)!
    if (before.start !== session.start) changes.push({ sessionId: session.id, field: 'start', before: formatTimeFull(before.start), after: formatTimeFull(session.start), reason: session.id === interpretation.targetId ? 'Respect the updated availability and keep the full session.' : session.start < before.start ? 'Bring a flexible activity forward to make room.' : 'Keep the program in order with the required changeover time.' })
    if (before.duration !== session.duration) changes.push({ sessionId: session.id, field: 'duration', before: `${before.duration} min`, after: `${session.duration} min`, reason: 'Include all of the additional time requested.' })
    if (before.roomId !== session.roomId) changes.push({ sessionId: session.id, field: 'roomId', before: plan.rooms.find(room => room.id === before.roomId)?.name ?? before.roomId, after: plan.rooms.find(room => room.id === session.roomId)?.name ?? session.roomId, reason: 'Use an available room with sufficient capacity and the required equipment.' })
  }
  return changes
}

function makeOption(plan: EventPlan, sessions: Session[], interpretation: Interpretation, index: number): RepairOption {
  const changes = describeChanges(plan, sessions, interpretation)
  const changedIds = new Set(changes.map(change => change.sessionId))
  const earlier = sessions.find(session => session.start < (plan.sessions.find(item => item.id === session.id)?.start ?? 0))
  const score = changedIds.size * 100 + sessions.reduce((sum, session) => { const before = plan.sessions.find(item => item.id === session.id)!; return sum + Math.abs(session.start - before.start) + (session.roomId !== before.roomId ? 45 : 0) }, 0)
  const affectedOwners = [...new Set(sessions.filter(session => changedIds.has(session.id)).map(session => session.ownerId))]
  const handoffs = affectedOwners.map(personId => {
    const person = plan.people.find(owner => owner.id === personId)!
    const affected = sessions.filter(session => session.ownerId === personId && changedIds.has(session.id))
    const fieldLabels = { start: 'Start time', duration: 'Duration', roomId: 'Room', ownerId: 'Owner' }
    return { personId, title: `${person.name.trim().split(' ')[0]}’s updated plan`, message: `Hi ${person.name.trim().split(' ')[0]},\n\nTiming and room details to confirm for ${plan.name}:\n${plan.date} · ${plan.timezone}\nVenue: ${plan.venue}\n\n${affected.map(session => `• ${session.title}: ${formatTimeFull(session.start)}–${formatTimeFull(session.start + session.duration)}, ${plan.rooms.find(room => room.id === session.roomId)?.name}.\n  What changed: ${changes.filter(change => change.sessionId === session.id).map(change => `${fieldLabels[change.field]}: ${change.before} → ${change.after}`).join('; ')}.`).join('\n\n')}\n\nPlease confirm this timing and room work for you. Thank you!` }
  })
  let title = interpretation.kind === 'room' ? 'Give the sessions a new home' : earlier ? `Bring ${earlier.id === 'workshop' ? 'the workshop' : earlier.id === 'conversation' ? 'the conversation' : earlier.title.toLowerCase()} forward` : 'Let the schedule breathe'
  if (title.length > 75) title = 'Reorder the flexible sessions'
  return { id: `option-${index + 1}`, title, description: interpretation.kind === 'room' ? 'Keep every time intact and move affected activities to a suitable space.' : earlier ? 'Change the running order, preserve the full sessions, and keep the fixed moments.' : 'Use the available breathing room while protecting the fixed moments.', sessions, changes, checks: validateCandidate(plan, sessions, interpretation), handoffs, score, tradeoff: `${changedIds.size} ${changedIds.size === 1 ? 'activity changes' : 'activities change'} · ${affectedOwners.length} ${affectedOwners.length === 1 ? 'person needs' : 'people need'} an update` }
}

function explainUnfoundRepair(plan: EventPlan, seed: Session[], interpretation: Interpretation): string[] {
  if (interpretation.kind === 'room') {
    const room = plan.rooms.find(item => item.id === interpretation.targetId)!
    const affected = plan.sessions.filter(session => session.roomId === room.id && session.start >= (plan.asOf ?? plan.start))
    const blockers: string[] = []
    for (const session of affected) {
      if (session.locked) blockers.push(`“${session.title}” is locked in ${room.name} at ${formatTimeFull(session.start)}. Confirm a new location and revise that lock before retrying.`)
      else {
        const alternatives = plan.rooms.filter(item => item.id !== room.id)
        const suitable = alternatives.some(item => item.capacity >= session.attendees && session.requiredEquipment.every(equipment => item.equipment.includes(equipment)))
        if (!suitable) {
          const requirements = `${session.attendees} attendees${session.requiredEquipment.length ? ` and ${session.requiredEquipment.join(', ')}` : ''}`
          const reasons = alternatives.map(item => {
            const missing = session.requiredEquipment.filter(equipment => !item.equipment.includes(equipment))
            return `${item.name}: ${[item.capacity < session.attendees ? `holds ${item.capacity}` : '', missing.length ? `missing ${missing.join(', ')}` : ''].filter(Boolean).join('; ')}`
          })
          blockers.push(`“${session.title}” needs space for ${requirements}. ${reasons.length ? reasons.join('. ') + '.' : 'No other room is listed.'} Confirm a suitable space and add its actual capacity and equipment to the event.`)
        }
      }
      if (blockers.length === 3) break
    }
    return blockers.length ? blockers : ['The bounded search did not find a checked room assignment. Review the remaining activities and confirm which existing spaces can be used; no changes have been made.']
  }
  const target = seed.find(session => session.id === interpretation.targetId)!
  const original = plan.sessions.find(session => session.id === target.id)!
  const owner = plan.people.find(person => person.id === target.ownerId)!
  const ongoing = ongoingExtension(plan, interpretation, original)
  const earliest = ongoing ? original.start : Math.max(plan.start + (target.setupMinutes ?? 0), plan.asOf ?? plan.start, owner.availableFrom ?? plan.start, interpretation.kind === 'delay' ? original.start + interpretation.minutes : plan.start)
  const latest = Math.min(plan.end, owner.availableUntil ?? plan.end)
  if (earliest + target.duration > latest) {
    const boundary = (owner.availableUntil ?? plan.end) < plan.end ? `${owner.name} is available only until ${formatTimeFull(latest)}` : `the event ends at ${formatTimeFull(plan.end)}`
    return [`“${target.title}” needs ${target.duration} minutes and can start no earlier than ${formatTimeFull(earliest)}, but ${boundary}. Confirm different availability or a smaller change before retrying.`]
  }
  const minimumLength = seed.reduce((sum, session) => sum + session.duration + (session.setupMinutes ?? 0), 0)
  if (minimumLength > plan.end - plan.start) {
    return [`Full activities and changeovers need at least ${minimumLength} minutes; the ${formatTimeFull(plan.start)}–${formatTimeFull(plan.end)} event window has ${plan.end - plan.start}. That is ${minimumLength - (plan.end - plan.start)} minutes short even with all gaps removed. A producer must revise the requested extra time or agree a different event window.`]
  }
  const nextFixed = plan.sessions.filter(session => session.locked && session.start > original.start).sort((a, b) => a.start - b.start)[0]
  if (ongoing && nextFixed && target.start + target.duration + (nextFixed.setupMinutes ?? 0) > nextFixed.start) {
    return [`Extending the running “${target.title}” by ${interpretation.minutes} minutes puts its end at ${formatTimeFull(target.start + target.duration)}, which conflicts with the fixed “${nextFixed.title}” at ${formatTimeFull(nextFixed.start)}${nextFixed.setupMinutes ? ` and its ${nextFixed.setupMinutes}-minute changeover` : ''}. A producer must agree less extra time or explicitly revise that fixed commitment; Ripple will not move a session that has already started.`]
  }
  return [
    `The bounded search did not find a checked repair${nextFixed ? ` before the fixed “${nextFixed.title}” at ${formatTimeFull(nextFixed.start)}` : ' within this event'}. This does not prove a repair is impossible.`,
    'This local search keeps flexible activities on their original side of fixed moments. A producer can review moving an activity across one of those boundaries, confirm different owner availability, or reduce the requested change. The current plan has not changed.',
  ]
}

/** Repair the selected IDs directly. The optional note never changes the target. */
export function repairInterpretedPlan(plan: EventPlan, interpretation: Interpretation, disruption?: string): RepairResult {
  const result: RepairResult = { id: `repair-${Date.now()}`, mode: 'demo', summary: '', interpretation: { ...interpretation }, options: [], blockers: [], trace: [] }
  const stop = (summary: string, blockers: string[]): RepairResult => {
    result.summary = summary
    result.blockers = blockers
    result.trace = [{ id: 'check', label: 'Check the selected change', detail: 'No repair or handoff was generated. The current plan is unchanged.', status: 'complete' }]
    return result
  }
  const baselineFailures = validateCandidate(plan, plan.sessions, { kind: 'unknown', targetId: null, minutes: 0, description: 'Check the starting schedule.' }).filter(check => !check.passed)
  if (baselineFailures.length) return stop('The starting schedule needs attention.', [`Resolve these existing conflicts before repairing a new change: ${baselineFailures.map(check => check.label.toLowerCase()).join('; ')}.`])
  if (!['delay', 'duration', 'room', 'absence', 'unknown'].includes(interpretation.kind)) return stop('Choose a supported change.', ['Select an activity delay, additional session time, or a room closure. No changes have been made.'])
  const target = plan.sessions.find(session => session.id === interpretation.targetId)
  if (interpretation.kind === 'room' && !plan.rooms.some(room => room.id === interpretation.targetId)) return stop('Choose an existing room.', ['That room is not in this event. Select the affected room again; no room was inferred from its name.'])
  if (interpretation.kind === 'room' && interpretation.minutes !== 0) return stop('Choose the scope of the room closure.', ['The local planner supports a room closure from the repair-from time through the end of the event. Temporary closures need a producer’s revised plan.'])
  if (interpretation.kind === 'delay' || interpretation.kind === 'duration') {
    if (!target) return stop('Choose an existing activity.', ['That activity is not in this event. Select the affected activity again; similarly named activities were not substituted.'])
    if (!Number.isInteger(interpretation.minutes) || interpretation.minutes <= 0 || interpretation.minutes > 720) return stop('Enter a whole number of minutes.', ['Use 1–720 additional minutes for the selected activity. No timing change has been applied.'])
    if (interpretation.kind === 'duration' && target.duration + interpretation.minutes > 720) return stop('Review the total activity duration.', ['An individual activity can last at most 720 minutes in this planner. Confirm the intended duration before retrying.'])
    if (target.locked) return stop('That activity is locked.', [`“${target.title}” is fixed at ${formatTimeFull(target.start)} for ${target.duration} minutes. Confirm that this commitment can change, then revise its lock in the source plan before retrying.`])
    if (target.start < (plan.asOf ?? plan.start) && !ongoingExtension(plan, interpretation, target)) return interpretation.kind === 'duration'
      ? stop('That activity has finished.', [`“${target.title}” ended at ${formatTimeFull(target.start + target.duration)}, at or before the ${formatTimeFull(plan.asOf ?? plan.start)} repair-from time. A producer must confirm what actually happened and revise the baseline; Ripple will not extend a completed activity.`])
      : stop('That activity has already started.', [`“${target.title}” started at ${formatTimeFull(target.start)}, before the ${formatTimeFull(plan.asOf ?? plan.start)} repair-from time. A producer must confirm what actually happened; Ripple will not rewrite its start. If it is still running and needs extra time, choose a duration extension instead.`])
  }
  const ongoingInClosedRoom = interpretation.kind === 'room' && plan.sessions.some(session => session.roomId === interpretation.targetId && session.start < (plan.asOf ?? plan.start) && session.start + session.duration > (plan.asOf ?? plan.start))
  if (ongoingInClosedRoom) {
    result.summary = 'An activity is already using that room.'
    result.blockers = ['The room closure affects an activity already in progress. A producer must decide how to interrupt or relocate it; Ripple cannot rewrite a session that has started.']
    result.trace = [{ id: 'check', label: 'Protect the running event', detail: 'An ongoing activity conflicts with the closure. No repair or handoff was generated.', status: 'complete' }]
    return result
  }
  if (interpretation.kind === 'room' && !plan.sessions.some(session => session.roomId === interpretation.targetId && session.start + session.duration > (plan.asOf ?? plan.start))) {
    result.summary = 'No schedule changes are needed.'
    result.blockers = ['No remaining activities use that room. The current plan can stay as it is.']
    result.trace = [{ id: 'check', label: 'Check remaining activities', detail: 'Earlier uses of the room have finished. No repair or handoff is needed.', status: 'complete' }]
    return result
  }
  if (interpretation.kind === 'unknown' || interpretation.kind === 'absence') {
    result.summary = interpretation.kind === 'absence' ? 'A person needs to make this call.' : 'A little more detail will help.'
    result.blockers = interpretation.kind === 'absence' ? ['The demo cannot verify a replacement’s qualifications. Confirm a suitable owner in your source plan, then import the updated plan.'] : [interpretation.description, 'Try “Maya is 40 minutes late”, “Workshop Studio is unavailable”, or “Build needs 25 more minutes”.']
    result.trace = [{ id: 'interpret', label: 'Read the change', detail: interpretation.description, status: 'complete' }]
    return result
  }
  const seed = copySessions(plan.sessions).map(session => interpretation.kind === 'duration' && session.id === interpretation.targetId ? { ...session, duration: session.duration + interpretation.minutes } : session)
  const candidates = interpretation.kind === 'room' ? roomVariants(plan, interpretation) : scheduleVariants(plan, seed, interpretation)
  const seen = new Set<string>()
  const options = candidates.filter(sessions => {
    const key = JSON.stringify([...sessions].sort((a, b) => a.id.localeCompare(b.id)).map(session => [session.id, session.start, session.duration, session.roomId]))
    if (seen.has(key)) return false
    seen.add(key)
    return validateCandidate(plan, sessions, interpretation).every(check => check.passed)
  }).map((sessions, index) => makeOption(plan, sessions, interpretation, index)).filter(option => option.changes.length > 0).sort((a, b) => a.score - b.score)
  result.options = options.slice(0, 2).map((option, index) => ({ ...option, id: `option-${index + 1}` }))
  result.summary = result.options.length ? `${result.options.length === 1 ? 'One checked way' : 'Two checked ways'} to keep the day moving.` : 'No checked repair was found.'
  if (!result.options.length) result.blockers = explainUnfoundRepair(plan, seed, interpretation)
  result.trace = [
    { id: 'interpret', label: 'Read the change', detail: `${interpretation.description}${disruption?.trim() ? ' The accompanying note did not change the selected target.' : ''}`, status: 'complete' },
    { id: 'explore', label: 'Explore repairs', detail: `Evaluated ${seen.size} distinct candidate ${seen.size === 1 ? 'plan' : 'plans'} using a bounded local search.`, status: 'complete' },
    { id: 'check', label: 'Check the boundaries', detail: `${options.length} candidates passed all 11 deterministic checks.`, status: 'complete' },
    { id: 'handoff', label: 'Prepare the handoffs', detail: options.length ? 'Drafted updates for affected session owners. Nothing has been sent.' : 'No checked plan was found; no handoff drafts were created.', status: 'complete' },
  ]
  return result
}

export function repairPlan(plan: EventPlan, text: string): RepairResult {
  return repairInterpretedPlan(plan, interpretDisruption(plan, text), text)
}

export function parseImportedPlan(value: unknown): EventPlan {
  if (!value || typeof value !== 'object') throw new Error('The file must contain a JSON event plan.')
  const plan = value as EventPlan
  const str = (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0
  const bounded = (item: unknown, max: number, empty = false): item is string => typeof item === 'string' && (empty || item.trim().length > 0) && item.length <= max
  const keys = (item: unknown, allowed: string[]): boolean => !!item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every(key => allowed.includes(key))
  if (!keys(plan, ['id', 'name', 'date', 'timezone', 'venue', 'start', 'end', 'asOf', 'sessions', 'rooms', 'people'])) throw new Error('The event has unrecognized fields. Use the downloadable sample format.')
  if (!['id', 'name', 'date', 'timezone', 'venue'].every(key => str(plan[key as keyof EventPlan]))) throw new Error('Include the event id, name, date, timezone, and venue.')
  if (!bounded(plan.id, 80) || !bounded(plan.name, 200) || !bounded(plan.venue, 200) || !bounded(plan.timezone, 80)) throw new Error('The event name or identifier is too long.')
  const date = new Date(`${plan.date}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== plan.date) throw new Error('Use a valid event date in YYYY-MM-DD format.')
  try { new Intl.DateTimeFormat('en-US', { timeZone: plan.timezone }).format(date) } catch { throw new Error('Use a valid IANA timezone, such as America/Chicago.') }
  if (!Number.isInteger(plan.start) || !Number.isInteger(plan.end) || plan.start < 0 || plan.end > 1440 || plan.start >= plan.end) throw new Error('Event start and end must be minutes from midnight within a single day.')
  if (plan.asOf !== undefined && (!Number.isInteger(plan.asOf) || plan.asOf < plan.start || plan.asOf > plan.end)) throw new Error('Repair-from time must be a whole minute inside the event window.')
  if (!Array.isArray(plan.sessions) || !plan.sessions.length || plan.sessions.length > 36 || !Array.isArray(plan.rooms) || !plan.rooms.length || plan.rooms.length > 12 || !Array.isArray(plan.people) || !plan.people.length || plan.people.length > 60) throw new Error('Include 1–36 activities, 1–12 rooms, and 1–60 people.')
  if (plan.rooms.some(room => !keys(room, ['id', 'name', 'capacity', 'equipment']) || !bounded(room.id, 80) || !bounded(room.name, 150) || !Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 100000 || !Array.isArray(room.equipment) || room.equipment.length > 20 || room.equipment.some(item => !str(item)))) throw new Error('Each room needs an id, name, positive capacity, and equipment list.')
  if (plan.people.some(person => !keys(person, ['id', 'name', 'role', 'initials', 'color', 'availableFrom', 'availableUntil']) || !bounded(person.id, 80) || !bounded(person.name, 150) || !bounded(person.role, 150, true) || !bounded(person.initials, 8, true) || !bounded(person.color, 50, true) || (person.availableFrom !== undefined && (!Number.isInteger(person.availableFrom) || person.availableFrom < 0 || person.availableFrom > 1440)) || (person.availableUntil !== undefined && (!Number.isInteger(person.availableUntil) || person.availableUntil < 0 || person.availableUntil > 1440)) || (person.availableFrom !== undefined && person.availableUntil !== undefined && person.availableUntil < person.availableFrom))) throw new Error('Each person needs an id, name, role, initials, and color. Availability uses whole minutes within the day.')
  if ([plan.sessions, plan.rooms, plan.people].some(items => new Set(items.map(item => item.id)).size !== items.length)) throw new Error('Activity, room, and person IDs must be unique within their lists.')
  if (plan.sessions.some(session => !keys(session, ['id', 'title', 'start', 'duration', 'roomId', 'ownerId', 'attendees', 'kind', 'locked', 'notes', 'requiredEquipment', 'setupMinutes']) || !bounded(session.id, 80) || !bounded(session.title, 200) || !bounded(session.roomId, 80) || !bounded(session.ownerId, 80) || !Number.isInteger(session.start) || !Number.isInteger(session.duration) || session.duration > 720 || !Number.isInteger(session.attendees) || session.attendees < 0 || session.attendees > 100000 || !['session', 'break', 'fixed'].includes(session.kind) || typeof session.locked !== 'boolean' || !bounded(session.notes, 2000, true) || !Array.isArray(session.requiredEquipment) || session.requiredEquipment.length > 20 || session.requiredEquipment.some(item => !str(item)) || (session.setupMinutes !== undefined && (!Number.isInteger(session.setupMinutes) || session.setupMinutes < 0 || session.setupMinutes > 120)))) throw new Error('An activity has invalid or missing fields. Download the sample to see the expected shape.')
  const checks = validateCandidate(plan, plan.sessions, { kind: 'unknown', targetId: null, minutes: 0, description: 'Validate the imported baseline.' })
  const failed = checks.filter(check => !check.passed)
  if (failed.length) throw new Error(`The imported baseline needs attention: ${failed.map(check => check.label.toLowerCase()).join('; ')}.`)
  return JSON.parse(JSON.stringify(plan)) as EventPlan
}

export function exportHandoff(plan: EventPlan, result: RepairResult, option: RepairOption, approved = false): string {
  return `RIPPLE · ${approved ? 'UPDATED RUN OF SHOW' : 'PROPOSED RUN OF SHOW'}\n${approved ? 'APPROVED LOCALLY — this repair was applied in the organizer workspace.' : 'PROPOSAL ONLY — this repair has not been applied.'}\n${plan.name}\n${plan.date} · ${plan.venue} · ${plan.timezone}\n${result.mode === 'demo' ? 'RULE-BASED PLAN — calculated with scheduling rules; no AI model was called.' : 'LIVE MODE — generated by the connected service and checked against plan constraints.'}\n\nTHE CHANGE\n${result.interpretation.description}\n\nTHE REPAIR\n${option.title}\n${option.description}\n\nRUN OF SHOW\n${[...option.sessions].sort((a, b) => a.start - b.start).map(session => `${formatTimeFull(session.start)}–${formatTimeFull(session.start + session.duration)} | ${session.title}\n  ${plan.rooms.find(room => room.id === session.roomId)?.name} · ${plan.people.find(person => person.id === session.ownerId)?.name}${session.locked ? ' · FIXED' : ''}`).join('\n\n')}\n\nWHAT CHANGED\n${option.changes.map(change => `${plan.sessions.find(session => session.id === change.sessionId)?.title}: ${change.before} → ${change.after}\n  ${change.reason}`).join('\n\n')}\n\nCHECKS\n${option.checks.map(check => `${check.passed ? 'PASS' : 'FAIL'} · ${check.label}: ${check.detail}`).join('\n')}\n\nHANDOFF DRAFTS — nothing has been sent\n\n${option.handoffs.map(handoff => `${handoff.title}\n${handoff.message}`).join('\n\n---\n\n')}\n`
}
