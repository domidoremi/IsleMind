import {
  CONTEXT_CONTRIBUTION_SCHEMA,
  createContextContributionAssembler,
  type ContextContribution,
  type ContextContributionInput,
  type ContextPlannerSource,
} from '@/modules/assistant-runtime'
import { TAVERN_REVIEW_READY_LABEL_INSTRUCTION, type TavernContextPack } from '@/modules/workspaces'
import type { RagEvaluationResult, RagQueryPlan, RetrievalSource } from '@/types/contextContracts'
import { formatWebPrompt } from '@/services/chatMessageUtils'
import { estimateTextTokens } from '@/services/tokenUsage'

export const CONTEXT_RUNTIME_SCHEMA = CONTEXT_CONTRIBUTION_SCHEMA

export interface ContextRuntimeRetrievedContext {
  sources: RetrievalSource[]
  prompt: string
  plan?: RagQueryPlan
  quality?: RagEvaluationResult
}

export type ContextRuntimeEnvelope = ContextContribution

export interface ChatContextRuntimeInput {
  retrievedContext: ContextRuntimeRetrievedContext
  webSources?: RetrievalSource[]
  mcpPrompt?: string
  mcpToolCount?: number
  tavernContext?: TavernContextPack
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
    tavern: number
    totalRetrievalSources: number
  }
  trace: Record<string, unknown>
}

const contextContributionAssembler = createContextContributionAssembler({
  estimateTokens: estimateTextTokens,
})

export function buildChatContextRuntime(input: ChatContextRuntimeInput): ChatContextRuntimeArtifact {
  const retrievedSources = input.retrievedContext.sources ?? []
  const webSources = input.webSources ?? []
  const sourceCounts = countRetrievalSources(retrievedSources)
  const toolCount = input.mcpToolCount ?? 0
  const assembly = contextContributionAssembler.assemble([
    contribution({
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
    contribution({
      id: 'web-context',
      lane: 'web',
      plannerType: 'retrieved_context',
      authority: 'external-public',
      text: webSources.length ? formatWebPrompt(webSources) : undefined,
      sourceCount: webSources.length,
      evidence: { webCount: webSources.length },
      trace: {
        source: 'web',
        contextRuntimeSchema: CONTEXT_RUNTIME_SCHEMA,
        runtimeLane: 'web',
      },
    }),
    contribution({
      id: 'mcp-context',
      lane: 'tools',
      plannerType: 'tool_outputs',
      authority: 'permissioned-tool',
      text: input.mcpPrompt,
      sourceCount: toolCount,
      evidence: { toolCount },
      trace: {
        source: 'mcp',
        contextRuntimeSchema: CONTEXT_RUNTIME_SCHEMA,
        runtimeLane: 'tools',
      },
    }),
    contribution({
      id: 'tavern-context',
      lane: 'tavern',
      plannerType: 'memory',
      authority: 'local-state',
      text: formatTavernPrompt(input.tavernContext),
      sourceCount: input.tavernContext?.evidence.length ?? 0,
      evidence: {
        tavernCharacterCount: input.tavernContext?.characters.length ?? 0,
        tavernLoreCount: input.tavernContext?.lorebook.length ?? 0,
        tavernMemoryCount: input.tavernContext?.relationshipMemories.length ?? 0,
        tavernSceneCount: input.tavernContext?.scene ? 1 : 0,
        tavernSummaryCount: input.tavernContext?.narrativeSummaries.length ?? 0,
        tavernEvidenceCount: input.tavernContext?.evidence.length ?? 0,
        tavernScopeId: input.tavernContext?.scopeId,
      },
      trace: {
        source: 'tavern',
        contextRuntimeSchema: CONTEXT_RUNTIME_SCHEMA,
        runtimeLane: 'tavern',
        mode: input.tavernContext?.mode,
        isolated: input.tavernContext?.isolated,
        shareWithChat: input.tavernContext?.shareWithChat,
        shareWithAgent: input.tavernContext?.shareWithAgent,
        scopeId: input.tavernContext?.scopeId,
        evidence: input.tavernContext?.evidence,
      },
    }),
  ])
  const retrievalSources = [...retrievedSources, ...webSources]
  return {
    schema: CONTEXT_RUNTIME_SCHEMA,
    contextSources: assembly.contextSources,
    retrievalSources,
    envelopes: assembly.contributions,
    counts: {
      memory: sourceCounts.memory,
      knowledge: sourceCounts.knowledge,
      web: webSources.length,
      tools: toolCount,
      tavern: input.tavernContext?.promptSections.length ? 1 : 0,
      totalRetrievalSources: retrievalSources.length,
    },
    trace: {
      schema: CONTEXT_RUNTIME_SCHEMA,
      envelopeCount: assembly.trace.contributionCount,
      includedEnvelopeCount: assembly.trace.includedContributionCount,
      retrievalSourceCount: retrievalSources.length,
      memoryCount: sourceCounts.memory,
      knowledgeCount: sourceCounts.knowledge,
      webCount: webSources.length,
      toolCount,
      tavernContextIncluded: Boolean(input.tavernContext?.promptSections.length),
      tavernEvidenceCount: input.tavernContext?.evidence.length ?? 0,
      tavernScopeId: input.tavernContext?.scopeId,
      ragPlanId: input.retrievedContext.plan?.id,
      ragProfile: input.retrievedContext.plan?.profile,
      ragConfidence: input.retrievedContext.quality?.confidence,
    },
  }
}

function contribution(input: ContextContributionInput): ContextContributionInput {
  return input
}

function formatTavernPrompt(context: TavernContextPack | undefined): string | undefined {
  const sections = context?.promptSections.map((section) => section.trim()).filter(Boolean) ?? []
  if (!sections.length) return undefined
  return [
    'Active Chat workspace context: local role, scene, lore, relationship, and narrative continuity state.',
    'Use this workspace only for the current conversation. Treat durable updates as pending review unless the application reports that they were committed.',
    TAVERN_REVIEW_READY_LABEL_INSTRUCTION,
    ...sections,
  ].join('\n\n')
}

function countRetrievalSources(sources: RetrievalSource[]): { memory: number; knowledge: number } {
  return sources.reduce((counts, source) => {
    if (source.type === 'memory') counts.memory += 1
    if (source.type === 'knowledge') counts.knowledge += 1
    return counts
  }, { memory: 0, knowledge: 0 })
}
