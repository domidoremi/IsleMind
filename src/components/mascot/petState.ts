import type { Conversation, Message, ProcessTrace, ReasoningEffort } from '@/types'

export type IsleAtlasId = 'core' | 'rag' | 'provider'
export type HomePetAnimation =
  | 'idle'
  | 'runningRight'
  | 'runningLeft'
  | 'running'
  | 'sendingPrompt'
  | 'review'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'deepThinking'
  | 'retrieving'
  | 'contextCompressing'
  | 'flareScan'
  | 'memoryLinking'
  | 'graphMapping'
  | 'citationReview'
  | 'knowledgeIndexing'
  | 'toolWorking'
  | 'mcpWorking'
  | 'skillRunning'
  | 'attachmentReading'
  | 'webSearching'
  | 'modelTesting'
  | 'syncingModels'
  | 'providerIssue'
  | 'offlineWaiting'
  | 'warningRecover'
export type HomePetMood = 'idle' | 'working' | 'thinking' | 'tool' | 'celebrate' | 'error'
export type HomePetActionState =
  | 'idle'
  | 'model_unconfigured'
  | 'model_unavailable'
  | 'model_testing'
  | 'streaming'
  | 'sending_prompt'
  | 'reasoning'
  | 'tool'
  | 'mcp_tool'
  | 'skill_tool'
  | 'attachment_processing'
  | 'web_search'
  | 'retrieval'
  | 'rag_deep'
  | 'rag_compressing'
  | 'rag_flare'
  | 'memory_linking'
  | 'graph_mapping'
  | 'citation_review'
  | 'knowledge_indexing'
  | 'rag_fallback'
  | 'provider_sync'
  | 'provider_issue'
  | 'update_check'
  | 'error'
  | 'success'
export type HomePetLabelKey =
  | 'pet.a11y.idle'
  | 'pet.a11y.modelUnconfigured'
  | 'pet.a11y.modelUnavailable'
  | 'pet.a11y.modelTesting'
  | 'pet.a11y.working'
  | 'pet.a11y.sending'
  | 'pet.a11y.thinking'
  | 'pet.a11y.tool'
  | 'pet.a11y.mcp'
  | 'pet.a11y.skill'
  | 'pet.a11y.attachment'
  | 'pet.a11y.search'
  | 'pet.a11y.retrieval'
  | 'pet.a11y.compressing'
  | 'pet.a11y.flare'
  | 'pet.a11y.memoryLinking'
  | 'pet.a11y.graphMapping'
  | 'pet.a11y.citationReview'
  | 'pet.a11y.knowledgeIndexing'
  | 'pet.a11y.providerSync'
  | 'pet.a11y.providerIssue'
  | 'pet.a11y.offline'
  | 'pet.a11y.recovering'
  | 'pet.a11y.updateCheck'
  | 'pet.a11y.error'
  | 'pet.a11y.celebrate'

export interface HomePetState {
  atlasId: IsleAtlasId
  animation: HomePetAnimation
  mood: HomePetMood
  speed: number
  reason: HomePetActionState
  labelKey: HomePetLabelKey
}

export interface HomePetStateInput {
  conversation?: Conversation | null
  isStreaming?: boolean
  reasoningEffort?: ReasoningEffort
  modelStatus?: 'unconfigured' | 'unavailable' | 'testing' | 'syncing' | 'ready'
  ragActivity?: 'idle' | 'retrieving' | 'deep' | 'fallback' | 'compressing' | 'flare' | 'memory' | 'graph' | 'citation' | 'indexing'
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

  if (input.providerActivity === 'testing' || input.modelStatus === 'testing') {
    return {
      atlasId: 'provider',
      animation: 'modelTesting',
      mood: 'working',
      speed: 1.04,
      reason: 'model_testing',
      labelKey: 'pet.a11y.modelTesting',
    }
  }

  if (input.providerActivity === 'syncing' || input.modelStatus === 'syncing') {
    return {
      atlasId: 'provider',
      animation: 'syncingModels',
      mood: 'working',
      speed: 1.08,
      reason: 'provider_sync',
      labelKey: 'pet.a11y.providerSync',
    }
  }

