import { create } from 'zustand'
import type { Message } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import { clampTraceContent } from '@/services/chatTraceUtils'
import { registerStreamStateCleaner } from '@/services/chatStreamLifecycle'
import { useChatStore } from './chatStore'
import {
  lifecycleStageForTrace,
  responseLifecycleTraceTimestamp,
  safeResponseLifecycleTraceSummary,
} from '@/modules/conversations'

type StreamingPersistHandle = ReturnType<typeof setTimeout>

const STREAMING_PERSIST_DELAY_MS = 420

export interface StreamingTraceSnapshot extends Pick<Message, 'reasoning' | 'toolCalls' | 'retrievalTrace'> {}

interface StreamingState {
  activeStreams: Map<string, boolean>
  streamingText: Map<string, string>
  streamingTraces: Map<string, StreamingTraceSnapshot>
  persistTimers: Map<string, StreamingPersistHandle>

  setStreaming: (convId: string, msgId: string) => void
  appendContent: (convId: string, msgId: string, content: string) => void
  resetContent: (convId: string, msgId: string, content?: string) => void
  upsertTrace: (convId: string, msgId: string, trace: ProcessTrace) => void
  getStreamingText: (convId: string, msgId: string) => string
  getStreamingTraceSnapshot: (convId: string, msgId: string) => StreamingTraceSnapshot | undefined
  commitStreamingText: (convId: string, msgId: string) => string
  commitStreamingTraces: (convId: string, msgId: string) => StreamingTraceSnapshot | undefined
  flushStreamingMessage: (convId: string, msgId: string) => Promise<void>
  clearStreaming: (convId: string, msgId: string) => void
  clearConversationStreaming: (convId: string) => void
  clearAllStreaming: () => void
}

function streamingKey(convId: string, msgId: string): string {
  return `${convId}:${msgId}`
}

function streamingKeyPrefix(convId: string): string {
  return `${convId}:`
}

