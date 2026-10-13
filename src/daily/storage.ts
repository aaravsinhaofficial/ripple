import type { DailyTask, Workspace } from './types'

export const WORKSPACE_STORAGE_KEY = 'ripple-daily-workspace-v1'
export const newId = (prefix = 'task'): string => `${prefix}-${crypto.randomUUID()}`

export function localDate(now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (name: string) => parts.find(item => item.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export function addDays(date: string, days: number): string {
  if (!validDate(date) || !Number.isInteger(days)) throw new Error('Use a valid date and a whole number of days.')
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function createWorkspace(date = localDate(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): Workspace {
  return parseWorkspace({ version: 1, tasks: [], commitments: [], settings: { date, timezone, start: 540, end: 1020, planFrom: 540, breakMinutes: 5, focusMinutes: 50 } })
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const timestamp = (value: unknown) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:[0-5]\d)$/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
const validSource = (value: unknown): boolean => {
  if (value === undefined) return true
  if (!object(value) || !keys(value, ['provider', 'label', 'namespace', 'externalId', 'fingerprint', 'importedAt', 'url', 'sourceDate']) || !['ics', 'csv', 'notes', 'json', 'google-calendar', 'google-tasks', 'notion', 'todoist', 'granola', 'otter', 'github', 'linear', 'outlook'].includes(value.provider as string) || !text(value.label, 200) || !text(value.namespace, 200) || !text(value.externalId, 500) || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(value.fingerprint) || !timestamp(value.importedAt) || (value.sourceDate !== undefined && !validDate(value.sourceDate))) return false
  if (value.url !== undefined) {
    if (!text(value.url, 2000)) return false
    try { const url = new URL(value.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false } catch { return false }
  }
  return true
}

/** The import/storage boundary is strict; unrelated event backups cannot overwrite this workspace. */
export function parseWorkspace(value: unknown): Workspace {
  if (typeof value === 'string') {
    if (value.length > 1_000_000) throw new Error('The backup is larger than 1 MB.')
    try { value = JSON.parse(value) } catch { throw new Error('The backup must contain valid JSON.') }
  }
  if (!object(value) || !keys(value, ['version', 'tasks', 'commitments', 'settings']) || value.version !== 1) throw new Error('Use a Ripple daily-workspace version 1 backup.')
  const settings = value.settings
  if (!object(settings) || !keys(settings, ['date', 'timezone', 'start', 'end', 'planFrom', 'breakMinutes', 'focusMinutes']) || !validDate(settings.date) || !text(settings.timezone, 80)) throw new Error('Choose a valid day and IANA timezone.')
  try { new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone }).format() } catch { throw new Error('Choose a valid IANA timezone, such as America/Chicago.') }
  if (!integer(settings.start, 0, 1439) || !integer(settings.end, 1, 1440) || settings.start >= settings.end || !integer(settings.planFrom, settings.start, settings.end)) throw new Error('Working hours must end after they start; plan-from must be inside those hours.')
  if (!integer(settings.breakMinutes, 0, 30) || !integer(settings.focusMinutes, 10, 180)) throw new Error('Choose a 0–30 minute break and 10–180 minute focus block.')
  if (!Array.isArray(value.tasks) || value.tasks.length > 200 || !Array.isArray(value.commitments) || value.commitments.length > 50) throw new Error('A workspace supports up to 200 tasks and 50 fixed commitments.')
  for (const task of value.tasks) {
    if (!object(task) || !keys(task, ['id', 'title', 'minutes', 'priority', 'project', 'notes', 'status', 'dueDate', 'dueTime', 'earliestDate', 'dependsOn', 'splittable', 'recurrence', 'seriesId', 'createdAt', 'completedAt', 'source']) || !text(task.id, 160) || !text(task.title, 200) || !integer(task.minutes, 1, 720) || !['high', 'normal', 'low'].includes(task.priority as string) || !text(task.project, 80, true) || !text(task.notes, 2000, true) || !['todo', 'done'].includes(task.status as string) || typeof task.splittable !== 'boolean' || !['none', 'daily', 'weekdays', 'weekly'].includes(task.recurrence as string) || !timestamp(task.createdAt)) throw new Error('Each task needs a title, 1–720 estimated minutes, priority, status and recurrence setting.')
    if (!validSource(task.source)) throw new Error(`Check the imported source details for “${task.title}”.`)
    if ((task.dueDate !== undefined && !validDate(task.dueDate)) || (task.earliestDate !== undefined && !validDate(task.earliestDate)) || (task.dueTime !== undefined && (!task.dueDate || !integer(task.dueTime, 0, 1440))) || (task.seriesId !== undefined && !text(task.seriesId, 160)) || (task.completedAt !== undefined && !timestamp(task.completedAt))) throw new Error(`Check the dates and deadline for “${task.title}”. A due time needs a due date.`)
    if (!Array.isArray(task.dependsOn) || task.dependsOn.length > 200 || task.dependsOn.some(id => !text(id, 160)) || new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.includes(task.id)) throw new Error(`Check the prerequisites for “${task.title}”; duplicates and self-dependencies are not allowed.`)
  }
  const tasks = value.tasks as unknown as DailyTask[]
  const byId = new Map(tasks.map(task => [task.id, task]))
  if (byId.size !== tasks.length) throw new Error('Task IDs must be unique.')
  if (tasks.some(task => task.dependsOn.some(id => !byId.has(id)))) throw new Error('Every prerequisite must reference an existing task. Update dependencies before deleting a task.')
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Task dependencies contain a cycle. Remove a prerequisite so tasks can finish in order.')
    if (visited.has(id)) return
    visiting.add(id)
    byId.get(id)!.dependsOn.forEach(visit)
    visiting.delete(id); visited.add(id)
  }
  tasks.forEach(task => visit(task.id))
  for (const commitment of value.commitments) {
    if (!object(commitment) || !keys(commitment, ['id', 'title', 'date', 'start', 'end', 'notes', 'source']) || !text(commitment.id, 160) || !text(commitment.title, 200) || !validDate(commitment.date) || !integer(commitment.start, 0, 1439) || !integer(commitment.end, 1, 1440) || commitment.start >= commitment.end || !text(commitment.notes, 2000, true)) throw new Error('Each fixed commitment needs a title, date and end time after its start.')
    if (!validSource(commitment.source)) throw new Error(`Check the imported source details for “${commitment.title}”.`)
  }
  if (new Set(value.commitments.map(item => item.id)).size !== value.commitments.length) throw new Error('Commitment IDs must be unique.')
  const encoded = JSON.stringify(value)
  if (encoded.length > 1_000_000) throw new Error('The workspace is larger than the 1 MB backup limit. Archive completed tasks or shorten notes before saving.')
  return JSON.parse(encoded) as Workspace
}

export function loadWorkspace(): Workspace | null {
  if (typeof localStorage === 'undefined') return null
  const saved = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  return saved === null ? null : parseWorkspace(saved)
}

export function saveWorkspace(workspace: Workspace): void {
  if (typeof localStorage === 'undefined') throw new Error('Browser storage is unavailable. Download a backup to keep your tasks.')
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(parseWorkspace(workspace)))
}

export function completeTask(workspace: Workspace, id: string, now = new Date()): Workspace {
  const result = parseWorkspace(workspace)
  const task = result.tasks.find(item => item.id === id)
  if (!task) throw new Error('This task no longer exists.')
  if (task.status === 'done') return result
  task.status = 'done'
  task.completedAt = now.toISOString()
  if (task.recurrence === 'none') return result
  const completedDate = localDate(now, result.settings.timezone)
  const occurrenceDate = task.earliestDate ?? task.dueDate ?? result.settings.date
  const base = [occurrenceDate, completedDate].sort().at(-1)!
  const elapsedDays = Math.floor((Date.parse(`${completedDate}T12:00:00Z`) - Date.parse(`${occurrenceDate}T12:00:00Z`)) / 86400000)
  let nextDate = task.recurrence === 'weekly' ? addDays(occurrenceDate, Math.max(1, Math.floor(elapsedDays / 7) + 1) * 7) : addDays(base, 1)
  if (task.recurrence === 'weekdays') while ([0, 6].includes(new Date(`${nextDate}T12:00:00Z`).getUTCDay())) nextDate = addDays(nextDate, 1)
  const seriesId = task.seriesId ?? task.id
  // Full series identity is checked as well as date, so repeated completion/restore cannot duplicate an occurrence.
  if (result.tasks.some(item => item.seriesId === seriesId && item.earliestDate === nextDate)) return result
  if (result.tasks.length >= 200) throw new Error('Archive a completed task before creating the next recurring occurrence; this workspace has 200 tasks.')
  let hash = 2166136261
  for (const character of seriesId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
  const nextId = `repeat-${hash.toString(16)}-${nextDate}`
  if (result.tasks.some(item => item.id === nextId)) throw new Error('A recurring-task identifier conflicts with another task. The task was not marked done; restore or edit that entry first.')
  const offset = Math.round((Date.parse(`${nextDate}T12:00:00Z`) - Date.parse(`${occurrenceDate}T12:00:00Z`)) / 86400000)
  const next: DailyTask = { ...task, id: nextId, seriesId, status: 'todo', earliestDate: nextDate, createdAt: now.toISOString(), dependsOn: [...task.dependsOn] }
  delete next.completedAt
  // A locally generated recurrence is not a second copy of the external source item.
  delete next.source
  if (task.dueDate) next.dueDate = addDays(task.dueDate, offset)
  result.tasks.push(next)
  return parseWorkspace(result)
}

export function sampleWorkspace(date = localDate()): Workspace {
  const workspace = createWorkspace(date)
  const createdAt = `${date}T08:00:00.000Z`
  const task = (id: string, title: string, minutes: number, extras: Partial<DailyTask> = {}): DailyTask => ({ id, title, minutes, priority: 'normal', project: '', notes: '', status: 'todo', dependsOn: [], splittable: true, recurrence: 'none', createdAt, ...extras })
  workspace.tasks = [
    task('outline', 'Outline the project update', 40, { priority: 'high', project: 'Work', dueDate: date, dueTime: 720 }),
    task('slides', 'Build the project update slides', 70, { priority: 'high', project: 'Work', dependsOn: ['outline'], dueDate: date, dueTime: 900 }),
    task('inbox', 'Clear the important messages', 25, { project: 'Admin', recurrence: 'weekdays' }),
    task('learn', 'Practice one new skill', 45, { project: 'Personal', priority: 'low' }),
    task('errand', 'Book the appointment', 15, { project: 'Personal', splittable: false }),
  ]
  workspace.commitments = [
    { id: 'standup', title: 'Team check-in', date, start: 600, end: 630, notes: 'Fixed commitment' },
    { id: 'lunch', title: 'Lunch away from the desk', date, start: 750, end: 795, notes: '' },
  ]
  return workspace
}
