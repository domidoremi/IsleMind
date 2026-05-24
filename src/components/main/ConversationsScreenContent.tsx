import { router } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native'
import { House, Plus, Search, X } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IsleEmptyState } from '@/components/ui/isle'
import { IslePressable } from '@/components/ui/isle'
import { IsleHeader, IsleIconButton } from '@/components/ui/isle'
import { ConversationRow } from '@/components/conversations/ConversationRow'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { normalizeSearchText } from '@/utils/text'
import { getProviderPreferredModel } from '@/utils/providerModels'
import type { Conversation } from '@/types'

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
  const listRef = useRef<FlatList<Conversation>>(null)
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
    const model = provider ? getProviderPreferredModel(provider) : undefined
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

  function keepRenameInputVisible(index: number) {
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.32, animated: true })
    })
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
        <IsleHeader
          title={t('conversation.title')}
          leading={
            onHome ? (
              <IsleIconButton label={t('common.home')} size="lg" onPress={onHome}>
                <House color={colors.text} size={20} strokeWidth={1.9} />
              </IsleIconButton>
            ) : undefined
          }
          trailing={
            <IslePressable
              haptic
              accessibilityLabel={t('chat.newConversation')}
              onPress={() => void createConversation()}
              style={{
                width: 50,
                height: 50,
                borderRadius: 25,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                shadowColor: colors.shadowTint,
                shadowOpacity: 0.16,
                shadowRadius: 0,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              <Plus color={colors.primaryForeground} size={22} strokeWidth={2.35} />
            </IslePressable>
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
            returnKeyType="search"
            placeholder={t('conversation.searchConversations')}
            placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, minHeight: 48, color: colors.text, fontSize: 15, fontWeight: '700', padding: 0 }}
          />
          {query.trim() ? (
            <IslePressable
              onPress={() => setQuery('')}
              accessibilityLabel={t('common.clearSearch')}
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textSecondary} size={16} strokeWidth={2} />
            </IslePressable>
          ) : null}
        </View>
      </View>
      <FlatList
        ref={listRef}
        data={filteredConversations}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 30 }}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
        }}
        ListEmptyComponent={
          query.trim()
            ? <IsleEmptyState title={t('conversation.noSearchResults')} />
            : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
                <IsleEmptyState title={t('conversation.emptyHistory')} actionLabel={t('chat.newConversation')} onAction={() => void createConversation()} />
              </View>
            )
        }
        renderItem={({ item, index }) => <ConversationRow conversation={item} index={index} onOpen={openConversation} onRenameFocus={() => keepRenameInputVisible(index)} />}
      />
    </KeyboardAvoidingView>
  )
}
