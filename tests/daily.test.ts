import { describe, expect, it } from 'vitest'
import { captureLines } from '../src/daily/capture'
import { exportBackup, exportPlanCalendar, exportPlanText } from '../src/daily/export'
import { planDay, validateDayPlan } from '../src/daily/planner'
import { addDays, completeTask, createWorkspace, localDate, parseWorkspace, sampleWorkspace } from '../src/daily/storage'
import type { DailyTask, DayPlan, Workspace } from '../src/daily/types'

const DATE = '2026-10-13'
const task = (id: string, minutes = 30, extras: Partial<DailyTask> = {}): DailyTask => ({ id, title: id, minutes, priority: 'normal', project: '', notes: '', status: 'todo', dependsOn: [], splittable: true, recurrence: 'none', createdAt: `${DATE}T08:00:00.000Z`, ...extras })
const workspace = (...tasks: DailyTask[]): Workspace => ({ ...createWorkspace(DATE, 'America/Chicago'), tasks })
const checked = (source: Workspace, plan: DayPlan) => expect(validateDayPlan(source, plan).every(check => check.passed)).toBe(true)
const work = (plan: DayPlan, id?: string) => plan.blocks.filter(block => block.kind === 'task' && (!id || block.taskId === id))

describe('daily planning', () => {
  it('plans real tasks around fixed commitments and accounts for every minute', () => {
    const source = sampleWorkspace(DATE)
    const snapshot = JSON.stringify(source)
    const plan = planDay(source)
    checked(source, plan)
    expect(plan.scheduledMinutes).toBe(195)
    expect(plan.availableMinutes).toBe(405)
    expect(plan.overflow).toEqual([])
    expect(JSON.stringify(source)).toBe(snapshot)
    expect(planDay(source)).toEqual(plan)
  })

  it('starts unfinished tasks from plan-from, even if an older proposal put them in the past', () => {
    const source = workspace(task('a', 60), task('b', 30))
    expect(work(planDay(source))[0].start).toBe(540)
    source.settings.planFrom = 900
    const plan = planDay(source)
    expect(work(plan).every(block => block.start >= 900)).toBe(true)
    expect(plan.completedTaskIds).toEqual([])
    checked(source, plan)
  })

  it('keeps all overflow explicit when the day is full or has ended', () => {
    const source = workspace(task('important', 180, { priority: 'high' }), task('low', 180, { priority: 'low' }))
    source.settings.end = 660
    const plan = planDay(source)
    expect(work(plan, 'important').length).toBeGreaterThan(0)
    expect(plan.scheduledMinutes + plan.overflow.reduce((sum, item) => sum + item.remainingMinutes, 0)).toBe(360)
    checked(source, plan)
    source.settings.planFrom = source.settings.end
    const ended = planDay(source)
    expect(ended.availableMinutes).toBe(0)
    expect(ended.scheduledMinutes).toBe(0)
    expect(ended.overflow).toHaveLength(2)
    checked(source, ended)
  })

  it('uses a same-day time deadline as a hard boundary but keeps overdue-date work eligible', () => {
    const source = workspace(task('due', 90, { dueDate: DATE, dueTime: 600 }), task('overdue', 30, { dueDate: '2026-10-12', dueTime: 60 }))
    const plan = planDay(source)
    expect(work(plan, 'due').every(block => block.end <= 600)).toBe(true)
    expect(plan.overflow.find(item => item.taskId === 'due')!.code).toBe('deadline')
    expect(work(plan, 'overdue').length).toBeGreaterThan(0)
    expect(plan.warnings.some(warning => warning.includes('still overdue'))).toBe(true)
    checked(source, plan)
  })

  it('keeps future work visible and does not schedule its dependent early', () => {
    const source = workspace(task('future', 30, { earliestDate: '2026-10-14' }), task('dependent', 20, { dependsOn: ['future'] }))
    const plan = planDay(source)
    expect(work(plan)).toEqual([])
    expect(plan.overflow.find(item => item.taskId === 'future')!.code).toBe('future')
    expect(plan.overflow.find(item => item.taskId === 'dependent')!.code).toBe('dependency')
    checked(source, plan)
  })

  it('schedules prerequisites fully before dependent work and accepts already completed prerequisites', () => {
    const source = workspace(task('prepare', 40, { priority: 'low' }), task('deliver', 30, { priority: 'high', dependsOn: ['prepare'] }), task('finished', 60, { status: 'done' }), task('review', 20, { dependsOn: ['finished'] }))
    const plan = planDay(source)
    expect(Math.max(...work(plan, 'prepare').map(block => block.end))).toBeLessThanOrEqual(Math.min(...work(plan, 'deliver').map(block => block.start)))
    expect(work(plan, 'finished')).toEqual([])
    expect(plan.completedTaskIds).toEqual(['finished'])
    checked(source, plan)
  })

  it('does not pretend a partly scheduled prerequisite is completed', () => {
    const source = workspace(task('prepare', 180), task('deliver', 20, { priority: 'high', dependsOn: ['prepare'] }))
    source.settings.end = 660
    const plan = planDay(source)
    expect(work(plan, 'prepare').length).toBeGreaterThan(0)
    expect(work(plan, 'deliver')).toEqual([])
    expect(plan.overflow.find(item => item.taskId === 'deliver')!.code).toBe('dependency')
  })

  it('splits only permitted tasks and respects configured focus and break lengths', () => {
    const source = workspace(task('deep', 120, { splittable: false }), task('flexible', 90))
    source.settings.end = 720
    source.settings.focusMinutes = 30
    source.commitments = [{ id: 'meeting', title: 'Meeting', date: DATE, start: 600, end: 630, notes: '' }]
    const plan = planDay(source)
    expect(work(plan, 'deep')).toEqual([])
    expect(work(plan, 'flexible').reduce((sum, block) => sum + block.end - block.start, 0)).toBe(90)
    expect(work(plan, 'flexible').every(block => block.end - block.start <= 30)).toBe(true)
    checked(source, plan)
  })

  it('counts break time against capacity instead of promising more work than the day fits', () => {
    const source = workspace(task('work', 90))
    source.settings.end = 640
    source.settings.focusMinutes = 30
    source.settings.breakMinutes = 10
    const plan = planDay(source)
    expect(plan.availableMinutes).toBe(100)
    expect(plan.scheduledMinutes).toBe(75)
    expect(plan.blocks.filter(block => block.kind === 'break').reduce((sum, block) => sum + block.end - block.start, 0)).toBe(20)
    expect(plan.overflow).toMatchObject([{ taskId: 'work', remainingMinutes: 15 }])
    checked(source, plan)
  })

  it('can place an urgent normal-priority deadline first while still fitting all high-priority work', () => {
    const source = workspace(task('important', 90, { priority: 'high' }), task('time-sensitive', 30, { dueDate: DATE, dueTime: 600 }))
    source.settings.end = 720
    const plan = planDay(source)
    expect(plan.overflow).toEqual([])
    expect(work(plan, 'time-sensitive').every(block => block.end <= 600)).toBe(true)
    expect(plan.scheduledMinutes).toBe(120)
    checked(source, plan)
  })

  it('does not overrun an impossible high-priority deadline to claim completion', () => {
    const source = workspace(task('urgent', 30, { priority: 'high', dueDate: DATE, dueTime: 555 }), task('other', 30))
    const plan = planDay(source)
    expect(work(plan, 'urgent').reduce((sum, block) => sum + block.end - block.start, 0)).toBe(15)
    expect(plan.overflow.find(item => item.taskId === 'urgent')).toMatchObject({ remainingMinutes: 15, code: 'deadline' })
    expect(work(plan, 'other')).not.toEqual([])
    checked(source, plan)
  })

  it('allows an explicitly uninterrupted task beyond the focus preference but rejects oversized split blocks', () => {
    const source = workspace(task('whole', 75, { splittable: false }), task('split', 75))
    source.settings.focusMinutes = 30
    const plan = planDay(source)
    expect(work(plan, 'whole')).toHaveLength(1)
    expect(work(plan, 'whole')[0].end - work(plan, 'whole')[0].start).toBe(75)
    expect(work(plan, 'split').every(block => block.end - block.start <= 30)).toBe(true)
    const first = work(plan, 'split')[0]; first.end = first.start + 31
    expect(validateDayPlan(source, plan).find(check => check.id === 'splitting')!.passed).toBe(false)
  })

  it('avoids tiny gaps and balances chunks so a 55-minute task does not end with five minutes', () => {
    const source = workspace(task('balanced', 55), task('learn', 45))
    source.settings.focusMinutes = 50
    source.commitments = [{ id: 'meeting', title: 'Meeting', date: DATE, start: 545, end: 600, notes: '' }]
    const plan = planDay(source)
    expect(work(plan).every(block => block.start >= 600)).toBe(true)
    expect(work(plan, 'balanced').map(block => block.end - block.start)).toEqual([40, 15])
    expect(work(plan, 'learn')).toHaveLength(1)
    expect(plan.overflow).toEqual([])
    checked(source, plan)
  })

  it('balances a 25-minute task into 9, 8 and 8 minutes under a ten-minute focus preference', () => {
    const source = workspace(task('not-divisible', 25))
    source.settings.focusMinutes = 10
    const plan = planDay(source)
    expect(work(plan).map(block => block.end - block.start)).toEqual([9, 8, 8])
    expect(plan.scheduledMinutes).toBe(25)
    expect(plan.overflow).toEqual([])
    checked(source, plan)
  })

  it('preserves overlapping fixed commitments, warns, and counts their union once', () => {
    const source = workspace(task('work', 30))
    source.commitments = [{ id: 'one', title: 'One', date: DATE, start: 600, end: 660, notes: '' }, { id: 'two', title: 'Two', date: DATE, start: 630, end: 690, notes: '' }]
    const plan = planDay(source)
    expect(plan.availableMinutes).toBe(390)
    expect(plan.blocks.filter(block => block.kind === 'commitment')).toHaveLength(2)
    expect(plan.warnings.some(warning => warning.includes('commitments overlap'))).toBe(true)
    checked(source, plan)
  })

  it('warns about fixed commitments outside working hours without moving them or extending task time', () => {
    const source = workspace(task('work', 30))
    source.commitments = [{ id: 'late', title: 'Evening appointment', date: DATE, start: 1080, end: 1110, notes: '' }, { id: 'early', title: 'Morning check-in', date: DATE, start: 510, end: 550, notes: '' }]
    const plan = planDay(source)
    expect(plan.blocks.find(block => block.commitmentId === 'late')).toMatchObject({ start: 1080, end: 1110 })
    expect(plan.blocks.find(block => block.commitmentId === 'early')).toMatchObject({ start: 510, end: 550 })
    expect(plan.availableMinutes).toBe(470)
    expect(work(plan).every(block => block.start >= 550 && block.end <= 1020)).toBe(true)
    expect(plan.warnings.filter(warning => warning.includes('outside your'))).toHaveLength(2)
    expect(plan.warnings.join(' ')).toContain('Evening appointment')
    expect(plan.warnings.join(' ')).toContain('remains fixed')
    expect(plan.warnings.join(' ')).toContain('Working hours limit task blocks')
    checked(source, plan)
  })

  it.each(['missing', 'overlap', 'deadline', 'dependency', 'invented', 'fixed', 'totals'])('independently rejects a forged %s proposal', failure => {
    const source = workspace(task('a', 30, { dueDate: DATE, dueTime: 700 }), task('b', 30, { dependsOn: ['a'] }))
    source.commitments = [{ id: 'fixed', title: 'Fixed', date: DATE, start: 900, end: 930, notes: '' }]
    const plan = planDay(source)
    const a = work(plan, 'a')[0], b = work(plan, 'b')[0]
    if (failure === 'missing') plan.blocks = plan.blocks.filter(block => block !== a)
    if (failure === 'overlap') { b.start = a.start; b.end = a.end }
    if (failure === 'deadline') { a.start = 800; a.end = 830 }
    if (failure === 'dependency') { a.taskId = 'b'; a.title = 'b'; b.taskId = 'a'; b.title = 'a' }
    if (failure === 'invented') a.taskId = 'unknown'
    if (failure === 'fixed') plan.blocks.find(block => block.commitmentId === 'fixed')!.start++
    if (failure === 'totals') plan.scheduledMinutes = 900
    expect(validateDayPlan(source, plan).some(check => !check.passed)).toBe(true)
  })

  it('rejects malformed result objects rather than throwing during validation', () => {
    const source = workspace(task('a'))
    const bad = { ...planDay(source), blocks: [null] } as unknown as DayPlan
    expect(validateDayPlan(source, bad).some(check => !check.passed)).toBe(true)
  })

  it('rejects malformed break titles and inconsistent split metadata before rendering a saved plan', () => {
    const source = workspace(task('a', 75))
    const badBreak = planDay(source)
    const block = badBreak.blocks.find(item => item.kind === 'break')!
    ;(block as unknown as { title: unknown }).title = { unsafe: 'object' }
    expect(validateDayPlan(source, badBreak).find(check => check.id === 'shape')!.passed).toBe(false)
    const badParts = planDay(source)
    work(badParts)[0].parts = 999
    expect(validateDayPlan(source, badParts).find(check => check.id === 'shape')!.passed).toBe(false)
  })

  it('handles 200 tasks within a bounded runtime and never loses backlog work', () => {
    const source = workspace(...Array.from({ length: 200 }, (_, index) => task(`task-${index}`, 10 + index % 60, { priority: index % 3 === 0 ? 'high' : 'normal', dependsOn: index && index % 10 === 0 ? [`task-${index - 1}`] : [] })))
    const start = performance.now()
    const plan = planDay(source)
    expect(performance.now() - start).toBeLessThan(2000)
    checked(source, plan)
    expect(plan.scheduledMinutes + plan.overflow.reduce((sum, item) => sum + item.remainingMinutes, 0)).toBe(source.tasks.reduce((sum, task) => sum + task.minutes, 0))
  })
})

