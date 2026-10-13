import { eventTime } from '../lib/calendar'
import { addDays, localDate, validDate } from './storage'
import type { ImportBatch } from './imports'

export type GoogleKind = 'calendar' | 'tasks'
export type GoogleSession = { token: string; expiresAt: number; kind: GoogleKind }
export type GoogleCollection = { id: string; title: string; primary?: boolean }
const SCOPES = {
  calendar: ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
  tasks: ['https://www.googleapis.com/auth/tasks.readonly'],
}
type TokenResponse = { access_token?: string; expires_in?: number | string; scope?: string; error?: string }
type Identity = {
  initTokenClient(config: { client_id: string; scope: string; include_granted_scopes: boolean; callback: (response: TokenResponse) => void; error_callback: (error: { type: string }) => void }): { requestAccessToken: (options: { prompt: string }) => void }
  revoke(token: string, callback: (response: { successful?: boolean }) => void): void
}
const identity = () => (window as unknown as { google?: { accounts?: { oauth2?: Identity } } }).google?.accounts?.oauth2
let loading: Promise<void> | undefined
export const googleClientId = (value: unknown = import.meta.env.VITE_GOOGLE_CLIENT_ID): string => typeof value === 'string' && /^[\w-]+\.apps\.googleusercontent\.com$/.test(value.trim()) ? value.trim() : ''

/** No Google script or data is requested until the user opens this connector. */
export function loadGoogleIdentity(): Promise<void> {
  if (identity()) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.referrerPolicy = 'no-referrer'
    const timer = window.setTimeout(() => fail(), 15000)
    const fail = () => { window.clearTimeout(timer); script.remove(); loading = undefined; reject(new Error('Google sign-in could not load. Check your connection or use a calendar file.')) }
    script.onerror = fail
    script.onload = () => { window.clearTimeout(timer); if (identity()) resolve(); else fail() }
    document.head.appendChild(script)
  })
  return loading
}

/** Invoke directly from a button, after loading GIS, to preserve the popup gesture. */
export function requestGoogleAccess(clientId: string, kind: GoogleKind): Promise<GoogleSession> {
  return new Promise((resolve, reject) => {
    if (!googleClientId(clientId)) { reject(new Error('Google connection needs the site owner’s OAuth client ID. You can import a calendar file now.')); return }
    const api = identity()
    if (!api) { reject(new Error('Google sign-in is still loading. Try again in a moment.')); return }
    const timer = window.setTimeout(() => reject(new Error('Google sign-in timed out. Please try again.')), 120000)
    const client = api.initTokenClient({
      client_id: clientId, scope: SCOPES[kind].join(' '), include_granted_scopes: false,
      callback: response => {
        window.clearTimeout(timer)
        if (response.error || !response.access_token) { reject(new Error('Google access was not granted. Nothing was imported.')); return }
        if (!SCOPES[kind].every(scope => response.scope?.split(' ').includes(scope))) { reject(new Error('Read access was not granted for this connection. Reconnect and allow the requested read permissions.')); return }
        const lifetime = Number(response.expires_in)
        if (!Number.isFinite(lifetime) || lifetime < 1) { reject(new Error('Google returned an expired connection. Please reconnect.')); return }
        resolve({ token: response.access_token, expiresAt: Date.now() + Math.min(lifetime, 3600) * 1000, kind })
      },
      error_callback: error => { window.clearTimeout(timer); reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was closed. Nothing was imported.' : 'Allow the Google sign-in popup, then try again.')) },
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
}

export async function revokeGoogle(session: GoogleSession): Promise<void> {
  const api = identity()
  if (!api) throw new Error('Google sign-in is unavailable. Remove Ripple access from your Google account permissions.')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Could not confirm removal. You can remove Ripple in Google account permissions.')), 10000)
    api.revoke(session.token, response => { clearTimeout(timer); response.successful ? resolve() : reject(new Error('Could not confirm removal. You can remove Ripple in Google account permissions.')) })
  })
}

async function googleGet(session: GoogleSession, url: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (Date.now() >= session.expiresAt - 10000) throw new Error('Your Google connection expired. Connect again to refresh it.')
  // Requests only reach documented read APIs. A source URL is never fetched.
  if (!['https://www.googleapis.com', 'https://tasks.googleapis.com'].includes(url.origin)) throw new Error('Unsupported Google API address.')
  const response = await fetch(url.href, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) })
  if (!response.ok) {
    if (response.status === 401) { session.expiresAt = 0; throw new Error('Your Google connection expired. Connect again to refresh it.') }
    if (response.status === 403) throw new Error('Google denied read access. Check the granted permissions and that this API is enabled for the OAuth project.')
    if (response.status === 429) throw new Error('Google’s request limit was reached. Wait a little before refreshing.')
    throw new Error('Google could not load these items. Try again; your workspace has not changed.')
  }
  const text = await response.text()
  if (text.length > 2_000_000) throw new Error('Google returned too much data. Choose a shorter date range.')
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Google returned unreadable data.')
  return data
}

async function pages(session: GoogleSession, url: URL, signal?: AbortSignal, limit = 500): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [], seen = new Set<string>()
  for (let page = 0; page < 5; page++) {
    const data = await googleGet(session, url, signal)
    if (data.items !== undefined && !Array.isArray(data.items)) throw new Error('Google returned an invalid item list.')
    for (const item of (data.items ?? []) as unknown[]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Google returned an invalid item.')
      items.push(item as Record<string, unknown>)
    }
    if (items.length > limit) throw new Error(`This selection has more than ${limit} items. Choose a smaller calendar or date range.`)
    if (!data.nextPageToken) return items
    if (typeof data.nextPageToken !== 'string' || seen.has(data.nextPageToken)) throw new Error('Google returned an invalid page cursor.')
    seen.add(data.nextPageToken); url.searchParams.set('pageToken', data.nextPageToken)
  }
  throw new Error('This selection has too many pages. Choose a smaller calendar or date range; no partial import was accepted.')
}

