import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, FileText, Link2, ListTodo, LoaderCircle, NotebookTabs, Plug, Sheet, Upload } from 'lucide-react'
import DailyModal from './DailyModal'
import type { Workspace } from './types'
import type { Connection } from './assist'
import { addDays } from './storage'
import { applyImport, inspectTaskCSV, parseActionNotes, parseConnectorPack, parseICS, parseTaskCSV, previewImport, type CSVField, type CSVMapping, type ImportBatch, type ImportPreview } from './imports'
import { googleClientId, listGoogleCollections, loadGoogleIdentity, readGoogleCalendar, readGoogleTasks, requestGoogleAccess, revokeGoogle, type GoogleCollection, type GoogleKind, type GoogleSession } from './googleConnector'
import { ConnectorAccessError, connectorClient, documentNamespace, safeSourceLink, type ConnectorDocument, type ConnectorFlow, type McpProvider, type ProviderStatus } from './connectorClient'
import './connectors.css'

type Choice = 'google-calendar' | 'google-tasks' | McpProvider | 'ics' | 'csv' | 'notes' | 'pack'
type Run = <T>(operation: (signal: AbortSignal) => Promise<T>, done: (value: T) => void) => void
const labels: Record<Choice, string> = { 'google-calendar': 'Google Calendar', 'google-tasks': 'Google Tasks', notion: 'Notion', granola: 'Granola', otter: 'Otter', ics: 'Calendar file', csv: 'Task spreadsheet', notes: 'Meeting notes', pack: 'Connector pack' }
const docsUrl = 'https://github.com/aaravsinhaofficial/ripple/blob/main/docs/connectors.md'
const googleSessions = new Map<GoogleKind, GoogleSession>()
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const message = (e: unknown) => e instanceof Error ? e.message : 'This import could not finish. Your workspace has not changed.'
function GuideLink({ children = 'Connection setup guide' }: { children?: string }) { return <a className="d-doc-link" href={docsUrl} target="_blank" rel="noreferrer">{children} <ArrowUpRight size={14} /></a> }
function DateRange({ from, to, setFrom, setTo, allDay, setAllDay, disabled }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; allDay: boolean; setAllDay: (v: boolean) => void; disabled?: boolean }) {
  return <><div className="c-fields"><label className="d-field">From date<input type="date" value={from} onChange={e => setFrom(e.target.value)} disabled={disabled} /></label><label className="d-field">Through date<input type="date" value={to} onChange={e => setTo(e.target.value)} disabled={disabled} /></label></div><label className="c-check"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} disabled={disabled} />Block all-day events</label><p className="c-hint">Import up to 31 days. All-day events are skipped unless selected. Times use your Ripple timezone.</p></>
}

