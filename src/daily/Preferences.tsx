import { useRef, useState, type FormEvent } from 'react'
import type { DaySettings } from './types'
import EditorDialog, { ErrorSummary, errorProps, fieldError, focusError, fromTimeInput, isISODate, toTimeInput, wholeNumber, type EditorErrors } from './EditorDialog'

export interface PreferencesProps { settings: DaySettings; onSave: (settings: DaySettings) => void; onClose: () => void }

export default function Preferences({ settings, onSave, onClose }: PreferencesProps) {
  const [draft, setDraft] = useState(() => ({
    date: settings.date, timezone: settings.timezone, start: toTimeInput(settings.start), end: toTimeInput(settings.end),
    planFrom: toTimeInput(settings.planFrom), breakMinutes: String(settings.breakMinutes), focusMinutes: String(settings.focusMinutes),
  }))
  const initial = useRef(JSON.stringify(draft))
  const lastEnd = useRef(settings.end === 1440 ? '17:00' : toTimeInput(settings.end))
  const [errors, setErrors] = useState<EditorErrors>({})
  const field = (key: keyof typeof draft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setErrors({}) }
  const zones = [...new Set([settings.timezone, 'America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'])]

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next: EditorErrors = {}
    const start = fromTimeInput(draft.start)
    const end = fromTimeInput(draft.end)
    const planFrom = fromTimeInput(draft.planFrom)
    const breakMinutes = wholeNumber(draft.breakMinutes, 0, 30)
    const focusMinutes = wholeNumber(draft.focusMinutes, 10, 180)
    if (!isISODate(draft.date)) next['d-day-date'] = 'Choose a valid planning date.'
    try {
      if (!draft.timezone.trim() || draft.timezone.length > 80) throw new Error('invalid timezone')
      new Intl.DateTimeFormat('en', { timeZone: draft.timezone.trim() }).format(new Date())
    } catch { next['d-day-timezone'] = 'Use a valid timezone, such as America/Chicago or Europe/London.' }
    if (!Number.isFinite(start) || start >= 1440) next['d-day-start'] = 'Choose a day start before midnight.'
    if (!Number.isFinite(end) || end <= start) next['d-day-end'] = 'The day must end after it starts, within the same date.'
    if (!Number.isFinite(planFrom) || planFrom < start || planFrom > end) next['d-day-from'] = 'Plan from a time within your day’s start and end.'
    if (breakMinutes === null) next['d-day-break'] = 'Use 0–30 whole minutes between work blocks.'
    if (focusMinutes === null) next['d-day-focus'] = 'Use a preferred work block of 10–180 whole minutes.'
    if (Object.keys(next).length) { setErrors(next); focusError(next); return }
    try { onSave({ ...settings, date: draft.date, timezone: draft.timezone.trim(), start, end, planFrom, breakMinutes: breakMinutes!, focusMinutes: focusMinutes! }) }
    catch (error) { setErrors({ form: error instanceof Error ? error.message : 'These settings could not be saved. Your current settings are unchanged.' }) }
  }

  return <EditorDialog title="Day settings" description="Set the time you have. Keep room for breaks and the unexpected." dirty={JSON.stringify(draft) !== initial.current} onClose={onClose}>
    <form className="d-editor-form" noValidate onSubmit={save}>
      <div className="d-editor-body">
        <ErrorSummary errors={errors} />
        <div className="d-editor-grid">
          <div className="d-editor-field d-editor-span"><label htmlFor="d-day-date">Planning date</label><input id="d-day-date" {...errorProps(errors, 'd-day-date')} type="date" value={draft.date} onChange={event => field('date', event.target.value)} required />{fieldError(errors, 'd-day-date')}</div>
          <div className="d-editor-field"><label htmlFor="d-day-start">Day starts</label><input id="d-day-start" {...errorProps(errors, 'd-day-start')} type="time" value={draft.start} onChange={event => field('start', event.target.value)} required />{fieldError(errors, 'd-day-start')}</div>
          <div className="d-editor-field"><label htmlFor="d-day-end">Day ends</label><input id="d-day-end" {...errorProps(errors, 'd-day-end')} type={draft.end === '24:00' ? 'text' : 'time'} value={draft.end} readOnly={draft.end === '24:00'} onChange={event => { lastEnd.current = event.target.value; field('end', event.target.value) }} required />{fieldError(errors, 'd-day-end')}<label className="d-editor-check d-editor-time-caption"><input type="checkbox" checked={draft.end === '24:00'} onChange={event => field('end', event.target.checked ? '24:00' : lastEnd.current)} /><span>End at midnight</span></label></div>
          <div className="d-editor-field d-editor-span"><label htmlFor="d-day-from">Plan from</label><input id="d-day-from" {...errorProps(errors, 'd-day-from')} type={draft.planFrom === '24:00' ? 'text' : 'time'} value={draft.planFrom} onChange={event => field('planFrom', event.target.value)} required />{fieldError(errors, 'd-day-from')}<p className="d-editor-help">Place unfinished work from this time onward. Tasks are only completed when you mark them done.</p></div>
        </div>
        <details className="d-editor-more"><summary>Work rhythm and timezone</summary><div className="d-editor-grid">
          <div className="d-editor-field"><label htmlFor="d-day-focus">Preferred focus block (minutes)</label><input id="d-day-focus" {...errorProps(errors, 'd-day-focus')} type="number" min="10" max="180" step="1" value={draft.focusMinutes} onChange={event => field('focusMinutes', event.target.value)} required />{fieldError(errors, 'd-day-focus')}</div>
          <div className="d-editor-field"><label htmlFor="d-day-break">Break between blocks (minutes)</label><input id="d-day-break" {...errorProps(errors, 'd-day-break')} type="number" min="0" max="30" step="1" value={draft.breakMinutes} onChange={event => field('breakMinutes', event.target.value)} required />{fieldError(errors, 'd-day-break')}</div>
          <div className="d-editor-field d-editor-span"><label htmlFor="d-day-timezone">Timezone</label><input id="d-day-timezone" {...errorProps(errors, 'd-day-timezone')} list="d-day-zones" value={draft.timezone} onChange={event => field('timezone', event.target.value)} required /><datalist id="d-day-zones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>{fieldError(errors, 'd-day-timezone')}<p className="d-editor-help">Changing timezone keeps entered clock times unchanged. Check fixed meetings before planning in a different zone.</p></div>
        </div></details>
      </div>
      <footer className="d-editor-footer"><p className="d-editor-footer-note">Your tasks and fixed meetings stay saved. Review the next plan before applying it.</p><div className="d-editor-actions"><button className="d-editor-button d-editor-primary" type="submit">Save day settings</button></div></footer>
    </form>
  </EditorDialog>
}