export const useChatStreamingStore = create<StreamingState>((set, get) => ({
  activeStreams: new Map(),
  streamingText: new Map(),
  streamingTraces: new Map(),
  persistTimers: new Map(),

  setStreaming: (convId: string, msgId: string) => {
    const key = streamingKey(convId, msgId)
    set((state) => {
      if (state.activeStreams.get(key) === true) return state
      const updated = new Map(state.activeStreams)
      updated.set(key, true)
      return { activeStreams: updated }
    })
  },

  appendContent: (convId: string, msgId: string, content: string) => {
    if (!content) return
    // The projection receives real provider text chunks. Promote the durable
    // response state on the first chunk rather than inferring generation from
    // a display timer.
    useChatStore.getState().transitionMessageLifecycle(convId, msgId, 'generating')
    const key = streamingKey(convId, msgId)
    const state = get()
    const existing = state.persistTimers.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      const text = get().streamingText.get(key)
      set((s) => {
        if (!s.persistTimers.has(key)) return s
        const persistTimers = new Map(s.persistTimers)
        persistTimers.delete(key)
        return { persistTimers }
      })
      if (text) useChatStore.getState().persistStreamingContentSnapshot(convId, msgId, text)
    }, STREAMING_PERSIST_DELAY_MS)

    set((s) => {
      const streamingText = new Map(s.streamingText)
      const persistTimers = new Map(s.persistTimers)
      streamingText.set(key, `${streamingText.get(key) ?? ''}${content}`)
      persistTimers.set(key, timer)
      return { streamingText, persistTimers }
    })
  },

  resetContent: (convId: string, msgId: string, content = '') => {
    const key = streamingKey(convId, msgId)
    const timer = get().persistTimers.get(key)
    if (timer) clearTimeout(timer)
    set((state) => {
      const streamingText = new Map(state.streamingText)
      const persistTimers = new Map(state.persistTimers)
      if (content) streamingText.set(key, content)
      else streamingText.delete(key)
      persistTimers.delete(key)
      return { streamingText, persistTimers }
    })
    useChatStore.getState().updateMessage(convId, msgId, {
      content,
      responseText: content,
    })
  },

  upsertTrace: (convId: string, msgId: string, trace: ProcessTrace) => {
    const key = streamingKey(convId, msgId)
    const hasOutput = Boolean(get().streamingText.get(key) || resolveBaseMessageText(convId, msgId))
    const lifecycleStage = lifecycleStageForTrace(trace, hasOutput)
    if (lifecycleStage) {
      useChatStore.getState().transitionMessageLifecycle(convId, msgId, lifecycleStage, {
        at: responseLifecycleTraceTimestamp(trace),
        summary: safeResponseLifecycleTraceSummary(trace),
        traceId: trace.id,
      })
    }
    set((state) => {
      const updated = new Map(state.streamingTraces)
      const current = updated.get(key) ?? cloneMessageTraceSnapshot(resolveBaseMessageTraceSnapshot(convId, msgId))
      const next = upsertTraceSnapshot(current, trace)
      if (next === current && updated.has(key)) return state
      updated.set(key, next)
      return { streamingTraces: updated }
    })
  },

  getStreamingText: (convId: string, msgId: string) => {
    return get().streamingText.get(streamingKey(convId, msgId)) ?? ''
  },

  getStreamingTraceSnapshot: (convId: string, msgId: string) => {
    return get().streamingTraces.get(streamingKey(convId, msgId))
  },

  commitStreamingText: (convId: string, msgId: string) => {
    const text = get().streamingText.get(streamingKey(convId, msgId)) ?? ''
    if (text) useChatStore.getState().commitStreamingContent(convId, msgId, text)
    return text
  },

  commitStreamingTraces: (convId: string, msgId: string) => {
    const traces = get().streamingTraces.get(streamingKey(convId, msgId))
    if (traces) useChatStore.getState().commitStreamingTraceSnapshot(convId, msgId, traces)
    return traces
  },

  flushStreamingMessage: async (convId: string, msgId: string) => {
    const key = streamingKey(convId, msgId)
    const state = get()
    const timer = state.persistTimers.get(key)
    const text = state.streamingText.get(key)
    const traces = state.streamingTraces.get(key)

    if (timer) {
      clearTimeout(timer)
      set((s) => {
        const updated = new Map(s.persistTimers)
        updated.delete(key)
        return { persistTimers: updated }
      })
    }

    if (text) useChatStore.getState().commitStreamingContent(convId, msgId, text)
    if (traces) useChatStore.getState().commitStreamingTraceSnapshot(convId, msgId, traces)
    await useChatStore.getState().flushStreamingMessage(convId, msgId)

    set((s) => {
      const updated = new Map(s.activeStreams)
      const streamingText = new Map(s.streamingText)
      const streamingTraces = new Map(s.streamingTraces)
      updated.delete(key)
      streamingText.delete(key)
      streamingTraces.delete(key)
      return { activeStreams: updated, streamingText, streamingTraces }
    })
  },

  clearStreaming: (convId: string, msgId: string) => {
    const key = streamingKey(convId, msgId)
    const state = get()
    const timer = state.persistTimers.get(key)

    if (timer) {
      clearTimeout(timer)
    }

    set((s) => {
      const activeStreams = new Map(s.activeStreams)
      const streamingText = new Map(s.streamingText)
      const streamingTraces = new Map(s.streamingTraces)
      const persistTimers = new Map(s.persistTimers)
      activeStreams.delete(key)
      streamingText.delete(key)
      streamingTraces.delete(key)
      persistTimers.delete(key)
      return { activeStreams, streamingText, streamingTraces, persistTimers }
    })
  },

  clearConversationStreaming: (convId: string) => {
    const prefix = streamingKeyPrefix(convId)
    set((state) => clearStreamingEntriesMatching(state, (key) => key.startsWith(prefix)))
  },

  clearAllStreaming: () => {
    set((state) => clearStreamingEntriesMatching(state, () => true))
  },
}))

registerStreamStateCleaner({
  clearConversation: (conversationId) => useChatStreamingStore.getState().clearConversationStreaming(conversationId),
  clearAll: () => useChatStreamingStore.getState().clearAllStreaming(),
})

