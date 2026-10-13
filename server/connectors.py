"""Bounded, read-only connectors. Provider grants live only in browser-scoped memory.

No generic URL, MCP tool, or arguments endpoint is exposed. OAuth imports do not
call the app's AI providers and never borrow the assistant's connector accounts.
"""
from __future__ import annotations

import asyncio
import base64
import codecs
import hashlib
import hmac
import html
import json
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import Depends, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import Field

from .config import Settings
from .models import StrictModel
from .providers import ProviderError

Provider = Literal["notion", "granola", "otter"]
MAX_RESPONSE_BYTES = 750_000
MAX_DOCUMENT_CHARS = 24_000
SESSION_HEADER = "X-Ripple-Connector-Session"
PROTOCOL_VERSION = "2025-06-18"


@dataclass(frozen=True)
class ProviderSpec:
    label: str
    mcp_url: str
    auth_origin: str
    scopes: tuple[str, ...]
    search_tools: tuple[str, ...]
    read_tools: tuple[str, ...]
    document_hosts: tuple[str, ...]


PROVIDERS = {
    "notion": ProviderSpec("Notion", "https://mcp.notion.com/mcp", "https://mcp.notion.com", ("default",),
                           ("notion-search", "notion-ai-search", "search"), ("notion-fetch", "fetch"),
                           ("notion.so", "notion.site", "notion.com")),
    "granola": ProviderSpec("Granola", "https://mcp.granola.ai/mcp", "https://mcp-auth.granola.ai", ("mcp",),
                            ("list_meetings",), ("get_meetings",), ("granola.ai",)),
    "otter": ProviderSpec("Otter", "https://mcp.otter.ai/mcp", "https://otter.ai", ("conversations:read",),
                          ("search",), ("fetch",), ("otter.ai",)),
}


class SearchRequest(StrictModel):
    query: str = Field(default="", max_length=200)
    limit: int = Field(default=10, ge=1, le=20)


class ReadRequest(StrictModel):
    id: str = Field(min_length=1, max_length=1000)


class FinishRequest(StrictModel):
    flowId: str = Field(min_length=30, max_length=100)
    completionToken: str = Field(min_length=30, max_length=100)


@dataclass
class Grant:
    token: str
    expires: float
    mode: str = "oauth"
    mcp_session: str | None = None
    protocol: str = PROTOCOL_VERSION
    tools: dict[str, dict] = field(default_factory=dict)
    documents: dict[str, dict] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class BrowserSession:
    expires: float
    grants: dict[str, Grant] = field(default_factory=dict)


@dataclass
class OAuthFlow:
    session_key: str
    provider: str
    origin: str
    verifier: str
    client_id: str
    token_endpoint: str
    resource: str
    expires: float
    used: bool = False
    completion_hash: str = ""
    grant: Grant | None = None


