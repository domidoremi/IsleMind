import type { ChatCompletionResult, ChatRequest, CitationCallback, DoneCallback, ErrorCallback, StreamCallback, TraceCallback } from '@/services/ai/base'
import { mergeOpenAIResponseReplayItems } from '@/services/ai/providerOpenAIReplay'
import { withProviderTextToolCallFallback } from '@/services/ai/providerResponseParsing'
import { createProviderTextToolCallStreamFilter, executableProviderToolCalls, mergeProviderToolCallParts, type ProviderToolCall } from '@/services/ai/providerToolCalls'
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
    const textToolCallFilter = createProviderTextToolCallStreamFilter()
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
          const visibleText = textToolCallFilter.push(parsed.text)
          if (visibleText) input.onChunk(visibleText)
        }
        for (const trace of parsed.traces) {
          traces.push(trace)
          input.onTrace?.(trace)
        }
        usage = parsed.usage ?? usage
        responseId = parsed.responseId ?? responseId
        providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(parsed.providerToolCalls ?? [])])
        responseItems = mergeOpenAIResponseReplayItems([...responseItems, ...(parsed.responseItems ?? [])])
        if (payload?.type === 'response.completed' || payload?.type === 'response.done') {
          const filterRemainder = textToolCallFilter.finish()
          if (filterRemainder) input.onChunk(filterRemainder)
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
        const filterRemainder = textToolCallFilter.finish()
        if (filterRemainder) input.onChunk(filterRemainder)
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
  return withProviderTextToolCallFallback({
    text: input.text,
    citations: input.citations,
    traces: input.traces,
    usage: input.usage,
    responseId: input.responseId,
    ...(executableToolCalls ? { providerToolCalls: executableToolCalls } : {}),
    ...(input.responseItems?.length ? { responseItems: input.responseItems } : {}),
  }, input.text)
}
