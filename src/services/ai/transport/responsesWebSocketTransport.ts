import type { ChatCompletionResult, ChatRequest, CitationCallback, DoneCallback, ErrorCallback, ProviderToolCall, StreamCallback, TraceCallback } from '@/services/ai/base'
import type { MessageCitation, MessageUsage, ProcessTrace, ProviderType } from '@/types'

export interface ResponsesWebSocketTransportInput {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  req: ChatRequest
  signal: AbortSignal
  parseEvent: (payload: unknown, providerType: ProviderType) => { text: string; traces: ProcessTrace[]; usage?: MessageUsage; responseId?: string; providerToolCalls?: ProviderToolCall[]; responseItems?: Record<string, unknown>[] }
  wireProviderType: ProviderType
  extractCitations: (text: string, sources?: ChatRequest['retrievalSources']) => MessageCitation[]
  onChunk: StreamCallback
  onDone: DoneCallback
  onError: ErrorCallback
  onCitations?: CitationCallback
  onTrace?: TraceCallback
}

export function runResponsesWebSocketTransport(input: ResponsesWebSocketTransportInput): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      reject(new Error('websocket_runtime_missing'))
      return
    }
    const WebSocketCtor = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> }
    ) => WebSocket
    const ws = new WebSocketCtor(input.url, undefined, { headers: input.headers })
    let settled = false
    let fullText = ''
    let responseId: string | undefined
    let usage: MessageUsage | undefined
    let providerToolCalls: ProviderToolCall[] = []
    let responseItems: Record<string, unknown>[] = []
    const traces: ProcessTrace[] = []

    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', abort)
      try {
        ws.close()
      } catch {}
      if (error) reject(error)
      else resolve()
    }

    const abort = () => settle(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
    input.signal.addEventListener('abort', abort, { once: true })

    ws.onopen = () => {
      const { stream: _stream, background: _background, ...body } = input.body
      ws.send(JSON.stringify({ type: 'response.create', ...body }))
    }

    ws.onerror = () => {
      settle(new Error('websocket_transport_error'))
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data))
        if (payload?.type === 'error' || payload?.error) {
          settle(new Error(String(payload.error?.message ?? payload.error?.code ?? payload.type ?? 'websocket_transport_error')))
          return
        }
        const parsed = input.parseEvent(payload, input.wireProviderType)
        if (parsed.text) {
          fullText += parsed.text
          input.onChunk(parsed.text)
        }
        for (const trace of parsed.traces) {
          traces.push(trace)
          input.onTrace?.(trace)
        }
        usage = parsed.usage ?? usage
        responseId = parsed.responseId ?? responseId
        providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(parsed.providerToolCalls ?? [])])
        responseItems = mergeResponseItems([...responseItems, ...(parsed.responseItems ?? [])])
        if (payload?.type === 'response.completed' || payload?.type === 'response.done') {
          const citations = input.extractCitations(fullText, input.req.retrievalSources)
          if (citations.length) input.onCitations?.(citations)
          input.onDone(buildChatCompletionResult({ text: fullText, citations, traces, usage, responseId, providerToolCalls, responseItems }))
          settle()
        }
      } catch (error) {
        settle(error instanceof Error ? error : new Error('websocket_parse_error'))
      }
    }

    ws.onclose = () => {
      if (settled) return
      if (fullText) {
        const citations = input.extractCitations(fullText, input.req.retrievalSources)
        if (citations.length) input.onCitations?.(citations)
        input.onDone(buildChatCompletionResult({ text: fullText, citations, traces, usage, responseId, providerToolCalls, responseItems }))
        settle()
      } else {
        settle(new Error('websocket_closed_before_response'))
      }
    }
  })
}

function buildChatCompletionResult(input: {
  text: string
  citations: MessageCitation[]
  traces: ProcessTrace[]
  usage?: MessageUsage
  responseId?: string
  providerToolCalls?: ProviderToolCall[]
  responseItems?: Record<string, unknown>[]
}): ChatCompletionResult {
  const executableToolCalls = executableProviderToolCalls(input.providerToolCalls)
  return {
    text: input.text,
    citations: input.citations,
    traces: input.traces,
    usage: input.usage,
    responseId: input.responseId,
    ...(executableToolCalls ? { providerToolCalls: executableToolCalls } : {}),
    ...(input.responseItems?.length ? { responseItems: input.responseItems } : {}),
  }
}

