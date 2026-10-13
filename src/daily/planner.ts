import { parseWorkspace } from './storage'
import type { DailyCheck, DailyTask, DayPlan, PlanBlock, UnscheduledTask, Workspace } from './types'

type Window = { start: number; end: number }
const overlap = (a: Window, b: Window) => Math.max(a.start, b.start) < Math.min(a.end, b.end)
const length = (block: Window) => block.end - block.start
const priority = { high: 3, normal: 2, low: 1 }
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const minimumChunk = (minutes: number, focus: number) => Math.max(1, Math.min(15, focus, Math.floor(minutes / Math.ceil(minutes / focus))))

function openWindows(start: number, end: number, busy: Window[]): Window[] {
  const windows: Window[] = []
  let cursor = start
  for (const block of [...busy].filter(item => item.end > start && item.start < end).sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (block.start > cursor) windows.push({ start: cursor, end: Math.min(block.start, end) })
    cursor = Math.max(cursor, block.end)
    if (cursor >= end) break
  }
  if (cursor < end) windows.push({ start: cursor, end })
  return windows
}

const deadline = (task: DailyTask, workspace: Workspace) => task.dueDate === workspace.settings.date && task.dueTime !== undefined ? Math.min(task.dueTime, workspace.settings.end) : workspace.settings.end
const future = (task: DailyTask, workspace: Workspace) => !!task.earliestDate && task.earliestDate > workspace.settings.date
const taskBlocks = (blocks: PlanBlock[], id: string) => blocks.filter(block => block.kind === 'task' && block.taskId === id)

