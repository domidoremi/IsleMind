import { useEffect, useMemo, useState } from 'react'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getPolicyPreferredProviderModel } from '@/bootstrap/providerModelAccess'

interface HomeScreenContentProps {
  active?: boolean
  embedded?: boolean
  initialDraft?: string
  initialDraftKey?: string | number
  restoreInitialDraftIfEmpty?: boolean
  requestedOutputMode?: 'auto' | 'reply' | 'work-artifact'
  shellNavigation?: boolean
  topChromeInset?: number
  showSetupEmptyState?: boolean
  settingsTransitionActive?: boolean
  onHistory?: () => void
  onSettings?: () => void
}

export function HomeScreenContent({ active = true, embedded = false, initialDraft, initialDraftKey, restoreInitialDraftIfEmpty, requestedOutputMode = 'auto', shellNavigation = false, topChromeInset = 0, showSetupEmptyState = true, settingsTransitionActive = false, onHistory, onSettings }: HomeScreenContentProps) {
  const conversations = useChatStore((state) => state.conversations)
  const currentId = useChatStore((state) => state.currentId)
  const select = useChatStore((state) => state.select)
  const settings = useSettingsStore((state) => state.settings)
  const defaultProvider = settings.defaultProvider
  const getConfiguredProviders = useSettingsStore((state) => state.getConfiguredProviders)
  const [configuredProviderIds, setConfiguredProviderIds] = useState<string[] | null>(null)
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === currentId) ?? null,
    [conversations, currentId]
  )

  useEffect(() => {
    if (!active) return

    // The setup workspace is an in-memory draft until the first valid send.
    // Do not create a persisted empty conversation just because Home mounted.
    if (!activeConversation) {
      setConfiguredProviderIds(null)
      return
    }

    if (activeConversation && activeConversation.providerId !== 'local-setup') {
      if (activeConversation.id !== currentId) {
        select(activeConversation.id)
      }
      return
    }

    let mounted = true
    setConfiguredProviderIds(null)
    void getConfiguredProviders()
      .then((configuredProviders) => {
        if (!mounted) return
        setConfiguredProviderIds(configuredProviders.map((provider) => provider.id))

        const primary =
          configuredProviders.find((provider) => provider.id === defaultProvider) ??
          configuredProviders[0] ??
          null

        const model = primary ? getPolicyPreferredProviderModel(primary, settings) : undefined
        if (!primary || !model) return

        const existing = conversations.find(
          (conversation) =>
            conversation.providerId === primary.id &&
            conversation.model === model
        )
        if (existing) {
          select(existing.id)
        }
      })
      .catch(() => {
        if (mounted) setConfiguredProviderIds([])
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
    defaultProvider,
    getConfiguredProviders,
    select,
    settings,
    active,
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
      active={active}
      embedded={embedded}
      initialDraft={initialDraft}
      initialDraftKey={initialDraftKey}
      restoreInitialDraftIfEmpty={restoreInitialDraftIfEmpty}
      initialRequestedOutputMode={requestedOutputMode}
      shellNavigation={shellNavigation}
      topChromeInset={topChromeInset}
      showSetupEmptyState={showSetupEmptyState}
      settingsTransitionActive={settingsTransitionActive}
      onHistory={onHistory}
      onSettings={onSettings}
    />
  )
}
