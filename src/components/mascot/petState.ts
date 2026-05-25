import type { Conversation, Message, ProcessTrace, ReasoningEffort } from '@/types'

export type IsleAtlasId = 'core' | 'rag' | 'provider'
export type HomePetAnimation =
  | 'idle'
  | 'runningRight'
  | 'runningLeft'
  | 'running'
  | 'review'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'deepThinking'
  | 'retrieving'
  | 'toolWorking'
  | 'syncingModels'
  | 'offlineWaiting'
  | 'warningRecover'
export type HomePetMood = 'idle' | 'working' | 'thinking' | 'tool' | 'celebrate' | 'error'

export interface HomePetState {
  atlasId: IsleAtlasId
  animation: HomePetAnimation
  mood: HomePetMood
  speed: number
  reason:
    | 'idle'
    | 'model_unconfigured'
    | 'model_unavailable'
    | 'model_testing'
    | 'streaming'
    | 'reasoning'
    | 'tool'
    | 'retrieval'
    | 'rag_deep'
    | 'rag_fallback'
    | 'provider_sync'
    | 'update_check'
    | 'error'
    | 'success'
  labelKey:
    | 'pet.a11y.idle'
    | 'pet.a11y.modelUnconfigured'
    | 'pet.a11y.modelUnavailable'
    | 'pet.a11y.working'
    | 'pet.a11y.thinking'
    | 'pet.a11y.tool'
    | 'pet.a11y.retrieval'
    | 'pet.a11y.providerSync'
    | 'pet.a11y.offline'
    | 'pet.a11y.recovering'
    | 'pet.a11y.updateCheck'
    | 'pet.a11y.error'
    | 'pet.a11y.celebrate'
}

export interface HomePetStateInput {
  conversation?: Conversation | null
  isStreaming?: boolean
  reasoningEffort?: ReasoningEffort
  modelStatus?: 'unconfigured' | 'unavailable' | 'testing' | 'syncing' | 'ready'
  ragActivity?: 'idle' | 'retrieving' | 'deep' | 'fallback' | 'compressing' | 'flare'
  toolActivity?: 'idle' | 'tool' | 'mcp' | 'skill' | 'attachment' | 'search'
  providerActivity?: 'idle' | 'syncing' | 'testing' | 'partialFailure' | 'failed'
  updateActivity?: 'idle' | 'checking' | 'failed'
}