function GooglePanel({ kind, workspace, busy, run, onBatch, fail }: { kind: GoogleKind; workspace: Workspace; busy: boolean; run: Run; onBatch: (b: ImportBatch) => void; fail: (s: string) => void }) {
  const [clientId, setClientId] = useState(googleClientId)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<GoogleSession | null>(() => googleSessions.get(kind) ?? null)
  const [collections, setCollections] = useState<GoogleCollection[]>([])
  const [selected, setSelected] = useState('')
  const [from, setFrom] = useState(workspace.settings.date), [to, setTo] = useState(addDays(workspace.settings.date, 6)), [allDay, setAllDay] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!session) return
    const expire = () => { googleSessions.delete(kind); setSession(null); setCollections([]); setSelected('') }
    const timer = window.setTimeout(expire, Math.max(0, session.expiresAt - Date.now() - 10000))
    return () => window.clearTimeout(timer)
  }, [session, kind])
  const perform: Run = (operation, done) => run(async signal => {
    try { return await operation(signal) }
    catch (e) { if (alive.current && session && session.expiresAt <= Date.now()) { googleSessions.delete(kind); setSession(null); setCollections([]); setSelected('') }; throw e }
  }, done)
  useEffect(() => { let active = true; loadGoogleIdentity().then(() => { if (active) setReady(true) }).catch(e => { if (active) fail(message(e)) }); return () => { active = false } }, [fail])
  function receive(list: GoogleCollection[]) { setCollections(list); setSelected(list.find(c => c.primary)?.id ?? list[0]?.id ?? '') }
  function connect() {
    const auth = requestGoogleAccess(clientId, kind)
    run(async signal => {
      const next = await auth
      if (signal.aborted) throw new DOMException('Canceled', 'AbortError')
      const list = await listGoogleCollections(next, signal)
      return { next, list }
    }, ({ next, list }) => { googleSessions.set(kind, next); setSession(next); receive(list) })
  }
  return <div className="c-panel">
    <div className="c-provider-intro"><div className="c-provider-mark google">G</div><div><h3>{kind === 'calendar' ? 'Make room for your meetings.' : 'Bring your existing tasks along.'}</h3><p>{kind === 'calendar' ? 'Choose a calendar, then review its events as fixed commitments.' : 'Choose a task list, then review unfinished tasks and their estimates.'}</p></div></div>
    {!session ? <>
      <p className="c-hint">Read access only. Your Google token stays in memory and clears when you reload. No events or tasks are written back.</p>
      {!googleClientId() && <div className="c-notice"><strong>One-time setup by the site owner</strong><p>Google sign-in needs a Google OAuth client ID for this website. Calendar files and task spreadsheets already work without setup.</p><GuideLink /><details><summary>Use your own client ID</summary><label className="d-field">Google OAuth client ID<input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off" disabled={busy} /></label><p className="c-hint">This is a public app identifier. Never paste a client secret or API key.</p></details></div>}
      <button className="d-button d-primary" onClick={connect} disabled={busy || !ready || !googleClientId(clientId)}>{!ready ? 'Loading Google sign-in…' : 'Continue with Google'}</button>
    </> : <>
      <div className="c-connected"><Check size={16} />Read access connected for this tab <button disabled={busy} onClick={() => { googleSessions.delete(kind); setSession(null); setCollections([]); setSelected('') }}>Disconnect here</button></div>
      <p className="c-hint">Disconnecting here forgets this tab’s token. <button className="c-text-button" disabled={busy} onClick={() => run(() => revokeGoogle(session), () => { googleSessions.clear(); setSession(null); setCollections([]) })}>Revoke Ripple’s Google access</button></p>
      <div className="c-fields"><label className="d-field">{kind === 'calendar' ? 'Calendar' : 'Task list'}<select value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}><option value="">{collections.length ? 'Choose a list' : 'Load your lists'}</option>{collections.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><button className="d-button d-secondary" disabled={busy} onClick={() => perform(signal => listGoogleCollections(session, signal), receive)}>Refresh lists</button></div>
      {kind === 'calendar' && <DateRange {...{ from, to, setFrom, setTo, allDay, setAllDay }} disabled={busy} />}
      <button className="d-button d-primary" disabled={busy || !selected} onClick={() => {
        const collection = collections.find(c => c.id === selected)!
        perform(signal => kind === 'calendar' ? readGoogleCalendar(session, collection, { from, to, timezone: workspace.settings.timezone, allDay: allDay ? 'block' : 'skip' }, signal) : readGoogleTasks(session, collection, signal), onBatch)
      }}>Review import</button>
    </>}
  </div>
}

