import { useEffect, useMemo, useState } from 'react'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getPolicyPreferredProviderModel } from '@/services/ai/policy/providerModelAccess'

interface HomeScreenContentProps {
  embedded?: boolean
  initialDraft?: string
  initialDraftKey?: string | number
  onHistory?: () => void
  onSettings?: () => void
}

export function HomeScreenContent({ embedded = false, initialDraft, initialDraftKey, onHistory, onSettings }: HomeScreenContentProps) {
  const conversations = useChatStore((state) => state.conversations)
  const currentId = useChatStore((state) => state.currentId)
  const create = useChatStore((state) => state.create)
  const select = useChatStore((state) => state.select)
  const settings = useSettingsStore((state) => state.settings)
  const defaultProvider = settings.defaultProvider
  const getConfiguredProviders = useSettingsStore((state) => state.getConfiguredProviders)
  const [configuredProviderIds, setConfiguredProviderIds] = useState<string[] | null>(null)
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === currentId) ?? conversations[0] ?? null,
    [conversations, currentId]
  )

  useEffect(() => {
    let mounted = true
    void getConfiguredProviders().then((configuredProviders) => {
      if (!mounted) return
      setConfiguredProviderIds(configuredProviders.map((provider) => provider.id))

      const primary =
        configuredProviders.find((provider) => provider.id === defaultProvider) ??
        configuredProviders[0] ??
        null

      if (activeConversation && activeConversation.providerId !== 'local-setup') {
        if (activeConversation.id !== currentId) {
          select(activeConversation.id)
        }
        return
      }

      const model = primary ? getPolicyPreferredProviderModel(primary, settings) : undefined
      if (!primary || !model) return

      const existing = conversations.find(
        (conversation) =>
          conversation.providerId === primary.id &&
          conversation.model === model
      )
      if (existing) {
        select(existing.id)
      } else {
        create(primary.id, model)
      }
    })
    return () => {
      mounted = false
    }
  }, [
    activeConversation?.id,
    activeConversation?.providerId,
    activeConversation?.model,
    conversations.length,
    currentId,
    create,
    defaultProvider,
    getConfiguredProviders,
    select,
    settings,
  ])

  const visibleConversation = useMemo(() => {
    if (!activeConversation) return null
    if (activeConversation.providerId === 'local-setup') {
      return configuredProviderIds?.length ? null : activeConversation
    }
    return activeConversation
  }, [activeConversation, configuredProviderIds])

  return (
    <ChatWorkspace
      conversation={visibleConversation}
      embedded={embedded}
      initialDraft={initialDraft}
      initialDraftKey={initialDraftKey}
      onHistory={onHistory}
      onSettings={onSettings}
    />
  )
}
