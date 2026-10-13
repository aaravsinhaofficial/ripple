import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, X } from 'lucide-react'
import './editors.css'

export default function EditorDialog({ title, description, dirty, onClose, children }: {
  title: string
  description: string
  dirty: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const keepEditing = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [discard, setDiscard] = useState(false)
  const close = () => dirty ? setDiscard(true) : onClose()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    const panel = dialog.current
    document.body.style.overflow = 'hidden'
    panel?.showModal()
    panel?.querySelector<HTMLInputElement>('input:not([type="checkbox"]), textarea, select')?.focus()
    return () => {
      panel?.close()
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => { if (discard) keepEditing.current?.focus() }, [discard])

  return <dialog ref={dialog} className="d-editor-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
    }}>
    <header className="d-editor-header">
      <div><p className="d-editor-eyebrow">MAKE ROOM FOR WHAT MATTERS</p><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
      <button type="button" className="d-editor-close" aria-label="Close dialog" onClick={close}><X size={20} /></button>
    </header>
    {discard && <section className="d-editor-discard" role="alert">
      <CircleAlert size={19} /><div><strong>Discard these changes?</strong><p>Your saved details will stay as they are.</p><div className="d-editor-actions">
        <button ref={keepEditing} type="button" className="d-editor-button d-editor-primary" onClick={() => setDiscard(false)}>Keep editing</button>
        <button type="button" className="d-editor-button" onClick={onClose}>Discard changes</button>
      </div></div>
    </section>}
    {children}
  </dialog>
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function toTimeInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function fromTimeInput(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours >= 0 && hours <= 24 && minutes >= 0 && minutes <= 59 && (hours < 24 || minutes === 0) ? hours * 60 + minutes : NaN
}

export function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null
}

export type EditorErrors = Record<string, string>

export function ErrorSummary({ errors }: { errors: EditorErrors }) {
  return Object.keys(errors).length > 0 ? <div className="d-editor-errors" role="alert"><CircleAlert size={18} /><div><strong>A detail needs attention.</strong><ul>{Object.values(errors).map(message => <li key={message}>{message}</li>)}</ul></div></div> : null
}

export function fieldError(errors: EditorErrors, id: string) {
  return errors[id] ? <span className="d-editor-field-error" id={`${id}-error`}>{errors[id]}</span> : null
}

export function errorProps(errors: EditorErrors, id: string) {
  return { 'aria-invalid': !!errors[id] || undefined, 'aria-describedby': errors[id] ? `${id}-error` : undefined }
}

export function focusError(errors: EditorErrors) {
  requestAnimationFrame(() => {
    const field = document.getElementById(Object.keys(errors)[0])
    let ancestor = field?.parentElement
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      ancestor = ancestor.parentElement
    }
    field?.focus()
  })
}
