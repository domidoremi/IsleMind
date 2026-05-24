import type { Conversation, Message, ProcessTrace, ReasoningEffort } from '@/types'

export type HomePetAnimation = 'idle' | 'running' | 'review' | 'waving' | 'jumping' | 'failed'
export type HomePetMood = 'idle' | 'working' | 'thinking' | 'tool' | 'celebrate' | 'error'

export interface HomePetState {
  animation: HomePetAnimation
  mood: HomePetMood
  speed: number
  reason: 'idle' | 'model_unconfigured' | 'model_unavailable' | 'streaming' | 'reasoning' | 'tool' | 'retrieval' | 'error' | 'success'
  labelKey: 'pet.a11y.idle' | 'pet.a11y.modelUnconfigured' | 'pet.a11y.modelUnavailable' | 'pet.a11y.working' | 'pet.a11y.thinking' | 'pet.a11y.tool' | 'pet.a11y.retrieval' | 'pet.a11y.error' | 'pet.a11y.celebrate'
}

export interface HomePetStateInput {
  conversation?: Conversation | null
  isStreaming?: boolean
  reasoningEffort?: ReasoningEffort
  modelStatus?: 'unconfigured' | 'unavailable' | 'ready'
}

const DEFAULT_STATE: HomePetState = {
  animation: 'idle',
  mood: 'idle',
  speed: 1,
  reason: 'idle',
  labelKey: 'pet.a11y.idle',
}

export function deriveHomePetState(input: HomePetStateInput): HomePetState {
  const conversation = input.conversation
  const reasoningEffort = input.reasoningEffort ?? conversation?.reasoningEffort ?? 'medium'
  const lastMessage = conversation?.messages.at(-1)

  if (lastMessage?.status === 'error') {
    return {
      animation: 'failed',
      mood: 'error',
      speed: 1,
      reason: 'error',
      labelKey: 'pet.a11y.error',
    }
  }

  if (isRecentSuccess(lastMessage)) {
    return {
      animation: 'jumping',
      mood: 'celebrate',
      speed: 1.12,
      reason: 'success',
      labelKey: 'pet.a11y.celebrate',
    }
  }

  if (input.modelStatus === 'unconfigured') {
    return {
      animation: 'waving',
      mood: 'thinking',
      speed: 0.78,
      reason: 'model_unconfigured',
      labelKey: 'pet.a11y.modelUnconfigured',
    }
  }

  if (input.modelStatus === 'unavailable') {
    return {
      animation: 'review',
      mood: 'error',
      speed: 0.88,
      reason: 'model_unavailable',
      labelKey: 'pet.a11y.modelUnavailable',
    }
  }

  if (input.isStreaming || lastMessage?.status === 'streaming' || lastMessage?.status === 'sending') {
    const activeTrace = findActiveTrace(lastMessage)
    if (activeTrace?.type === 'tool' || activeTrace?.type === 'search') {
      return {
        animation: 'waving',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, 1.1),
        reason: 'tool',
        labelKey: 'pet.a11y.tool',
      }
    }
    if (activeTrace?.type === 'retrieval' || activeTrace?.type === 'knowledge' || activeTrace?.type === 'memory') {
      return {
        animation: 'review',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.98),
        reason: 'retrieval',
        labelKey: 'pet.a11y.retrieval',
      }
    }
    if (reasoningEffort === 'high') {
      return {
        animation: 'review',
        mood: 'thinking',
        speed: 1.18,
        reason: 'reasoning',
        labelKey: 'pet.a11y.thinking',
      }
    }
    return {
      animation: 'running',
      mood: 'working',
      speed: speedForReasoning(reasoningEffort),
      reason: 'streaming',
      labelKey: 'pet.a11y.working',
    }
  }

  if (reasoningEffort === 'high') {
    return {
      animation: 'review',
      mood: 'thinking',
      speed: 0.78,
      reason: 'reasoning',
      labelKey: 'pet.a11y.thinking',
    }
  }

  return DEFAULT_STATE
}

function findActiveTrace(message?: Message): ProcessTrace | undefined {
  if (!message) return undefined
  const traces = [
    ...(message.retrievalTrace ?? []),
    ...(message.reasoning ?? []),
    ...(message.toolCalls ?? []),
  ]
  return traces.find((trace) => trace.status === 'running' || trace.status === 'pending') ?? traces.find((trace) => trace.status === 'error')
}

function isRecentSuccess(message?: Message): boolean {
  if (!message || message.role !== 'assistant' || message.status !== 'done') return false
  const completedAt = message.completedAt ?? message.timestamp
  return Date.now() - completedAt < 2600
}

function speedForReasoning(reasoningEffort: ReasoningEffort, base = 1): number {
  switch (reasoningEffort) {
    case 'minimal':
      return base * 0.82
    case 'low':
      return base * 0.92
    case 'high':
      return base * 1.2
    case 'medium':
    default:
      return base
  }
}
