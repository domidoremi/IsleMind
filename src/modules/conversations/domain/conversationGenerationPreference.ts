import type { GenerationParameterKey } from '@/core'
import type { ConversationGenerationParameterOverrides, ConversationSnapshot } from './conversationSnapshot'

const parameterKeys = ['temperature', 'topP', 'topK', 'maxTokens'] as const satisfies readonly GenerationParameterKey[]

/** Legacy finite values are explicit; a present override map retains its own meaning. */
export function normalizeConversationGenerationPreferences(
  conversation: Pick<ConversationSnapshot, GenerationParameterKey | 'generationParameterOverrides'>,
): ConversationGenerationParameterOverrides {
  const normalized: Partial<Record<GenerationParameterKey, true>> = {}
  const explicit = Object.hasOwn(conversation, 'generationParameterOverrides')
  for (const key of parameterKeys) {
    if (explicit ? conversation.generationParameterOverrides?.[key] === true
      : typeof conversation[key] === 'number' && Number.isFinite(conversation[key])) normalized[key] = true
  }
  return normalized
}
