import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, TextInput, View } from 'react-native'
import { House, Plus, Search, Settings2, X } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/ui/EmptyState'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandHeader, IslandIconButton } from '@/components/ui/IslandPrimitives'
import { ConversationRow } from '@/components/conversations/ConversationRow'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { normalizeSearchText } from '@/utils/text'

interface ConversationsScreenContentProps {
  onHome?: () => void
  onSettings?: () => void
}

export function ConversationsScreenContent({ onHome, onSettings }: ConversationsScreenContentProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const conversations = useChatStore((state) => state.conversations)
  const create = useChatStore((state) => state.create)
  const select = useChatStore((state) => state.select)
  const getPrimaryConfiguredProvider = useSettingsStore((state) => state.getPrimaryConfiguredProvider)
  const [query, setQuery] = useState('')
  const filteredConversations = useMemo(() => {
    const normalized = normalizeSearchText(query)
    if (!normalized) return conversations
    return conversations.filter((conversation) => {
      const haystack = normalizeSearchText([
        conversation.title,
        conversation.providerId,
        conversation.model,
        conversation.systemPrompt,
        ...conversation.messages.map((message) => message.responseText ?? message.content),
      ].join('\n'))
      return haystack.includes(normalized)
    })
  }, [conversations, query])

  async function createConversation() {
    const provider = await getPrimaryConfiguredProvider()
    const model = provider?.models[0]
    if (!provider || !model) {
      if (onSettings) onSettings()
      else router.push('/settings')
      return
    }
    const id = create(provider.id, model)
    select(id)
    if (onHome) onHome()
    else router.push('/')
  }

  function openConversation(id: string) {
    select(id)
    if (onHome) onHome()
    else router.push({ pathname: '/chat/[id]', params: { id } })
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
        <IslandHeader
          title={t('conversation.title')}
          leading={
            onHome ? (
              <IslandIconButton label={t('common.home')} size="lg" onPress={onHome}>
                <House color={colors.text} size={20} strokeWidth={1.9} />
              </IslandIconButton>
            ) : undefined
          }
          trailing={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <IslandIconButton label={t('settings.title')} size="lg" onPress={onSettings ?? (() => router.push('/settings'))}>
                <Settings2 color={colors.text} size={20} strokeWidth={1.9} />
              </IslandIconButton>
              <IslandIconButton label={t('chat.newConversation')} size="lg" tone="ink" onPress={() => void createConversation()}>
                <Plus color={colors.surface} size={22} strokeWidth={2.2} />
              </IslandIconButton>
            </View>
          }
        />
        <View
          style={{
            minHeight: 50,
            borderRadius: 25,
            paddingHorizontal: 14,
            marginTop: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: colors.material.chrome,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Search color={colors.textTertiary} size={18} strokeWidth={1.9} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('conversation.searchConversations')}
            placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, minHeight: 48, color: colors.text, fontSize: 15, fontWeight: '700', padding: 0 }}
          />
          {query.trim() ? (
            <PressableScale
              onPress={() => setQuery('')}
              accessibilityLabel={t('common.clearSearch')}
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textSecondary} size={16} strokeWidth={2} />
            </PressableScale>
          ) : null}
        </View>
      </View>
      <FlatList
        data={filteredConversations}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 30 }}
        ListEmptyComponent={
          query.trim()
            ? <EmptyState title={t('conversation.noSearchResults')} />
            : <EmptyState title={t('conversation.emptyHistory')} actionLabel={t('chat.newConversation')} onAction={() => void createConversation()} />
        }
        renderItem={({ item, index }) => <ConversationRow conversation={item} index={index} onOpen={openConversation} />}
      />
    </View>
  )
}