export async function listGoogleCollections(session: GoogleSession, signal?: AbortSignal): Promise<GoogleCollection[]> {
  const url = new URL(session.kind === 'calendar' ? 'https://www.googleapis.com/calendar/v3/users/me/calendarList' : 'https://tasks.googleapis.com/tasks/v1/users/@me/lists')
  url.searchParams.set('maxResults', '100')
  if (session.kind === 'calendar') url.searchParams.set('minAccessRole', 'reader')
  const items = await pages(session, url, signal)
  return items.filter(item => !item.deleted && typeof item.id === 'string').map(item => ({ id: String(item.id), title: String(item.summaryOverride || item.summary || item.title || 'Untitled list').slice(0, 200), primary: item.primary === true }))
}

const clipped = (value: unknown, length: number) => typeof value === 'string' ? value.slice(0, length) : ''
const sourceUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 2000) return undefined
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined } catch { return undefined }
}
const minuteAt = (time: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(time)
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value)
}

export function googleEventsToBatch(events: Record<string, unknown>[], collection: GoogleCollection, options: { from: string; to: string; timezone: string; allDay: 'skip' | 'block' }): ImportBatch {
  if (!validDate(options.from) || !validDate(options.to) || options.to < options.from || Date.parse(options.to) - Date.parse(options.from) > 30 * 86400000) throw new Error('Choose a date range of up to 31 days.')
  new Intl.DateTimeFormat('en-US', { timeZone: options.timezone }).format()
  const batch: ImportBatch = { version: 1, source: { provider: 'google-calendar', label: collection.title, namespace: collection.id }, items: [], skipped: [], warnings: [] }
  for (const event of events) {
    const title = clipped(event.summary, 200) || 'Busy'
    const skip = (reason: string) => batch.skipped.push({ title, reason })
    if (event.status === 'cancelled' || event.transparency === 'transparent' || event.eventType === 'workingLocation' || (Array.isArray(event.attendees) && event.attendees.some(a => a?.self === true && a.responseStatus === 'declined'))) { skip('Canceled, declined, or shown as free.'); continue }
    if (typeof event.id !== 'string') { skip('Missing a stable event ID.'); continue }
    const start = event.start as { date?: string; dateTime?: string } | undefined, end = event.end as typeof start
    const allDay = !!start?.date
    if (allDay && options.allDay === 'skip') { skip('All-day event. Enable “Block all-day events” to reserve this time.'); continue }
    const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
    if (allDay ? !validDate(start?.date) || !validDate(end?.date) : !dateTime.test(start?.dateTime || '') || !dateTime.test(end?.dateTime || '')) { skip('Missing a valid event time or explicit timezone offset.'); continue }
    const begin = allDay ? null : new Date(Math.floor(Date.parse(start!.dateTime!) / 60000) * 60000), finish = allDay ? null : new Date(Math.ceil(Date.parse(end!.dateTime!) / 60000) * 60000)
    if ((!allDay && (!Number.isFinite(begin!.valueOf()) || !Number.isFinite(finish!.valueOf()) || finish! <= begin!)) || (allDay && end!.date! <= start!.date!)) { skip('The event ends before it starts.'); continue }
    const startDay = allDay ? start!.date! : localDate(begin!, options.timezone)
    const endDay = allDay ? end!.date! : localDate(finish!, options.timezone)
    if (!allDay) {
      try {
        eventTime(startDay, minuteAt(begin!, options.timezone), options.timezone)
        eventTime(endDay, minuteAt(finish!, options.timezone), options.timezone)
      } catch { skip('This event touches an ambiguous daylight-saving clock time. Check it in the source calendar.'); continue }
    }
    let first = startDay < options.from ? options.from : startDay
    for (let day = first; day <= options.to && day <= endDay; day = addDays(day, 1)) {
      if (allDay && day >= endDay) break
      const from = allDay || day > startDay ? 0 : minuteAt(begin!, options.timezone)
      const to = allDay || day < endDay ? 1440 : minuteAt(finish!, options.timezone)
      if (to <= from) { if (day === startDay && day === endDay) skip('This event crosses a repeated clock hour that the daily planner cannot represent.'); continue }
      const segment = Math.round((Date.parse(day) - Date.parse(startDay)) / 86400000)
      batch.items.push({ kind: 'commitment', externalId: `${event.id}:segment:${segment}`, title, notes: [clipped(event.description, 1400), clipped(event.location, 300)].filter(Boolean).join('\n'), date: day, start: from, end: to, allDay, ...(sourceUrl(event.htmlLink) ? { url: sourceUrl(event.htmlLink) } : {}) })
    }
  }
  batch.warnings.push('Imports are snapshots. Refresh to review changed times; removed events are not deleted from Ripple automatically.')
  return batch
}

