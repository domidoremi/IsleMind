import type { RagQueryPlan, RetrievalSource, Settings } from '@/types'
import type { AgentRagContextPackRequest, AgentRagRuntime, AgentRagRuntimeOptions } from '@/services/agent/agentToolTypes'
import { runAgenticRag } from '@/services/rag'

export interface CreateAgentRagRuntimeInput {
  settings: Settings
  conversationTitle?: string
  systemPrompt?: string
  memorySources?: RetrievalSource[]
  retrieveKnowledge: (query: string, limit: number, options?: AgentRagRuntimeOptions) => Promise<RetrievalSource[]>
  retrieveAgentic?: (query: string, plan: RagQueryPlan, limit: number, options?: AgentRagRuntimeOptions) => Promise<RetrievalSource[]>
  now?: () => number
}

export function createAgentRagRuntime(input: CreateAgentRagRuntimeInput): AgentRagRuntime {
  return {
    buildContextPack: (request: AgentRagContextPackRequest, options?: AgentRagRuntimeOptions) => runAgenticRag({
      query: request.query,
      conversationTitle: request.conversationTitle ?? input.conversationTitle,
      systemPrompt: request.systemPrompt ?? input.systemPrompt,
      settings: input.settings,
      profile: request.profile,
      profileReason: request.profileReason,
      memorySources: input.memorySources,
      retrieveKnowledge: input.retrieveKnowledge,
      retrieveAgentic: input.retrieveAgentic,
      now: input.now,
      tokenBudget: request.tokenBudget,
      maxContextItems: request.maxContextItems,
      signal: options?.signal,
    }),
  }
}
