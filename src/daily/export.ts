import { eventTime } from '../lib/calendar'
import { parseWorkspace } from './storage'
import { validateDayPlan } from './planner'
import type { DayPlan, Workspace } from './types'

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/;/g, '\\;').replace(/,/g, '\\,')
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
function fold(line: string): string {
  const encoder = new TextEncoder(), parts: string[] = []
  let current = ''
  for (const character of line) {
    if (encoder.encode(current + character).length > 75) { parts.push(current); current = ' ' }
    current += character
  }
  return [...parts, current].join('\r\n')
}
const checked = (workspace: Workspace, plan: DayPlan) => {
  const failures = validateDayPlan(workspace, plan).filter(check => !check.passed)
  if (failures.length) throw new Error(`The plan no longer matches this workspace. Make a fresh plan before exporting: ${failures.map(check => check.label).join('; ')}.`)
}

export function exportPlanText(workspace: Workspace, plan: DayPlan): string {
  checked(workspace, plan)
  return `RIPPLE · DAILY PLAN\n${plan.date} · ${workspace.settings.timezone}\n${plan.summary}\n${plan.scheduledMinutes} task minutes planned / ${plan.availableMinutes} minutes available around fixed commitments.\n\nSCHEDULE\n${plan.blocks.map(block => `${clock(block.start)}–${clock(block.end)} | ${block.title}${block.kind === 'commitment' ? ' · FIXED' : block.kind === 'break' ? ' · BREAK' : block.parts && block.parts > 1 ? ` · Part ${block.part}/${block.parts}` : ''}`).join('\n') || 'No blocks planned.'}\n\nNOT PLACED\n${plan.overflow.map(item => `${workspace.tasks.find(task => task.id === item.taskId)!.title} · ${item.remainingMinutes} min\n${item.reason}`).join('\n\n') || 'All eligible task minutes are planned.'}\n\nNOTES\n${plan.warnings.join('\n')}\n\nCHECKS\n${plan.checks.map(check => `${check.passed ? 'PASS' : 'FAIL'} · ${check.label}`).join('\n')}\n\nA schedule is a proposal. Tasks are completed only when you mark them done. Nothing has been sent or synced.\n`
}

export function exportPlanCalendar(workspace: Workspace, plan: DayPlan, now = new Date()): string {
  checked(workspace, plan)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ripple//Daily planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escape(`Ripple · ${plan.date}`)}`]
  for (const block of plan.blocks) {
    const task = workspace.tasks.find(item => item.id === block.taskId)
    const note = task?.notes ?? workspace.commitments.find(item => item.id === block.commitmentId)?.notes ?? ''
    lines.push('BEGIN:VEVENT', `UID:${encodeURIComponent(plan.date)}.${encodeURIComponent(block.id)}@ripple.local`, `DTSTAMP:${stamp(now)}`, `LAST-MODIFIED:${stamp(now)}`, `DTSTART:${stamp(eventTime(plan.date, block.start, workspace.settings.timezone))}`, `DTEND:${stamp(eventTime(plan.date, block.end, workspace.settings.timezone))}`, `SUMMARY:${escape(`${block.title}${block.parts && block.parts > 1 ? ` (${block.part}/${block.parts})` : ''}`)}`, `DESCRIPTION:${escape(`Daily plan · ${plan.date} · ${workspace.settings.timezone}\n${task?.project ? `Project: ${task.project}\n` : ''}${note}\n${block.kind === 'commitment' ? 'Fixed commitment copied from your plan.' : 'Proposed time block; work is not marked completed.'}\nThis file sends no invitations or calendar updates.`)}`, 'END:VEVENT')
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n'
}

export function exportBackup(workspace: Workspace): string {
  return JSON.stringify(parseWorkspace(workspace), null, 2) + '\n'
}
