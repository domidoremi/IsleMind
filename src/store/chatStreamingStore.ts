import { create } from 'zustand'
import type { Message, ProcessTrace } from '@/types'
import { clampTraceContent } from '@/services/chatTraceUtils'
import { useChatStore } from './chatStore'

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
  upsertTrace: (convId: string, msgId: string, trace: ProcessTrace) => void
  getStreamingText: (convId: string, msgId: string) => string
  getStreamingTraceSnapshot: (convId: string, msgId: string) => StreamingTraceSnapshot | undefined
  commitStreamingText: (convId: string, msgId: string) => string
  commitStreamingTraces: (convId: string, msgId: string) => StreamingTraceSnapshot | undefined
  flushStreamingMessage: (convId: string, msgId: string) => Promise<void>
  clearStreaming: (convId: string, msgId: string) => void
}

function streamingKey(convId: string, msgId: string): string {
  return `${convId}:${msgId}`
}

export const useChatStreamingStore = create<StreamingState>((set, get) => ({
  activeStreams: new Map(),
  streamingText: new Map(),
  streamingTraces: new Map(),
  persistTimers: new Map(),

  setStreaming: (convId: string, msgId: string) => {
    const key = streamingKey(convId, msgId)
    set((state) => {
      const updated = new Map(state.activeStreams)
      updated.set(key, true)
      return { activeStreams: updated }
    })
  },

  appendContent: (convId: string, msgId: string, content: string) => {
    const key = streamingKey(convId, msgId)
    set((state) => {
      const updated = new Map(state.streamingText)
      updated.set(key, `${updated.get(key) ?? ''}${content}`)
      return { streamingText: updated }
    })

    // Schedule debounced persist
    const state = get()
    const existing = state.persistTimers.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      get().persistTimers.delete(key)
      const text = get().streamingText.get(key)
      if (text) useChatStore.getState().persistStreamingContentSnapshot(convId, msgId, text)
    }, STREAMING_PERSIST_DELAY_MS)

    set((s) => {
      const updated = new Map(s.persistTimers)
      updated.set(key, timer)
      return { persistTimers: updated }
    })
  },

  upsertTrace: (convId: string, msgId: string, trace: ProcessTrace) => {
    const key = streamingKey(convId, msgId)
    set((state) => {
      const updated = new Map(state.streamingTraces)
      const current = updated.get(key) ?? cloneMessageTraceSnapshot(resolveBaseMessageTraceSnapshot(convId, msgId))
      updated.set(key, upsertTraceSnapshot(current, trace))
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
}))

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
  return {
    ...snapshot,
    [key]: upsertTraceList(snapshot[key] ?? [], trace),
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
    JSON.stringify(current.metadata ?? null) === JSON.stringify(next.metadata ?? null)
}