function McpPanel({ provider, connection, workspace, busy, run, onBatch, fail, onConnectService }: { provider: McpProvider; connection: Connection; workspace: Workspace; busy: boolean; run: Run; onBatch: (b: ImportBatch) => void; fail: (s: string) => void; onConnectService: () => void }) {
  const client = useMemo(() => connection.url ? connectorClient(connection) : null, [connection.url, connection.token])
  const [status, setStatus] = useState<ProviderStatus | null>(null), [query, setQuery] = useState(''), [searched, setSearched] = useState(false)
  const [documents, setDocuments] = useState<ConnectorDocument[]>([]), [warnings, setWarnings] = useState<string[]>([])
  const [flow, setFlow] = useState<ConnectorFlow | null>(null), [code, setCode] = useState('')
  const popup = useRef<Window | null>(null), active = useRef(true), finishing = useRef(false)
  const flowRef = useRef<ConnectorFlow | null>(null)
  const perform: Run = (operation, done) => run(async signal => {
    try { return await operation(signal) }
    catch (e) { if (e instanceof ConnectorAccessError && active.current && !signal.aborted) { setStatus(previous => previous ? { ...previous, connected: false } : null); setDocuments([]); setSearched(false) }; throw e }
  }, done)
  const reload = () => { if (client) perform(signal => client.status(signal), providers => setStatus(providers.find(p => p.id === provider) ?? null)) }
  useEffect(() => { active.current = true; return () => {
    active.current = false; popup.current?.close()
    if (client && flowRef.current) { flowRef.current = null; void client.disconnect(provider).catch(() => { /* The server expires an unreachable pending grant. */ }) }
  } }, [client, provider])
  useEffect(() => {
    if (!client || !flow?.flowId) return
    const listener = (event: MessageEvent) => {
      const data = event.data
      if (event.origin !== client.origin || event.source !== popup.current || data?.type !== 'ripple-connector-complete' || data.provider !== provider || data.flowId !== flow.flowId || typeof data.completionToken !== 'string' || finishing.current) return
      finish(data.completionToken)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  })
  function finish(token: string) {
    if (!client || !flow?.flowId) return
    finishing.current = true
    perform(async signal => { try { await client.finish(provider, flow.flowId!, token.trim(), signal); return await client.status(signal) } finally { finishing.current = false } }, providers => { popup.current?.close(); flowRef.current = null; setFlow(null); setCode(''); setStatus(providers.find(p => p.id === provider) ?? null) })
  }
  function connect() {
    if (!client) return
    // Open during the gesture, before the network request, so popup blockers do not swallow sign-in.
    popup.current?.close()
    const nextPopup = window.open('about:blank', '_blank', 'popup,width=620,height=760')
    popup.current = nextPopup
    if (!nextPopup) { fail('Allow the sign-in popup, then try connecting again.'); return }
    try { nextPopup.document.title = 'Connecting to ' + labels[provider]; nextPopup.document.body.textContent = 'Preparing your secure sign-in…' } catch {}
    perform(async signal => { try { return await client.connect(provider, signal) } catch (e) { nextPopup.close(); throw e } }, result => {
      if (!active.current) { nextPopup.close(); return }
      if (result.connected) { nextPopup.close(); reload(); return }
      flowRef.current = result; setFlow(result)
      nextPopup.location.href = result.authorizationUrl!
    })
  }
  return <div className="c-panel">
    <div className="c-provider-intro"><div className={`c-provider-mark ${provider}`}>{labels[provider][0]}</div><div><h3>Turn context into your next steps.</h3><p>Connect {labels[provider]}, find a note, and review its action items as tasks.</p></div></div>
    <p className="c-hint">Ripple uses {status?.authMode === 'server-token' ? 'the Notion API' : 'the official MCP server'} to search and read the documents you choose. Nothing is changed in {labels[provider]}. Your provider’s plan and sharing settings control access.</p>
    {!client ? <div className="c-notice"><strong>Connect your Ripple service first</strong><p>The private service handles authorization for Notion, Granola, and Otter. You can import exported notes below while hosting is being set up.</p><button className="d-button d-primary" onClick={onConnectService}>Connect Ripple service</button><GuideLink /></div> : <>
      {!status && <button className="d-button d-primary" disabled={busy} onClick={reload}>Check connection</button>}
      {status && <>
        <p className={`c-connection-state ${status.connected ? 'connected' : ''}`}><span />{status.connected ? 'Connected for this tab' : status.configured ? 'Ready to connect' : 'Service setup needed'}</p>
        {status.detail && <p className="c-hint">{status.detail}</p>}
        {!status.connected ? <><button className="d-button d-primary" disabled={busy || !status.configured} onClick={connect}>Connect {labels[provider]}</button>{!status.configured && <GuideLink />}</> : <>
          <form onSubmit={e => { e.preventDefault(); perform(signal => client.search(provider, query, signal), result => { setDocuments(result.documents); setWarnings(result.warnings); setSearched(true) }) }} className="c-search-form"><label className="d-field">Search your notes<input value={query} onChange={e => setQuery(e.target.value)} maxLength={200} placeholder="A project, meeting, or topic" disabled={busy} /></label><button className="d-button d-primary" disabled={busy}>Find notes</button></form>
          {warnings.map((w, i) => <p className="c-notice" key={i}>{w}</p>)}
          {searched && !documents.length && <p className="c-notice">No accessible notes matched. Try a more specific topic or check sharing in {labels[provider]}.</p>}
          <div className="c-documents">{documents.map(doc => <article key={doc.id}><div><strong>{doc.title}</strong>{doc.excerpt && <p>{doc.excerpt}</p>}{doc.url && <a href={doc.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={12} /></a>}</div><button className="d-button d-secondary" disabled={busy} onClick={() => perform(async signal => { const result = await client.read(provider, doc.id, signal); return { ...result, namespace: await documentNamespace(result.document.id) } }, result => {
            if (!result.document.text) { fail('This note did not contain readable text. Open its source to check access.'); return }
            try {
              const batch = parseActionNotes(result.document.text, { provider, sourceLabel: result.document.title.slice(0, 200), namespace: result.namespace, sourceUrl: result.document.url, date: workspace.settings.date })
              batch.warnings.push(...result.warnings)
              onBatch(batch)
            } catch (e) { fail(message(e)) }
          })}>Review action items</button></article>)}</div>
          <button className="c-text-button" disabled={busy} onClick={() => perform(signal => client.disconnect(provider, signal), () => { setDocuments([]); setSearched(false); reload() })}>Disconnect {labels[provider]}</button>
        </>}
      </>}
      {flow && <div className="c-notice" role="status"><strong>Finish signing in to {labels[provider]}</strong><p>The authorization window will return you here. If it shows a completion code instead, paste that one-time code below.</p><label className="d-field">Connection completion code<input type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" disabled={busy} /></label><div className="c-inline-actions"><button className="d-button d-primary" disabled={busy || !code.trim()} onClick={() => finish(code)}>Finish connection</button><button className="d-button d-secondary" onClick={() => {
        popup.current?.close(); flowRef.current = null; setFlow(null); setCode(''); setStatus(previous => previous ? { ...previous, connected: false } : null)
        if (client) perform(signal => client.disconnect(provider, signal), () => {})
      }}>Cancel sign-in</button></div></div>}
    </>}
  </div>
}