function solve(workspace: Workspace, strategy: number): { blocks: PlanBlock[]; overflow: UnscheduledTask[] } {
  const { settings, tasks } = workspace
  const blocks: PlanBlock[] = workspace.commitments.filter(item => item.date === settings.date).map(item => ({ id: `commitment:${item.id}`, commitmentId: item.id, kind: 'commitment', title: item.title, start: item.start, end: item.end }))
  const fixed = [...blocks]
  const byId = new Map(tasks.map(task => [task.id, task]))
  const dependents = new Map(tasks.map(task => [task.id, tasks.filter(other => other.dependsOn.includes(task.id) && other.status !== 'done')]))
  const importance = new Map<string, { level: number; due: string }>()
  const rank = (task: DailyTask): { level: number; due: string } => {
    const known = importance.get(task.id)
    if (known) return known
    const children = dependents.get(task.id)!.filter(item => !future(item, workspace)).map(rank)
    const due = `${task.dueDate ?? '9999-12-31'}T${clock(task.dueTime ?? 1440)}`
    const value = { level: Math.max(priority[task.priority], ...children.map(item => item.level)), due: [due, ...children.map(item => item.due)].sort()[0] }
    importance.set(task.id, value)
    return value
  }
  const compare = (a: DailyTask, b: DailyTask) => {
    const ra = rank(a), rb = rank(b)
    const byPriority = rb.level - ra.level
    const byDue = ra.due.localeCompare(rb.due)
    return (strategy === 1 ? byDue || byPriority : strategy === 2 ? byPriority || a.minutes - b.minutes || byDue : byPriority || byDue) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  }
  const pending = new Map(tasks.filter(task => task.status === 'todo').map(task => [task.id, task]))
  const processed = new Set(tasks.filter(task => task.status === 'done').map(task => task.id))
  const fullyPlanned = new Set(processed)
  const overflow: UnscheduledTask[] = []
  while (pending.size) {
    const ready = [...pending.values()].filter(task => task.dependsOn.every(id => processed.has(id))).sort(compare)
    const task = ready[0]
    if (!task) throw new Error('Task dependencies could not be ordered. Check for missing or cyclic prerequisites.')
    pending.delete(task.id); processed.add(task.id)
    if (future(task, workspace)) {
      overflow.push({ taskId: task.id, remainingMinutes: task.minutes, code: 'future', reason: `Available from ${task.earliestDate}; kept for a later day.` })
      continue
    }
    const blocked = task.dependsOn.filter(id => !fullyPlanned.has(id))
    if (blocked.length) {
      overflow.push({ taskId: task.id, remainingMinutes: task.minutes, code: 'dependency', reason: `First finish or fully plan ${blocked.map(id => `“${byId.get(id)!.title}”`).join(', ')}.` })
      continue
    }
    const release = Math.max(settings.planFrom, ...task.dependsOn.flatMap(id => taskBlocks(blocks, id).map(block => block.end)))
    const latest = deadline(task, workspace)
    let remaining = task.minutes
    const minimumBlock = minimumChunk(task.minutes, settings.focusMinutes)
    while (remaining > 0) {
      const busy = [...fixed, ...blocks.filter(block => block.kind === 'task').map(block => ({ start: block.start - settings.breakMinutes, end: block.end + settings.breakMinutes }))]
      const windows = openWindows(Math.max(settings.start, release), latest, busy)
      if (task.splittable && remaining < minimumBlock) break
      const slot = windows.find(window => length(window) >= (task.splittable ? minimumBlock : remaining))
      if (!slot) break
      const balancedCap = remaining - (Math.ceil(remaining / settings.focusMinutes) - 1) * minimumBlock
      let minutes = task.splittable ? Math.min(remaining, settings.focusMinutes, length(slot), balancedCap) : remaining
      if (task.splittable && remaining > minutes && remaining - minutes < minimumBlock) {
        const balanced = remaining - minimumBlock
        if (balanced >= minimumBlock) minutes = balanced
      }
      const count = taskBlocks(blocks, task.id).length + 1
      blocks.push({ id: `task:${task.id}:${count}`, kind: 'task', taskId: task.id, title: task.title, start: slot.start, end: slot.start + minutes })
      remaining -= minutes
    }
    if (!remaining) fullyPlanned.add(task.id)
    else {
      const timed = task.dueDate === settings.date && task.dueTime !== undefined
      const reason = timed ? `${remaining} minutes were not placed before the ${clock(task.dueTime!)} deadline. Change the estimate, deadline or today's workload.` : `${remaining} minutes were not placed within working hours${task.splittable ? ' with the chosen focus blocks and breaks' : ' in one uninterrupted block'}. Keep this work visible for another plan.`
      overflow.push({ taskId: task.id, remainingMinutes: remaining, code: timed ? 'deadline' : 'capacity', reason })
    }
  }
  for (const task of tasks) {
    const parts = taskBlocks(blocks, task.id).sort((a, b) => a.start - b.start)
    parts.forEach((block, index) => { block.part = index + 1; block.parts = parts.length })
  }
  // Display real free breaks only. Fixed commitments are never relabeled as rest.
  const ordered = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  ordered.forEach((block, index) => {
    if (block.kind === 'task' && settings.breakMinutes > 0 && ordered.slice(index + 1).some(item => item.kind === 'task')) {
      const end = block.end + settings.breakMinutes
      if (end <= settings.end && !ordered.some(other => other !== block && overlap({ start: block.end, end }, other))) blocks.push({ id: `break:${block.id}`, kind: 'break', title: 'Take a break', start: block.end, end })
    }
  })
  return { blocks: blocks.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id)), overflow }
}