export async function readGoogleCalendar(session: GoogleSession, collection: GoogleCollection, options: { from: string; to: string; timezone: string; allDay: 'skip' | 'block' }, signal?: AbortSignal): Promise<ImportBatch> {
  if (session.kind !== 'calendar' || !validDate(options.from) || !validDate(options.to) || options.to < options.from || Date.parse(options.to) - Date.parse(options.from) > 30 * 86400000) throw new Error('Choose a calendar and a date range of up to 31 days.')
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(collection.id)}/events`)
  url.search = new URLSearchParams({ timeMin: eventTime(options.from, 0, options.timezone).toISOString(), timeMax: eventTime(addDays(options.to, 1), 0, options.timezone).toISOString(), timeZone: options.timezone, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '100' }).toString()
  return googleEventsToBatch(await pages(session, url, signal), collection, options)
}

export async function readGoogleTasks(session: GoogleSession, collection: GoogleCollection, signal?: AbortSignal): Promise<ImportBatch> {
  if (session.kind !== 'tasks') throw new Error('Connect Google Tasks first.')
  const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(collection.id)}/tasks`)
  url.search = new URLSearchParams({ maxResults: '100', showCompleted: 'false', showDeleted: 'false', showHidden: 'false' }).toString()
  const tasks = await pages(session, url, signal, 200)
  return { version: 1, source: { provider: 'google-tasks', label: collection.title, namespace: collection.id }, skipped: [], warnings: ['Google Tasks does not supply duration estimates. Review the 30-minute defaults before adding.'], items: tasks.filter(t => typeof t.id === 'string' && t.status !== 'completed' && !t.deleted).map(t => ({ kind: 'task', externalId: String(t.id), title: clipped(t.title, 200) || 'Untitled task', notes: clipped(t.notes, 2000), minutes: 30, priority: 'normal', project: collection.title.slice(0, 80), status: 'todo', ...(typeof t.due === 'string' && validDate(t.due.slice(0, 10)) ? { dueDate: t.due.slice(0, 10) } : {}), ...(sourceUrl(t.webViewLink) ? { url: sourceUrl(t.webViewLink) } : {}) })) }
}
