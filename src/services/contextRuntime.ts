import type { RagEvaluationResult, RagQueryPlan, RetrievalSource } from '@/types'
import type { ContextPlannerSource } from '@/services/contextPlanner'
import { formatWebPrompt } from '@/services/chatMessageUtils'
import { estimateTextTokens } from '@/services/tokenUsage'

export const CONTEXT_RUNTIME_SCHEMA = 'islemind.context-runtime.v1'

export type ContextRuntimeLane = 'retrieval' | 'web' | 'tools'
export type ContextRuntimeAuthority = 'user-private' | 'external-public' | 'permissioned-tool'

export interface ContextRuntimeRetrievedContext {
  sources: RetrievalSource[]
  prompt: string
  plan?: RagQueryPlan
  quality?: RagEvaluationResult
}

export interface ContextRuntimeEnvelope {
  schema: typeof CONTEXT_RUNTIME_SCHEMA
  id: string
  lane: ContextRuntimeLane
  plannerType: ContextPlannerSource['type']
  authority: ContextRuntimeAuthority
  text?: string
  sourceCount: number
  estimatedTokens: number
  budgetPolicy: 'planner-token-cap'
  evidence: {
    memoryCount?: number
    knowledgeCount?: number
    webCount?: number
    toolCount?: number
    ragPlanId?: string
    ragProfile?: RagQueryPlan['profile']
    ragConfidence?: number
  }
  trace: Record<string, unknown>
}

export interface ChatContextRuntimeInput {
  retrievedContext: ContextRuntimeRetrievedContext
  webSources?: RetrievalSource[]
  mcpPrompt?: string
  mcpToolCount?: number
}

export interface ChatContextRuntimeArtifact {
  schema: typeof CONTEXT_RUNTIME_SCHEMA
  contextSources: ContextPlannerSource[]
  retrievalSources: RetrievalSource[]
  envelopes: ContextRuntimeEnvelope[]
  counts: {
    memory: number
    knowledge: number
    web: number
    tools: number
    totalRetrievalSources: number
  }
  trace: Record<string, unknown>
}

export function buildChatContextRuntime(input: ChatContextRuntimeInput): ChatContextRuntimeArtifact {
  const retrievedSources = input.retrievedContext.sources ?? []
  const webSources = input.webSources ?? []
  const sourceCounts = countRetrievalSources(retrievedSources)
  const toolCount = input.mcpToolCount ?? 0
  const envelopes = [
    buildEnvelope({
      id: 'retrieved-context',
      lane: 'retrieval',
      plannerType: 'retrieved_context',
      authority: 'user-private',
      text: input.retrievedContext.prompt,
      sourceCount: retrievedSources.length,
      evidence: {
        memoryCount: sourceCounts.memory,
        knowledgeCount: sourceCounts.knowledge,
        ragPlanId: input.retrievedContext.plan?.id,
        ragProfile: input.retrievedContext.plan?.profile,
        ragConfidence: input.retrievedContext.quality?.confidence,
      },
      trace: {
        source: 'rag',
        contextRuntimeSchema: CONTEXT_RUNTIME_SCHEMA,
        runtimeLane: 'retrieval',
        memoryCount: sourceCounts.memory,
        knowledgeCount: sourceCounts.knowledge,
        quality: input.retrievedContext.quality,
      },
    }),
    buildEnvelope({
      id: 'web-context',
      lane: 'web',
      plannerType: 'retrieved_context',
      authority: 'external-public',
      text: webSources.length ? formatWebPrompt(webSources) : undefined,
      sourceCount: webSources.length,
      evidence: {
        webCount: webSources.length,
      },
      trace: {
        source: 'web',
        contextRuntimeSchema: CONTEXT_RUNTIME_SCHEMA,
        runtimeLane: 'web',
      },
    }),
    buildEnvelope({
      id: 'mcp-context',
      lane: 'tools',
      plannerType: 'tool_outputs',
      authority: 'permissioned-tool',
      text: input.mcpPrompt,
      sourceCount: toolCount,
      evidence: {
        toolCount,
      },
      trace: {
        source: 'mcp',
        contextRuntimeSchema: CONTEXT_RUNTIME_SCHEMA,
        runtimeLane: 'tools',
      },
    }),
  ]
  const retrievalSources = [...retrievedSources, ...webSources]
  return {
    schema: CONTEXT_RUNTIME_SCHEMA,
    contextSources: envelopes.map(toPlannerSource),
    retrievalSources,
    envelopes,
    counts: {
      memory: sourceCounts.memory,
      knowledge: sourceCounts.knowledge,
      web: webSources.length,
      tools: toolCount,
      totalRetrievalSources: retrievalSources.length,
    },
    trace: {
      schema: CONTEXT_RUNTIME_SCHEMA,
      envelopeCount: envelopes.length,
      includedEnvelopeCount: envelopes.filter((envelope) => envelope.estimatedTokens > 0).length,
      retrievalSourceCount: retrievalSources.length,
      memoryCount: sourceCounts.memory,
      knowledgeCount: sourceCounts.knowledge,
      webCount: webSources.length,
      toolCount,
      ragPlanId: input.retrievedContext.plan?.id,
      ragProfile: input.retrievedContext.plan?.profile,
      ragConfidence: input.retrievedContext.quality?.confidence,
    },
  }
}

function buildEnvelope(input: Omit<ContextRuntimeEnvelope, 'schema' | 'estimatedTokens' | 'budgetPolicy'>): ContextRuntimeEnvelope {
  const text = input.text?.trim()
  return {
    ...input,
    schema: CONTEXT_RUNTIME_SCHEMA,
    text,
    estimatedTokens: text ? estimateTextTokens(text) : 0,
    budgetPolicy: 'planner-token-cap',
  }
}

function toPlannerSource(envelope: ContextRuntimeEnvelope): ContextPlannerSource {
  return {
    id: envelope.id,
    type: envelope.plannerType,
    text: envelope.text,
    sourceCount: envelope.sourceCount,
    trace: {
      ...envelope.trace,
      contextRuntime: {
        schema: envelope.schema,
        lane: envelope.lane,
        authority: envelope.authority,
        estimatedTokens: envelope.estimatedTokens,
        budgetPolicy: envelope.budgetPolicy,
        evidence: envelope.evidence,
      },
    },
  }
}

function countRetrievalSources(sources: RetrievalSource[]): { memory: number; knowledge: number } {
  return sources.reduce((counts, source) => {
    if (source.type === 'memory') counts.memory += 1
    if (source.type === 'knowledge') counts.knowledge += 1
    return counts
  }, { memory: 0, knowledge: 0 })
}
