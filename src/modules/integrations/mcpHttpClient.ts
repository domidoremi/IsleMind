import type { JsonRecord } from '@/core'

import type { McpToolClient } from './mcpToolAdapter'

export type McpHttpTransport = 'sse' | 'streamable-http'

export interface McpHttpServer {
  id: string
  url: string
  transport: McpHttpTransport
}

export interface McpHttpResponse {
  result: Record<string, unknown>
  sessionId?: string
}

export type McpNegotiatedProtocolVersion = '2026-07-28' | '2025-03-26'

export interface McpHttpRequestOptions {
  signal?: AbortSignal
  headers?: Readonly<Record<string, string>>
}

export interface McpHttpClient {
  initialize(options?: { signal?: AbortSignal }): Promise<string | undefined>
  request(method: string, params: JsonRecord, options?: McpHttpRequestOptions): Promise<McpHttpResponse>
  getNegotiatedProtocolVersion(): McpNegotiatedProtocolVersion | undefined
  getServerCapabilities(): Readonly<Record<string, unknown>> | undefined
  clearSession(): void
}

export interface McpHttpClientOptions {
  fetch?: typeof globalThis.fetch
  requestId?: () => string
}

const MCP_SESSION_ID_MAX_LENGTH = 512
const MCP_LATEST_PROTOCOL_VERSION = '2026-07-28' as const
const MCP_LEGACY_PROTOCOL_VERSION = '2025-03-26' as const
const MCP_CLIENT_INFO = { name: 'IsleMind', version: '1' } as const
const MCP_PROTOCOL_META_KEY = 'io.modelcontextprotocol/protocolVersion'
const MCP_CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo'
const MCP_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities'
const MCP_SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo'
const MCP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const MCP_SAFE_HEADER_VALUE_PATTERN = /^[\t\x20-\x7e]*$/
const MCP_BASE64_SENTINEL_PATTERN = /^=\?base64\?.*\?=$/
const MCP_RESERVED_REQUEST_HEADERS = new Set([
  'accept',
  'content-length',
  'content-type',
  'host',
  'mcp-method',
  'mcp-name',
  'mcp-protocol-version',
  'mcp-session-id',
])

type McpHttpProtocolMode = 'latest' | 'legacy' | 'sse'

interface McpHttpNegotiation {
  url: string
  id?: string
  version?: string
  capabilities: Record<string, unknown>
  protocolVersion: McpNegotiatedProtocolVersion
  mode: Exclude<McpHttpProtocolMode, 'sse'>
}

interface McpHttpRequestError extends Error {
  status: number
  rpcCode?: string | number
  rpcError?: Record<string, unknown>
  protocolErrorDetail: string
  recognizedPayload: boolean
}

