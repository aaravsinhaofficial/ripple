import { safeEndpoint, type Connection } from './assist'

export type McpProvider = 'notion' | 'granola' | 'otter'
export type ProviderStatus = { id: McpProvider; label: string; configured: boolean; connected: boolean; authMode: 'oauth' | 'server-token'; detail: string }
export type ConnectorDocument = { id: string; title: string; url?: string; excerpt?: string; text?: string }
export type ConnectorFlow = { authorizationUrl?: string; connected: boolean; flowId?: string; expiresAt?: string }
const sessions = new Map<string, { token: string; expiresAt: number }>()
export class ConnectorAccessError extends Error {}
export function forgetConnectorSession(connection: Connection) { if (connection.url) sessions.delete(`${safeEndpoint(connection.url)}\n${connection.token}`) }
export async function documentNamespace(id: string): Promise<string> {
  if (id.length <= 200) return id
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return `document:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function safeSourceLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return undefined
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined } catch { return undefined }
}

export function connectorClient(connection: Connection) {
  const base = safeEndpoint(connection.url), key = `${base}\n${connection.token}`
  async function request(path: string, body?: unknown, signal?: AbortSignal, needsSession = true): Promise<Record<string, unknown>> {
    let session = sessions.get(key)
    if (needsSession && (!session || session.expiresAt <= Date.now())) {
      sessions.delete(key)
      const result = await request('/api/connectors/session', {}, signal, false)
      if (typeof result.sessionToken !== 'string' || result.sessionToken.length < 20 || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('The service returned an invalid connector session.')
      session = { token: result.sessionToken, expiresAt: Date.parse(result.expiresAt) }
      sessions.set(key, session)
    }
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}), ...(needsSession ? { 'X-Ripple-Connector-Session': session!.token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000) })
    const text = await response.text()
    if (text.length > 1_000_000) throw new Error('The connector returned too much content. Choose a smaller document.')
    let data: unknown
    try { data = JSON.parse(text) } catch { throw new Error('The connector service returned an unreadable response. Update the service and try again.') }
    if (!response.ok) {
      if (response.status === 401) {
        const code = object(data) && object(data.error) ? data.error.code : undefined
        if (!['not_connected', 'authorization', 'connector_not_connected', 'connector_authorization'].includes(String(code))) sessions.delete(key)
        throw new ConnectorAccessError('This connection expired or access was rejected. Connect this source again; if needed, reconnect the Ripple service.')
      }
      if (response.status === 404) throw new Error('This service does not have connectors yet. Update the Ripple API or use a file import.')
      const message = object(data) && object(data.error) && typeof data.error.message === 'string' ? data.error.message : object(data) && typeof data.detail === 'string' ? data.detail : 'The source could not complete this request. Your workspace has not changed.'
      throw new Error(message.slice(0, 500))
    }
    if (!object(data)) throw new Error('The connector returned invalid data.')
    return data
  }
  const providerPath = (provider: McpProvider, action: string) => {
    if (!['notion', 'granola', 'otter'].includes(provider)) throw new Error('Unsupported connector.')
    return `/api/connectors/${provider}/${action}`
  }
  const document = (value: unknown): ConnectorDocument => {
    if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.length > 2000 || typeof value.title !== 'string' || value.title.length > 1000 || (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 100_000))) throw new Error('The source returned an invalid document.')
    return { id: value.id, title: value.title, ...(safeSourceLink(value.url) ? { url: safeSourceLink(value.url) } : {}), ...(typeof value.excerpt === 'string' ? { excerpt: value.excerpt.slice(0, 1000) } : {}), ...(typeof value.text === 'string' ? { text: value.text } : {}) }
  }
  return {
    origin: new URL(base).origin,
    async status(signal?: AbortSignal): Promise<ProviderStatus[]> {
      const data = await request('/api/connectors', undefined, signal)
      if (!Array.isArray(data.providers) || data.providers.length > 10) throw new Error('The service returned an invalid connector list.')
      return data.providers.map(value => {
        if (!object(value) || !['notion', 'granola', 'otter'].includes(String(value.id)) || typeof value.label !== 'string' || typeof value.configured !== 'boolean' || typeof value.connected !== 'boolean' || !['oauth', 'server-token'].includes(String(value.authMode)) || typeof value.detail !== 'string') throw new Error('The service returned invalid connection details.')
        return value as ProviderStatus
      })
    },
    async connect(provider: McpProvider, signal?: AbortSignal): Promise<ConnectorFlow> {
      const data = await request(providerPath(provider, 'connect'), {}, signal)
      if (data.connected === true) return { connected: true }
      const url = safeSourceLink(data.authorizationUrl)
      if (!url || typeof data.flowId !== 'string') throw new Error('The service did not provide a valid authorization link.')
      // Only the verified provider authorization domains can receive this navigation.
      if (!['mcp.notion.com', 'mcp-auth.granola.ai', 'otter.ai'].includes(new URL(url).hostname)) throw new Error('The service returned an unexpected authorization provider.')
      return { connected: false, authorizationUrl: url, flowId: data.flowId, ...(typeof data.expiresAt === 'string' ? { expiresAt: data.expiresAt } : {}) }
    },
    async finish(provider: McpProvider, flowId: string, completionToken: string, signal?: AbortSignal) {
      const data = await request(providerPath(provider, 'finish'), { flowId, completionToken }, signal)
      if (data.connected !== true) throw new Error('Authorization is not complete. Finish the source’s sign-in first.')
    },
    async search(provider: McpProvider, query: string, signal?: AbortSignal): Promise<{ documents: ConnectorDocument[]; warnings: string[] }> {
      const data = await request(providerPath(provider, 'search'), { query, limit: 10 }, signal)
      if (!Array.isArray(data.documents) || data.documents.length > 20) throw new Error('The source returned an invalid document list.')
      return { documents: data.documents.map(document), warnings: Array.isArray(data.warnings) ? data.warnings.filter(v => typeof v === 'string').slice(0, 10) : [] }
    },
    async read(provider: McpProvider, id: string, signal?: AbortSignal): Promise<{ document: ConnectorDocument; warnings: string[] }> {
      const data = await request(providerPath(provider, 'read'), { id }, signal)
      return { document: document(data.document), warnings: Array.isArray(data.warnings) ? data.warnings.filter(v => typeof v === 'string').slice(0, 10) : [] }
    },
    async disconnect(provider: McpProvider, signal?: AbortSignal) { await request(providerPath(provider, 'disconnect'), {}, signal) },
  }
}
