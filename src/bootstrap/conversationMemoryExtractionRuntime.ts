import { snapshotPlainData, type ProcessTrace } from '@/core'
import {
  createConversationMemoryExtractionRuntime,
  type ConversationMemoryExtractionTransition,
} from '@/modules/knowledge'
import { extractConversationMemories } from '@/bootstrap/knowledgeMemoryExtraction'
import { completeTrace } from '@/services/chatTraceUtils'
import { useSettingsStore } from '@/store/settingsStore'
import type { Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { st } from '@/i18n/service'

export function runConversationMemoryExtraction(input: {
  conversationId: string
  assistantMessageId: string
  messages: readonly Message[]
  provider: AIProvider
  model: string
  settings?: Settings
  signal?: AbortSignal
  recordTrace(trace: ProcessTrace): void
}) {
  input = {
    ...input,
    settings: snapshotPlainData(input.settings ?? useSettingsStore.getState().settings),
    provider: snapshotPlainData(input.provider),
    messages: snapshotPlainData(input.messages),
  }
  const startedAt = Date.now()
  const id = memoryExtractionTraceId()
  const settings = input.settings as Settings
  const memoryEnabled = settings.memoryEnabled === true
  const providerAvailable = Boolean(input.provider.apiKey)
  const runtime = createConversationMemoryExtractionRuntime<Message, AIProvider, Settings>({
    extractor: { extract: extractConversationMemories },
    projectTransition(projection) {
      input.recordTrace(buildMemoryExtractionTrace({
        id,
        startedAt,
        memoryEnabled,
        providerAvailable,
        signalAborted: isMemoryExtractionSignalAborted(input.signal),
        transition: projection.transition,
      }))
    },
    nonErrorFailureMessage: st('chatRunner.trace.memoryExtractFailed'),
    cancellationMessage: st('chatRunner.trace.memoryExtractCancelled'),
  })
  return runtime.run({
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    messages: input.messages,
    provider: input.provider,
    model: input.model,
    settings,
    memoryEnabled,
    signal: input.signal,
  })
}

function buildMemoryExtractionTrace(input: {
  id: string
  startedAt: number
  memoryEnabled: boolean
  providerAvailable: boolean
  signalAborted: boolean
  transition: ConversationMemoryExtractionTransition
}): ProcessTrace {
  const base = {
    id: input.id,
    type: 'memory' as const,
    title: st('chatRunner.trace.memoryExtractTitle'),
    startedAt: input.startedAt,
    metadata: {
      memoryEnabled: input.memoryEnabled,
      providerAvailable: input.providerAvailable,
      signalAborted: input.signalAborted,
      transitionStatus: input.transition.status,
      ...(input.transition.status === 'skipped'
        ? { transitionReason: input.transition.reason }
        : {}),
    },
  }
  switch (input.transition.status) {
    case 'running':
      return {
        ...base,
        content: st('chatRunner.trace.memoryExtractRunning'),
        status: 'running',
      }
    case 'completed':
      return completeTrace({
        ...base,
        content: input.transition.addedCount
          ? st('chatRunner.trace.memoryExtractAdded', {
              count: input.transition.addedCount,
              items: input.transition.items.join('; '),
            })
          : st('chatRunner.trace.memoryExtractNone'),
        status: 'done',
        metadata: {
          ...base.metadata,
          addedCount: input.transition.addedCount,
        },
      })
    case 'cancelled':
      return completeTrace({ ...base, content: input.transition.message, status: 'cancelled' })
    case 'failed':
      return completeTrace({ ...base, content: input.transition.message, status: 'error' })
    case 'skipped':
      return completeTrace({
        ...base,
        content: st('chatRunner.trace.memoryExtractDisabled'),
        status: 'skipped',
      })
  }
}

function isMemoryExtractionSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

function memoryExtractionTraceId(): string {
  return `memory-extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
