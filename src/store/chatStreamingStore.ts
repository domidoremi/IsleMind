import { create } from 'zustand'
import type { Conversation } from '@/types'
import { useChatStore } from './chatStore'

type StreamingPersistHandle = ReturnType<typeof setTimeout>

const STREAMING_PERSIST_DELAY_MS = 420

interface StreamingState {
  activeStreams: Map<string, boolean>
  persistTimers: Map<string, StreamingPersistHandle>

  setStreaming: (convId: string, msgId: string) => void
  appendContent: (convId: string, msgId: string, content: string) => void
  flushStreamingMessage: (convId: string, msgId: string) => Promise<void>
  clearStreaming: (convId: string, msgId: string) => void
}

function streamingKey(convId: string, msgId: string): string {
  return `${convId}:${msgId}`
}

export const useChatStreamingStore = create<StreamingState>((set, get) => ({
  activeStreams: new Map(),
  persistTimers: new Map(),

  setStreaming: (convId: string, msgId: string) => {
    const key = streamingKey(convId, msgId)
    set((state) => {
      const updated = new Map(state.activeStreams)
      updated.set(key, true)
      return { activeStreams: updated }
    })
    useChatStore.getState().setStreaming(convId, msgId)
  },

  appendContent: (convId: string, msgId: string, content: string) => {
    const key = streamingKey(convId, msgId)
    useChatStore.getState().appendContent(convId, msgId, content)

    // Schedule debounced persist
    const state = get()
    const existing = state.persistTimers.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      get().persistTimers.delete(key)
      // Persist will be handled by chatStore's scheduleStreamingPersist
    }, STREAMING_PERSIST_DELAY_MS)

    set((s) => {
      const updated = new Map(s.persistTimers)
      updated.set(key, timer)
      return { persistTimers: updated }
    })
  },

  flushStreamingMessage: async (convId: string, msgId: string) => {
    const key = streamingKey(convId, msgId)
    const state = get()
    const timer = state.persistTimers.get(key)

    if (timer) {
      clearTimeout(timer)
      set((s) => {
        const updated = new Map(s.persistTimers)
        updated.delete(key)
        return { persistTimers: updated }
      })
    }

    await useChatStore.getState().flushStreamingMessage(convId, msgId)

    set((s) => {
      const updated = new Map(s.activeStreams)
      updated.delete(key)
      return { activeStreams: updated }
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
      const persistTimers = new Map(s.persistTimers)
      activeStreams.delete(key)
      persistTimers.delete(key)
      return { activeStreams, persistTimers }
    })
  },
}))
