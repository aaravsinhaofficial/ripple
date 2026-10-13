import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleClientId, googleEventsToBatch, listGoogleCollections, readGoogleCalendar, readGoogleTasks, type GoogleSession } from '../src/daily/googleConnector'
const collection = { id: 'my/calendar@example.com', title: 'Work' }
const options = { from: '2026-10-13', to: '2026-10-19', timezone: 'America/Chicago', allDay: 'skip' as const }
const session = (kind: 'calendar' | 'tasks' = 'calendar'): GoogleSession => ({ token: 'synthetic-test-google-token', expiresAt: Date.now() + 3600000, kind })
const event = { id: 'meeting-one', summary: 'Project check-in', start: { dateTime: '2026-10-13T15:00:00Z' }, end: { dateTime: '2026-10-13T15:30:00Z' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=example' }
afterEach(() => vi.unstubAllGlobals())
describe('Google imports cover busy time without changing the source', () => {
  it('uses the workspace timezone and keeps source IDs and links', () => {
    const batch = googleEventsToBatch([event], collection, options)
    expect(batch.source.namespace).toBe(collection.id)
    expect(batch.items[0]).toMatchObject({ kind: 'commitment', date: '2026-10-13', start: 600, end: 630, externalId: 'meeting-one:segment:0', url: event.htmlLink })
  })
  it('rounds busy seconds outward, including midnight, and rejects repeated-hour ambiguity', () => {
    const batch = googleEventsToBatch([{ ...event, start: { dateTime: '2026-10-13T23:50:14-05:00' }, end: { dateTime: '2026-10-13T23:59:59-05:00' } }], collection, options)
    expect(batch.items).toHaveLength(1)
    expect(batch.items[0]).toMatchObject({ start: 1430, end: 1440 })
    const fold = googleEventsToBatch([{ ...event, start: { dateTime: '2026-11-01T01:15:00-05:00' }, end: { dateTime: '2026-11-01T01:45:00-06:00' } }], collection, { ...options, from: '2026-11-01', to: '2026-11-01' })
    expect(fold.items).toHaveLength(0)
    expect(fold.skipped[0].reason).toContain('daylight-saving')
  })
  it('ignores canceled, free, working-location and self-declined events', () => {
    const batch = googleEventsToBatch([{ ...event, status: 'cancelled' }, { ...event, transparency: 'transparent' }, { ...event, eventType: 'workingLocation' }, { ...event, attendees: [{ self: true, responseStatus: 'declined' }] }], collection, options)
    expect(batch.items).toHaveLength(0); expect(batch.skipped).toHaveLength(4)
  })
  it('makes all-day blocking explicit and treats the ending date as exclusive', () => {
    const allDay = { ...event, start: { date: '2026-10-13' }, end: { date: '2026-10-15' } }
    expect(googleEventsToBatch([allDay], collection, options).items).toHaveLength(0)
    const batch = googleEventsToBatch([allDay], collection, { ...options, allDay: 'block' })
    expect(batch.items.map(i => i.kind === 'commitment' && i.date)).toEqual(['2026-10-13', '2026-10-14'])
    expect(batch.items[0]).toMatchObject({ start: 0, end: 1440, allDay: true })
  })
  it('splits overnight commitments, ignores invalid source links and rejects unbounded ranges', () => {
    const batch = googleEventsToBatch([{ ...event, htmlLink: 'javascript:alert(1)', start: { dateTime: '2026-10-13T23:00:00-05:00' }, end: { dateTime: '2026-10-14T01:00:00-05:00' } }], collection, options)
    expect(batch.items).toHaveLength(2); expect(batch.items[0]).toMatchObject({ start: 1380, end: 1440 }); expect(batch.items[1]).toMatchObject({ start: 0, end: 60 }); expect(batch.items[0].url).toBeUndefined()
    expect(() => googleEventsToBatch([], collection, { ...options, to: '2027-01-01' })).toThrow('31 days')
  })
  it('paginates real read URLs, keeps bearer credentials out of URLs, and requests expanded recurring events', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [event], nextPageToken: 'page2' }))).mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
    vi.stubGlobal('fetch', fetcher)
    const batch = await readGoogleCalendar(session(), collection, options)
    expect(batch.items).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toContain('singleEvents=true'); expect(url).not.toContain('synthetic-test-google-token'); expect(init.headers.Authorization).toBe('Bearer synthetic-test-google-token'); expect(init.redirect).toBe('error'); expect(init.body).toBeUndefined()
    }
    expect(fetcher.mock.calls[1][0]).toContain('pageToken=page2')
  })
  it('refuses expired credentials before network and invalidates a rejected token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 })); vi.stubGlobal('fetch', fetcher)
    await expect(listGoogleCollections({ ...session(), expiresAt: 0 })).rejects.toThrow('expired'); expect(fetcher).not.toHaveBeenCalled()
    const credentials = session(); await expect(listGoogleCollections(credentials)).rejects.toThrow('expired'); expect(credentials.expiresAt).toBe(0)
  })
  it('rejects repeat cursors without silently returning a partial import', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ items: [], nextPageToken: 'same' })))))
    await expect(listGoogleCollections(session())).rejects.toThrow('cursor')
  })
  it('imports unfinished Google tasks as drafts with labeled default estimates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 'a', title: 'Review draft', status: 'needsAction', notes: 'Two-page limit', due: '2026-10-16T00:00:00.000Z' }, { id: 'b', title: 'Done', status: 'completed' }] }))))
    const batch = await readGoogleTasks(session('tasks'), collection)
    expect(batch.items).toHaveLength(1); expect(batch.items[0]).toMatchObject({ minutes: 30, status: 'todo', notes: 'Two-page limit', dueDate: '2026-10-16' }); expect(batch.warnings[0]).toContain('30-minute')
  })
  it('accepts only public Google client IDs, not secrets or arbitrary URLs', () => {
    expect(googleClientId('123456-example.apps.googleusercontent.com')).toContain('apps.googleusercontent.com')
    expect(googleClientId('https://attacker.example')).toBe(''); expect(googleClientId('secret')).toBe('')
  })
})