/** Owns MCP Streamable HTTP session and JSON-RPC transport behavior. */
export function createMcpHttpClient(server: McpHttpServer, options: McpHttpClientOptions = {}): McpHttpClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (typeof fetchImplementation !== 'function') throw new Error('MCP HTTP transport requires fetch.')
  let session: McpHttpNegotiation | undefined
  let sessionGeneration = 0
  let initialization: {
    promise: Promise<McpHttpNegotiation>
    signal?: AbortSignal
    generation: number
  } | undefined

  const post = async (
    method: string,
    params: JsonRecord,
    input: {
      signal?: AbortSignal
      sessionId?: string
      notification?: boolean
      protocol: McpHttpProtocolMode
      headers?: Readonly<Record<string, string>>
    },
  ): Promise<McpHttpResponse> => {
    throwIfAborted(input.signal)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (input.protocol !== 'sse') {
      headers['MCP-Protocol-Version'] = input.protocol === 'latest'
        ? MCP_LATEST_PROTOCOL_VERSION
        : MCP_LEGACY_PROTOCOL_VERSION
    }
    if (input.protocol === 'latest') {
      headers['Mcp-Method'] = encodeMcpHeaderValue(method)
      const requestName = resolveMcpRequestName(method, params)
      if (requestName !== undefined) headers['Mcp-Name'] = encodeMcpHeaderValue(requestName)
      applyMcpRequestHeaders(headers, input.headers)
    }
    const safeSessionId = sanitizeMcpSessionId(input.sessionId)
    if (safeSessionId) headers['Mcp-Session-Id'] = safeSessionId
    const requestParams = input.protocol === 'latest' ? withLatestMcpMetadata(params) : params
    const response = await fetchImplementation(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(input.notification ? {} : { id: options.requestId?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
        method,
        params: requestParams,
      }),
      signal: input.signal,
    })
    throwIfAborted(input.signal)
    const text = await response.text()
    throwIfAborted(input.signal)
    const parsed = tryParseMcpResponse(text)
    if (!response.ok) throw createMcpHttpRequestError(method, response.status, parsed)
    if (input.notification || !text.trim()) {
      return {
        result: {},
        sessionId: input.protocol === 'legacy' ? readMcpResponseSessionId(response) : undefined,
      }
    }
    if (!parsed.payload) throw new Error(`MCP ${method} returned an invalid response.`)
    const payload = parsed.payload
    if (payload.error) {
      throw createMcpHttpRequestError(method, response.status, parsed)
    }
    return {
      result: isRecord(payload.result) ? payload.result : {},
      sessionId: input.protocol === 'legacy' ? readMcpResponseSessionId(response) : undefined,
    }
  }

  const startInitialization = (signal?: AbortSignal) => {
    const generation = sessionGeneration
    const promise = (async () => {
      try {
        const discovered = await post('server/discover', {}, {
          signal,
          protocol: 'latest',
        })
        validateLatestMcpDiscovery(discovered.result)
        return {
          url: server.url,
          version: readMcpServerVersion(discovered.result, 'latest'),
          capabilities: readMcpServerCapabilities(discovered.result),
          protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
          mode: 'latest' as const,
        }
      } catch (error) {
        throwIfAborted(signal)
        if (!shouldFallbackToLegacy(error)) throw error
      }

      const initialized = await post('initialize', {
        protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      }, { signal, protocol: 'legacy' })
      const sessionId = sanitizeMcpSessionId(initialized.sessionId)
      await post('notifications/initialized', {}, {
        signal,
        sessionId,
        notification: true,
        protocol: 'legacy',
      })
      return {
        url: server.url,
        id: sessionId,
        version: readMcpServerVersion(initialized.result, 'legacy'),
        capabilities: readMcpServerCapabilities(initialized.result),
        protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
        mode: 'legacy' as const,
      }
    })()
    const pending = { promise, signal, generation }
    initialization = pending
    void promise.then(
      (initialized) => {
        if (initialization === pending) initialization = undefined
        if (sessionGeneration === generation) session = initialized
      },
      () => {
        if (initialization === pending) initialization = undefined
      },
    )
    return pending
  }

  const ensureSession = async (input: { signal?: AbortSignal } = {}): Promise<string | undefined> => {
    throwIfAborted(input.signal)
    if (server.transport !== 'streamable-http') return undefined
    if (session?.url === server.url) return session.version

    while (!session || session.url !== server.url) {
      const pending = initialization ?? startInitialization(input.signal)
      try {
        const initialized = await waitForInitialization(pending.promise, input.signal)
        throwIfAborted(input.signal)
        if (sessionGeneration !== pending.generation) continue
        if (!session) session = initialized
        return initialized.version
      } catch (error) {
        throwIfAborted(input.signal)
        if (pending.signal?.aborted && pending.signal !== input.signal) {
          if (initialization === pending) initialization = undefined
          continue
        }
        throw error
      }
    }

    return session.version
  }

  return {
    initialize: ensureSession,
    async request(method, params, input = {}) {
      throwIfAborted(input.signal)
      await ensureSession(input)
      throwIfAborted(input.signal)
      try {
        const response = await post(method, params, {
          signal: input.signal,
          sessionId: session?.mode === 'legacy' ? session.id : undefined,
          protocol: server.transport === 'sse' ? 'sse' : session?.mode ?? 'latest',
          headers: input.headers,
        })
        throwIfAborted(input.signal)
        return response
      } catch (error) {
        throwIfAborted(input.signal)
        if (server.transport === 'streamable-http') {
          session = undefined
          initialization = undefined
          sessionGeneration += 1
        }
        throw error
      }
    },
    getNegotiatedProtocolVersion() {
      return session?.url === server.url ? session.protocolVersion : undefined
    },
    getServerCapabilities() {
      return session?.url === server.url ? { ...session.capabilities } : undefined
    },
    clearSession() {
      session = undefined
      initialization = undefined
      sessionGeneration += 1
    },
  }
}

