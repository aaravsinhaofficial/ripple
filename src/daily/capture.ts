import { addDays, localDate, newId, validDate } from './storage'
import type { DailyTask, TaskPriority, TaskRecurrence } from './types'

/** One line = one task. Only explicit lightweight tokens are interpreted. */
export function captureLines(text: string, date = localDate()): DailyTask[] {
  if (!validDate(date)) throw new Error('Choose a valid date before capturing tasks.')
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length > 200 || text.length > 100_000) throw new Error('Capture up to 200 task lines at a time.')
  const createdAt = new Date().toISOString()
  return lines.map((raw, index) => {
    let title = raw.replace(/^[-*•]\s+|^\d+[.)]\s+/, '').replace(/^\[\s*\]\s*/, '')
    const error = (message: string): never => { throw new Error(`Line ${index + 1}: ${message}`) }
    const duration = /(?:^|\s|\()(?:(-?\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?:\s*(\d+)\s*(?:minutes?|mins?|m))?|(-?\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m))(?=\s|$|\))/gi
    const amounts = [...title.matchAll(duration)]
    if (amounts.length > 1) error('Use one estimate per line, such as “Draft report 45m”.')
    const amount = amounts[0]
    const minutes = amount ? amount[1] !== undefined ? Number(amount[1]) * 60 + Number(amount[2] ?? 0) : Number(amount[3]) : 30
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) error('Use a whole-minute estimate between 1m and 12h.')
    if (amount) {
      const end = amount.index! + amount[0].length
      title = title.slice(0, amount.index) + ' ' + title.slice(end + (amount[0].startsWith('(') && title[end] === ')' ? 1 : 0))
    }
    const projects = [...title.matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_.-]{0,79})(?=\s|$)/gu)]
    if (projects.length > 1) error('Use at most one #project per task.')
    const project = projects[0]?.[1] ?? ''
    if (projects[0]) title = title.replace(projects[0][0], ' ')
    const priorities = [...title.matchAll(/(?:^|\s)!(high|normal|low)(?=\s|$)/gi)]
    if (priorities.length > 1) error('Use one priority: !high, !normal or !low.')
    const priority = (priorities[0]?.[1].toLowerCase() ?? 'normal') as TaskPriority
    if (priorities[0]) title = title.replace(priorities[0][0], ' ')
    const repeat = [...title.matchAll(/(?:^|\s)~(daily|weekdays|weekly)(?=\s|$)/gi)]
    if (repeat.length > 1) error('Use one recurrence: ~daily, ~weekdays or ~weekly.')
    const recurrence = (repeat[0]?.[1].toLowerCase() ?? 'none') as TaskRecurrence
    if (repeat[0]) title = title.replace(repeat[0][0], ' ')
    const due = [...title.matchAll(/(?:^|\s)due:(today|tomorrow|\d{4}-\d{2}-\d{2})(?:@(\d{1,2}):(\d{2}))?(?=\s|$)/gi)]
    if (due.length > 1) error('Use one due date per task.')
    let dueDate: string | undefined, dueTime: number | undefined
    if (due[0]) {
      dueDate = due[0][1].toLowerCase() === 'today' ? date : due[0][1].toLowerCase() === 'tomorrow' ? addDays(date, 1) : due[0][1]
      if (!validDate(dueDate)) error('The due date is not a real calendar date.')
      if (due[0][2] !== undefined) {
        const hours = Number(due[0][2]), minute = Number(due[0][3])
        if (hours > 24 || minute > 59 || hours === 24 && minute !== 0) error('Use a due time from 00:00 through 24:00.')
        dueTime = hours * 60 + minute
      }
      title = title.replace(due[0][0], ' ')
    }
    title = title.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()
    if (!title || title.length > 200) error('Give the task a title of 1–200 characters.')
    return { id: newId(), title, minutes, priority, project, notes: '', status: 'todo', dependsOn: [], splittable: true, recurrence, createdAt, ...(dueDate ? { dueDate } : {}), ...(dueTime !== undefined ? { dueTime } : {}) }
  })
}