const DEFAULT_STATE: HomePetState = {
  atlasId: 'core',
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
  const activeTrace = findActiveTrace(lastMessage)

  if (lastMessage?.status === 'error') {
    return {
      atlasId: 'rag',
      animation: 'warningRecover',
      mood: 'error',
      speed: 1,
      reason: 'error',
      labelKey: 'pet.a11y.error',
    }
  }

  if (isRecentSuccess(lastMessage)) {
    return {
      atlasId: 'core',
      animation: 'jumping',
      mood: 'celebrate',
      speed: 1.12,
      reason: 'success',
      labelKey: 'pet.a11y.celebrate',
    }
  }

  if (input.providerActivity === 'syncing' || input.providerActivity === 'testing' || input.modelStatus === 'syncing' || input.modelStatus === 'testing') {
    return {
      atlasId: 'provider',
      animation: 'syncingModels',
      mood: 'working',
      speed: 1.08,
      reason: input.providerActivity === 'testing' || input.modelStatus === 'testing' ? 'model_testing' : 'provider_sync',
      labelKey: 'pet.a11y.providerSync',
    }
  }

  if (input.providerActivity === 'partialFailure' || input.providerActivity === 'failed' || input.updateActivity === 'failed') {
    return {
      atlasId: 'rag',
      animation: 'warningRecover',
      mood: 'error',
      speed: 0.92,
      reason: 'rag_fallback',
      labelKey: 'pet.a11y.recovering',
    }
  }

  if (input.updateActivity === 'checking') {
    return {
      atlasId: 'provider',
      animation: 'syncingModels',
      mood: 'working',
      speed: 0.92,
      reason: 'update_check',
      labelKey: 'pet.a11y.updateCheck',
    }
  }

  if (input.modelStatus === 'unconfigured') {
    return {
      atlasId: 'provider',
      animation: 'offlineWaiting',
      mood: 'thinking',
      speed: 0.78,
      reason: 'model_unconfigured',
      labelKey: 'pet.a11y.modelUnconfigured',
    }
  }

  if (input.modelStatus === 'unavailable') {
    return {
      atlasId: 'provider',
      animation: 'offlineWaiting',
      mood: 'error',
      speed: 0.88,
      reason: 'model_unavailable',
      labelKey: 'pet.a11y.modelUnavailable',
    }
  }

  if (input.ragActivity === 'fallback' || input.ragActivity === 'flare') {
    return {
      atlasId: 'rag',
      animation: 'warningRecover',
      mood: 'thinking',
      speed: 1,
      reason: 'rag_fallback',
      labelKey: 'pet.a11y.recovering',
    }
  }

  if (input.ragActivity === 'retrieving' || input.ragActivity === 'deep' || input.ragActivity === 'compressing') {
    return {
      atlasId: 'rag',
      animation: input.ragActivity === 'retrieving' ? 'retrieving' : 'deepThinking',
      mood: 'thinking',
      speed: speedForReasoning(reasoningEffort, input.ragActivity === 'retrieving' ? 0.98 : 0.9),
      reason: input.ragActivity === 'retrieving' ? 'retrieval' : 'rag_deep',
      labelKey: input.ragActivity === 'retrieving' ? 'pet.a11y.retrieval' : 'pet.a11y.thinking',
    }
  }

  if (input.toolActivity && input.toolActivity !== 'idle') {
    return {
      atlasId: 'provider',
      animation: 'toolWorking',
      mood: 'tool',
      speed: speedForReasoning(reasoningEffort, 1.04),
      reason: 'tool',
      labelKey: 'pet.a11y.tool',
    }
  }

  if (input.isStreaming || lastMessage?.status === 'streaming' || lastMessage?.status === 'sending') {
    if (activeTrace?.status === 'error') {
      return {
        atlasId: 'rag',
        animation: 'warningRecover',
        mood: 'error',
        speed: 0.95,
        reason: 'rag_fallback',
        labelKey: 'pet.a11y.recovering',
      }
    }
    if (activeTrace?.type === 'tool' || activeTrace?.type === 'search') {
      return {
        atlasId: 'provider',
        animation: 'toolWorking',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, 1.1),
        reason: 'tool',
        labelKey: 'pet.a11y.tool',
      }
    }
    if (activeTrace?.type === 'retrieval' || activeTrace?.type === 'knowledge' || activeTrace?.type === 'memory') {
      return {
        atlasId: 'rag',
        animation: traceLooksLikeFallback(activeTrace) ? 'warningRecover' : 'retrieving',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.98),
        reason: traceLooksLikeFallback(activeTrace) ? 'rag_fallback' : 'retrieval',
        labelKey: traceLooksLikeFallback(activeTrace) ? 'pet.a11y.recovering' : 'pet.a11y.retrieval',
      }
    }
    if (reasoningEffort === 'high' || reasoningEffort === 'xhigh') {
      return {
        atlasId: 'rag',
        animation: 'deepThinking',
        mood: 'thinking',
        speed: 1.18,
        reason: 'reasoning',
        labelKey: 'pet.a11y.thinking',
      }
    }
    return {
      atlasId: 'core',
      animation: 'running',
      mood: 'working',
      speed: speedForReasoning(reasoningEffort),
      reason: 'streaming',
      labelKey: 'pet.a11y.working',
    }
  }

  if (reasoningEffort === 'high' || reasoningEffort === 'xhigh') {
    return {
      atlasId: 'rag',
      animation: 'deepThinking',
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

function traceLooksLikeFallback(trace?: ProcessTrace): boolean {
  if (!trace) return false
  if (trace.status === 'error' || trace.status === 'skipped') return true
  const haystack = [
    trace.title,
    trace.content,
    trace.metadata?.fallback,
    trace.metadata?.fallbackReason,
    trace.metadata?.fallbackReasons,
    trace.metadata?.degraded,
    trace.metadata?.flareTriggered,
  ].filter(Boolean).join(' ')
  return /fallback|degrad|flare|retry|second-pass|unavailable|补检索|降级|重试|不可用/i.test(haystack)
}

function isRecentSuccess(message?: Message): boolean {
  if (!message || message.role !== 'assistant' || message.status !== 'done') return false
  const completedAt = message.completedAt ?? message.timestamp
  return Date.now() - completedAt < 2600
}

function speedForReasoning(reasoningEffort: ReasoningEffort, base = 1): number {
  switch (reasoningEffort) {
    case 'none':
      return base * 0.78
    case 'minimal':
      return base * 0.82
    case 'low':
      return base * 0.92
    case 'high':
      return base * 1.2
    case 'xhigh':
      return base * 1.32
    case 'medium':
    default:
      return base
  }
}
