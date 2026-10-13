import { useRef, useState, type FormEvent } from 'react'
import type { DailyTask, TaskPriority, TaskRecurrence } from './types'
import EditorDialog, { ErrorSummary, errorProps, fieldError, focusError, fromTimeInput, isISODate, toTimeInput, wholeNumber, type EditorErrors } from './EditorDialog'

export interface TaskEditorProps {
  task?: DailyTask
  tasks: DailyTask[]
  date: string
  onSave: (task: DailyTask) => void
  onDelete?: () => void
  onClose: () => void
}

export default function TaskEditor({ task, tasks, date, onSave, onDelete, onClose }: TaskEditorProps) {
  const [identity] = useState(() => ({ id: task?.id ?? `task-${crypto.randomUUID()}`, createdAt: task?.createdAt ?? new Date().toISOString() }))
  const [draft, setDraft] = useState(() => ({
    title: task?.title ?? '', minutes: String(task?.minutes ?? 30), priority: task?.priority ?? 'normal' as TaskPriority,
    project: task?.project ?? '', notes: task?.notes ?? '', dueDate: task?.dueDate ?? '',
    dueTime: task?.dueTime === undefined ? '' : toTimeInput(task.dueTime), earliestDate: task?.earliestDate ?? '',
    dependsOn: [...(task?.dependsOn ?? [])], splittable: task?.splittable ?? true, recurrence: task?.recurrence ?? 'none' as TaskRecurrence,
  }))
  const initial = useRef(JSON.stringify(draft))
  const [errors, setErrors] = useState<EditorErrors>({})
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setErrors({}) }
  const dependents = task ? tasks.filter(item => item.id !== task.id && item.dependsOn.includes(task.id)) : []
  const projects = [...new Set(tasks.map(item => item.project).filter(Boolean))].sort()
  const moreInitiallyOpen = !!task && (task.priority !== 'normal' || !!task.project || !!task.dueDate || !!task.earliestDate || !!task.notes || task.dependsOn.length > 0 || task.recurrence !== 'none' || !task.splittable)

  const dependsOnThis = (id: string, visited = new Set<string>()): boolean => {
    if (id === identity.id) return true
    if (visited.has(id)) return false
    visited.add(id)
    return tasks.find(item => item.id === id)?.dependsOn.some(dependency => dependsOnThis(dependency, visited)) ?? false
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next: EditorErrors = {}
    const minutes = wholeNumber(draft.minutes, 1, 720)
    if (!draft.title.trim() || draft.title.trim().length > 200) next['d-task-title'] = 'Give this task a title of 1–200 characters.'
    if (minutes === null) next['d-task-minutes'] = 'Enter 1–720 whole minutes of work still needed.'
    if (draft.project.length > 80) next['d-task-project'] = 'Keep the project name to 80 characters or fewer.'
    if (draft.notes.length > 2000) next['d-task-notes'] = 'Keep notes to 2,000 characters or fewer.'
    if (draft.dueDate && !isISODate(draft.dueDate)) next['d-task-due-date'] = 'Choose a valid due date.'
    if (draft.dueTime && (!draft.dueDate || !Number.isFinite(fromTimeInput(draft.dueTime)))) next['d-task-due-time'] = 'Choose a due date and a valid due time first.'
    if (draft.earliestDate && !isISODate(draft.earliestDate)) next['d-task-earliest'] = 'Choose a valid earliest date.'
    if (draft.dependsOn.some(id => !tasks.some(item => item.id === id) || dependsOnThis(id))) next['d-task-dependencies'] = 'Dependencies must be existing tasks and cannot form a loop.'
    if (!task && tasks.length >= 200) next['d-task-title'] = 'This workspace has 200 tasks. Remove a task before adding another.'
    if (Object.keys(next).length) { setErrors(next); focusError(next); return }
    const candidate: DailyTask = {
      ...(task ?? {}), ...identity, title: draft.title.trim(), minutes: minutes!, priority: draft.priority,
      project: draft.project.trim(), notes: draft.notes, status: task?.status ?? 'todo',
      dependsOn: [...new Set(draft.dependsOn)], splittable: draft.splittable, recurrence: draft.recurrence,
    }
    if (draft.dueDate) candidate.dueDate = draft.dueDate; else delete candidate.dueDate
    if (draft.dueTime && draft.dueDate) candidate.dueTime = fromTimeInput(draft.dueTime); else delete candidate.dueTime
    if (draft.earliestDate) candidate.earliestDate = draft.earliestDate; else delete candidate.earliestDate
    if (draft.recurrence !== 'none' && !candidate.seriesId) candidate.seriesId = candidate.id
    try { onSave(candidate) } catch (error) { setErrors({ form: error instanceof Error ? error.message : 'This task could not be saved. Your existing task is unchanged.' }) }
  }

  return <EditorDialog title={task ? 'Edit task' : 'Add a task'} description="Start with what needs doing and how much time it needs." dirty={JSON.stringify(draft) !== initial.current} onClose={onClose}>
    <form className="d-editor-form" noValidate onSubmit={save}>
      <div className="d-editor-body">
        <ErrorSummary errors={errors} />
        <div className="d-editor-grid">
          <div className="d-editor-field d-editor-span"><label htmlFor="d-task-title">Title</label><input id="d-task-title" {...errorProps(errors, 'd-task-title')} value={draft.title} onChange={event => field('title', event.target.value)} maxLength={200} placeholder="e.g. Finish the project outline" autoComplete="off" required />{fieldError(errors, 'd-task-title')}</div>
          <div className="d-editor-field d-editor-span"><label htmlFor="d-task-minutes">Time needed (minutes)</label><input id="d-task-minutes" {...errorProps(errors, 'd-task-minutes')} type="number" min="1" max="720" step="1" value={draft.minutes} onChange={event => field('minutes', event.target.value)} required />{fieldError(errors, 'd-task-minutes')}<p className="d-editor-help">Your estimate of the work still left. You can change it later.</p><div className="d-editor-presets" aria-label="Common time estimates">{[15, 30, 60].map(minutes => <button key={minutes} type="button" aria-label={`Use ${minutes} minutes`} aria-pressed={draft.minutes === String(minutes)} onClick={() => field('minutes', String(minutes))}>{minutes} min</button>)}</div></div>
        </div>
        <details className="d-editor-more" open={moreInitiallyOpen}>
          <summary>More options</summary>
          <div className="d-editor-grid">
            <div className="d-editor-field"><label htmlFor="d-task-priority">Priority</label><select id="d-task-priority" value={draft.priority} onChange={event => field('priority', event.target.value as TaskPriority)}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></div>
            <div className="d-editor-field"><label htmlFor="d-task-project">Project (optional)</label><input id="d-task-project" {...errorProps(errors, 'd-task-project')} list="d-task-projects" value={draft.project} onChange={event => field('project', event.target.value)} maxLength={80} placeholder="e.g. Coursework" /><datalist id="d-task-projects">{projects.map(project => <option key={project} value={project} />)}</datalist>{fieldError(errors, 'd-task-project')}</div>
            <div className="d-editor-field"><label htmlFor="d-task-due-date">Due date (optional)</label><input id="d-task-due-date" {...errorProps(errors, 'd-task-due-date')} type="date" value={draft.dueDate} onChange={event => { field('dueDate', event.target.value); if (!event.target.value) field('dueTime', '') }} />{fieldError(errors, 'd-task-due-date')}</div>
            <div className="d-editor-field"><label htmlFor="d-task-due-time">Due time (optional)</label><input id="d-task-due-time" {...errorProps(errors, 'd-task-due-time')} type={draft.dueTime === '24:00' ? 'text' : 'time'} value={draft.dueTime} disabled={!draft.dueDate} onChange={event => field('dueTime', event.target.value)} />{fieldError(errors, 'd-task-due-time')}<p className="d-editor-help">Leave blank for the end of the due date.</p></div>
            <div className="d-editor-field"><label htmlFor="d-task-earliest">Start no earlier than (optional)</label><input id="d-task-earliest" {...errorProps(errors, 'd-task-earliest')} type="date" value={draft.earliestDate} onChange={event => field('earliestDate', event.target.value)} />{fieldError(errors, 'd-task-earliest')}</div>
            <div className="d-editor-field"><label htmlFor="d-task-repeat">Repeat</label><select id="d-task-repeat" value={draft.recurrence} onChange={event => field('recurrence', event.target.value as TaskRecurrence)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option></select></div>
            {draft.recurrence !== 'none' && <p className="d-editor-note d-editor-span">The next occurrence is created when you mark this task done. Completing it twice will not create two copies.</p>}
            {draft.dueDate && draft.earliestDate && draft.earliestDate > draft.dueDate && <p className="d-editor-note d-editor-span">This task starts after its deadline. The planner will show the conflict until one of those dates changes.</p>}
            <label className="d-editor-check d-editor-span"><input type="checkbox" checked={draft.splittable} onChange={event => field('splittable', event.target.checked)} /><span>Allow shorter work blocks<small>Keep all the estimated minutes, spread across available gaps.</small></span></label>
            <fieldset className="d-editor-dependencies d-editor-span" id="d-task-dependencies" tabIndex={-1} {...errorProps(errors, 'd-task-dependencies')}><legend>Depends on (optional)</legend>
              {tasks.some(item => item.id !== identity.id) ? <div className="d-editor-dependency-list">{tasks.filter(item => item.id !== identity.id).map(item => {
                const cycle = dependsOnThis(item.id)
                return <label key={item.id} className={`d-editor-check ${cycle ? 'd-editor-disabled' : ''}`}><input type="checkbox" value={item.id} checked={draft.dependsOn.includes(item.id)} disabled={cycle} onChange={event => field('dependsOn', event.target.checked ? [...draft.dependsOn, item.id] : draft.dependsOn.filter(id => id !== item.id))} /><span>{item.title}<small>{cycle ? 'This task already depends on the one you are editing.' : item.status === 'done' ? 'Completed · prerequisite already satisfied' : [item.project, `${item.minutes} min`].filter(Boolean).join(' · ')}</small></span></label>
              })}</div> : <p className="d-editor-help">Add another task first to use it as a prerequisite.</p>}{fieldError(errors, 'd-task-dependencies')}</fieldset>
            <div className="d-editor-field d-editor-span"><label htmlFor="d-task-notes">Notes (optional)</label><textarea id="d-task-notes" {...errorProps(errors, 'd-task-notes')} value={draft.notes} onChange={event => field('notes', event.target.value)} maxLength={2000} rows={3} placeholder="Links, a next step, or anything useful when you begin." />{fieldError(errors, 'd-task-notes')}</div>
          </div>
        </details>
        {dependents.length > 0 && <p className="d-editor-note" style={{ marginTop: 18 }}>To delete this task, first remove it from the dependencies of {dependents.slice(0, 3).map(item => `“${item.title}”`).join(', ')}{dependents.length > 3 ? ` and ${dependents.length - 3} more` : ''}.</p>}
      </div>
      <footer className="d-editor-footer">
        {task && onDelete ? <button className="d-editor-button d-editor-danger" type="button" onClick={onDelete} disabled={dependents.length > 0}>Delete task</button> : <p className="d-editor-footer-note">Selected planning day: {date}. Nothing changes until you save.</p>}
        <div className="d-editor-actions"><button className="d-editor-button d-editor-primary" type="submit">{task ? 'Save task' : 'Add task'}</button></div>
      </footer>
    </form>
  </EditorDialog>
}