function mergeResponseItems(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = []
  for (const item of items) {
    const key = responseItemKey(item)
    const index = key ? merged.findIndex((entry) => responseItemKey(entry) === key) : -1
    if (index < 0) merged.push({ ...item })
    else merged[index] = { ...merged[index], ...item }
  }
  return merged
}

function responseItemKey(item: Record<string, unknown>): string {
  if (typeof item.id === 'string' && item.id) return `${item.type}:id:${item.id}`
  if (typeof item.call_id === 'string' && item.call_id) return `${item.type}:call:${item.call_id}`
  return ''
}

function mergeProviderToolCallParts(parts: ProviderToolCall[]): ProviderToolCall[] {
  const merged: ProviderToolCall[] = []
  for (const part of parts) {
    const index = findMatchingProviderToolCallIndex(merged, part)
    if (index < 0) {
      merged.push({ ...part, arguments: { ...part.arguments } })
      continue
    }
    merged[index] = mergeProviderToolCallPart(merged[index], part)
  }
  return merged
}

function findMatchingProviderToolCallIndex(calls: ProviderToolCall[], part: ProviderToolCall): number {
  if (part.id) {
    const byId = calls.findIndex((call) => call.id === part.id)
    if (byId >= 0) return byId
  }
  if (part.index !== undefined) {
    const byIndex = calls.findIndex((call) => call.index === part.index)
    if (byIndex >= 0) return byIndex
  }
  if (part.name) {
    const byName = calls.findIndex((call) => call.name === part.name && !call.id && call.index === undefined)
    if (byName >= 0) return byName
  }
  return -1
}

function mergeProviderToolCallPart(previous: ProviderToolCall, next: ProviderToolCall): ProviderToolCall {
  const rawArguments = mergeProviderToolRawArguments(previous.rawArguments, next.rawArguments, next.argumentsComplete === true)
  const parsed = normalizeProviderToolCallArguments(rawArguments)
  const mergedArguments = rawArguments !== undefined && parsed.complete
    ? parsed.arguments
    : { ...previous.arguments, ...next.arguments }
  return {
    id: previous.id || next.id,
    ...(previous.callId || next.callId ? { callId: previous.callId || next.callId } : {}),
    index: previous.index ?? next.index,
    name: previous.name || next.name,
    arguments: mergedArguments,
    ...(rawArguments !== undefined ? { rawArguments } : {}),
    argumentsComplete: rawArguments !== undefined ? parsed.complete : previous.argumentsComplete !== false && next.argumentsComplete !== false,
  }
}

function mergeProviderToolRawArguments(previous: unknown, next: unknown, nextComplete: boolean): unknown {
  if (next === undefined) return previous
  if (previous === undefined) return next
  if (typeof previous === 'string' && typeof next === 'string') return nextComplete ? next : `${previous}${next}`
  return next
}

function normalizeProviderToolCallArguments(value: unknown): { arguments: Record<string, unknown>; complete: boolean } {
  if (value === undefined) return { arguments: {}, complete: true }
  if (value && typeof value === 'object' && !Array.isArray(value)) return { arguments: { ...(value as Record<string, unknown>) }, complete: true }
  if (typeof value !== 'string') return { arguments: {}, complete: false }
  const trimmed = value.trim()
  if (!trimmed) return { arguments: {}, complete: true }
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { arguments: { ...(parsed as Record<string, unknown>) }, complete: true }
      : { arguments: {}, complete: false }
  } catch {
    return { arguments: {}, complete: false }
  }
}

function executableProviderToolCalls(calls: ProviderToolCall[] | undefined): ProviderToolCall[] | undefined {
  const executable = mergeProviderToolCallParts(calls ?? [])
    .filter((call) => call.name && call.argumentsComplete !== false)
    .map((call) => ({
      ...(call.id ? { id: call.id } : {}),
      ...(call.callId ? { callId: call.callId } : {}),
      ...(call.index !== undefined ? { index: call.index } : {}),
      name: call.name,
      arguments: { ...call.arguments },
      ...(call.rawArguments !== undefined ? { rawArguments: call.rawArguments } : {}),
      argumentsComplete: true,
    }))
  return executable.length ? executable : undefined
}