describe('capture, recurrence and backups', () => {
  it('captures plain lines and explicit duration/project/priority/date tokens', () => {
    const tasks = captureLines('Draft report 1h30m #Work !high due:today@14:00\n- Clear inbox 25m ~weekdays\nBuy 2 pens', DATE)
    expect(tasks.map(task => task.minutes)).toEqual([90, 25, 30])
    expect(tasks[0]).toMatchObject({ title: 'Draft report', project: 'Work', priority: 'high', dueDate: DATE, dueTime: 840 })
    expect(tasks[1]).toMatchObject({ title: 'Clear inbox', recurrence: 'weekdays' })
    expect(tasks[2].title).toBe('Buy 2 pens')
    expect(new Set(tasks.map(task => task.id)).size).toBe(3)
    expect(parseWorkspace(workspace(...tasks)).tasks).toHaveLength(3)
  })

  it.each(['Task 0m', 'Task -5m', 'Task 13h', 'Task 1.2m', 'Task 10m 20m', 'Task due:2026-02-30', 'Task due:today@24:10', '30m #Work'])('does not silently accept an invalid explicit capture: %s', text => {
    expect(() => captureLines(text, DATE)).toThrow(/Line 1/)
  })

  it('creates only one next recurrence and keeps the completed record', () => {
    const source = workspace(task('daily', 20, { recurrence: 'daily', dueDate: DATE, dueTime: 900 }))
    const now = new Date('2026-10-13T18:00:00Z')
    const result = completeTask(source, 'daily', now)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toMatchObject({ status: 'done', completedAt: now.toISOString() })
    expect(result.tasks[1]).toMatchObject({ status: 'todo', earliestDate: '2026-10-14', dueDate: '2026-10-14', dueTime: 900, seriesId: 'daily' })
    expect(completeTask(result, 'daily', now)).toEqual(result)
    expect(source.tasks[0].status).toBe('todo')
    const reset = structuredClone(result)
    reset.tasks[0].status = 'todo'
    expect(completeTask(reset, 'daily', now).tasks).toHaveLength(2)
  })

  it.each([['weekdays', '2026-10-16', '2026-10-19'], ['weekly', '2026-10-13', '2026-10-20'], ['daily', '2026-12-31', '2027-01-01']] as const)('advances %s recurrence using dates across weekends and year changes', (recurrence, date, next) => {
    const source = createWorkspace(date, 'America/Chicago')
    source.tasks = [task('repeat', 30, { recurrence, earliestDate: date, dueDate: date })]
    expect(completeTask(source, 'repeat', new Date(`${date}T18:00:00Z`)).tasks[1].earliestDate).toBe(next)
  })

  it('shifts an overdue recurrence forward when it is completed late', () => {
    const source = workspace(task('repeat', 20, { recurrence: 'daily', dueDate: '2026-10-10' }))
    const next = completeTask(source, 'repeat', new Date('2026-10-13T18:00:00Z')).tasks[1]
    expect(next.earliestDate).toBe('2026-10-14')
    expect(next.dueDate).toBe('2026-10-14')
  })

  it('keeps weekly recurrence on its original weekday while skipping missed occurrences', () => {
    const source = workspace(task('weekly', 30, { recurrence: 'weekly', earliestDate: DATE, dueDate: DATE }))
    const next = completeTask(source, 'weekly', new Date('2026-10-22T18:00:00Z')).tasks[1]
    expect(next.earliestDate).toBe('2026-10-27')
    expect(next.dueDate).toBe('2026-10-27')
  })

  it('round trips a strict backup and rejects cycles, dangling dependencies and invalid settings', () => {
    const source = workspace(task('a'), task('b', 30, { dependsOn: ['a'] }))
    expect(parseWorkspace(exportBackup(source))).toEqual(source)
    for (const mutate of [(copy: Workspace) => { copy.tasks[0].dependsOn = ['b'] }, (copy: Workspace) => { copy.tasks = copy.tasks.filter(task => task.id !== 'a') }, (copy: Workspace) => { copy.settings.planFrom = 2000 }]) {
      const copy = structuredClone(source)
      mutate(copy)
      expect(() => parseWorkspace(copy)).toThrow()
    }
    expect(() => parseWorkspace({ ...source, event: {} })).toThrow()
  })

  it('captures a parenthesized estimate without leaving punctuation in the title', () => {
    expect(captureLines('Review notes (45m)', DATE)[0]).toMatchObject({ title: 'Review notes', minutes: 45 })
  })

  it.each([
    (copy: Workspace) => { copy.tasks[0].minutes = Number.NaN },
    (copy: Workspace) => { copy.tasks[0].dueDate = '2026-02-30' },
    (copy: Workspace) => { copy.tasks[0].createdAt = '2026-02-30T00:00:00Z' },
    (copy: Workspace) => { copy.tasks[0].dueTime = 600 },
    (copy: Workspace) => { copy.settings.timezone = 'Unknown/Timezone' },
    (copy: Workspace) => { copy.settings.end = copy.settings.start },
    (copy: Workspace) => { copy.tasks.push(structuredClone(copy.tasks[0])) },
  ])('rejects malformed backup fields before scheduling or saving', mutate => {
    const copy = workspace(task('a'))
    mutate(copy)
    expect(() => parseWorkspace(copy)).toThrow()
  })

  it('does not mark a recurring task done when its next occurrence cannot be safely created', () => {
    const source = workspace(task('repeat', 30, { recurrence: 'daily' }), ...Array.from({ length: 199 }, (_, index) => task(`existing-${index}`)))
    expect(() => completeTask(source, 'repeat', new Date('2026-10-13T18:00:00Z'))).toThrow(/200 tasks/)
    expect(source.tasks[0].status).toBe('todo')
  })

  it('uses the selected timezone for dates and handles leap days without local DST arithmetic', () => {
    expect(localDate(new Date('2026-10-14T01:00:00Z'), 'America/Chicago')).toBe('2026-10-13')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(() => addDays('2026-02-30', 1)).toThrow()
  })

  it('exports timezone-correct calendar blocks and a complete text plan with overflow', () => {
    const source = workspace(task('Write; send, review', 60, { notes: 'Line one\nLine two' }), task('overflow', 720))
    const plan = planDay(source)
    const calendar = exportPlanCalendar(source, plan, new Date('2026-10-13T12:00:00Z'))
    expect(calendar).toContain('DTSTART:20261013T140000Z')
    expect(calendar).toContain('SUMMARY:Write\\; send\\, review')
    expect(calendar).not.toContain('ATTENDEE:')
    expect(calendar).not.toContain('METHOD:REQUEST')
    expect(exportPlanText(source, plan)).toContain('NOT PLACED')
    const edited = structuredClone(source); edited.tasks[0].minutes = 5
    expect(() => exportPlanCalendar(edited, plan)).toThrow(/fresh plan/)
  })
})
