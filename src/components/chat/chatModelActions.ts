import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { isConversationLocked } from '@/services/conversationLock'
import { hasActiveStream } from '@/services/chatStreamLifecycle'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import type { ModelAccessSettings } from './chatModelSelection'
export function confirmConversationModelSwitch({
  activeConversation,
  modelAccessSettings,
  nextModel,
  nextProvider,
  routingPlan,
  setShowOptions,
  switchConversationModel,
}: {
  activeConversation: Conversation
  modelAccessSettings: ModelAccessSettings
  nextModel: string
  nextProvider: AIProvider
  routingPlan?: Conversation['routingPlan']
  setShowOptions: (showOptions: boolean) => void
  switchConversationModel: (id: string, providerId: string, model: string, options?: { routingPlan?: Conversation['routingPlan'] }) => boolean
}): boolean {
  if (isConversationLocked(activeConversation.id) || hasActiveStream(activeConversation.id)) return false
  const access = resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings: modelAccessSettings })
  if (!access.allowed) return false

  const switched = routingPlan ? switchConversationModel(activeConversation.id, nextProvider.id, nextModel, { routingPlan })
    : switchConversationModel(activeConversation.id, nextProvider.id, nextModel)
  if (!switched) return false
  setShowOptions(false)
  return true
}
