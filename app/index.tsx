import { useEffect, useMemo, useRef, useState } from 'react'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

export default function HomeScreen() {
  const conversations = useChatStore((state) => state.conversations)
  const currentId = useChatStore((state) => state.currentId)
  const create = useChatStore((state) => state.create)
  const select = useChatStore((state) => state.select)
  const defaultProvider = useSettingsStore((state) => state.settings.defaultProvider)
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

      if (!primary?.models[0]) return

      const existing = conversations.find(
        (conversation) =>
          conversation.providerId === primary.id &&
          primary.models.includes(conversation.model)
      )
      if (existing) {
        select(existing.id)
      } else {
        create(primary.id, primary.models[0])
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
  ])

  const visibleConversation = useMemo(() => {
    if (!activeConversation) return null
    if (activeConversation.providerId === 'local-setup') {
      return configuredProviderIds?.length ? null : activeConversation
    }
    return activeConversation
  }, [activeConversation, configuredProviderIds])

  return <ChatWorkspace conversation={visibleConversation} />
}
