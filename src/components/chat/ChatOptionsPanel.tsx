import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { Search, X } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { Pill } from '@/components/ui/Pill'
import { PressableScale } from '@/components/ui/PressableScale'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { getModelConfig, getModelName } from '@/types'
import type { AIProvider, Conversation } from '@/types'
import { normalizeSearchText } from '@/utils/text'

export function ChatOptionsPanel({
  conversation,
  provider,
  switchableProviders,
  colors,
  maxHeight,
  onSwitchModel,
  onCopyLink,
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  switchableProviders: AIProvider[]
  colors: ReturnType<typeof useAppTheme>['colors']
  maxHeight: number
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink: () => void
}) {
  const { t } = useTranslation()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const [selectedProviderId, setSelectedProviderId] = useState(provider?.id ?? conversation.providerId)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const currentProvider = provider
  const normalizedQuery = normalizeSearchText(modelPickerQuery)
  const orderedProviders = useMemo(
    () => sortSwitchableProviders(switchableProviders, conversation.providerId, normalizedQuery),
    [conversation.providerId, normalizedQuery, switchableProviders]
  )
  const selectedProvider =
    orderedProviders.find((item) => item.id === selectedProviderId) ??
    currentProvider ??
    orderedProviders[0]
  const visibleProviders = normalizedQuery
    ? orderedProviders.filter((item) => providerMatchesQuery(item, normalizedQuery))
    : orderedProviders.slice(0, 8)
  const selectedModels = selectedProvider
    ? getSwitchableProviderModels(selectedProvider, normalizedQuery)
      .map((id) => ({ id, name: getModelName(id), config: getModelConfig(id, selectedProvider.type, selectedProvider.modelConfigs) }))
    : []
  const selectedProviderIsCurrent = selectedProvider?.id === conversation.providerId
  const capabilities = currentProvider?.capabilities

  useEffect(() => {
    setSelectedProviderId(provider?.id ?? conversation.providerId)
  }, [conversation.providerId, provider?.id])

  useEffect(() => {
    if (!normalizedQuery || !visibleProviders.length) return
    if (!visibleProviders.some((item) => item.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0].id)
    }
  }, [normalizedQuery, selectedProviderId, visibleProviders])

  return (
    <IslandPanel material="chrome" elevated style={{ marginTop: 10, maxHeight }} radius={24} contentStyle={{ padding: 0 }}>
      <ScrollView
        style={{ maxHeight }}
        contentContainerStyle={{ padding: 12, paddingBottom: 14 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <View style={{ minHeight: 42, borderRadius: 21, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
          <Search color={colors.textTertiary} size={15} strokeWidth={2} />
          <TextInput
            value={modelPickerQuery}
            onChangeText={setModelPickerQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('chat.searchProviderOrModel')}
            placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, minHeight: 40, padding: 0, color: colors.text, fontSize: 13, fontWeight: '800' }}
          />
          {modelPickerQuery.trim() ? (
            <PressableScale
              onPress={() => setModelPickerQuery('')}
              accessibilityLabel={t('chat.clearModelSearch')}
              style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textSecondary} size={14} strokeWidth={2.2} />
            </PressableScale>
          ) : null}
        </View>

        <View style={{ gap: 8, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('settings.providerManagement')}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
              {normalizedQuery ? `${visibleProviders.length}/${switchableProviders.length}` : t('chat.countItems', { count: switchableProviders.length })}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {visibleProviders.map((item) => (
              <PressableScale key={item.id} haptic onPress={() => setSelectedProviderId(item.id)}>
                <Pill active={selectedProvider?.id === item.id}>{item.name}{item.enabled ? '' : ` · ${t('settings.disabledState')}`}</Pill>
              </PressableScale>
            ))}
            {!visibleProviders.length ? (
              <View style={{ borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>{t('chat.noProviderModelMatches')}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ gap: 8, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.model')}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
              {selectedProvider?.name ?? t('chat.notSelected')} · {selectedModels.length || t('chat.none')}
            </Text>
          </View>
          {selectedModels.length ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {selectedModels.map((model) => (
                <PressableScale key={model.id} haptic onPress={() => selectedProvider && onSwitchModel(selectedProvider, model.id)}>
                  <Pill active={selectedProviderIsCurrent && conversation.model === model.id}>{model.name}{model.config.deprecated ? ` · ${t('chat.deprecated')}` : ''}</Pill>
                </PressableScale>
              ))}
            </View>
          ) : (
            <View style={{ borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>{t('chat.providerNoModels')}</Text>
            </View>
          )}
        </View>

        <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 8 }}>
          {t('chat.modelSwitchNote')}
        </Text>
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', marginBottom: 6 }}>{t('chat.systemPrompt')}</Text>
          <TextInput
            value={conversation.systemPrompt}
            onChangeText={(systemPrompt) => updateConversation(conversation.id, { systemPrompt })}
            multiline
            placeholder={t('chat.systemPromptExample')}
            placeholderTextColor={colors.textTertiary}
            style={{ minHeight: 72, maxHeight: 128, borderRadius: 18, padding: 12, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 13, lineHeight: 19 }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <PressableScale haptic onPress={onCopyLink} style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('chat.copyConversationLink')}</Text>
          </PressableScale>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <ParamInput
            label="Temperature"
            value={String(conversation.temperature)}
            onChange={(value) => {
              const next = Number(value)
              if (!Number.isNaN(next)) updateConversation(conversation.id, { temperature: Math.max(0, Math.min(2, next)) })
            }}
          />
          <ParamInput
            label="Max Tokens"
            value={String(conversation.maxTokens)}
            onChange={(value) => {
              const next = Number.parseInt(value, 10)
              const config = getModelConfig(conversation.model, currentProvider?.type, currentProvider?.modelConfigs)
              if (!Number.isNaN(next)) updateConversation(conversation.id, { maxTokens: Math.max(128, Math.min(config.maxOutputTokens, next)) })
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {capabilities?.topP !== false ? (
            <ParamInput
              label="Top P"
              value={String(conversation.topP ?? 1)}
              onChange={(value) => {
                const next = Number(value)
                if (!Number.isNaN(next)) updateConversation(conversation.id, { topP: Math.max(0, Math.min(1, next)) })
              }}
            />
          ) : null}
          {capabilities?.reasoningEffort ? (
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{t('chat.reasoning')}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {(['minimal', 'low', 'medium', 'high'] as const).map((effort) => (
                  <PressableScale key={effort} haptic onPress={() => updateConversation(conversation.id, { reasoningEffort: effort })}>
                    <Pill active={(conversation.reasoningEffort ?? 'medium') === effort}>{effort}</Pill>
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </IslandPanel>
  )
}

function getSwitchableProviderModels(provider: AIProvider, query = ''): string[] {
  const groups = provider.credentialGroups ?? []
  const models = Array.from(new Set(provider.models))
    .filter((id) => !groups.length || groups.some((group) => group.enabled && (!group.availableModels?.length || group.availableModels.includes(id))))
  if (!query) return models
  return models.filter((id) => normalizeSearchText(`${id} ${getModelName(id)}`).includes(query))
}

function sortSwitchableProviders(providers: AIProvider[], currentProviderId: string, query: string): AIProvider[] {
  return [...providers].sort((a, b) => {
    const aScore = getProviderPickerScore(a, currentProviderId, query)
    const bScore = getProviderPickerScore(b, currentProviderId, query)
    if (aScore !== bScore) return bScore - aScore
    return a.name.localeCompare(b.name)
  })
}

function getProviderPickerScore(provider: AIProvider, currentProviderId: string, query: string): number {
  let score = 0
  if (provider.id === currentProviderId) score += 120
  if (provider.enabled) score += 32
  const modelCount = getSwitchableProviderModels(provider).length
  score += Math.min(modelCount, 24)
  if (query) {
    if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) score += 80
    if (getSwitchableProviderModels(provider, query).length) score += 48
  }
  return score
}

function providerMatchesQuery(provider: AIProvider, query: string): boolean {
  if (!query) return true
  if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) return true
  return getSwitchableProviderModels(provider, query).length > 0
}

function ParamInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholderTextColor={colors.textTertiary}
        style={{ minHeight: 46, borderRadius: 18, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 14, fontWeight: '700' }}
      />
    </View>
  )
}