/** A bounded deterministic planner; overflow remains part of the result, never silently discarded. */
export function planDay(input: Workspace): DayPlan {
  const workspace = parseWorkspace(input)
  const candidates = [0, 1, 2].map(strategy => solve(workspace, strategy))
  const penalty = (candidate: typeof candidates[number]) => ['high', 'normal', 'low'].flatMap(level => {
    const relevant = candidate.overflow.filter(item => workspace.tasks.find(task => task.id === item.taskId)!.priority === level && item.code !== 'future')
    return [relevant.length, relevant.reduce((sum, item) => sum + item.remainingMinutes, 0)]
  })
  candidates.sort((a, b) => { const pa = penalty(a), pb = penalty(b); for (let index = 0; index < pa.length; index++) if (pa[index] !== pb[index]) return pa[index] - pb[index]; return a.blocks.length - b.blocks.length })
  const chosen = candidates[0]
  const fixed = workspace.commitments.filter(item => item.date === workspace.settings.date)
  const overdue = workspace.tasks.filter(task => task.status === 'todo' && task.dueDate && task.dueDate < workspace.settings.date && !future(task, workspace))
  const conflicts = fixed.filter((item, index) => fixed.slice(index + 1).some(other => overlap(item, other)))
  const outsideHours = fixed.filter(item => item.start < workspace.settings.start || item.end > workspace.settings.end)
  const work = chosen.blocks.filter(block => block.kind === 'task')
  const fullyPlaced = workspace.tasks.filter(task => task.status === 'todo' && work.filter(block => block.taskId === task.id).reduce((sum, block) => sum + length(block), 0) === task.minutes).length
  const overflowCount = chosen.overflow.filter(item => item.code !== 'future').length
  const result: DayPlan = {
    date: workspace.settings.date, ...chosen, checks: [],
    summary: `${fullyPlaced} task${fullyPlaced === 1 ? '' : 's'} fully planned${overflowCount ? `; ${overflowCount} need${overflowCount === 1 ? 's' : ''} more room or a decision` : ''}.`,
    scheduledMinutes: work.reduce((sum, block) => sum + length(block), 0),
    availableMinutes: openWindows(workspace.settings.planFrom, workspace.settings.end, fixed).reduce((sum, window) => sum + length(window), 0),
    completedTaskIds: workspace.tasks.filter(task => task.status === 'done').map(task => task.id),
    warnings: [...overdue.map(task => `“${task.title}” was due ${task.dueDate}; it remains eligible today and is still overdue.`), ...(conflicts.length ? ['Some fixed commitments overlap. Their original times are preserved; resolve those conflicts yourself. Task blocks avoid all of them.'] : []), ...outsideHours.map(item => `“${item.title}” (${clock(item.start)}–${clock(item.end)}) extends outside your ${clock(workspace.settings.start)}–${clock(workspace.settings.end)} working hours and remains fixed. Working hours limit task blocks; they do not move this commitment.`)],
  }
  result.checks = validateDayPlan(workspace, result)
  if (result.checks.some(check => !check.passed)) throw new Error('The generated plan failed an independent scheduling check. No plan was applied.')
  return result
}