export function createMcpHttpToolClient(
  server: McpHttpServer,
  client = createMcpHttpClient(server),
  requestHeaders?: (argumentsValue: JsonRecord) => Readonly<Record<string, string>>,
): McpToolClient {
  return {
    async callTool(input, options) {
      if (input.serverId !== server.id) throw new Error(`MCP client ${server.id} cannot call server ${input.serverId}.`)
      const response = await client.request('tools/call', {
        name: input.toolName,
        arguments: input.arguments,
      }, {
        ...options,
        headers: requestHeaders?.(input.arguments),
      })
      if (response.result.resultType === 'input_required') {
        throw new Error('MCP tool requires interactive input, which is not supported by this client yet.')
      }
      if (
        typeof response.result.resultType === 'string'
        && response.result.resultType !== 'complete'
      ) {
        throw new Error(`MCP tool returned unsupported result type ${response.result.resultType}.`)
      }
      return response.result.content
    },
  }
}

export function validateMcpToolRequestHeaderSchema(inputSchema: unknown): void {
  collectMcpToolHeaderBindings(inputSchema)
}

export function createMcpToolRequestHeaders(
  inputSchema: unknown,
  argumentsValue: JsonRecord,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {}
  for (const binding of collectMcpToolHeaderBindings(inputSchema)) {
    const value = readMcpArgumentPath(argumentsValue, binding.path)
    if (value === undefined) continue
    if (!matchesMcpHeaderValueType(value, binding.type)) {
      throw new Error(`MCP header argument ${binding.path.join('.')} does not match its primitive schema type.`)
    }
    headers[`Mcp-Param-${binding.suffix}`] = String(value)
  }
  return headers
}

export function sanitizeMcpSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > MCP_SESSION_ID_MAX_LENGTH) return undefined
  if (value.trim() !== value || /[\r\n\0]/.test(value)) return undefined
  return value
}

function readMcpResponseSessionId(response: Pick<Response, 'headers'>): string | undefined {
  const rawSessionId = response.headers.get('Mcp-Session-Id')
  if (rawSessionId === null) return undefined
  const sessionId = sanitizeMcpSessionId(rawSessionId)
  if (!sessionId) throw new Error('MCP server returned an invalid session identifier.')
  return sessionId
}

function parseMcpResponse(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('data:') || trimmed.startsWith('event:') || trimmed.startsWith(':')) {
    const messages = parseMcpSseMessages(trimmed)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message && ('result' in message || 'error' in message)) return message
    }
    return {}
  }
  return JSON.parse(trimmed) as Record<string, unknown>
}

function parseMcpSseMessages(text: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = []
  for (const event of text.replace(/\r\n?/g, '\n').split(/\n\n+/)) {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''))
      .join('\n')
    if (!data) continue
    const payload = JSON.parse(data) as unknown
    if (isRecord(payload)) messages.push(payload)
  }
  return messages
}

function tryParseMcpResponse(text: string): {
  payload?: Record<string, unknown>
  recognizedPayload: boolean
} {
  if (!text.trim()) return { recognizedPayload: false }
  try {
    const payload = parseMcpResponse(text)
    return {
      payload,
      recognizedPayload: typeof payload.jsonrpc === 'string' || 'result' in payload || 'error' in payload,
    }
  } catch {
    return { recognizedPayload: false }
  }
}

