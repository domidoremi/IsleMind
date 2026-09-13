import type { TFunction } from 'i18next'

import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { useSettingsStore } from '@/store/settingsStore'
import { isConversationLocked } from '@/services/conversationLock'
import { hasActiveStream } from '@/services/chatStreamLifecycle'
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
  switchConversationModel,
  t,
}: {
  activeConversation: Conversation
  dialog: ChatModelActionDialog
  modelAccessSettings: ModelAccessSettings
  nextModel: string
  nextProvider: AIProvider
  setShowOptions: (showOptions: boolean) => void
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  t: TFunction
}): boolean {
  if (isConversationLocked(activeConversation.id) || hasActiveStream(activeConversation.id)) return false
  const access = resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings: modelAccessSettings })
  if (!access.allowed) return false

  const switched = switchConversationModel(activeConversation.id, nextProvider.id, nextModel)
  if (!switched) return false
  setShowOptions(false)
  dialog.toast({
    title: t('chat.modelSwitched'),
    message: `${resolveProviderDisplayName(nextProvider, t('providerSettings.customProvider'))} · ${resolveChatModelDisplayName(nextProvider, nextModel, useSettingsStore.getState().settings.modelDisplayAliases)}`,
    tone: 'mint',
  })
  return true
}
