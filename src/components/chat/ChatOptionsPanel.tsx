import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { Search, X } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IslePanel } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { getModelConfig } from '@/types'
import type { AIProvider, Conversation } from '@/types'
import { normalizeSearchText } from '@/utils/text'
import { getReasoningEffortOptions } from '@/utils/modelReasoning'
import { getProviderDisplayModel, getProviderSelectableModels, resolveProviderModelAlias } from '@/utils/providerModels'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

export function ChatOptionsPanel({
  conversation,
  provider,
  switchableProviders,
  colors,
  maxHeight,
  onSwitchModel,
  onCopyLink,
  onClose,
  onDraftChange,
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  switchableProviders: AIProvider[]
  colors: ReturnType<typeof useAppTheme>['colors']
  maxHeight: number
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink: () => void
  onClose: () => void
  onDraftChange?: (updates: Partial<Pick<Conversation, 'systemPrompt' | 'temperature' | 'topP' | 'reasoningEffort' | 'maxTokens'>>) => void
}) {
  const { t } = useTranslation()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const motion = useMotionPreference()
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
    : orderedProviders
  const selectedModels = selectedProvider
      ? getSwitchableProviderModels(selectedProvider, normalizedQuery)
      .map((id) => {
        const upstreamModel = resolveProviderModelAlias(selectedProvider, id)
        return { id, name: getProviderDisplayModel(selectedProvider, id), config: getModelConfig(upstreamModel, selectedProvider.type, selectedProvider.modelConfigs) }
      })
    : []
  const selectedProviderIsCurrent = selectedProvider?.id === conversation.providerId
  const capabilities = currentProvider?.capabilities
  const reasoningOptions = getReasoningEffortOptions(currentProvider, conversation.model)
  const compactPicker = windowWidth < 430 || windowHeight < 620
  const panelBodyMaxHeight = Math.max(250, maxHeight - 104)
  const panelWidth = windowWidth >= 900
    ? Math.min(720, Math.round(windowWidth * 0.7))
    : Math.min(windowWidth - 24, Math.max(320, Math.round(windowWidth * 0.92)))
  const bodyVerticalPadding = 26
  const panelHeaderReserve = 128
  const pickerHeaderReserve = 30
  const systemPromptReserve = compactPicker ? 102 : 116
  const copyLinkReserve = 52
  const primaryParamReserve = 79
  const secondaryParamReserve = capabilities?.topP !== false || reasoningOptions.length ? 79 : 10
  const lowerControlsReserve = systemPromptReserve + copyLinkReserve + primaryParamReserve + secondaryParamReserve
  const pickerRowMaxHeight = Math.max(compactPicker ? 126 : 132, Math.min(compactPicker ? 210 : 210, maxHeight - panelHeaderReserve - bodyVerticalPadding - lowerControlsReserve))
  const pickerListMaxHeight = Math.max(52, pickerRowMaxHeight - pickerHeaderReserve)
  const compactProviderMaxHeight = Math.max(52, Math.min(150, Math.floor((pickerRowMaxHeight - 12) * 0.42)))
  const compactModelMaxHeight = Math.max(64, Math.min(190, pickerRowMaxHeight - compactProviderMaxHeight - 12))
  const providerListMinHeight = visibleProviders.length ? (compactPicker ? 52 : 108) : (compactPicker ? 52 : 64)
  const modelListMinHeight = selectedModels.length ? (compactPicker ? 64 : 132) : (compactPicker ? 64 : 76)
  const providerListHeight = clampListHeight(
    visibleProviders.length,
    Math.min(providerListMinHeight, compactPicker ? compactProviderMaxHeight : pickerListMaxHeight),
    compactPicker ? compactProviderMaxHeight : pickerListMaxHeight,
    1,
  )
  const modelListHeight = clampListHeight(
    selectedModels.length,
    Math.min(modelListMinHeight, compactPicker ? compactModelMaxHeight : pickerListMaxHeight),
    compactPicker ? compactModelMaxHeight : pickerListMaxHeight,
    2,
  )
  const pickerFloor = visibleProviders.length || selectedModels.length ? Math.min(156, pickerRowMaxHeight) : 132
  const pickerMinHeight = compactPicker ? undefined : Math.max(pickerFloor, Math.min(pickerRowMaxHeight, Math.max(providerListHeight, modelListHeight) + pickerHeaderReserve))

  useEffect(() => {
    setSelectedProviderId(provider?.id ?? conversation.providerId)
  }, [conversation.providerId, provider?.id])

  useEffect(() => {
    if (visibleProviders.some((item) => item.id === selectedProviderId)) return
    if (currentProvider && visibleProviders.some((item) => item.id === currentProvider.id)) {
      setSelectedProviderId(currentProvider.id)
      return
    }
    if (visibleProviders.length) {
      setSelectedProviderId(visibleProviders[0].id)
    }
  }, [currentProvider, selectedProviderId, visibleProviders])

  function patchConversation(updates: Partial<Pick<Conversation, 'systemPrompt' | 'temperature' | 'topP' | 'reasoningEffort' | 'maxTokens'>>) {
    if (onDraftChange) {
      onDraftChange(updates)
      return
    }
    updateConversation(conversation.id, updates)
  }

  return (
    <IslePanel material="paper" elevated style={{ alignSelf: 'center', width: panelWidth, maxWidth: '100%', marginTop: 10, maxHeight, borderWidth: 1, borderColor: colors.borderStrong }} radius={24} contentStyle={{ padding: 0, backgroundColor: colors.paper }}>
      <View style={{ padding: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{t('chat.model')}</Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800', marginTop: 2 }}>{t('chat.modelPickerSubtitle')}</Text>
          </View>
          <IslePressable
            haptic
            onPress={onClose}
            accessibilityLabel={t('chat.closeModelMenu')}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}
          >
            <X color={colors.textSecondary} size={16} strokeWidth={2.2} />
          </IslePressable>
        </View>
        <View style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
          <Search color={colors.textTertiary} size={15} strokeWidth={2} />
          <TextInput
            value={modelPickerQuery}
            onChangeText={setModelPickerQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('chat.searchProviderOrModel')}
            placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, minHeight: 44, padding: 0, color: colors.text, fontSize: 13, fontWeight: '800' }}
          />
          {modelPickerQuery.trim() ? (
            <IslePressable
              onPress={() => setModelPickerQuery('')}
              accessibilityLabel={t('chat.clearModelSearch')}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textSecondary} size={14} strokeWidth={2.2} />
            </IslePressable>
          ) : null}
        </View>
      </View>

      <View style={{ maxHeight: panelBodyMaxHeight, padding: 12, paddingBottom: 14 }}>
        <View style={{ flexDirection: compactPicker ? 'column' : 'row', gap: 12, alignItems: 'stretch', minHeight: pickerMinHeight }}>
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateX: -8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{ flex: compactPicker ? undefined : 0.42, minWidth: compactPicker ? undefined : 0, gap: 8 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('settings.providerManagement')}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
                {normalizedQuery ? `${visibleProviders.length}/${switchableProviders.length}` : t('chat.countItems', { count: switchableProviders.length })}
              </Text>
            </View>
            {visibleProviders.length ? (
              <ScrollView
                style={{ flexGrow: 0, height: providerListHeight }}
                contentContainerStyle={{ gap: 8 }}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {visibleProviders.map((item) => (
                  <IslePressable
                    key={item.id}
                    haptic
                    onPress={() => setSelectedProviderId(item.id)}
                    accessibilityLabel={`${item.name}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`}
                  >
                    <PickerChip
                      active={selectedProvider?.id === item.id}
                      label={`${item.name}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`}
                      maxWidth={compactPicker ? panelWidth - 48 : Math.max(112, panelWidth * 0.34)}
                    />
                  </IslePressable>
                ))}
              </ScrollView>
            ) : (
              <View style={{ minHeight: providerListHeight, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>{t('chat.noProviderModelMatches')}</Text>
              </View>
            )}
          </MotiView>

          <MotiView
            from={motion === 'full' ? { opacity: 0, translateX: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle, delay: 35 } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{ flex: 1, minWidth: 0, gap: 8 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.model')}</Text>
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', flexShrink: 1 }}>
                {selectedProvider?.name ?? t('chat.notSelected')} · {selectedModels.length || t('chat.none')}
              </Text>
            </View>
            {selectedModels.length ? (
              <ScrollView
                style={{ flexGrow: 0, height: modelListHeight }}
                contentContainerStyle={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingRight: 4, paddingBottom: 2 }}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {selectedModels.map((model) => (
                  <IslePressable
                    key={model.id}
                    haptic
                    onPress={() => selectedProvider && onSwitchModel(selectedProvider, model.id)}
                    accessibilityLabel={`${model.name}${model.config.deprecated ? ` · ${t('chat.deprecated')}` : ''}`}
                  >
                    <PickerChip
                      active={selectedProviderIsCurrent && conversation.model === model.id}
                      label={`${model.name}${model.config.deprecated ? ` · ${t('chat.deprecated')}` : ''}`}
                      maxWidth={compactPicker ? panelWidth - 48 : Math.max(128, panelWidth * 0.42)}
                    />
                  </IslePressable>
                ))}
              </ScrollView>
            ) : (
              <View style={{ minHeight: modelListHeight, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>{t('chat.providerNoModelsSyncHint')}</Text>
              </View>
            )}
          </MotiView>
        </View>

        <View style={{ marginTop: 10 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', marginBottom: 6 }}>{t('chat.systemPrompt')}</Text>
          <TextInput
            value={conversation.systemPrompt}
            onChangeText={(systemPrompt) => patchConversation({ systemPrompt })}
            multiline
            placeholder={t('chat.systemPromptExample')}
            placeholderTextColor={colors.textTertiary}
            style={{ minHeight: compactPicker ? 68 : 82, maxHeight: 136, borderRadius: 18, padding: 12, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <IslePressable haptic onPress={onCopyLink} style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('chat.copyConversationLink')}</Text>
          </IslePressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <ParamInput
            label="Temperature"
            value={String(conversation.temperature)}
            onChange={(value) => {
              const next = Number(value)
              if (!Number.isNaN(next)) patchConversation({ temperature: Math.max(0, Math.min(2, next)) })
            }}
          />
          <ParamInput
            label="Max Tokens"
            value={String(conversation.maxTokens)}
            onChange={(value) => {
              const next = Number.parseInt(value, 10)
              const upstreamModel = currentProvider ? resolveProviderModelAlias(currentProvider, conversation.model) : conversation.model
              const config = getModelConfig(upstreamModel, currentProvider?.type, currentProvider?.modelConfigs)
              if (!Number.isNaN(next)) patchConversation({ maxTokens: Math.max(128, Math.min(config.maxOutputTokens, next)) })
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
                if (!Number.isNaN(next)) patchConversation({ topP: Math.max(0, Math.min(1, next)) })
              }}
            />
          ) : null}
          {reasoningOptions.length ? (
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{t('chat.reasoning')}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {reasoningOptions.map((effort) => (
                  <IslePressable key={effort} haptic onPress={() => patchConversation({ reasoningEffort: effort })}>
                    <IsleChip active={(conversation.reasoningEffort ?? 'medium') === effort}>{t(`chat.reasoningEffort.${effort}`)}</IsleChip>
                  </IslePressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </IslePanel>
  )
}

function clampListHeight(count: number, minHeight: number, maxHeight: number, columns: number): number {
  if (count <= 0) return minHeight
  const estimated = Math.ceil(count / Math.max(1, columns)) * 40 + 8
  return Math.round(Math.max(minHeight, Math.min(maxHeight, estimated)))
}

function PickerChip({ label, active, maxWidth }: { label: string; active: boolean; maxWidth: number }) {
  const { colors } = useAppTheme()
  return (
    <View
      style={{
        maxWidth,
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        backgroundColor: active ? colors.text : colors.islandRaised,
        borderWidth: active ? 0 : 1,
        borderColor: colors.border,
      }}
    >
      <Text numberOfLines={1} ellipsizeMode="tail" style={{ maxWidth: Math.max(24, maxWidth - 22), color: active ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '900' }}>
        {label}
      </Text>
    </View>
  )
}

function getSwitchableProviderModels(provider: AIProvider, query = ''): string[] {
  const models = getProviderSelectableModels(provider)
    .filter((id) => getModelConfig(resolveProviderModelAlias(provider, id), provider.type, provider.modelConfigs).chatCompatible !== false)
  if (!query) return models
  return models.filter((id) => normalizeSearchText(`${id} ${getProviderDisplayModel(provider, id)} ${resolveProviderModelAlias(provider, id)}`).includes(query))
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
        accessibilityLabel={label}
        placeholderTextColor={colors.textTertiary}
        style={{ minHeight: 46, borderRadius: 18, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 14, fontWeight: '700' }}
      />
    </View>
  )
}