function createMcpHttpRequestError(
  method: string,
  status: number,
  parsed: { payload?: Record<string, unknown>; recognizedPayload: boolean },
): McpHttpRequestError {
  const rpcError = isRecord(parsed.payload?.error) ? parsed.payload.error : undefined
  const rpcCode = typeof rpcError?.code === 'string' || typeof rpcError?.code === 'number'
    ? rpcError.code
    : undefined
  const message = typeof rpcError?.message === 'string'
    ? rpcError.message
    : `MCP ${method} failed: HTTP ${status}`
  const error = new Error(message) as McpHttpRequestError
  error.name = 'McpHttpRequestError'
  error.status = status
  error.rpcCode = rpcCode
  error.rpcError = rpcError
  error.protocolErrorDetail = JSON.stringify(parsed.payload?.error ?? parsed.payload ?? {})
  error.recognizedPayload = parsed.recognizedPayload
  return error
}

function shouldFallbackToLegacy(error: unknown): boolean {
  if (!isMcpHttpRequestError(error) || isModernMcpProtocolError(error)) return false
  const methodNotFound = error.rpcCode === -32601
    || String(error.rpcCode) === '-32601'
    || (typeof error.rpcError?.message === 'string' && /method\s+not\s+found/i.test(error.rpcError.message))
  if (methodNotFound && error.status !== 404) return true
  if (error.status === 400) {
    if (!error.recognizedPayload) return true
    if (error.rpcCode === -32600 || error.rpcCode === -32002) return true
    return typeof error.rpcError?.message === 'string'
      && /invalid\s+request|server\s+not\s+initialized|unknown\s+method|no\s+valid\s+session\s+id|session\s+id\s+(?:is\s+)?required/i.test(error.rpcError.message)
  }
  return (error.status === 404 || error.status === 405 || error.status === 501)
    && !error.recognizedPayload
}

function isMcpHttpRequestError(value: unknown): value is McpHttpRequestError {
  return value instanceof Error
    && value.name === 'McpHttpRequestError'
    && typeof (value as Partial<McpHttpRequestError>).status === 'number'
}

function isModernMcpProtocolError(error: McpHttpRequestError): boolean {
  return error.rpcCode === -32022
    || error.rpcCode === -32021
    || error.rpcCode === -32020
    || /UnsupportedProtocolVersion|HeaderMismatch|MissingRequiredClientCapability/.test(error.protocolErrorDetail)
}

function readMcpServerVersion(
  result: Record<string, unknown>,
  mode: Exclude<McpHttpProtocolMode, 'sse'>,
): string | undefined {
  const serverInfo = mode === 'latest' && isRecord(result._meta)
    ? result._meta[MCP_SERVER_INFO_META_KEY]
    : result.serverInfo
  return isRecord(serverInfo) && typeof serverInfo.version === 'string'
    ? serverInfo.version
    : undefined
}

function readMcpServerCapabilities(result: Record<string, unknown>): Record<string, unknown> {
  return isRecord(result.capabilities) ? { ...result.capabilities } : {}
}

function validateLatestMcpDiscovery(result: Record<string, unknown>): void {
  if (
    !Array.isArray(result.supportedVersions)
    || !result.supportedVersions.includes(MCP_LATEST_PROTOCOL_VERSION)
  ) {
    throw new Error(`MCP server discovery did not advertise ${MCP_LATEST_PROTOCOL_VERSION}.`)
  }
}

function withLatestMcpMetadata(params: JsonRecord): JsonRecord {
  return {
    ...params,
    _meta: {
      ...(isRecord(params._meta) ? params._meta : {}),
      [MCP_PROTOCOL_META_KEY]: MCP_LATEST_PROTOCOL_VERSION,
      [MCP_CLIENT_INFO_META_KEY]: MCP_CLIENT_INFO,
      [MCP_CLIENT_CAPABILITIES_META_KEY]: {},
    },
  }
}

function resolveMcpRequestName(method: string, params: JsonRecord): string | undefined {
  if (method === 'resources/read') {
    if (typeof params.uri !== 'string') throw new Error('MCP resources/read requires a string uri for Mcp-Name.')
    return params.uri
  }
  if (method === 'tools/call' || method === 'prompts/get') {
    if (typeof params.name !== 'string') throw new Error(`MCP ${method} requires a string name for Mcp-Name.`)
    return params.name
  }
  return undefined
}

