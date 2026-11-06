import { buildAssistantContextPlanReceipt, createContextPlanningPolicy, projectContextCapacity } from '@/modules/assistant-runtime'
import { resolveConversationContextSettings, resolveConversationSceneSettings } from '@/modules/conversations'
import { packChatMessages } from './contextPacking'
import { decideRemoteCompact } from './providerRemoteCompact'
import { resolveConversationGenerationParameterRequest, resolveConversationReasoningEffort } from './providerConversationGeneration'
import { resolveProviderModelExecutionProfile } from './providerModelExecutionProfile'
import { estimateTextTokens } from '@/core'
import { buildSystemPrompt } from '@/services/promptEngineering'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

const previewPlanner = createContextPlanningPolicy({
  packChatMessages,
  decideRemoteCompact(input) {
    const decision = decideRemoteCompact(input)
    return decision.strategy === 'application-model-summary'
      ? { ...decision, strategy: 'local-structured-v2' as const, reason: 'harness_admission_required' as const }
      : decision
  },
  estimateTextTokens,
  emitRuntimeEvent: () => undefined,
})

/**
 * Estimate only already-loaded text with the current request configuration.
 * This cannot acquire sources, invoke tools, persist a run, or call a provider.
 */
export function previewDraftContextCapacity(input: {
  conversation: Conversation
  provider: AIProvider | undefined
  settings: Settings
  draft: { ready: boolean; text: string; attachmentCount: number } | undefined
  capturedAt: number
}) {
  const { conversation, provider, draft } = input
  if (!draft?.ready) return { kind: 'draft-unavailable' as const }
  if (!provider || provider.id !== conversation.providerId || !conversation.model) return { kind: 'draft-unbound' as const }
  if (conversation.messages.some(message => message.status === 'streaming' || message.status === 'sending')) {
    return { kind: 'draft-busy' as const }
  }
  const profile = resolveProviderModelExecutionProfile({ provider, model: conversation.model, reasoningEffort: conversation.reasoningEffort })
  const settings = resolveConversationSceneSettings(resolveConversationContextSettings(input.settings, conversation), conversation)
  const parameters = resolveConversationGenerationParameterRequest({ conversation: { ...conversation, model: conversation.model }, provider, model: profile.upstreamModel, modelConfig: profile.modelConfig, settings })
  const messages = conversation.messages
    .filter(message => message.role === 'user' || message.role === 'assistant' && message.status === 'done')
    .map(message => ({ role: message.role as 'user' | 'assistant', content: message.responseText ?? message.content }))
  if (draft.text.trim() || draft.attachmentCount > 0) messages.push({ role: 'user', content: draft.text })
  const plan = previewPlanner.planChatContext({
    messages,
    draft: { text: draft.text },
    provider,
    providerType: provider.type,
    model: profile.upstreamModel,
    modelManifest: profile.modelConfig,
    modelContextWindow: profile.modelConfig.contextWindow,
    maxOutputTokens: parameters.maxTokens,
    reasoningEffort: resolveConversationReasoningEffort(provider, conversation.model, conversation.reasoningEffort),
    systemPrompt: buildSystemPrompt({
      baseSystemPrompt: conversation.systemPrompt, language: settings.language, modelConfig: profile.modelConfig,
      provider, hasMemory: false, hasKnowledge: false, hasWeb: false, retrievalSources: [],
    }),
    usesOpenAIResponses: profile.adapter.protocol === 'openai-responses',
    settings,
    attachmentCount: draft.attachmentCount + conversation.messages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0),
  })
  const receipt = buildAssistantContextPlanReceipt({
    providerId: provider.id, model: profile.upstreamModel, conversationId: conversation.id,
    plan, activePrompt: plan.packed, settings, conversation,
  })
  // An absent window or inferred family default cannot establish a capacity or overrun.
  const hasKnownWindow = profile.modelConfig.source !== 'inferred'
    && Number.isFinite(profile.modelConfig.contextWindow) && profile.modelConfig.contextWindow > 0
  const previewReceipt = hasKnownWindow ? receipt : {
    ...receipt,
    budget: { ...receipt.budget, modelContextWindow: 0 },
    failureCodes: receipt.failureCodes.filter(code => code !== 'context_budget_overrun'),
  }
  return {
    kind: 'ready' as const,
    view: projectContextCapacity({ runId: `draft:${conversation.id}`, capturedAt: input.capturedAt, receipt: previewReceipt }),
    requestedModel: conversation.model,
    draftCharacters: Array.from(draft.text).length,
  }
}

export type DraftContextCapacityResult = ReturnType<typeof previewDraftContextCapacity>
