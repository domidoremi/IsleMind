import type {
  RagContextPack,
  RagQueryPlan,
  RetrievalSource,
} from '@/types/contextContracts'
import type { RagProfile, Settings } from '@/types/settingsContracts'
import { runAgenticRag } from './ragOrchestration'

export interface ConversationRagContextPackRequest {
  query: string
  conversationTitle?: string
  systemPrompt?: string
  profile?: RagProfile
  profileReason?: string
  tokenBudget?: number
  maxContextItems?: number
}

export interface ConversationRagRuntimeOptions {
  signal?: AbortSignal
}

export interface ConversationRagRuntime {
  buildContextPack(
    request: ConversationRagContextPackRequest,
    options?: ConversationRagRuntimeOptions,
  ): Promise<RagContextPack>
}

export interface CreateConversationRagRuntimeInput {
  settings: Settings
  conversationTitle?: string
  systemPrompt?: string
  memorySources?: RetrievalSource[]
  retrieveKnowledge(
    query: string,
    limit: number,
    options?: ConversationRagRuntimeOptions,
  ): Promise<RetrievalSource[]>
  retrieveAgentic?(
    query: string,
    plan: RagQueryPlan,
    limit: number,
    options?: ConversationRagRuntimeOptions,
  ): Promise<RetrievalSource[]>
  now?: () => number
}

export function createConversationRagRuntime(input: CreateConversationRagRuntimeInput): ConversationRagRuntime {
  return {
    buildContextPack: (request, options) => runAgenticRag({
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