function applyMcpRequestHeaders(
  target: Record<string, string>,
  headers: Readonly<Record<string, string>> | undefined,
): void {
  if (!headers) return
  for (const [name, value] of Object.entries(headers)) {
    if (!MCP_HEADER_NAME_PATTERN.test(name)) throw new Error('MCP request header names must use HTTP tchar characters.')
    if (MCP_RESERVED_REQUEST_HEADERS.has(name.toLowerCase())) {
      throw new Error(`MCP request header ${name} cannot override a transport header.`)
    }
    if (typeof value !== 'string') throw new Error(`MCP request header ${name} must be a string.`)
    target[name] = encodeMcpHeaderValue(value)
  }
}

function encodeMcpHeaderValue(value: string): string {
  if (
    MCP_SAFE_HEADER_VALUE_PATTERN.test(value)
    && value.trim() === value
    && !MCP_BASE64_SENTINEL_PATTERN.test(value)
  ) return value
  return `=?base64?${encodeUtf8Base64(value)}?=`
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += alphabet[first >> 2]
    output += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    output += second === undefined ? '=' : alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    output += third === undefined ? '=' : alphabet[third & 0x3f]
  }
  return output
}

interface McpToolHeaderBinding {
  path: string[]
  suffix: string
  type: 'string' | 'integer' | 'boolean'
}

function collectMcpToolHeaderBindings(inputSchema: unknown): McpToolHeaderBinding[] {
  if (!isRecord(inputSchema)) return []
  assertMcpHeaderAnnotationsReachable(inputSchema)
  const bindings: McpToolHeaderBinding[] = []
  const suffixes = new Set<string>()
  walkMcpHeaderSchema(inputSchema, [], bindings, suffixes)
  return bindings
}

function walkMcpHeaderSchema(
  schema: Record<string, unknown>,
  path: string[],
  bindings: McpToolHeaderBinding[],
  suffixes: Set<string>,
): void {
  const annotation = schema['x-mcp-header']
  if (annotation !== undefined) {
    if (path.length === 0 || typeof annotation !== 'string' || !MCP_HEADER_NAME_PATTERN.test(annotation)) {
      throw new Error('MCP x-mcp-header annotations require a property and an HTTP tchar suffix.')
    }
    if (schema.type !== 'string' && schema.type !== 'integer' && schema.type !== 'boolean') {
      throw new Error('MCP x-mcp-header annotations require a primitive string, integer, or boolean property.')
    }
    const normalizedSuffix = annotation.toLowerCase()
    if (suffixes.has(normalizedSuffix)) {
      throw new Error('MCP x-mcp-header suffixes must be case-insensitively unique.')
    }
    suffixes.add(normalizedSuffix)
    bindings.push({ path, suffix: annotation, type: schema.type })
  }

  if (!isRecord(schema.properties)) return
  for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
    if (isRecord(propertySchema)) {
      walkMcpHeaderSchema(propertySchema, [...path, propertyName], bindings, suffixes)
    }
  }
}

function assertMcpHeaderAnnotationsReachable(inputSchema: Record<string, unknown>): void {
  const visit = (value: unknown, onStaticPath: boolean, annotationAllowed: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, false, false)
      return
    }
    if (!isRecord(value)) return
    if ('x-mcp-header' in value && !annotationAllowed) {
      throw new Error('MCP x-mcp-header annotations must be statically reachable through properties only.')
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'x-mcp-header') continue
      if (key === 'properties' && isRecord(child)) {
        for (const propertySchema of Object.values(child)) {
          visit(propertySchema, onStaticPath, onStaticPath)
        }
      } else {
        visit(child, false, false)
      }
    }
  }
  visit(inputSchema, true, false)
}

function readMcpArgumentPath(argumentsValue: JsonRecord, path: readonly string[]): unknown {
  let value: unknown = argumentsValue
  for (const segment of path) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined
    value = value[segment]
  }
  return value
}

function matchesMcpHeaderValueType(value: unknown, type: McpToolHeaderBinding['type']): boolean {
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function waitForInitialization<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return promise

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      try {
        throwIfAborted(signal)
      } catch (error) {
        reject(error)
      }
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