def _utc(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def _fail(code: str, message: str, status: int = 502):
    raise ProviderError("connector_" + code, message, status)


def _safe_link(value: Any, provider: str) -> str | None:
    if not isinstance(value, str) or len(value) > 2000:
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in {None, 443}:
            return None
        host = (parsed.hostname or "").lower()
        if not any(host == allowed or host.endswith("." + allowed) for allowed in PROVIDERS[provider].document_hosts):
            return None
        return value
    except ValueError:
        return None


def _text(value: Any, limit: int = MAX_DOCUMENT_CHARS, depth: int = 0) -> str:
    """Extract document text as data; never render or execute external markup."""
    if depth > 12:
        return ""
    if isinstance(value, str):
        return value[:limit]
    if isinstance(value, list):
        return "\n".join(filter(None, (_text(item, limit, depth + 1) for item in value[:150])))[:limit]
    if isinstance(value, dict):
        for key in ("plain_text", "text", "markdown", "body", "content"):
            if key in value:
                result = _text(value[key], limit, depth + 1)
                if result:
                    return result
        return "\n".join(filter(None, (_text(value[key], limit, depth + 1) for key in (
            "private_notes", "notes", "summary", "summarized_notes", "enhanced_notes", "transcript", "segments", "children", "meetings", "documents", "results", "data", "result", "meeting", "document"
        ) if key in value)))[:limit]
    return ""


def _mcp_values(result: dict) -> list[Any]:
    if result.get("isError"):
        _fail("tool_error", "The provider could not complete this read. Check its access permissions or try a more specific search.")
    values = []
    if isinstance(result.get("structuredContent"), (dict, list)):
        # Servers often repeat the same document as JSON text and structured data.
        return [result["structuredContent"]]
    content = result.get("content", [])
    if not isinstance(content, list):
        _fail("invalid_response", "The provider returned an unsupported content format.")
    for block in content[:30]:
        if not isinstance(block, dict) or block.get("type") != "text" or not isinstance(block.get("text"), str):
            continue
        raw = block["text"]
        try:
            values.append(json.loads(raw))
        except (ValueError, TypeError):
            values.append(raw)
    return values


def _document_rows(value: Any, depth: int = 0) -> list[dict]:
    if depth > 8:
        return []
    if isinstance(value, list):
        return [row for item in value[:100] for row in _document_rows(item, depth + 1)]
    if isinstance(value, dict):
        if any(key in value for key in ("id", "meeting_id", "document_id", "note_id", "url")) and any(key in value for key in ("title", "name", "meeting_title")):
            return [value]
        return [row for key in ("results", "meetings", "documents", "notes", "items", "data", "result") if key in value for row in _document_rows(value[key], depth + 1)]
    return []


def normalize_documents(result: dict, provider: str, limit: int) -> list[dict]:
    documents: dict[str, dict] = {}
    for value in _mcp_values(result):
        for row in _document_rows(value):
            identifier = next((row[key] for key in ("id", "meeting_id", "document_id", "note_id", "url") if isinstance(row.get(key), str) and row[key]), None)
            if not identifier or len(identifier) > 1000 or any(ord(c) < 32 for c in identifier):
                continue
            if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", identifier) and not _safe_link(identifier, provider):
                continue
            title = next((row[key] for key in ("title", "name", "meeting_title") if isinstance(row.get(key), str)), "Untitled document")[:300]
            document = {"id": identifier, "title": title or "Untitled document"}
            url = _safe_link(row.get("url") or row.get("web_url") or row.get("document_url"), provider)
            if url:
                document["url"] = url
            excerpt = _text(row.get("excerpt") or row.get("snippet") or row.get("summary"), 500)
            if excerpt:
                document["excerpt"] = excerpt
            documents[identifier] = document
        # Some MCP servers return Markdown search lists instead of structured JSON.
        if isinstance(value, str):
            for title, url in re.findall(r"\[([^\]\n]{1,300})\]\((https://[^\s)]+)\)", value):
                if _safe_link(url, provider):
                    documents.setdefault(url, {"id": url, "title": title, "url": url})
    return list(documents.values())[:limit]


class ConnectorService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings, self.client = settings, client
        self.sessions: dict[str, BrowserSession] = {}
        self.flows: dict[str, OAuthFlow] = {}
        self.registrations: dict[str, dict] = {}
        self.registration_lock = asyncio.Lock()

    def _prune(self):
        now = time.time()
        self.sessions = {key: value for key, value in self.sessions.items() if value.expires > now}
        self.flows = {key: value for key, value in self.flows.items() if value.expires > now and value.session_key in self.sessions}

    def new_session(self) -> dict:
        self._prune()
        if len(self.sessions) >= 100:
            _fail("session_limit", "The connector service is busy. Try again after an existing session expires.", 429)
        token = secrets.token_urlsafe(32)
        expires = time.time() + self.settings.connector_session_minutes * 60
        self.sessions[self._session_key(token)] = BrowserSession(expires)
        return {"sessionToken": token, "expiresAt": _utc(expires)}

    @staticmethod
    def _session_key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def session(self, token: str | None) -> tuple[str, BrowserSession]:
        self._prune()
        if not token or len(token) > 100:
            _fail("session_required", "Start a new connector session before connecting an account.", 401)
        key = self._session_key(token)
        if key not in self.sessions:
            _fail("session_expired", "This connector session expired. Connect your account again.", 401)
        return key, self.sessions[key]

    def status(self, token: str | None) -> dict:
        session = self.session(token)[1] if token else None
        rows = []
        for provider, spec in PROVIDERS.items():
            mode = "server-token" if provider == "notion" and self.settings.notion_api_token else "oauth"
            configured = bool(self.settings.notion_api_token and self.settings.access_token) if mode == "server-token" else bool(self.settings.public_api_url)
            grant = session.grants.get(provider) if session else None
            connected = bool(grant and grant.expires > time.time())
            detail = "Connect your own account. Imports are read-only and stay separate from other browser sessions."
            if mode == "server-token":
                detail = "Imports the server owner's shared Notion workspace. Requires the private Ripple app access token."
            if not configured:
                detail = "Set RIPPLE_PUBLIC_API_URL on the private backend to enable browser OAuth." if mode == "oauth" else "Set RIPPLE_ACCESS_TOKEN before exposing the server's Notion connection."
            rows.append({"id": provider, "label": spec.label, "configured": configured, "connected": connected, "authMode": mode, "detail": detail})
        result = {"providers": rows}
        if session:
            result["expiresAt"] = _utc(session.expires)
        return result

    async def _http(self, method: str, url: str, *, allowed_origins: set[str], **kwargs) -> tuple[Any, httpx.Headers]:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc not in {urlsplit(origin).netloc for origin in allowed_origins} or parsed.username or parsed.password or parsed.fragment:
            _fail("unsafe_endpoint", "The provider returned an unrecognized endpoint. No credentials were sent.")
        client = self.client or httpx.AsyncClient(timeout=25, follow_redirects=False, trust_env=False)
        try:
            async with client.stream(method, url, follow_redirects=False, **kwargs) as response:
                if response.status_code in {401, 403}:
                    _fail("authorization", "The provider rejected access. Reconnect or check your account's integration permissions.", 401)
                if response.status_code == 429:
                    _fail("rate_limit", "The provider's rate limit was reached. Wait before trying again.", 429)
                if response.status_code >= 300:
                    _fail("request_failed", f"The provider returned HTTP {response.status_code}. No data was imported.")
                if response.status_code in {202, 204}:
                    return {}, response.headers
                data = bytearray()
                is_sse = "text/event-stream" in response.headers.get("content-type", "")
                if is_sse:
                    decoder = codecs.getincrementaldecoder("utf-8")()
                    pending, event = "", []
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_RESPONSE_BYTES:
                            _fail("response_limit", "The provider response exceeded the import size limit.")
                        pending += decoder.decode(chunk)
                        while "\n" in pending:
                            line, pending = pending.split("\n", 1)
                            line = line.rstrip("\r")
                            if line.startswith("data:"):
                                event.append(line[5:].lstrip())
                            if not line and event:
                                item = json.loads("\n".join(event))
                                event = []
                                expected = kwargs.get("json", {}).get("id")
                                if isinstance(item, dict) and item.get("id") == expected:
                                    return item, response.headers
                    _fail("invalid_response", "The provider's event stream ended without a result.")
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_RESPONSE_BYTES:
                        _fail("response_limit", "The provider response exceeded the import size limit.")
                return json.loads(data), response.headers
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            raise ProviderError("connector_timeout", "The provider took too long. No automatic retry was made.", 504) from exc
        except httpx.RequestError as exc:
            raise ProviderError("connector_unavailable", "The provider could not be reached. Try again later.", 503) from exc
        except (ValueError, TypeError) as exc:
            raise ProviderError("connector_invalid_response", "The provider returned an unsupported response. No data was imported.") from exc
        finally:
            if self.client is None:
                await client.aclose()

    async def _registration(self, provider: str) -> dict:
        async with self.registration_lock:
            if provider in self.registrations:
                return self.registrations[provider]
            spec = PROVIDERS[provider]
            mcp_origin = spec.mcp_url.rsplit("/", 1)[0]
            resource, _ = await self._http("GET", mcp_origin + "/.well-known/oauth-protected-resource", allowed_origins={mcp_origin})
            if not isinstance(resource, dict) or not isinstance(resource.get("authorization_servers"), list) or spec.auth_origin not in [str(value).rstrip("/") for value in resource["authorization_servers"]]:
                _fail("discovery", "The provider's authorization metadata has changed. No credentials were sent.")
            resource_url = resource.get("resource")
            if resource_url not in {mcp_origin, mcp_origin + "/", spec.mcp_url}:
                _fail("discovery", "The provider returned an unexpected resource identifier.")
            metadata, _ = await self._http("GET", spec.auth_origin + "/.well-known/oauth-authorization-server", allowed_origins={spec.auth_origin})
            if not isinstance(metadata, dict) or str(metadata.get("issuer", "")).rstrip("/") != spec.auth_origin or not isinstance(metadata.get("code_challenge_methods_supported"), list) or "S256" not in metadata["code_challenge_methods_supported"] or not isinstance(metadata.get("token_endpoint_auth_methods_supported"), list) or "none" not in metadata["token_endpoint_auth_methods_supported"]:
                _fail("discovery", "The provider does not advertise the required OAuth PKCE flow.")
            endpoints = {}
            for name in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
                value = metadata.get(name)
                if not isinstance(value, str) or urlsplit(value).scheme != "https" or urlsplit(value).netloc != urlsplit(spec.auth_origin).netloc or urlsplit(value).username or urlsplit(value).password or urlsplit(value).fragment or urlsplit(value).query:
                    _fail("discovery", "The provider returned an unrecognized OAuth endpoint.")
                endpoints[name] = value
            redirect = self.settings.public_api_url + f"/api/connectors/oauth/{provider}/callback"
            registration, _ = await self._http("POST", endpoints["registration_endpoint"], allowed_origins={spec.auth_origin}, json={
                "client_name": "Ripple read-only imports", "redirect_uris": [redirect],
                "grant_types": ["authorization_code"], "response_types": ["code"],
                "token_endpoint_auth_method": "none", "scope": " ".join(spec.scopes),
            })
            if not isinstance(registration, dict) or not isinstance(registration.get("client_id"), str) or not registration["client_id"] or len(registration["client_id"]) > 1000 or registration.get("token_endpoint_auth_method", "none") != "none":
                _fail("registration", "The provider did not register a compatible OAuth client.")
            record = {**endpoints, "client_id": registration["client_id"], "resource": resource_url, "redirect_uri": redirect}
            self.registrations[provider] = record
            return record

    async def connect(self, provider: str, token: str, origin: str) -> dict:
        key, session = self.session(token)
        if origin not in self.settings.allowed_origins:
            _fail("origin", "Open the connector from an allowed Ripple application origin.", 403)
        if provider == "notion" and self.settings.notion_api_token:
            if not self.settings.access_token:
                _fail("not_configured", "Configure the private Ripple access token before using the server's Notion connection.", 503)
            # A real authenticated, bounded read confirms this server token before Connected is shown.
            await self._notion_request("POST", "/search", {"page_size": 1, "filter": {"property": "object", "value": "page"}})
            session.grants[provider] = Grant(self.settings.notion_api_token, session.expires, mode="server-token")
            return {"connected": True}
        if not self.settings.public_api_url:
            _fail("not_configured", "Set RIPPLE_PUBLIC_API_URL to the private backend's public origin before connecting OAuth accounts.", 503)
        for state in [state for state, flow in self.flows.items() if flow.session_key == key and flow.provider == provider]:
            self.flows.pop(state, None)
        registration = await self._registration(provider)
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        expires = min(session.expires, time.time() + 600)
        self.flows[state] = OAuthFlow(key, provider, origin, verifier, registration["client_id"], registration["token_endpoint"], registration["resource"], expires)
        query = urlencode({"response_type": "code", "client_id": registration["client_id"], "redirect_uri": registration["redirect_uri"], "scope": " ".join(PROVIDERS[provider].scopes), "resource": registration["resource"], "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
        return {"connected": False, "authorizationUrl": registration["authorization_endpoint"] + "?" + query, "flowId": state, "expiresAt": _utc(expires)}

    async def callback(self, provider: str, state: str, code: str) -> tuple[OAuthFlow, str]:
        self._prune()
        flow = self.flows.get(state)
        if not flow or flow.provider != provider or flow.used or not code or len(code) > 4000:
            _fail("oauth_state", "This connection attempt expired or was already used. Start again in Ripple.", 400)
        flow.used = True  # One code exchange; no replay or automatic retry.
        response, _ = await self._http("POST", flow.token_endpoint, allowed_origins={PROVIDERS[provider].auth_origin}, data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": self.settings.public_api_url + f"/api/connectors/oauth/{provider}/callback",
            "client_id": flow.client_id, "code_verifier": flow.verifier, "resource": flow.resource,
        })
        if not isinstance(response, dict) or not isinstance(response.get("access_token"), str) or not 1 <= len(response["access_token"]) <= 16000 or str(response.get("token_type", "bearer")).lower() != "bearer":
            _fail("oauth_token", "The provider did not return a usable access grant.")
        expires_in = response.get("expires_in", 3600)
        if type(expires_in) not in {int, float} or not 0 < expires_in <= 31_536_000:
            _fail("oauth_token", "The provider returned an invalid token lifetime.")
        self._prune()
        session = self.sessions.get(flow.session_key)
        if session is None or self.flows.get(state) is not flow:
            _fail("oauth_state", "This connection attempt expired or was disconnected. Start again in Ripple.", 400)
        flow.grant = Grant(response["access_token"], min(session.expires, time.time() + expires_in))
        completion = secrets.token_urlsafe(32)
        flow.completion_hash = hashlib.sha256(completion.encode()).hexdigest()
        flow.expires = min(session.expires, time.time() + 300)
        flow.verifier = ""
        return flow, completion

    async def finish(self, provider: str, token: str, payload: FinishRequest) -> dict:
        key, session = self.session(token)
        flow = self.flows.get(payload.flowId)
        if not flow or flow.provider != provider or flow.session_key != key or not flow.grant or not hmac.compare_digest(flow.completion_hash, hashlib.sha256(payload.completionToken.encode()).hexdigest()):
            _fail("oauth_completion", "The completion code is invalid or expired. Reconnect from this Ripple window.", 400)
        async with flow.grant.lock:
            await self._ensure_tools(provider, flow.grant)
        # Disconnect, replacement flows and expiry must win over an in-flight finish.
        self.session(token)
        if self.flows.get(payload.flowId) is not flow or flow.grant.expires <= time.time():
            _fail("oauth_completion", "This connection attempt is no longer active. Connect again.", 400)
        session.grants[provider] = flow.grant
        self.flows.pop(payload.flowId, None)
        return {"connected": True}

    def disconnect(self, provider: str, token: str) -> dict:
        key, session = self.session(token)
        session.grants.pop(provider, None)
        for state in [state for state, flow in self.flows.items() if flow.session_key == key and flow.provider == provider]:
            self.flows.pop(state, None)
        return {"connected": False}

    def _grant(self, provider: str, token: str) -> Grant:
        _, session = self.session(token)
        grant = session.grants.get(provider)
        if not grant or grant.expires <= time.time():
            session.grants.pop(provider, None)
            _fail("not_connected", "Connect this account in the current Ripple window before importing.", 401)
        return grant

    async def _rpc(self, provider: str, grant: Grant, method: str, params: dict | None = None, *, notification: bool = False) -> dict:
        request_id = secrets.token_hex(8)
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notification:
            body["id"] = request_id
        headers = {"Authorization": "Bearer " + grant.token, "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": grant.protocol}
        if grant.mcp_session:
            headers["Mcp-Session-Id"] = grant.mcp_session
        spec = PROVIDERS[provider]
        try:
            result, response_headers = await self._http("POST", spec.mcp_url, allowed_origins={spec.mcp_url.rsplit("/", 1)[0]}, headers=headers, json=body)
        except ProviderError as exc:
            if exc.code == "connector_authorization":
                grant.expires = 0
            raise
        session_id = response_headers.get("mcp-session-id")
        if session_id and len(session_id) <= 500 and "\n" not in session_id and "\r" not in session_id:
            grant.mcp_session = session_id
        if notification:
            return {}
        if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or result.get("id") != request_id or "error" in result or not isinstance(result.get("result"), dict):
            _fail("mcp_response", "The provider did not return a valid MCP result. No import was applied.")
        return result["result"]

    async def _ensure_tools(self, provider: str, grant: Grant):
        if grant.tools:
            return
        initialized = await self._rpc(provider, grant, "initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": {"name": "ripple-readonly", "version": "1.0.0"}})
        protocol = initialized.get("protocolVersion")
        if protocol not in {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}:
            _fail("mcp_version", "The provider requires an unsupported MCP protocol version.")
        grant.protocol = protocol
        await self._rpc(provider, grant, "notifications/initialized", notification=True)
        result = await self._rpc(provider, grant, "tools/list", {})
        tools = result.get("tools")
        if not isinstance(tools, list):
            _fail("mcp_tools", "The provider did not advertise its read tools.")
        allowed = set(PROVIDERS[provider].search_tools + PROVIDERS[provider].read_tools)
        grant.tools = {tool["name"]: tool for tool in tools[:100] if isinstance(tool, dict) and isinstance(tool.get("name"), str) and tool["name"] in allowed and isinstance(tool.get("inputSchema"), dict)}
        if not any(name in grant.tools for name in PROVIDERS[provider].search_tools) or not any(name in grant.tools for name in PROVIDERS[provider].read_tools):
            grant.tools = {}
            _fail("mcp_tools", "This account does not expose the supported search and read tools. Check the provider's MCP access settings.")

    @staticmethod
    def _arguments(tool: dict, *, query: str | None = None, limit: int = 10, document: dict | None = None) -> dict:
        schema = tool["inputSchema"]
        properties, required = schema.get("properties", {}), schema.get("required", [])
        if not isinstance(properties, dict) or not isinstance(required, list) or any(not isinstance(key, str) for key in required):
            _fail("tool_schema", "The provider's read tool schema has changed.")
        arguments = {}
        if document is not None:
            identifier = document["id"]
            for key in ("id", "meeting_id", "document_id", "page_id"):
                if key in properties:
                    arguments[key] = identifier
                    break
            else:
                if "meeting_ids" in properties:
                    arguments["meeting_ids"] = [identifier]
                elif "ids" in properties:
                    arguments["ids"] = [identifier]
                elif "url" in properties:
                    arguments["url"] = document.get("url", identifier)
        else:
            for key in ("query", "search", "search_query"):
                if key in properties:
                    arguments[key] = query or ""
                    break
            for key in ("limit", "page_size", "max_results", "max_meetings"):
                if key in properties:
                    maximum = properties[key].get("maximum", limit) if isinstance(properties[key], dict) else limit
                    arguments[key] = min(limit, maximum) if type(maximum) is int and maximum > 0 else limit
            if "query_type" in properties and isinstance(properties["query_type"], dict) and isinstance(properties["query_type"].get("enum"), list) and "internal" in properties["query_type"]["enum"]:
                arguments["query_type"] = "internal"
        for key in required:
            if key not in arguments:
                definition = properties.get(key, {})
                if isinstance(definition, dict) and "default" in definition and key in {"time_range", "include_archived", "include_transcript"}:
                    arguments[key] = definition["default"]
                else:
                    _fail("tool_schema", "The provider's read tool requires a parameter this version of Ripple does not support. Use a text export while the adapter is updated.")
        if document is not None and not arguments:
            _fail("tool_schema", "The provider's read tool does not accept a supported document identifier.")
        return arguments

    async def search(self, provider: str, token: str, payload: SearchRequest) -> dict:
        grant = self._grant(provider, token)
        warnings = []
        async with grant.lock:
            if grant.mode == "server-token":
                body = {"page_size": payload.limit, "filter": {"property": "object", "value": "page"}, "sort": {"direction": "descending", "timestamp": "last_edited_time"}}
                if payload.query.strip():
                    body["query"] = payload.query.strip()
                result = await self._notion_request("POST", "/search", body)
                rows = result.get("results")
                if not isinstance(rows, list):
                    _fail("invalid_response", "Notion returned an invalid search result.")
                documents = []
                for row in rows[:payload.limit]:
                    if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not re.fullmatch(r"[a-fA-F0-9-]{32,36}", row["id"]):
                        continue
                    properties = row.get("properties", {})
                    title = next((_text(value.get("title"), 300) for value in properties.values() if isinstance(value, dict) and value.get("type") == "title"), "Untitled page") if isinstance(properties, dict) else "Untitled page"
                    document = {"id": row["id"], "title": title or "Untitled page"}
                    if url := _safe_link(row.get("url"), "notion"):
                        document["url"] = url
                    documents.append(document)
                if result.get("has_more"):
                    warnings.append("More Notion pages match. Narrow your search; this import reads one results page.")
            else:
                await self._ensure_tools(provider, grant)
                name = next(name for name in PROVIDERS[provider].search_tools if name in grant.tools)
                tool = grant.tools[name]
                arguments = self._arguments(tool, query=payload.query.strip(), limit=payload.limit)
                result = await self._rpc(provider, grant, "tools/call", {"name": name, "arguments": arguments})
                documents = normalize_documents(result, provider, payload.limit)
                if provider == "granola" and payload.query.strip() and not any(key in arguments for key in ("query", "search", "search_query")):
                    documents = [document for document in documents if payload.query.casefold() in (document["title"] + " " + document.get("excerpt", "")).casefold()]
                    warnings.append("Granola search filters the recent notes returned by its list tool. Older matches may not be included.")
                if not documents:
                    warnings.append("No matching document references were returned. Try a different search or use the provider's text export.")
            # Selection is scoped to this exact browser grant. No direct arbitrary-ID fetch endpoint.
            for document in documents:
                grant.documents[document["id"]] = document
            if len(grant.documents) > 100:
                grant.documents = dict(list(grant.documents.items())[-100:])
            return {"provider": provider, "documents": documents, "warnings": warnings}

    async def read(self, provider: str, token: str, payload: ReadRequest) -> dict:
        grant = self._grant(provider, token)
        document = grant.documents.get(payload.id)
        if not document:
            _fail("selection", "Search and select this document in the current connection before reading it.", 400)
        warnings = []
        async with grant.lock:
            if grant.mode == "server-token":
                text, warnings = await self._notion_read(document["id"])
            else:
                await self._ensure_tools(provider, grant)
                name = next(name for name in PROVIDERS[provider].read_tools if name in grant.tools)
                result = await self._rpc(provider, grant, "tools/call", {"name": name, "arguments": self._arguments(grant.tools[name], document=document)})
                values = _mcp_values(result)
                text = "\n\n".join(filter(None, (_text(value, MAX_DOCUMENT_CHARS + 1) for value in values)))
            if not text.strip():
                _fail("empty_document", "The selected document has no readable text. Check access or use a text export.", 422)
            if len(text) > MAX_DOCUMENT_CHARS:
                warnings.append("Only the first 24,000 characters are included. Review the original document for remaining action items.")
                text = text[:MAX_DOCUMENT_CHARS]
            return {"provider": provider, "document": {**document, "text": text}, "warnings": warnings}

    async def _notion_request(self, method: str, path: str, body: dict | None = None) -> dict:
        kwargs: dict[str, Any] = {"headers": {"Authorization": "Bearer " + self.settings.notion_api_token, "Notion-Version": "2026-03-11"}}
        if body is not None:
            kwargs["json"] = body
        result, _ = await self._http(method, "https://api.notion.com/v1" + path, allowed_origins={"https://api.notion.com"}, **kwargs)
        if not isinstance(result, dict):
            _fail("invalid_response", "Notion returned an invalid response.")
        return result

    async def _notion_read(self, page_id: str) -> tuple[str, list[str]]:
        queue = [(page_id, 0)]
        lines, warnings = [], []
        calls = 0
        while queue and calls < 4:
            block_id, depth = queue.pop(0)
            result = await self._notion_request("GET", f"/blocks/{block_id}/children?page_size=100")
            calls += 1
            rows = result.get("results")
            if not isinstance(rows, list):
                _fail("invalid_response", "Notion returned invalid page blocks.")
            if result.get("has_more"):
                warnings.append("This page has more blocks than the bounded import includes.")
            for row in rows[:100]:
                if not isinstance(row, dict):
                    continue
                kind = row.get("type")
                content = row.get(kind, {}) if isinstance(kind, str) else {}
                if not isinstance(content, dict):
                    continue
                value = _text(content.get("rich_text", []))
                if kind == "to_do" and value:
                    value = ("[x] " if content.get("checked") else "[ ] ") + value
                if value:
                    lines.append(value)
                child_id = row.get("id", "")
                if row.get("has_children") and depth < 2 and isinstance(child_id, str) and re.fullmatch(r"[a-fA-F0-9-]{32,36}", child_id):
                    queue.append((child_id, depth + 1))
                elif row.get("has_children"):
                    warnings.append("Deeply nested content is omitted. Review the original page.")
        if queue:
            warnings.append("Some nested blocks were omitted to keep this import bounded.")
        return "\n".join(lines), list(dict.fromkeys(warnings))


def _callback_page(provider: str, flow_id: str, completion: str, origin: str) -> HTMLResponse:
    nonce = secrets.token_urlsafe(24)
    message = json.dumps({"type": "ripple-connector-complete", "provider": provider, "flowId": flow_id, "completionToken": completion}).replace("<", "\\u003c")
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finish connecting to Ripple</title><body><h1>Return to Ripple to finish connecting</h1><p>This window sent a one-time confirmation to your original Ripple window. Your provider credentials stay on the server.</p><p>If Ripple did not finish connecting, paste this completion code there within five minutes:</p><p><code>{html.escape(completion)}</code></p><p>You can close this window after Ripple confirms the connection.</p><script nonce="{nonce}">if(window.opener)window.opener.postMessage({message},{json.dumps(origin)});</script></body></html>'''
    return HTMLResponse(page, headers={"Content-Security-Policy": f"default-src 'none'; script-src 'nonce-{nonce}'; frame-ancestors 'none'; base-uri 'none'", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})


def install_connector_routes(app, settings: Settings, authorize, service: ConnectorService | None = None):
    service = service or ConnectorService(settings)
    app.state.connectors = service

    async def bounded(operation):
        try:
            async with asyncio.timeout(60):
                return await operation
        except TimeoutError as exc:
            raise ProviderError("connector_timeout", "The import exceeded its time limit. No automatic retry was made.", 504) from exc

    async def session_header(x_ripple_connector_session: str | None = Header(default=None)) -> str:
        service.session(x_ripple_connector_session)
        return x_ripple_connector_session

    @app.post("/api/connectors/session", dependencies=[Depends(authorize)])
    async def create_connector_session():
        return service.new_session()

    @app.get("/api/connectors", dependencies=[Depends(authorize)])
    async def connector_status(x_ripple_connector_session: str | None = Header(default=None)):
        return service.status(x_ripple_connector_session)

    @app.post("/api/connectors/{provider}/connect", dependencies=[Depends(authorize)])
    async def connect(provider: Provider, request: Request, token=Depends(session_header)):
        return await bounded(service.connect(provider, token, request.headers.get("origin", "")))

    @app.post("/api/connectors/{provider}/finish", dependencies=[Depends(authorize)])
    async def finish(provider: Provider, payload: FinishRequest, token=Depends(session_header)):
        return await bounded(service.finish(provider, token, payload))

    @app.post("/api/connectors/{provider}/disconnect", dependencies=[Depends(authorize)])
    async def disconnect(provider: Provider, token=Depends(session_header)):
        return service.disconnect(provider, token)

    @app.post("/api/connectors/{provider}/search", dependencies=[Depends(authorize)])
    async def search(provider: Provider, payload: SearchRequest, token=Depends(session_header)):
        return await bounded(service.search(provider, token, payload))

    @app.post("/api/connectors/{provider}/read", dependencies=[Depends(authorize)])
    async def read(provider: Provider, payload: ReadRequest, token=Depends(session_header)):
        return await bounded(service.read(provider, token, payload))

    @app.get("/api/connectors/oauth/{provider}/callback")
    async def callback(provider: Provider, request: Request):
        query = request.query_params
        request.scope["query_string"] = b""  # Keep codes out of the application's access-log query string.
        try:
            if query.get("error"):
                _fail("oauth_denied", "The provider connection was cancelled. Return to Ripple to try again.", 400)
            state, code = query.get("state", ""), query.get("code", "")
            flow, completion = await service.callback(provider, state, code)
            return _callback_page(provider, state, completion, flow.origin)
        except ProviderError as exc:
            return HTMLResponse(f"<!doctype html><html lang='en'><meta charset='utf-8'><title>Connection not completed</title><h1>Connection not completed</h1><p>{html.escape(exc.message)}</p></html>", status_code=exc.status_code, headers={"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})
