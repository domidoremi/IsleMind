import {
  createAssistantConversationProviderStreamingRuntime,
  createAssistantStreamProjectionPolicy,
  type AssistantConversationProviderStreamingRuntimeInput,
} from '@/modules/assistant-runtime'
import type {
  ProviderRuntimeChatRequest,
  ProviderRuntimeCompletionResult,
} from '@/modules/providers'
import type { MessageCitation } from '@/types/contextContracts'
import type {
  ChatProviderStateBinding,
  ChatReasoningReplayPart,
  ChatToolCallProviderMetadata,
  JsonRecord,
  ProcessTrace,
  StreamEvent,
} from '@/core'
import { parseToolArguments } from '@/modules/integrations'
import { streamProviderChat } from '@/bootstrap/providerRuntime'
import {
  clearActiveStream,
  getActiveStream,
  setActiveStream,
} from '@/services/chatStreamLifecycle'
import { clampTraceContent, sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'

const streamProjectionPolicy = createAssistantStreamProjectionPolicy({
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
  appendContent(projection) {
    useChatStreamingStore.getState().appendContent(
      projection.conversationId,
      projection.responseMessageId,
      projection.text,
    )
  },
  upsertTrace(projection) {
    const safeTrace = sanitizeTrace(projection.trace)
    const streamingStore = useChatStreamingStore.getState()
    if (streamingStore.activeStreams.get(
      `${projection.conversationId}:${projection.responseMessageId}`,
    ) === true) {
      streamingStore.upsertTrace(
        projection.conversationId,
        projection.responseMessageId,
        safeTrace,
      )
      return
    }
    useChatStore.getState().upsertMessageTrace(
      projection.conversationId,
      projection.responseMessageId,
      safeTrace,
    )
  },
  clampTraceContent,
})

const providerStreamingRuntime =
  createAssistantConversationProviderStreamingRuntime<
    ProviderRuntimeChatRequest,
    ProviderRuntimeCompletionResult,
    Error,
    MessageCitation[],
    ProcessTrace
  >({
    createProjection: streamProjectionPolicy.start,
    dispatch(request, onChunk, onDone, onError, onCitations, onTrace) {
      return streamProviderChat(
        request,
        onChunk,
        onDone,
        onError,
        onCitations,
        onTrace,
      )
    },
    getActiveStream,
    setActiveStream,
    clearActiveStream,
    isMessageCancelled({ conversationId, assistantMessageId }) {
      const conversation = useChatStore.getState().conversations
        .find((item) => item.id === conversationId)
      return conversation?.messages
        .find((message) => message.id === assistantMessageId)
        ?.status === 'cancelled'
    },
  })

type ProviderStreamingInput = AssistantConversationProviderStreamingRuntimeInput<
  ProviderRuntimeChatRequest,
  ProviderRuntimeCompletionResult,
  Error,
  MessageCitation[],
  ProcessTrace
>

type ConversationProviderStreamingInput = Omit<ProviderStreamingInput, 'citations'> & {
  readonly onStreamEvent?: (event: StreamEvent) => void
}

export const conversationProviderStreamingRuntime = {
  start(input: ConversationProviderStreamingInput) {
    const { onStreamEvent, ...streamInput } = input
    // The provider request is now admitted to its streaming transport. Until
    // a trace or text chunk arrives, the visible state is genuinely waiting.
    useChatStore.getState().transitionMessageLifecycle(
      input.conversationId,
      input.assistantMessageId,
      'waiting',
    )
    const durableEvents = createRichStreamEventReporter(onStreamEvent, {
      binding: {
        providerId: input.request.provider.id,
        model: input.request.model,
      },
    })
    return providerStreamingRuntime.start({
      ...streamInput,
      onTextDelta(chunk) {
        input.onTextDelta?.(chunk)
        durableEvents.text(chunk)
      },
      onTrace(trace) {
        input.onTrace?.(trace)
        durableEvents.trace(trace)
      },
      async complete(result, lifecycle) {
        durableEvents.complete(result)
        await input.complete(result, {
          ...lifecycle,
          ...(onStreamEvent ? { onStreamEvent } : {}),
        })
      },
      citations(citations) {
        durableEvents.citations(citations)
        useChatStore.getState().updateMessage(
          input.conversationId,
          input.assistantMessageId,
          { citations },
        )
      },
    })
  },
}

const MAX_DURABLE_TRACE_EVENTS = 128
const DURABLE_EVENT_TEXT_LIMIT = 512
const MAX_DURABLE_TOOL_ARGUMENTS_CHARACTERS = 32 * 1024
const MAX_REASONING_REPLAY_TEXT_CHARACTERS = 262_144

export interface RichStreamEventReporterOptions {
  readonly binding?: ChatProviderStateBinding
}

/**
 * Converts the legacy callback completion surface into the bounded normalized
 * stream events used by the canonical Assistant Runtime. The callback path is
 * observational: durable journals still redact sensitive tool payloads, while
 * the transient event carries enough state for continuation and diagnostics.
 */
export function createRichStreamEventReporter(
  onStreamEvent: ((event: StreamEvent) => void) | undefined,
  options: RichStreamEventReporterOptions = {},
) {
  const citationIds = new Set<string>()
  const toolCallIds = new Set<string>()
  const traceStates = new Set<string>()
  let traceEventCount = 0
  let traceLimitReported = false

  const emit = (event: StreamEvent): void => onStreamEvent?.(event)
  const text = (chunk: string): void => {
    if (typeof chunk === 'string' && chunk) emit({ type: 'text-delta', text: chunk })
  }
  const citations = (values: readonly MessageCitation[]): void => {
    if (!Array.isArray(values)) return
    for (const citation of values) {
      if (!citation || typeof citation !== 'object') continue
      const citationId = boundedText(citation.id)
      if (!citationId || citationIds.has(citationId)) continue
      citationIds.add(citationId)
      const title = boundedText(citation.title)
      const url = sanitizeCitationUrl(citation.url)
      emit({
        type: 'citation',
        citationId,
        ...(title ? { title } : {}),
        ...(url ? { url } : {}),
      })
    }
  }
  const trace = (value: ProcessTrace): void => {
    if (!value || typeof value !== 'object'
      || typeof value.id !== 'string'
      || typeof value.type !== 'string'
      || typeof value.status !== 'string'
      || typeof value.title !== 'string') return
    const safeTrace = sanitizeTrace(value)
    const traceId = boundedText(safeTrace.id)
    const traceType = boundedText(safeTrace.type)
    const traceStatus = boundedText(safeTrace.status)
    if (!traceId || !traceType || !traceStatus) return
    const title = boundedText(safeTrace.title)
    const stateKey = `${traceId}\u0000${traceType}\u0000${traceStatus}\u0000${title}`
    if (traceStates.has(stateKey)) return
    if (traceEventCount >= MAX_DURABLE_TRACE_EVENTS) {
      if (!traceLimitReported) {
        traceLimitReported = true
        emit({ type: 'notice', code: 'trace-event-limit-reached' })
      }
      return
    }
    traceStates.add(stateKey)
    traceEventCount += 1
    emit({
      type: 'trace',
      traceId,
      traceType,
      traceStatus,
      ...(title ? { title } : {}),
    })
  }
  const complete = (result: ProviderRuntimeCompletionResult): void => {
    if (!result || typeof result !== 'object') return
    const calls = (Array.isArray(result.providerToolCalls) ? result.providerToolCalls : [])
      .flatMap((call, index) => {
        if (!call || typeof call !== 'object') return []
        const toolCallId = boundedText(call.callId || call.id || `tool-call-${index}`)
        const toolName = boundedText(call.name)
        if (!toolCallId || !toolName) return []
        return [{ call, toolCallId, toolName }]
      })
    const reasoningReplay = toRichReasoningReplay(result)
    if (options.binding && (reasoningReplay.length || calls.length)) {
      emit({
        type: 'provider-continuation-state',
        binding: options.binding,
        reasoningReplay,
      })
    }
    for (const { call, toolCallId, toolName } of calls) {
      const dedupeKey = `${toolCallId}\u0000${toolName}`
      if (toolCallIds.has(dedupeKey)) continue
      toolCallIds.add(dedupeKey)
      const providerMetadata = richProviderMetadata(call)
      emit({
        type: 'tool-call',
        toolCallId,
        toolName,
        arguments: boundedToolArguments(call.arguments),
        ...(providerMetadata ? { providerMetadata } : {}),
      })
    }
    const usage = streamUsageEvent(result.usage)
    if (usage) emit(usage)
    citations(result.citations ?? [])
    for (const value of (Array.isArray(result.traces) ? result.traces : [])) trace(value)
  }

  return { text, citations, trace, complete }
}

function richProviderMetadata(call: {
  readonly id?: string
  readonly thoughtSignature?: string
  readonly index?: number
}): ChatToolCallProviderMetadata | undefined {
  const providerCallId = boundedText(call.id)
  const thoughtSignature = boundedReasoningText(call.thoughtSignature)
  const providerCallIndex = typeof call.index === 'number'
    && Number.isSafeInteger(call.index)
    && call.index >= 0
    ? call.index
    : undefined
  const metadata: ChatToolCallProviderMetadata = {
    ...(providerCallId ? { providerCallId } : {}),
    ...(providerCallIndex === undefined ? {} : { providerCallIndex }),
    ...(thoughtSignature ? { thoughtSignature } : {}),
  }
  return Object.keys(metadata).length ? metadata : undefined
}

function boundedToolArguments(value: unknown): JsonRecord {
  let parsed: JsonRecord
  try {
    parsed = parseToolArguments(value)
  } catch {
    if (typeof value !== 'string') return {}
    try {
      parsed = parseToolArguments(JSON.parse(value))
    } catch {
      return {}
    }
  }
  try {
    const serialized = JSON.stringify(parsed)
    if (!serialized || serialized.length > MAX_DURABLE_TOOL_ARGUMENTS_CHARACTERS) return {}
    return JSON.parse(serialized) as JsonRecord
  } catch {
    return {}
  }
}

function toRichReasoningReplay(
  result: ProviderRuntimeCompletionResult,
): readonly ChatReasoningReplayPart[] {
  const replay: ChatReasoningReplayPart[] = []
  const reasoningContent = boundedReasoningText(result.reasoningContent)
  if (reasoningContent) replay.push({ kind: 'text', text: reasoningContent })
  for (const item of result.responseItems ?? []) {
    if (item.type !== 'reasoning'
      || typeof item.id !== 'string'
      || typeof item.encrypted_content !== 'string') continue
    const id = boundedText(item.id)
    const data = boundedReasoningText(item.encrypted_content)
    if (!id || !data) continue
    const summary = Array.isArray(item.summary)
      ? item.summary.flatMap((entry) => {
          const text = typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object' && !Array.isArray(entry)
              && typeof entry.text === 'string'
              ? entry.text
              : undefined
          const bounded = boundedReasoningText(text)
          return bounded ? [bounded] : []
        }).slice(0, 64)
      : []
    replay.push({ kind: 'encrypted', id, data, ...(summary.length ? { summary } : {}) })
  }
  for (const block of result.providerContentBlocks ?? []) {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      const text = boundedReasoningText(block.thinking)
      if (text) {
        const signature = boundedReasoningText(block.signature)
        replay.push({ kind: 'thinking', text, ...(signature ? { signature } : {}) })
      }
    } else if (block.type === 'redacted_thinking' && typeof block.data === 'string') {
      const data = boundedReasoningText(block.data)
      if (data) replay.push({ kind: 'redacted', data })
    }
  }
  return replay.slice(0, 32)
}

