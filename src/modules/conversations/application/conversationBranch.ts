import type { Conversation, Message } from '@/types/chatContracts'

/**
 * A branch is a new Chat draft, not a copied run or workflow. Only transcript
 * content and AI configuration cross this boundary; Send retains its existing
 * durability/permission barriers. The source record is never mutated.
 */
export function createConversationBranchDraft(
  source: Conversation,
  throughMessageId: string,
  identity: { id: string; title: string; now: number },
): Conversation | null {
  const end = source.messages.findIndex(message => message.id === throughMessageId)
  if (end < 0 || !identity.id || identity.id === source.id) return null
  const prefix = source.messages.slice(0, end + 1)
  if (prefix.some(message => message.status === 'sending' || message.status === 'streaming')) return null

  const messages = prefix.map<Message>((message, index) => ({
    id: `${identity.id}-history-${index}`,
    role: message.role,
    content: message.content,
    responseText: message.responseText,
    providerId: message.providerId,
    model: message.model,
    timestamp: message.timestamp,
    status: message.status,
    errorCode: message.errorCode,
    errorProviderId: message.errorProviderId,
    attachments: message.attachments?.map(attachment => ({ ...attachment })),
    citations: message.citations?.map(citation => ({
      ...citation,
      ...(citation.headingPath ? { headingPath: [...citation.headingPath] } : {}),
    })),
    // No traces, pending confirmations, lifecycle/run identities or usage:
    // copied history must not advertise replay authority or double-count cost.
  }))

  return {
    id: identity.id,
    title: identity.title,
    providerId: source.providerId,
    model: source.model,
    providerModelMode: source.providerModelMode,
    systemPrompt: source.systemPrompt,
    temperature: source.temperature,
    topP: source.topP,
    topK: source.topK,
    reasoningEffort: source.reasoningEffort,
    maxTokens: source.maxTokens,
    ...(source.generationParameterOverrides !== undefined
      ? { generationParameterOverrides: { ...source.generationParameterOverrides } }
      : {}),
    skillIds: source.skillIds ? [...source.skillIds] : undefined,
    skillSnapshot: source.skillSnapshot ? {
      ...source.skillSnapshot,
      skillIds: [...source.skillSnapshot.skillIds],
      names: [...source.skillSnapshot.names],
      variables: { ...source.skillSnapshot.variables },
      enabledTools: source.skillSnapshot.enabledTools ? [...source.skillSnapshot.enabledTools] : undefined,
      knowledgeSources: source.skillSnapshot.knowledgeSources ? [...source.skillSnapshot.knowledgeSources] : undefined,
    } : undefined,
    enabledTools: source.enabledTools ? [...source.enabledTools] : undefined,
    knowledgeSources: source.knowledgeSources ? [...source.knowledgeSources] : undefined,
    // Workspace/command bindings and conversation-scoped memory stay with the
    // source conversation. A new conversation ID cannot inherit their authority.
    messages,
    createdAt: identity.now,
    updatedAt: identity.now,
  }
}
