import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Text, TextInput, View } from 'react-native'
import { Plus, Search, Settings2, X } from 'lucide-react-native'
import { Screen } from '@/components/ui/Screen'
import { EmptyState } from '@/components/ui/EmptyState'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandHeader, IslandIconButton } from '@/components/ui/IslandPrimitives'
import { ConversationRow } from '@/components/conversations/ConversationRow'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

export default function ConversationsScreen() {
  const { colors } = useAppTheme()
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
      router.push('/settings')
      return
    }
    const id = create(provider.id, model)
    select(id)
    router.replace('/')
  }

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
        <IslandHeader
          title="历史对话"
          subtitle="IsleMind"
          trailing={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <IslandIconButton label="设置" size="lg" onPress={() => router.push('/settings')}>
                <Settings2 color={colors.text} size={20} strokeWidth={1.9} />
              </IslandIconButton>
              <IslandIconButton label="新建对话" size="lg" tone="ink" onPress={() => void createConversation()}>
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
            placeholder="搜索标题、消息、模型..."
            placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, minHeight: 48, color: colors.text, fontSize: 15, fontWeight: '700', padding: 0 }}
          />
          {query.trim() ? (
            <PressableScale
              onPress={() => setQuery('')}
              accessibilityLabel="清空搜索"
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
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 30 }}
        ListEmptyComponent={
          query.trim()
            ? <EmptyState title="没有找到" description="换一个关键词试试；会搜索对话标题、消息正文和模型 ID。" />
            : <EmptyState title="还没有历史" description="配置服务商后，新建对话会在这里出现。" actionLabel="新建对话" onAction={() => void createConversation()} />
        }
        renderItem={({ item, index }) => <ConversationRow conversation={item} index={index} />}
      />
    </Screen>
  )
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