function streamUsageEvent(
  usage: ProviderRuntimeCompletionResult['usage'],
): Extract<StreamEvent, { type: 'usage' }> | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const event: Extract<StreamEvent, { type: 'usage' }> = { type: 'usage' }
  const inputTokens = safeTokenCount(usage.inputTokens)
  const outputTokens = safeTokenCount(usage.outputTokens)
  const totalTokens = safeTokenCount(usage.totalTokens)
  const cacheCreationInputTokens = safeTokenCount(usage.cacheCreationInputTokens)
  const cacheReadInputTokens = safeTokenCount(usage.cacheReadInputTokens)
  const cachedInputTokens = safeTokenCount(usage.cachedInputTokens)
  const reasoningTokens = safeTokenCount(usage.reasoningTokens)
  if (inputTokens !== undefined) event.inputTokens = inputTokens
  if (outputTokens !== undefined) event.outputTokens = outputTokens
  if (totalTokens !== undefined) event.totalTokens = totalTokens
  if (cacheCreationInputTokens !== undefined) {
    event.cacheCreationInputTokens = cacheCreationInputTokens
  }
  if (cacheReadInputTokens !== undefined) event.cacheReadInputTokens = cacheReadInputTokens
  if (cachedInputTokens !== undefined) event.cachedInputTokens = cachedInputTokens
  if (reasoningTokens !== undefined) event.reasoningTokens = reasoningTokens
  return Object.keys(event).length > 1 ? event : undefined
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.length <= DURABLE_EVENT_TEXT_LIMIT
    ? normalized
    : normalized.slice(0, DURABLE_EVENT_TEXT_LIMIT)
}

function boundedReasoningText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.length <= MAX_REASONING_REPLAY_TEXT_CHARACTERS
    ? normalized
    : normalized.slice(0, MAX_REASONING_REPLAY_TEXT_CHARACTERS)
}

function sanitizeCitationUrl(value: unknown): string | undefined {
  const normalized = boundedText(value)
  if (!normalized || /^data:/i.test(normalized)) return undefined
  const withoutFragment = normalized.split('#', 1)[0] ?? normalized
  const withoutQuery = withoutFragment.split('?', 1)[0] ?? withoutFragment
  return boundedText(withoutQuery.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i,
    '$1',
  ))
}
