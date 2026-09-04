import type { TFunction } from 'i18next'

import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { useSettingsStore } from '@/store/settingsStore'
import { isConversationLocked } from '@/services/conversationLock'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import type { ModelAccessSettings } from './chatModelSelection'
import { resolveChatModelDisplayName } from './chatIdentityPresentation'

type ChatModelActionDialog = {
  toast: (options: { title: string; message?: string; tone: 'mint' | 'amber' }) => void
}

export function confirmConversationModelSwitch({
  activeConversation,
  dialog,
  modelAccessSettings,
  nextModel,
  nextProvider,
  setShowOptions,
  stopStreaming,
  switchConversationModel,
  t,
}: {
  activeConversation: Conversation
  dialog: ChatModelActionDialog
  modelAccessSettings: ModelAccessSettings
  nextModel: string
  nextProvider: AIProvider
  setShowOptions: (showOptions: boolean) => void
  stopStreaming: (conversationId: string) => void
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  t: TFunction
}): boolean {
  if (isConversationLocked(activeConversation.id)) return false
  if (nextProvider.id === activeConversation.providerId && nextModel === activeConversation.model) return false
  const access = resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings: modelAccessSettings })
  if (!access.allowed) return false

  void (async () => {
    stopStreaming(activeConversation.id)
    const switched = switchConversationModel(activeConversation.id, nextProvider.id, nextModel)
    if (!switched) return
    setShowOptions(false)
    dialog.toast({
      title: t('chat.modelSwitched'),
      message: `${resolveProviderDisplayName(nextProvider, t('providerSettings.customProvider'))} · ${resolveChatModelDisplayName(nextProvider, nextModel, useSettingsStore.getState().settings.modelDisplayAliases)}`,
      tone: 'mint',
    })
  })()
  return true
}