function clearStreamingEntriesMatching(
  state: StreamingState,
  matches: (key: string) => boolean
): Partial<StreamingState> | StreamingState {
  let changed = false
  const activeStreams = new Map(state.activeStreams)
  const streamingText = new Map(state.streamingText)
  const streamingTraces = new Map(state.streamingTraces)
  const persistTimers = new Map(state.persistTimers)

  for (const [key, timer] of persistTimers) {
    if (!matches(key)) continue
    clearTimeout(timer)
    persistTimers.delete(key)
    changed = true
  }
  for (const key of activeStreams.keys()) {
    if (!matches(key)) continue
    activeStreams.delete(key)
    changed = true
  }
  for (const key of streamingText.keys()) {
    if (!matches(key)) continue
    streamingText.delete(key)
    changed = true
  }
  for (const key of streamingTraces.keys()) {
    if (!matches(key)) continue
    streamingTraces.delete(key)
    changed = true
  }

  return changed
    ? { activeStreams, streamingText, streamingTraces, persistTimers }
    : state
}

export function mergeMessageWithStreamingTraceSnapshot(
  message: Message,
  snapshot: StreamingTraceSnapshot | null | undefined,
): Message {
  if (!snapshot) return message
  return {
    ...message,
    reasoning: snapshot.reasoning,
    toolCalls: snapshot.toolCalls,
    retrievalTrace: snapshot.retrievalTrace,
  }
}

function resolveBaseMessageTraceSnapshot(convId: string, msgId: string): StreamingTraceSnapshot {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === convId)
  const message = conversation?.messages.find((item) => item.id === msgId)
  return cloneMessageTraceSnapshot(message)
}

function resolveBaseMessageText(convId: string, msgId: string): string {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === convId)
  const message = conversation?.messages.find((item) => item.id === msgId)
  return message?.responseText ?? message?.content ?? ''
}

function cloneMessageTraceSnapshot(
  message: Pick<Message, 'reasoning' | 'toolCalls' | 'retrievalTrace'> | null | undefined,
): StreamingTraceSnapshot {
  return {
    reasoning: [...(message?.reasoning ?? [])],
    toolCalls: [...(message?.toolCalls ?? [])],
    retrievalTrace: [...(message?.retrievalTrace ?? [])],
  }
}

function upsertTraceSnapshot(snapshot: StreamingTraceSnapshot, trace: ProcessTrace): StreamingTraceSnapshot {
  const key = trace.type === 'reasoning' ? 'reasoning' : trace.type === 'tool' ? 'toolCalls' : 'retrievalTrace'
  const current = snapshot[key] ?? []
  const next = upsertTraceList(current, trace)
  if (next === current) return snapshot
  return {
    ...snapshot,
    [key]: next,
  }
}

function upsertTraceList(traces: ProcessTrace[], trace: ProcessTrace): ProcessTrace[] {
  const index = traces.findIndex((item) => item.id === trace.id)
  if (index < 0) return [...traces, trace]
  const nextTrace = mergeStreamingTrace(traces[index], trace)
  if (areStreamingTracesEquivalent(traces[index], nextTrace)) return traces
  return traces.map((item, itemIndex) => itemIndex === index ? nextTrace : item)
}

function mergeStreamingTrace(current: ProcessTrace, next: ProcessTrace): ProcessTrace {
  const shouldAppend =
    next.status === 'running' &&
    current.content &&
    next.content &&
    current.content !== next.content &&
    !current.content.endsWith(next.content)
  const content = shouldAppend ? `${current.content}${next.content}` : next.content ?? current.content
  return {
    ...current,
    ...next,
    content: content ? clampTraceContent(content, next.type) : undefined,
    startedAt: current.startedAt ?? next.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    durationMs: next.durationMs ?? current.durationMs,
    metadata: { ...current.metadata, ...next.metadata },
  }
}

function areStreamingTracesEquivalent(current: ProcessTrace, next: ProcessTrace): boolean {
  return current.id === next.id &&
    current.type === next.type &&
    current.title === next.title &&
    current.content === next.content &&
    current.status === next.status &&
    current.startedAt === next.startedAt &&
    current.completedAt === next.completedAt &&
    current.durationMs === next.durationMs &&
    areStreamingTraceMetadataEquivalent(current.metadata, next.metadata)
}

function areStreamingTraceMetadataEquivalent(
  current: ProcessTrace['metadata'],
  next: ProcessTrace['metadata'],
): boolean {
  if (current === next) return true
  const currentKeys = Object.keys(current ?? {})
  const nextKeys = Object.keys(next ?? {})
  if (currentKeys.length !== nextKeys.length) return false
  for (const key of currentKeys) {
    if ((current as Record<string, unknown> | undefined)?.[key] !== (next as Record<string, unknown> | undefined)?.[key]) {
      return false
    }
  }
  return true
}
