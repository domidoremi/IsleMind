import type { MessageUsage } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'
import type { ProviderType } from '@/types/providerContracts'
import type { ProcessTrace } from '@/core'

import type {
  ProviderRuntimeChatRequest,
  ProviderRuntimeChunkCallback,
  ProviderRuntimeCitationCallback,
  ProviderRuntimeCompletionResult,
  ProviderRuntimeDoneCallback,
  ProviderRuntimeErrorCallback,
  ProviderRuntimeTraceCallback,
} from '../providerRuntimeContracts'
import { mergeOpenAIResponseReplayItems } from '../providerReplay'
import {
  createProviderTextToolCallStreamFilter,
  executableProviderToolCalls,
  mergeProviderToolCallParts,
  type ProviderToolCall,
} from '../providerToolCalls'

export interface ResponsesWebSocketTransportInput {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  req: ProviderRuntimeChatRequest
  signal: AbortSignal
  parseEvent: (
    payload: unknown,
    providerType: ProviderType,
  ) => {
    text: string
    traces: ProcessTrace[]
    usage?: MessageUsage
    responseId?: string
    providerToolCalls?: ProviderToolCall[]
    responseItems?: Record<string, unknown>[]
  }
  wireProviderType: ProviderType
  extractCitations: (
    text: string,
    sources?: ProviderRuntimeChatRequest['retrievalSources'],
  ) => MessageCitation[]
  onChunk: ProviderRuntimeChunkCallback
  onDone: ProviderRuntimeDoneCallback
  onError: ProviderRuntimeErrorCallback
  onCitations?: ProviderRuntimeCitationCallback
  onTrace?: ProviderRuntimeTraceCallback
}

export interface ResponsesWebSocketTransportDependencies {
  finalizeCompletion(
    result: ProviderRuntimeCompletionResult,
    rawText?: string,
  ): ProviderRuntimeCompletionResult
}

export interface ResponsesWebSocketTransport {
  run(input: ResponsesWebSocketTransportInput): Promise<void>
}

export function createResponsesWebSocketTransport(
  dependencies: ResponsesWebSocketTransportDependencies,
): ResponsesWebSocketTransport {
  return {
    run(input) {
      return runResponsesWebSocketTransport(input, dependencies)
    },
  }
}

function runResponsesWebSocketTransport(
  input: ResponsesWebSocketTransportInput,
  dependencies: ResponsesWebSocketTransportDependencies,
): Promise<void> {
  if (input.signal.aborted) {
    return Promise.reject(providerRuntimeCancellationReason(input.signal))
  }

  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      reject(new Error('websocket_runtime_missing'))
      return
    }
    const WebSocketCtor = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> },
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
    let finishing = false
    let completionDelivered = false

    const isActive = () => !settled && !finishing && !input.signal.aborted

    const settle = (error?: unknown) => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', abort)
      try {
        ws.close()
      } catch {}
      if (error !== undefined) reject(error)
      else resolve()
    }

    const abort = () => {
      if (completionDelivered) return
      settle(providerRuntimeCancellationReason(input.signal))
    }
    input.signal.addEventListener('abort', abort, { once: true })
    if (input.signal.aborted) {
      abort()
      return
    }

    ws.onopen = () => {
      if (!isActive()) {
        if (input.signal.aborted) abort()
        return
      }
      try {
        const { stream: _stream, background: _background, ...body } = input.body
        ws.send(JSON.stringify({ type: 'response.create', ...body }))
      } catch (error) {
        settle(error)
      }
    }

    ws.onerror = () => {
      if (!isActive()) return
      settle(new Error('websocket_transport_error'))
    }

    ws.onmessage = (event) => {
      if (!isActive()) return
      try {
        const payload = JSON.parse(String(event.data))
        if (!isActive()) return
        if (payload?.type === 'error' || payload?.error) {
          settle(new Error(String(payload.error?.message ?? payload.error?.code ?? payload.type ?? 'websocket_transport_error')))
          return
        }
        const parsed = input.parseEvent(payload, input.wireProviderType)
        if (!isActive()) return
        if (parsed.text) {
          fullText += parsed.text
          const visibleText = textToolCallFilter.push(parsed.text)
          if (visibleText) {
            input.onChunk(visibleText)
            if (!isActive()) return
          }
        }
        for (const trace of parsed.traces) {
          traces.push(trace)
          input.onTrace?.(trace)
          if (!isActive()) return
        }
        usage = parsed.usage ?? usage
        responseId = parsed.responseId ?? responseId
        providerToolCalls = mergeProviderToolCallParts([
          ...providerToolCalls,
          ...(parsed.providerToolCalls ?? []),
        ])
        responseItems = mergeOpenAIResponseReplayItems([
          ...responseItems,
          ...(parsed.responseItems ?? []),
        ])
        if (payload?.type === 'response.completed' || payload?.type === 'response.done') {
          finishCompletion()
        }
      } catch (error) {
        settle(error instanceof Error ? error : new Error('websocket_parse_error'))
      }
    }

    ws.onclose = () => {
      if (!isActive()) {
        if (input.signal.aborted) abort()
        return
      }
      if (fullText) {
        try {
          finishCompletion()
        } catch (error) {
          settle(error instanceof Error ? error : new Error('websocket_parse_error'))
        }
      } else {
        settle(new Error('websocket_closed_before_response'))
      }
    }

    function finishCompletion(): void {
      if (!isActive()) return
      finishing = true
      const filterRemainder = textToolCallFilter.finish()
      if (filterRemainder) {
        input.onChunk(filterRemainder)
        if (settled || input.signal.aborted) return
      }
      const citations = input.extractCitations(fullText, input.req.retrievalSources)
      if (settled || input.signal.aborted) return
      if (citations.length) {
        input.onCitations?.(citations)
        if (settled || input.signal.aborted) return
      }
      const result = dependencies.finalizeCompletion(buildChatCompletionResult({
        text: fullText,
        citations,
        traces,
        usage,
        responseId,
        providerToolCalls,
        responseItems,
      }), fullText)
      if (settled || input.signal.aborted) return
      completionDelivered = true
      input.onDone(result)
      settle()
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
}): ProviderRuntimeCompletionResult {
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

function providerRuntimeCancellationReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  const error = new Error('AbortError')
  error.name = 'AbortError'
  return error
}
