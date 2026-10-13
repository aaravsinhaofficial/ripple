import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorAccessError, connectorClient, documentNamespace, forgetConnectorSession, safeSourceLink } from '../src/daily/connectorClient'
const connection = { url: 'https://private-ripple.example', token: 'synthetic-app-token' }
const sessionToken = 'synthetic-browser-session-credential'
const session = () => ({ sessionToken, expiresAt: new Date(Date.now() + 3600000).toISOString() })
const provider = { id: 'notion', label: 'Notion', configured: true, connected: true, authMode: 'oauth', detail: 'Read only' }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
afterEach(() => { forgetConnectorSession(connection); vi.unstubAllGlobals() })
describe('private connector client boundaries', () => {
  it('keeps the app/session credentials in headers and sends no workspace during a status check', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response({ providers: [provider] })); vi.stubGlobal('fetch', fetcher)
    expect(await connectorClient(connection).status()).toEqual([provider])
    const [url, request] = fetcher.mock.calls[1]
    expect(url).toBe(connection.url + '/api/connectors'); expect(request.headers.Authorization).toBe('Bearer synthetic-app-token'); expect(request.headers['X-Ripple-Connector-Session']).toBe(sessionToken); expect(request.body).toBeUndefined(); expect(request.credentials).toBe('omit'); expect(request.redirect).toBe('error')
    expect(fetcher.mock.calls.every(([address]) => !address.includes(sessionToken) && !address.includes(connection.token))).toBe(true)
  })
  it('preserves other provider grants when one provider rejects access and requires reconnect', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response({ error: { code: 'connector_authorization' } }, 401)).mockResolvedValueOnce(response({ providers: [provider] })); vi.stubGlobal('fetch', fetcher)
    const client = connectorClient(connection)
    await expect(client.search('notion', 'project')).rejects.toBeInstanceOf(ConnectorAccessError)
    await client.status()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[2][1].headers['X-Ripple-Connector-Session']).toBe(sessionToken)
  })
  it('creates a new isolated session after session expiry, with no silent read retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response({ error: { code: 'connector_session_expired' } }, 401)).mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response({ providers: [provider] })); vi.stubGlobal('fetch', fetcher)
    const client = connectorClient(connection)
    await expect(client.search('notion', 'project')).rejects.toBeInstanceOf(ConnectorAccessError)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await client.status(); expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('rejects authorization redirects to a host outside the provider allowlist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response({ authorizationUrl: 'https://attacker.example/authorize', flowId: 'flow', connected: false })))
    await expect(connectorClient(connection).connect('notion')).rejects.toThrow('unexpected authorization')
  })
  it('rejects malformed source results and strips unsafe links', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response({ documents: [{ id: 'id', title: 'Meeting', url: 'javascript:alert(1)', excerpt: 'Summary' }] })).mockResolvedValueOnce(response({ document: { id: 'id', title: 'Meeting', text: { tool: 'execute' } } })); vi.stubGlobal('fetch', fetcher)
    const client = connectorClient(connection)
    expect((await client.search('notion', 'project')).documents[0].url).toBeUndefined()
    await expect(client.read('notion', 'id')).rejects.toThrow('invalid document')
    expect(safeSourceLink('https://user:password@notion.so/x')).toBeUndefined()
  })
  it('hashes the full long document identity, so common prefixes do not collide', async () => {
    const prefix = 'https://notion.so/' + 'a'.repeat(200)
    const one = await documentNamespace(prefix + 'one'), two = await documentNamespace(prefix + 'two')
    expect(one).not.toBe(two); expect(one.length).toBeLessThan(200); expect(await documentNamespace('short-id')).toBe('short-id')
  })
  it('abort propagates and no provider-read retry is started', async () => {
    const controller = new AbortController(); controller.abort()
    const fetcher = vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError')); vi.stubGlobal('fetch', fetcher)
    await expect(connectorClient(connection).status(controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
