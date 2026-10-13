import { useRef, useState, type FormEvent } from 'react'
import type { Commitment } from './types'
import EditorDialog, { ErrorSummary, errorProps, fieldError, focusError, fromTimeInput, isISODate, toTimeInput, type EditorErrors } from './EditorDialog'

export interface CommitmentEditorProps {
  commitment?: Commitment
  date: string
  onSave: (commitment: Commitment) => void
  onDelete?: () => void
  onClose: () => void
}

export default function CommitmentEditor({ commitment, date, onSave, onDelete, onClose }: CommitmentEditorProps) {
  const [id] = useState(() => commitment?.id ?? `meeting-${crypto.randomUUID()}`)
  const [draft, setDraft] = useState(() => ({ title: commitment?.title ?? '', date: commitment?.date ?? date,
    start: toTimeInput(commitment?.start ?? 540), end: toTimeInput(commitment?.end ?? 570), notes: commitment?.notes ?? '' }))
  const initial = useRef(JSON.stringify(draft))
  const lastEnd = useRef(commitment?.end === 1440 ? '17:00' : draft.end)
  const [errors, setErrors] = useState<EditorErrors>({})
  const field = (key: keyof typeof draft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setErrors({}) }

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next: EditorErrors = {}
    const start = fromTimeInput(draft.start)
    const end = fromTimeInput(draft.end)
    if (!draft.title.trim() || draft.title.trim().length > 200) next['d-meeting-title'] = 'Give this fixed commitment a title of 1–200 characters.'
    if (!isISODate(draft.date)) next['d-meeting-date'] = 'Choose a valid date.'
    if (!Number.isFinite(start) || start >= 1440) next['d-meeting-start'] = 'Choose a start time before midnight.'
    if (!Number.isFinite(end) || end <= start) next['d-meeting-end'] = 'The end must follow the start on the same date. Split an overnight commitment into one entry per date.'
    if (draft.notes.length > 2000) next['d-meeting-notes'] = 'Keep notes to 2,000 characters or fewer.'
    if (Object.keys(next).length) { setErrors(next); focusError(next); return }
    try { onSave({ ...(commitment ?? {}), id, title: draft.title.trim(), date: draft.date, start, end, notes: draft.notes }) }
    catch (error) { setErrors({ form: error instanceof Error ? error.message : 'This commitment could not be saved. Your existing plan is unchanged.' }) }
  }

  return <EditorDialog title={commitment ? 'Edit fixed commitment' : 'Add a fixed commitment'} description="Meetings, classes, appointments—time the planner must leave alone." dirty={JSON.stringify(draft) !== initial.current} onClose={onClose}>
    <form className="d-editor-form" noValidate onSubmit={save}>
      <div className="d-editor-body"><ErrorSummary errors={errors} /><div className="d-editor-grid">
        <div className="d-editor-field d-editor-span"><label htmlFor="d-meeting-title">Title</label><input id="d-meeting-title" {...errorProps(errors, 'd-meeting-title')} value={draft.title} onChange={event => field('title', event.target.value)} maxLength={200} placeholder="e.g. Team check-in" autoComplete="off" required />{fieldError(errors, 'd-meeting-title')}</div>
        <div className="d-editor-field d-editor-span"><label htmlFor="d-meeting-date">Date</label><input id="d-meeting-date" {...errorProps(errors, 'd-meeting-date')} type="date" value={draft.date} onChange={event => field('date', event.target.value)} required />{fieldError(errors, 'd-meeting-date')}</div>
        <div className="d-editor-field"><label htmlFor="d-meeting-start">Starts</label><input id="d-meeting-start" {...errorProps(errors, 'd-meeting-start')} type="time" value={draft.start} onChange={event => field('start', event.target.value)} required />{fieldError(errors, 'd-meeting-start')}</div>
        <div className="d-editor-field"><label htmlFor="d-meeting-end">Ends</label><input id="d-meeting-end" {...errorProps(errors, 'd-meeting-end')} type={draft.end === '24:00' ? 'text' : 'time'} value={draft.end} readOnly={draft.end === '24:00'} onChange={event => { lastEnd.current = event.target.value; field('end', event.target.value) }} required />{fieldError(errors, 'd-meeting-end')}<label className="d-editor-check d-editor-time-caption"><input type="checkbox" checked={draft.end === '24:00'} onChange={event => field('end', event.target.checked ? '24:00' : lastEnd.current)} /><span>Ends at midnight</span></label></div>
      </div><details className="d-editor-more" open={!!commitment?.notes}><summary>Add a note</summary><div className="d-editor-field"><label htmlFor="d-meeting-notes">Notes (optional)</label><textarea id="d-meeting-notes" {...errorProps(errors, 'd-meeting-notes')} value={draft.notes} onChange={event => field('notes', event.target.value)} rows={3} maxLength={2000} placeholder="Location, meeting link, or a reminder." />{fieldError(errors, 'd-meeting-notes')}</div></details></div>
      <footer className="d-editor-footer">{commitment && onDelete ? <button type="button" className="d-editor-button d-editor-danger" onClick={onDelete}>Delete commitment</button> : <p className="d-editor-footer-note">Times use your workspace timezone. Saving does not send invitations.</p>}<div className="d-editor-actions"><button className="d-editor-button d-editor-primary" type="submit">{commitment ? 'Save commitment' : 'Add commitment'}</button></div></footer>
    </form>
  </EditorDialog>
}