export default function Connectors({ workspace, connection, onApply, onClose, onConnectService }: { workspace: Workspace; connection: Connection; onApply: (workspace: Workspace, count: number) => void; onClose: () => void; onConnectService: () => void }) {
  const [choice, setChoice] = useState<Choice | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null), [selection, setSelection] = useState<Set<string>>(new Set())
  const [text, setText] = useState(''), [name, setName] = useState(''), [mapping, setMapping] = useState<CSVMapping>({ title: '' }), [headers, setHeaders] = useState<string[]>([])
  const [from, setFrom] = useState(workspace.settings.date), [to, setTo] = useState(addDays(workspace.settings.date, 6)), [allDay, setAllDay] = useState(false)
  const [namespace, setNamespace] = useState(''), [noteProvider, setNoteProvider] = useState<'notes' | McpProvider>('notes'), [sourceUrl, setSourceUrl] = useState(''), [defaultMinutes, setDefaultMinutes] = useState(30), [dateFormat, setDateFormat] = useState<'iso' | 'mdy' | 'dmy'>('iso')
  const controller = useRef<AbortController | null>(null)
  const cancel = () => { controller.current?.abort(); setBusy(false) }
  useEffect(() => () => { controller.current?.abort() }, [])
  const run: Run = (operation, done) => {
    controller.current?.abort()
    const current = new AbortController(); controller.current = current; setBusy(true); setError('')
    operation(current.signal).then(value => { if (!current.signal.aborted) done(value) }).catch(e => { if (!current.signal.aborted) setError(message(e)) }).finally(() => { if (controller.current === current) setBusy(false) })
  }
  function review(batch: ImportBatch) { const result = previewImport(workspace, batch); setPreview(result); setSelection(new Set(result.rows.filter(row => row.selected).map(row => row.key))); setError('') }
  function choose(next: Choice) { cancel(); setChoice(next); setPreview(null); setText(''); setName(''); setNamespace(''); setHeaders([]); setMapping({ title: '' }); setError('') }
  function file(file?: File) {
    if (!file) return
    if (file.size > 1_000_000) { setError('Import a file smaller than 1 MB. Export fewer items or a shorter date range.'); return }
    run(() => file.text(), value => {
      setText(value); setName(file.name); setNamespace(file.name)
      if (choice === 'csv') { const details = inspectTaskCSV(value); setHeaders(details.headers); setMapping(details.mapping) }
    })
  }
  function reviewLocal() {
    try {
      if (choice === 'ics') review(parseICS(text, { timezone: workspace.settings.timezone, from, to, allDay: allDay ? 'block' : 'skip', sourceLabel: name || 'Calendar file', namespace: namespace || name || 'calendar' }))
      else if (choice === 'csv') review(parseTaskCSV(text, { mapping, sourceLabel: name || 'Task spreadsheet', namespace: namespace || name || 'tasks', defaultMinutes, dateFormat }))
      else if (choice === 'notes') {
        if (sourceUrl && !safeSourceLink(sourceUrl)) throw new Error('Use a full HTTPS source link without a username or password.')
        review(parseActionNotes(text, { provider: noteProvider, sourceLabel: name || labels[noteProvider === 'notes' ? 'notes' : noteProvider], namespace: namespace || sourceUrl || name || 'pasted-notes', sourceUrl: sourceUrl || undefined, defaultMinutes, date: workspace.settings.date }))
      } else if (choice === 'pack') review(parseConnectorPack(text))
    } catch (e) { setError(message(e)) }
  }
  function apply() {
    if (!preview) return
    try {
      const add = preview.rows.filter(row => row.status === 'added' && selection.has(row.key)).map(row => row.key), replace = preview.rows.filter(row => row.status === 'changed' && selection.has(row.key)).map(row => row.key)
      const next = applyImport(workspace, preview, { add, replace })
      onApply(next, add.length + replace.length)
    } catch (e) { setError(message(e)) }
  }
  const cards: { id: Choice; subtitle: string; icon: typeof CalendarDays; badge: string }[] = [
    { id: 'google-calendar', subtitle: 'Reserve time for the meetings already in your day.', icon: CalendarDays, badge: 'Read-only connection' },
    { id: 'google-tasks', subtitle: 'Bring in unfinished tasks from a chosen list.', icon: ListTodo, badge: 'Read-only connection' },
    { id: 'notion', subtitle: 'Find pages and bring action items into your plan.', icon: NotebookTabs, badge: 'Official MCP' },
    { id: 'granola', subtitle: 'Give your meeting follow-ups a place in the day.', icon: FileText, badge: 'Official MCP' },
    { id: 'otter', subtitle: 'Turn meeting notes into reviewable next steps.', icon: FileText, badge: 'Official MCP' },
    { id: 'ics', subtitle: 'Google, Apple, Outlook, and other .ics calendars.', icon: CalendarDays, badge: 'Works now · on device' },
    { id: 'csv', subtitle: 'Notion, Todoist, spreadsheets, and CSV task lists.', icon: Sheet, badge: 'Works now · on device' },
    { id: 'notes', subtitle: 'Paste a summary, checklist, or exported meeting note.', icon: FileText, badge: 'Works now · on device' },
    { id: 'pack', subtitle: 'Import a structured handoff from any connected assistant.', icon: Plug, badge: 'For power users' },
  ]
  return <DailyModal title="Bring your work into Ripple" wide onClose={() => { cancel(); onClose() }}>
    <div className="c-shell">
      {(choice || preview) && <button className="c-back" onClick={() => { cancel(); setError(''); preview ? setPreview(null) : setChoice(null) }}><ArrowLeft size={15} />{preview ? 'Back to source' : 'All connections'}</button>}
      {error && <div className="d-alert" role="alert">{error}</div>}
      {busy && <p className="c-busy" role="status"><LoaderCircle size={16} className="c-spin" />Loading your selection… {!['notion', 'granola', 'otter'].includes(choice || '') && <button onClick={cancel}>Cancel</button>}</p>}
      {!choice && !preview && <>
        <p className="c-intro">Your day is already scattered across a few places.<br /><strong>Bring it together, then choose what belongs in your plan.</strong></p>
        <div className="c-trust"><Check size={14} />Review before adding<span>·</span><Check size={14} />Duplicates checked<span>·</span><Check size={14} />Undo anytime</div>
        <div className="c-grid">{cards.map(({ id, subtitle, icon: Icon, badge }) => <button className="c-card" key={id} aria-label={labels[id]} onClick={() => choose(id)}><span className={`c-card-icon ${id}`}><Icon size={21} /></span><strong>{labels[id]}</strong><p>{subtitle}</p><small>{badge}<ArrowUpRight size={13} /></small></button>)}</div>
        <p className="c-hint">Connections belong to this browser tab. File imports stay on your device. Imported items are snapshots; refresh a source to review changes.</p><a className="c-text-button" href="./third-party-notices.txt" target="_blank" rel="noreferrer">Open-source notices</a>
      </>}
      {choice && !preview && <>
        <div className="c-source-heading"><span>IMPORT FROM</span><h3>{labels[choice]}</h3></div>
        {(choice === 'google-calendar' || choice === 'google-tasks') && <GooglePanel key={choice} kind={choice === 'google-calendar' ? 'calendar' : 'tasks'} {...{ workspace, busy, run }} onBatch={review} fail={setError} />}
        {(['notion', 'granola', 'otter'] as string[]).includes(choice) && <McpPanel key={choice} provider={choice as McpProvider} {...{ workspace, connection, busy, run, onConnectService }} onBatch={review} fail={setError} />}
        {(['ics', 'csv', 'notes', 'pack'] as string[]).includes(choice) && <div className="c-panel">
          <p className="c-hint">{choice === 'ics' ? 'Events become fixed commitments. Recurring events are expanded within your chosen dates.' : choice === 'csv' ? 'Choose which columns contain the task details. Missing estimates start at 30 minutes.' : choice === 'notes' ? 'Paste action items or a Markdown checklist. Review the detected tasks and their estimates before adding.' : 'Use a Ripple connector pack from an assistant, script, or another app. This adds selected items; it does not replace your workspace.'}</p>
          {choice !== 'notes' && <label className="c-file"><Upload size={19} /><span>{choice === 'ics' ? 'Choose calendar file' : choice === 'csv' ? 'Choose task spreadsheet' : 'Choose connector pack'}</span><input type="file" aria-label={choice === 'ics' ? 'Choose calendar file' : choice === 'csv' ? 'Choose task spreadsheet' : 'Choose connector pack'} accept={choice === 'ics' ? '.ics,text/calendar' : choice === 'csv' ? '.csv,text/csv' : '.json,application/json'} onChange={e => { file(e.target.files?.[0]); e.target.value = '' }} disabled={busy} /></label>}
          {name && choice !== 'notes' && <p className="c-file-name"><FileText size={14} />{name}</p>}
          {choice === 'ics' && <DateRange {...{ from, to, setFrom, setTo, allDay, setAllDay }} disabled={busy} />}
          {choice === 'csv' && headers.length > 0 && <>
            <div className="c-fields c-mapping">{([['title', 'Task title column'], ['minutes', 'Minutes column'], ['dueDate', 'Due date column'], ['project', 'Project column'], ['status', 'Status column'], ['externalId', 'Stable ID column'], ['notes', 'Notes column'], ['priority', 'Priority column'], ['url', 'Source URL column']] as [CSVField, string][]).map(([field, label]) => <label className="d-field" key={field}>{label}<select value={mapping[field] ?? ''} onChange={e => setMapping({ ...mapping, [field]: e.target.value })}><option value="">{field === 'title' ? 'Choose a column' : 'Not included'}</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
            <label className="d-field">Date format<select value={dateFormat} onChange={e => setDateFormat(e.target.value as typeof dateFormat)}><option value="iso">Year-month-day (2026-10-13)</option><option value="mdy">Month/day/year</option><option value="dmy">Day/month/year</option></select></label>
          </>}
          {choice === 'notes' && <>
            <div className="c-fields"><label className="d-field">Notes source<select value={noteProvider} onChange={e => setNoteProvider(e.target.value as typeof noteProvider)}><option value="notes">Pasted notes</option><option value="notion">Notion</option><option value="granola">Granola</option><option value="otter">Otter</option></select></label><label className="d-field">Note title<input value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="e.g. Monday project meeting" /></label></div>
            <label className="d-field">Notes or action items<textarea value={text} onChange={e => setText(e.target.value)} rows={9} maxLength={100_000} placeholder={'Action items\n- [ ] Send the updated proposal 30m\n- [ ] Review the design draft 45m'} /></label>
            <label className="d-field">Source link (optional)<input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" maxLength={2000} /></label>
            <label className="c-file"><Upload size={16} /><span>Or choose a notes file</span><input type="file" aria-label="Choose notes file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e => { file(e.target.files?.[0]); e.target.value = '' }} /></label>
          </>}
          {choice === 'pack' && <><label className="d-field">Connector pack JSON<textarea value={text} onChange={e => setText(e.target.value)} rows={8} maxLength={1_000_000} placeholder='{"version":1,"source":{…},"items":[…]}' /></label><GuideLink>Connector pack format and assistant instructions</GuideLink></>}
          {(choice === 'notes' || choice === 'csv') && <label className="d-field c-estimate">Default estimate (minutes)<input type="number" min={1} max={720} value={defaultMinutes} onChange={e => setDefaultMinutes(Number(e.target.value))} /></label>}
          {choice !== 'pack' && <details className="c-advanced"><summary>Import identity</summary><label className="d-field">Source identity<input value={namespace} onChange={e => setNamespace(e.target.value)} maxLength={200} placeholder="Defaults to this file or note" /></label><p className="c-hint">Reuse this identity when refreshing the same source, even if you rename the export. This helps Ripple recognize existing items.</p></details>}
          <div className="d-modal-actions"><button className="d-button d-primary" disabled={busy || !text.trim() || (choice === 'csv' && !mapping.title)} onClick={reviewLocal}>Review import</button></div>
        </div>}
      </>}
      {preview && <div className="c-review">
        <div className="c-review-heading"><div><span>REVIEW IMPORT</span><h3>{preview.source.label}</h3></div><span className="c-device-badge">Nothing added yet</span></div>
        <div className="c-counts"><span><b>{preview.counts.added}</b> new</span><span><b>{preview.counts.changed}</b> changed</span><span><b>{preview.counts.duplicate}</b> already imported</span><span><b>{preview.counts.skipped}</b> skipped</span></div>
        {preview.warnings.map((warning, index) => <p className="c-notice" key={index}>{warning}</p>)}
        <p className="c-hint">New items are selected. Changed items need your explicit choice and may replace local edits. Completed tasks stay completed.</p>
        <div className="c-inline-actions"><button className="c-text-button" onClick={() => setSelection(new Set(preview.rows.filter(r => r.status === 'added').map(r => r.key)))}>Select new items</button><button className="c-text-button" onClick={() => setSelection(new Set())}>Clear selection</button></div>
        {!preview.rows.length && <p className="c-notice">No importable items were found. Check your source, date range, or action-item formatting.</p>}
        <div className="c-review-list">{preview.rows.map(row => <article className={`c-review-row ${row.status}`} key={row.key}>
          <label className="c-row-select"><input type="checkbox" aria-label={`Import ${row.title}`} checked={selection.has(row.key)} disabled={!['added', 'changed'].includes(row.status)} onChange={e => setSelection(previous => { const next = new Set(previous); e.target.checked ? next.add(row.key) : next.delete(row.key); return next })} /><span><strong>{row.title}</strong><small>{row.item?.kind === 'commitment' ? `${row.item.date} · ${row.item.allDay ? 'All day' : `${clock(row.item.start)}–${clock(row.item.end)}`} · Fixed commitment` : row.item?.kind === 'task' ? `${row.item.minutes} min${row.item.dueDate ? ` · Due ${row.item.dueDate}` : ''}${row.item.status === 'done' ? ' · Completed at source' : ''}` : row.reason}</small></span><em>{row.status === 'added' ? 'New' : row.status === 'duplicate' ? 'Already imported' : row.status === 'changed' ? 'Changed' : 'Skipped'}</em></label>
          {row.item?.url && <a className="c-source-link" href={row.item.url} target="_blank" rel="noreferrer"><Link2 size={12} />Open source <ArrowUpRight size={12} /></a>}
          {row.reason && row.item && <p className="c-hint">{row.reason}</p>}
          {row.localEdited && <p className="c-local-edit">You have edited this item in Ripple.</p>}
          {row.status === 'changed' && <div className="c-diffs">{row.diffs.map(diff => <p key={diff.field}><b>{diff.field}</b><del>{diff.before || '(empty)'}</del><span>→ {diff.after || '(empty)'}</span></p>)}</div>}
          {row.item?.notes && <details className="c-item-notes"><summary>Notes</summary><p>{row.item.notes}</p></details>}
        </article>)}</div>
        <div className="c-review-footer"><p>{selection.size} selected <span>·</span> Added to your workspace; plan when ready.</p><button className="d-button d-primary" disabled={!selection.size || busy} onClick={apply}>Add selected items</button></div>
      </div>}
    </div>
  </DailyModal>
}