/** Recompute every scheduling invariant. A model's or worker's claimed checks are never authoritative. */
export function validateDayPlan(input: Workspace, plan: DayPlan): DailyCheck[] {
  let workspace: Workspace
  try { workspace = parseWorkspace(input) } catch (error) { return [{ id: 'input', label: 'Valid workspace', passed: false, detail: error instanceof Error ? error.message : 'Invalid workspace.' }] }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.blocks) || !Array.isArray(plan.overflow) || plan.blocks.some(block => !block || typeof block !== 'object') || plan.overflow.some(item => !item || typeof item !== 'object')) return [{ id: 'shape', label: 'Valid result structure', passed: false, detail: 'The result must contain valid block and unscheduled-task arrays.' }]
  const { tasks, settings } = workspace
  const byId = new Map(tasks.map(task => [task.id, task]))
  const fixed = workspace.commitments.filter(item => item.date === settings.date)
  const blocks = Array.isArray(plan.blocks) ? plan.blocks : []
  const work = blocks.filter(block => block.kind === 'task')
  const breaks = blocks.filter(block => block.kind === 'break')
  const overflow = Array.isArray(plan.overflow) ? plan.overflow : []
  const total = (id: string) => work.filter(block => block.taskId === id).reduce((sum, block) => sum + length(block), 0)
  const check = (id: string, label: string, passed: boolean, detail: string): DailyCheck => ({ id, label, passed, detail })
  const shape = blocks.every(block => typeof block.id === 'string' && block.id.trim().length > 0 && block.id.length <= 200 && typeof block.title === 'string' && block.title.trim().length > 0 && block.title.length <= 200 && ['task', 'commitment', 'break'].includes(block.kind) && Number.isInteger(block.start) && Number.isInteger(block.end) && block.start >= 0 && block.end <= 1440 && block.end > block.start) && new Set(blocks.map(block => block.id)).size === blocks.length
  const partsConsistent = blocks.every(block => {
    if (block.part === undefined && block.parts === undefined) return true
    if (block.kind !== 'task' || !Number.isInteger(block.part) || !Number.isInteger(block.parts) || block.part! < 1 || block.parts! > 200) return false
    const pieces = taskBlocks(blocks, block.taskId ?? '').sort((a, b) => a.start - b.start)
    return block.parts === pieces.length && block.part === pieces.indexOf(block) + 1
  })
  const known = work.every(block => { const task = byId.get(block.taskId ?? ''); return !!task && task.status === 'todo' && !future(task, workspace) && block.title === task.title && !block.commitmentId })
  const overflowKnown = overflow.every(item => byId.get(item.taskId)?.status === 'todo' && Number.isInteger(item.remainingMinutes) && item.remainingMinutes > 0 && ['capacity', 'deadline', 'dependency', 'future', 'invalid'].includes(item.code) && typeof item.reason === 'string' && item.reason.length > 0) && new Set(overflow.map(item => item.taskId)).size === overflow.length
  const commitments = blocks.filter(block => block.kind === 'commitment')
  const fixedPreserved = commitments.length === fixed.length && new Set(commitments.map(block => block.commitmentId)).size === fixed.length && commitments.every(block => { const original = fixed.find(item => item.id === block.commitmentId); return !!original && original.start === block.start && original.end === block.end && original.title === block.title && !block.taskId })
  const orderedWork = [...work].sort((a, b) => a.start - b.start)
  const accounting = tasks.every(task => task.status === 'done' ? total(task.id) === 0 && !overflow.some(item => item.taskId === task.id) : total(task.id) + (overflow.find(item => item.taskId === task.id)?.remainingMinutes ?? 0) === task.minutes)
  const completed = tasks.filter(task => task.status === 'done').map(task => task.id)
  return [
    check('shape', 'Valid block times and identities', shape && partsConsistent && known && plan.date === settings.date, 'Only known, unfinished, currently eligible tasks may receive task blocks.'),
    check('commitments', 'Fixed commitments stay fixed', fixedPreserved, 'Every commitment for this date keeps its exact time and title, including existing conflicts.'),
    check('accounting', 'Every task minute is accounted for', overflowKnown && accounting, 'Unscheduled minutes stay visible in the task backlog; planning never marks work done.'),
    check('hours', 'Task blocks stay inside working hours', work.every(block => block.start >= settings.planFrom && block.end <= settings.end), `Planning starts at ${clock(settings.planFrom)} and ends at ${clock(settings.end)}.`),
    check('overlap', 'Task blocks do not double-book your time', work.every((block, index) => !work.slice(index + 1).some(other => overlap(block, other)) && !fixed.some(other => overlap(block, other))), 'Task blocks avoid each other and all fixed commitments.'),
    check('deadline', 'Same-day time deadlines are respected', work.every(block => block.end <= deadline(byId.get(block.taskId ?? '') ?? { dueDate: undefined } as DailyTask, workspace)), 'An explicit time deadline for today is a hard boundary. Overdue dates stay visible as warnings.'),
    check('splitting', 'Task splitting follows your choice', tasks.every(task => { const parts = taskBlocks(blocks, task.id); return task.splittable ? parts.every(block => length(block) >= minimumChunk(task.minutes, settings.focusMinutes) && length(block) <= settings.focusMinutes) : parts.length === 0 || parts.length === 1 && length(parts[0]) === task.minutes }), 'Split blocks balance useful chunks within the focus preference. Uninterrupted tasks keep their full estimate.'),
    check('dependencies', 'Prerequisites finish before dependent work', work.every(block => { const task = byId.get(block.taskId ?? ''); return !!task && task.dependsOn.every(id => byId.get(id)?.status === 'done' || total(id) === byId.get(id)?.minutes && taskBlocks(blocks, id).every(prerequisite => prerequisite.end <= block.start)) }), 'A dependent task is not started after a partially planned prerequisite.'),
    check('breaks', 'Breaks between task blocks are preserved', orderedWork.every((block, index) => index === 0 || orderedWork[index - 1].end + settings.breakMinutes <= block.start) && breaks.every(block => length(block) === settings.breakMinutes && block.start >= settings.planFrom && block.end <= settings.end && !block.taskId && !block.commitmentId && !blocks.some(other => other !== block && overlap(block, other))), 'The chosen gap separates task blocks; displayed breaks occupy real free time.'),
    check('totals', 'Summary totals match the blocks', plan.scheduledMinutes === work.reduce((sum, block) => sum + length(block), 0) && plan.availableMinutes === openWindows(settings.planFrom, settings.end, fixed).reduce((sum, window) => sum + length(window), 0) && Array.isArray(plan.completedTaskIds) && plan.completedTaskIds.length === completed.length && new Set(plan.completedTaskIds).size === completed.length && completed.every(id => plan.completedTaskIds.includes(id)), 'Scheduled work, time available and explicit completed tasks are counted independently.'),
  ]
}