  if (input.providerActivity === 'partialFailure' || input.providerActivity === 'failed' || input.updateActivity === 'failed') {
    return {
      atlasId: 'provider',
      animation: 'providerIssue',
      mood: 'error',
      speed: 0.92,
      reason: 'provider_issue',
      labelKey: 'pet.a11y.providerIssue',
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

  if (input.ragActivity === 'fallback') {
    return {
      atlasId: 'rag',
      animation: 'warningRecover',
      mood: 'thinking',
      speed: 1,
      reason: 'rag_fallback',
      labelKey: 'pet.a11y.recovering',
    }
  }

  if (input.ragActivity && input.ragActivity !== 'idle') {
    return stateForRagActivity(input.ragActivity, reasoningEffort)
  }

  if (input.toolActivity && input.toolActivity !== 'idle') {
    return stateForToolActivity(input.toolActivity, reasoningEffort)
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
      return stateForToolActivity(toolActivityForTrace(activeTrace), reasoningEffort, 1.1)
    }
    if (activeTrace?.type === 'retrieval' || activeTrace?.type === 'knowledge' || activeTrace?.type === 'memory') {
      return stateForRagActivity(ragActivityForTrace(activeTrace), reasoningEffort)
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
    if (lastMessage?.status === 'sending') {
      return {
        atlasId: 'core',
        animation: 'sendingPrompt',
        mood: 'working',
        speed: speedForReasoning(reasoningEffort, 0.95),
        reason: 'sending_prompt',
        labelKey: 'pet.a11y.sending',
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

function stateForRagActivity(ragActivity: NonNullable<HomePetStateInput['ragActivity']>, reasoningEffort: ReasoningEffort): HomePetState {
  switch (ragActivity) {
    case 'retrieving':
      return {
        atlasId: 'rag',
        animation: 'retrieving',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.98),
        reason: 'retrieval',
        labelKey: 'pet.a11y.retrieval',
      }
    case 'compressing':
      return {
        atlasId: 'rag',
        animation: 'contextCompressing',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.86),
        reason: 'rag_compressing',
        labelKey: 'pet.a11y.compressing',
      }
    case 'flare':
      return {
        atlasId: 'rag',
        animation: 'flareScan',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 1.08),
        reason: 'rag_flare',
        labelKey: 'pet.a11y.flare',
      }
    case 'memory':
      return {
        atlasId: 'rag',
        animation: 'memoryLinking',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.94),
        reason: 'memory_linking',
        labelKey: 'pet.a11y.memoryLinking',
      }
    case 'graph':
      return {
        atlasId: 'rag',
        animation: 'graphMapping',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.92),
        reason: 'graph_mapping',
        labelKey: 'pet.a11y.graphMapping',
      }
    case 'citation':
      return {
        atlasId: 'rag',
        animation: 'citationReview',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.88),
        reason: 'citation_review',
        labelKey: 'pet.a11y.citationReview',
      }
    case 'indexing':
      return {
        atlasId: 'rag',
        animation: 'knowledgeIndexing',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.98),
        reason: 'knowledge_indexing',
        labelKey: 'pet.a11y.knowledgeIndexing',
      }
    case 'fallback':
      return {
        atlasId: 'rag',
        animation: 'warningRecover',
        mood: 'thinking',
        speed: 1,
        reason: 'rag_fallback',
        labelKey: 'pet.a11y.recovering',
      }
    case 'deep':
      return {
        atlasId: 'rag',
        animation: 'deepThinking',
        mood: 'thinking',
        speed: speedForReasoning(reasoningEffort, 0.9),
        reason: 'rag_deep',
        labelKey: 'pet.a11y.thinking',
      }
    case 'idle':
    default:
      return DEFAULT_STATE
  }
}

function stateForToolActivity(toolActivity: NonNullable<HomePetStateInput['toolActivity']>, reasoningEffort: ReasoningEffort, baseSpeed = 1.04): HomePetState {
  switch (toolActivity) {
    case 'mcp':
      return {
        atlasId: 'provider',
        animation: 'mcpWorking',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, baseSpeed),
        reason: 'mcp_tool',
        labelKey: 'pet.a11y.mcp',
      }
    case 'skill':
      return {
        atlasId: 'provider',
        animation: 'skillRunning',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, baseSpeed * 0.96),
        reason: 'skill_tool',
        labelKey: 'pet.a11y.skill',
      }
    case 'attachment':
      return {
        atlasId: 'provider',
        animation: 'attachmentReading',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, baseSpeed * 0.9),
        reason: 'attachment_processing',
        labelKey: 'pet.a11y.attachment',
      }
    case 'search':
      return {
        atlasId: 'provider',
        animation: 'webSearching',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, baseSpeed * 1.06),
        reason: 'web_search',
        labelKey: 'pet.a11y.search',
      }
    case 'tool':
    case 'idle':
    default:
      return {
        atlasId: 'provider',
        animation: 'toolWorking',
        mood: 'tool',
        speed: speedForReasoning(reasoningEffort, baseSpeed),
        reason: 'tool',
        labelKey: 'pet.a11y.tool',
      }
  }
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

function ragActivityForTrace(trace: ProcessTrace): NonNullable<HomePetStateInput['ragActivity']> {
  if (traceLooksLikeFallback(trace)) return 'fallback'
  if (traceMatches(trace, /flare|second-pass|补检索/i)) return 'flare'
  if (traceMatches(trace, /compress|llmlingua|压缩/i)) return 'compressing'
  if (trace.type === 'memory' || traceMatches(trace, /memory|remember|recall|long-term|长期记忆|记忆/i)) return 'memory'
  if (traceMatches(trace, /graph|raptor|map|cluster|relationship|entity|多跳|图谱/i)) return 'graph'
  if (traceMatches(trace, /citation|source|reference|verify|evidence|引用|来源|证据/i)) return 'citation'
  if (traceMatches(trace, /index|embedding|chunk|ingest|vector|索引|嵌入|分块/i)) return 'indexing'
  if (traceMatches(trace, /colbert|hyde|rewrite|deep/i)) return 'deep'
  return 'retrieving'
}

function toolActivityForTrace(trace: ProcessTrace): NonNullable<HomePetStateInput['toolActivity']> {
  if (trace.type === 'search') return 'search'
  if (traceMatches(trace, /mcp/i)) return 'mcp'
  if (traceMatches(trace, /skill|isleskill/i)) return 'skill'
  if (traceMatches(trace, /attach|file|image|附件|图片/i)) return 'attachment'
  return 'tool'
}

function traceMatches(trace: ProcessTrace, pattern: RegExp): boolean {
  const haystack = [
    trace.title,
    trace.content,
    trace.metadata ? Object.entries(trace.metadata).slice(0, 12).map(([key, value]) => `${key}:${Array.isArray(value) ? value.join(',') : String(value)}`).join(' ') : '',
  ].filter(Boolean).join(' ')
  return pattern.test(haystack)
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
