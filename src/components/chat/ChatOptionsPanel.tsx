import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePanel } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { getModelConfig } from '@/types'
import type { AIModel, AIProvider, Conversation } from '@/types'
import { normalizeSearchText } from '@/utils/text'
import { getReasoningControlOptions, getReasoningControlValue, getReasoningEffortOptions, modelSupportsSamplingControls, resolveReasoningControlValue } from '@/utils/modelReasoning'
import { getProviderDisplayModel, resolveProviderModelAlias } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels, getProviderModelDisplayCandidates, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'
import { resolveProviderRequestParameters } from '@/services/ai/providerRequestParameters'
import { resolveConversationGenerationParameterRanges } from '@/services/ai/conversationGenerationParameters'
import { providerSupportsNativeSearch, providerSupportsVisionInput, resolveProviderNativeToolSupport } from '@/services/chatProviderNativeToolUtils'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface ModelPickerItem {
  id: string
  name: string
  subtitle?: string
  badges: ModelCapabilityBadge[]
}

interface ModelPickerGroup {
  id: string
  label: string
  models: ModelPickerItem[]
}

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
  settings,
  placement = 'popover',
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  switchableProviders: AIProvider[]
  colors: ReturnType<typeof useAppTheme>['colors']
  maxHeight: number
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink: () => void
  onClose: () => void
  onDraftChange?: (updates: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens'>>) => void
  settings?: ProviderModelAccessInput['settings']
  placement?: 'popover' | 'sheet'
}) {
  const { t } = useTranslation()
  const { isGlass, isCartoon } = useAppTheme()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const motion = useMotionPreference()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const [selectedProviderId, setSelectedProviderId] = useState(provider?.id ?? conversation.providerId)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const currentProvider = provider
  const normalizedQuery = normalizeSearchText(modelPickerQuery)
  const policySwitchableProviders = useMemo(
    () => getProviderModelDisplayCandidates({ providers: switchableProviders, settings }).map((candidate) => candidate.provider),
    [settings, switchableProviders]
  )
  const orderedProviders = useMemo(
    () => sortSwitchableProviders(policySwitchableProviders, conversation.providerId, normalizedQuery, settings),
    [conversation.providerId, normalizedQuery, policySwitchableProviders, settings]
  )
  const selectedProvider =
    orderedProviders.find((item) => item.id === selectedProviderId) ??
    orderedProviders[0]
  const visibleProviders = normalizedQuery
    ? orderedProviders.filter((item) => providerMatchesQuery(item, normalizedQuery, settings))
    : orderedProviders
  const selectedModels = selectedProvider
    ? disambiguateModelPickerItems(getSwitchableProviderModels(selectedProvider, normalizedQuery, settings)
      .map((id) => {
        const upstreamModel = resolveProviderModelAlias(selectedProvider, id)
        const config = getModelConfig(upstreamModel, selectedProvider.type, selectedProvider.modelConfigs)
        return {
          id,
          name: getProviderDisplayModel(selectedProvider, id),
          badges: getModelCapabilityBadges(selectedProvider, upstreamModel, config, t),
        }
      }))
    : []
  const selectedModelGroups = selectedProvider ? groupModelPickerItemsByToken(selectedProvider, selectedModels, t) : []
  const noSwitchableProviderCandidates = policySwitchableProviders.length === 0
  const showPickerEmptyState = noSwitchableProviderCandidates || (normalizedQuery.length > 0 && visibleProviders.length === 0 && selectedModels.length === 0)
  const pickerEmptyTitle = noSwitchableProviderCandidates
    ? switchableProviders.length ? t('chat.noAvailableModels') : t('chat.noProviderConnected')
    : t('chat.noProviderModelMatches')
  const pickerEmptyDescription = noSwitchableProviderCandidates
    ? switchableProviders.length ? t('chat.syncModelsBeforeChat') : t('chat.configureProviderBeforeChat')
    : t('chat.noProviderModelMatchesDescription')
  const modelEmptyTitle = selectedProvider ? t('chat.noModelsForSelectedProvider', { provider: selectedProvider.name }) : t('chat.noAvailableModels')
  const selectedProviderIsCurrent = selectedProvider?.id === conversation.providerId
  const reasoningModel = currentProvider ? resolveProviderModelAlias(currentProvider, conversation.model) : conversation.model
  const reasoningOptions = getReasoningEffortOptions(currentProvider, reasoningModel)
  const reasoningControlOptions = getReasoningControlOptions(reasoningOptions)
  const selectedReasoningControlValue = getReasoningControlValue(conversation.reasoningEffort)
  const currentModelConfig = getModelConfig(reasoningModel, currentProvider?.type, currentProvider?.modelConfigs)
  const currentCapabilityBadges = currentProvider ? getModelCapabilityBadges(currentProvider, reasoningModel, currentModelConfig, t) : []
  const samplingControlsSupported = modelSupportsSamplingControls(currentProvider, reasoningModel, conversation.reasoningEffort)
  const requestParameters = currentProvider ? resolveProviderRequestParameters({
    provider: currentProvider,
    model: reasoningModel,
    reasoningEffort: conversation.reasoningEffort,
    temperature: conversation.temperature,
    topP: conversation.topP,
    topK: conversation.topK,
    maxTokens: conversation.maxTokens,
  }, { includeRanges: true }) : undefined
  const conversationParameterRanges = resolveConversationGenerationParameterRanges({
    provider: currentProvider,
    model: reasoningModel,
    reasoningEffort: conversation.reasoningEffort,
    temperature: conversation.temperature,
    topP: conversation.topP,
    topK: conversation.topK,
    maxTokens: conversation.maxTokens,
    modelConfig: currentModelConfig,
  })
  const showTemperatureControl = requestParameters?.temperatureSupported ?? samplingControlsSupported
  const showMaxTokensControl = requestParameters?.maxTokens !== undefined
  const showTopPControl = requestParameters?.topPSupported ?? false
  const showTopKControl = requestParameters?.topKSupported ?? false
  const temperatureRange = requestParameters?.temperatureRange ?? conversationParameterRanges.temperature
  const topPRange = requestParameters?.topPRange ?? conversationParameterRanges.topP
  const topKRange = requestParameters?.topKRange ?? conversationParameterRanges.topK
  const maxTokensRange = requestParameters?.maxTokensRange ?? conversationParameterRanges.maxTokens
  const compactPicker = windowWidth < 430 || windowHeight < 620
  const sheetMode = placement === 'sheet'
  const panelBodyMaxHeight = Math.max(250, maxHeight - 104)
  const panelWidth = sheetMode
    ? Math.min(windowWidth - 24, Math.max(320, windowWidth - 24))
    : windowWidth >= 900
    ? Math.min(720, Math.round(windowWidth * 0.7))
    : Math.min(windowWidth - 24, Math.max(320, Math.round(windowWidth * 0.92)))
  const bodyVerticalPadding = 26
  const panelHeaderReserve = 128
  const pickerHeaderReserve = 30
  const copyLinkReserve = 52
  const primaryParamReserve = showTemperatureControl || showMaxTokensControl ? 79 : 0
  const secondaryParamReserve = showTopPControl || showTopKControl || reasoningOptions.length ? 90 : 10
  const lowerControlsReserve = copyLinkReserve + primaryParamReserve + secondaryParamReserve
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
  const pickerEmptyMinHeight = compactPicker ? 108 : Math.max(116, pickerMinHeight ?? 116)
  const panelRadius = sheetMode ? colors.ui.radius.modal : colors.ui.radius.panel
  const fieldRadius = colors.ui.radius.field
  const controlRadius = colors.ui.radius.controlLarge
  const sheetMaterial = colors.material.sheet
  const panelSurface = sheetMode ? sheetMaterial.surface : isGlass ? colors.ui.semantic.chrome.background : isCartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const panelBody = sheetMode ? sheetMaterial.body : isGlass ? colors.ui.actionBar.itemBackground : isCartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const panelChrome = sheetMode ? sheetMaterial.chrome : isGlass ? colors.ui.semantic.chrome.toolbar : isCartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base
  const panelBorder = sheetMode ? sheetMaterial.border : isCartoon ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const panelDivider = sheetMode ? sheetMaterial.divider : colors.ui.section.divider
  const actionSurface = isGlass ? colors.ui.actionBar.itemBackground : isCartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const actionBorder = isCartoon ? colors.material.stroke : colors.ui.semantic.chrome.border
  const subtleBorderWidth = isCartoon ? 1 : StyleSheet.hairlineWidth

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

  function patchConversation(updates: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens'>>) {
    if (onDraftChange) {
      onDraftChange(updates)
      return
    }
    updateConversation(conversation.id, updates)
  }

  return (
    <IslePanel material={sheetMode || isGlass ? 'chrome' : 'paper'} intensity={isGlass ? 44 : 30} elevated={false} style={{ alignSelf: 'center', width: panelWidth, maxWidth: '100%', marginTop: sheetMode ? 0 : 10, maxHeight, borderWidth: subtleBorderWidth, borderColor: panelBorder, backgroundColor: panelSurface }} radius={panelRadius} contentStyle={{ padding: 0, backgroundColor: panelBody }}>
      <View style={{ padding: 12, paddingBottom: 10, borderBottomWidth: subtleBorderWidth, borderBottomColor: panelDivider, backgroundColor: panelChrome }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{t('chat.model')}</Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800', marginTop: 2 }}>{t('chat.modelPickerSubtitle')}</Text>
          </View>
          <IslePressable
            haptic
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('chat.closeModelMenu')}
            accessibilityHint={t('chat.closeModelMenuHint')}
            hitSlop={MODEL_MENU_ACTION_HIT_SLOP}
            style={{ width: 44, height: 44, borderRadius: controlRadius, alignItems: 'center', justifyContent: 'center', backgroundColor: actionSurface, borderWidth: subtleBorderWidth, borderColor: actionBorder }}
          >
            <AppIcon name="close" color={colors.textSecondary} size={16} strokeWidth={appIconStroke.strong} />
          </IslePressable>
        </View>
        <View style={{ minHeight: 44, borderRadius: fieldRadius, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}>
          <AppIcon name="search" color={colors.textTertiary} size={15} />
          <TextInput
            value={modelPickerQuery}
            onChangeText={setModelPickerQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('chat.searchProviderOrModel')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('chat.searchProviderOrModel')}
            accessibilityHint={t('chat.searchProviderOrModelAccessibilityHint')}
            style={{ flex: 1, minHeight: 44, padding: 0, color: colors.text, fontSize: 13, fontWeight: '800' }}
          />
          {modelPickerQuery.trim() ? (
            <IslePressable
              onPress={() => setModelPickerQuery('')}
              accessibilityRole="button"
              accessibilityLabel={t('chat.clearModelSearch')}
              accessibilityHint={t('chat.clearModelSearchHint')}
              hitSlop={MODEL_MENU_ACTION_HIT_SLOP}
              style={{ width: 44, height: 44, borderRadius: controlRadius, alignItems: 'center', justifyContent: 'center', backgroundColor: actionSurface, borderWidth: subtleBorderWidth, borderColor: actionBorder }}
            >
              <AppIcon name="close" color={colors.textSecondary} size={14} strokeWidth={appIconStroke.strong} />
            </IslePressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={{ maxHeight: panelBodyMaxHeight, backgroundColor: panelBody }}
        contentContainerStyle={{ padding: 12, paddingBottom: 14 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {showPickerEmptyState ? (
          <PickerEmptyState title={pickerEmptyTitle} description={pickerEmptyDescription} minHeight={pickerEmptyMinHeight} />
        ) : (
          <View style={{ flexDirection: compactPicker ? 'column' : 'row', gap: 12, alignItems: 'stretch', minHeight: pickerMinHeight }}>
            <View style={{ flex: compactPicker ? undefined : 0.42, minWidth: compactPicker ? undefined : 0, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('settings.providerManagement')}</Text>
                <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
                  {normalizedQuery ? `${visibleProviders.length}/${policySwitchableProviders.length}` : t('chat.countItems', { count: policySwitchableProviders.length })}
                </Text>
              </View>
              <MotiView
                from={motion === 'full' ? { opacity: 0, translateX: -8 } : { opacity: 0 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                pointerEvents="box-none"
              >
                {visibleProviders.map((item) => (
                  <IslePressable
                    key={item.id}
                    haptic
                    onPress={() => setSelectedProviderId(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`}
                    accessibilityHint={t('chat.selectProviderAccessibilityHint', { provider: item.name })}
                    accessibilityState={{ selected: selectedProvider?.id === item.id }}
                    hitSlop={MODEL_MENU_CHIP_HIT_SLOP}
                  >
                    <PickerChip
                      active={selectedProvider?.id === item.id}
                      label={`${item.name}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`}
                      maxWidth={compactPicker ? panelWidth - 48 : Math.max(112, panelWidth * 0.34)}
                    />
                  </IslePressable>
                ))}
              </MotiView>
            </View>

            <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.model')}</Text>
                <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', flexShrink: 1 }}>
                  {selectedProvider?.name ?? t('chat.notSelected')} · {selectedModels.length || t('chat.none')}
                </Text>
              </View>
              {selectedModels.length ? (
                <MotiView
                  from={motion === 'full' ? { opacity: 0, translateX: 8 } : { opacity: 0 }}
                  animate={{ opacity: 1, translateX: 0 }}
                  transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle, delay: 35 } : { type: 'timing', duration: motionTokens.duration.fast }}
                  style={{ gap: 10, paddingRight: 4, paddingBottom: 2 }}
                  pointerEvents="box-none"
                >
                  {selectedModelGroups.map((group) => (
                    <View key={group.id} style={{ gap: 7 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900' }}>
                          {group.label}
                        </Text>
                        <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '800' }}>
                          {t('chat.countItems', { count: group.models.length })}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        {group.models.map((model) => (
                          <IslePressable
                            key={`${group.id}:${model.id}`}
                            haptic
                            onPress={() => selectedProvider && onSwitchModel(selectedProvider, model.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`${group.label} · ${model.name}`}
                            accessibilityHint={t('chat.selectModelAccessibilityHint', { provider: selectedProvider?.name ?? t('chat.notSelected'), model: model.name })}
                            accessibilityState={{ selected: selectedProviderIsCurrent && conversation.model === model.id }}
                            hitSlop={MODEL_MENU_CHIP_HIT_SLOP}
                          >
                            <PickerChip
                              active={selectedProviderIsCurrent && conversation.model === model.id}
                              label={model.name}
                              subtitle={model.subtitle}
                              badges={model.badges}
                              maxWidth={compactPicker ? panelWidth - 48 : Math.max(128, panelWidth * 0.42)}
                            />
                          </IslePressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </MotiView>
              ) : (
                <PickerEmptyState title={modelEmptyTitle} description={t('chat.providerNoModelsSyncHint')} minHeight={modelListHeight} />
              )}
            </View>
          </View>
        )}
        {currentCapabilityBadges.length ? (
          <ModelCapabilityStrip badges={currentCapabilityBadges} />
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <IslePressable
            haptic
            onPress={onCopyLink}
            accessibilityRole="button"
            accessibilityLabel={t('chat.copyConversationLink')}
            accessibilityHint={t('chat.copyConversationLinkHint')}
            hitSlop={MODEL_MENU_ACTION_HIT_SLOP}
            style={{ minHeight: 44, borderRadius: controlRadius, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: actionSurface, borderWidth: subtleBorderWidth, borderColor: actionBorder }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('chat.copyConversationLink')}</Text>
          </IslePressable>
        </View>
        {showTemperatureControl || showMaxTokensControl ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {showTemperatureControl ? (
              <ParamInput
                label={t('chat.temperature')}
                accessibilityHint={t('chat.temperatureAccessibilityHint')}
                value={String(conversation.temperature)}
                onChange={(value) => {
                  const next = Number(value)
                  if (!Number.isNaN(next)) patchConversation({ temperature: clampParameterInput(next, temperatureRange) })
                }}
              />
            ) : null}
            {showMaxTokensControl ? (
              <ParamInput
                label={t('chat.maxTokens')}
                accessibilityHint={t('chat.maxTokensAccessibilityHint', { limit: currentModelConfig.maxOutputTokens })}
                value={String(conversation.maxTokens)}
                onChange={(value) => {
                  const next = Number.parseInt(value, 10)
                  if (!Number.isNaN(next)) patchConversation({ maxTokens: Math.floor(clampParameterInput(next, maxTokensRange)) })
                }}
              />
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {showTopPControl ? (
            <ParamInput
              label={t('chat.topP')}
              accessibilityHint={t('chat.topPAccessibilityHint')}
              value={String(conversation.topP ?? 1)}
              onChange={(value) => {
                const next = Number(value)
                if (!Number.isNaN(next)) patchConversation({ topP: clampParameterInput(next, topPRange) })
              }}
            />
          ) : null}
          {showTopKControl ? (
            <ParamInput
              label={t('chat.topK')}
              accessibilityHint={t('chat.topKAccessibilityHint')}
              value={conversation.topK === undefined ? '' : String(conversation.topK)}
              onChange={(value) => {
                if (!value.trim()) {
                  patchConversation({ topK: undefined })
                  return
                }
                const next = Number.parseInt(value, 10)
                if (!Number.isNaN(next)) patchConversation({ topK: Math.floor(clampParameterInput(next, topKRange)) })
              }}
            />
          ) : null}
          {reasoningControlOptions.length ? (
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{t('chat.reasoning')}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {reasoningControlOptions.map((effort) => (
                  <IslePressable
                    key={effort}
                    haptic
                    onPress={() => patchConversation({ reasoningEffort: resolveReasoningControlValue(effort) })}
                    accessibilityRole="button"
                    accessibilityLabel={t('chat.reasoningChip', { value: t(`chat.reasoningEffort.${effort}`) })}
                    accessibilityHint={t('chat.reasoningEffortAccessibilityHint', { value: t(`chat.reasoningEffort.${effort}`) })}
                    accessibilityState={{ selected: selectedReasoningControlValue === effort }}
                    hitSlop={MODEL_MENU_CHIP_HIT_SLOP}
                  >
                    <IsleChip active={selectedReasoningControlValue === effort}>{t(`chat.reasoningEffort.${effort}`)}</IsleChip>
                  </IslePressable>
                ))}
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 6 }}>{t('chat.reasoningCostHint')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </IslePanel>
  )
}

const MODEL_MENU_ACTION_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }
const MODEL_MENU_CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 }

type ModelCapabilityBadge = {
  key: string
  icon: AppIconName
  label: string
}

function clampListHeight(count: number, minHeight: number, maxHeight: number, columns: number): number {
  if (count <= 0) return minHeight
  const estimated = Math.ceil(count / Math.max(1, columns)) * 40 + 8
  return Math.round(Math.max(minHeight, Math.min(maxHeight, estimated)))
}

function clampParameterInput(value: number, range: { min: number; max: number }): number {
  return Math.max(range.min, Math.min(range.max, value))
}

function PickerEmptyState({ title, description, minHeight }: { title: string; description: string; minHeight: number }) {
  const { colors, isGlass, isCartoon } = useAppTheme()
  const surface = isGlass ? colors.ui.actionBar.itemBackground : isCartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const borderColor = isCartoon ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight, borderRadius: colors.ui.radius.field, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', backgroundColor: surface, borderWidth: isCartoon ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '900' }}>{title}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{description}</Text>
    </View>
  )
}

function PickerChip({ label, subtitle, active, maxWidth, badges = [] }: { label: string; subtitle?: string; active: boolean; maxWidth: number; badges?: ModelCapabilityBadge[] }) {
  const { colors, isGlass, isCartoon } = useAppTheme()
  const motion = useMotionPreference()
  const activeBackground = colors.ui.control.primaryBackground
  const activeForeground = colors.ui.control.primaryForeground
  const idleBackground = isCartoon ? colors.ui.semantic.surface.base : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const idleBorder = isCartoon ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const labelMaxWidth = Math.max(24, maxWidth - 22 - (badges.length ? badges.length * 18 + 6 : 0))
  return (
    <MotiView
      animate={{
        backgroundColor: active ? activeBackground : idleBackground,
        borderColor: active ? colors.ui.control.primaryBorder : idleBorder,
        scale: active ? (isCartoon ? 1.025 : 1.01) : 1,
      }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
      style={{
        maxWidth,
        minHeight: subtitle ? 52 : 44,
        borderRadius: colors.ui.radius.chip,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        alignSelf: 'flex-start',
        borderWidth: isCartoon ? 1 : StyleSheet.hairlineWidth,
      }}
    >
      <View style={{ maxWidth: labelMaxWidth, minWidth: 0 }}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: active ? activeForeground : colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false }}>
          {label}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: active ? activeForeground : colors.textTertiary, opacity: active ? 0.82 : 1, fontSize: 9.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false, marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badges.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {badges.slice(0, 4).map((badge) => (
            <AppIcon key={badge.key} name={badge.icon} color={active ? activeForeground : colors.textTertiary} size={12} strokeWidth={appIconStroke.strong} />
          ))}
        </View>
      ) : null}
    </MotiView>
  )
}

function ModelCapabilityStrip({ badges }: { badges: ModelCapabilityBadge[] }) {
  const { colors, isGlass, isCartoon } = useAppTheme()
  const surface = isGlass ? colors.ui.actionBar.itemBackground : isCartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const borderColor = isCartoon ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: 36, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {badges.map((badge) => (
        <View
          key={badge.key}
          accessible
          accessibilityRole="text"
          accessibilityLabel={badge.label}
          style={{
            minHeight: 30,
            borderRadius: colors.ui.radius.chip,
            paddingHorizontal: 9,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: surface,
            borderWidth: isCartoon ? 1 : StyleSheet.hairlineWidth,
            borderColor,
          }}
        >
          <AppIcon name={badge.icon} color={colors.textSecondary} size={13} strokeWidth={appIconStroke.strong} />
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '800' }}>
            {badge.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

function getModelCapabilityBadges(provider: AIProvider, model: string, config: AIModel, t: TFunction): ModelCapabilityBadge[] {
  const badges: ModelCapabilityBadge[] = []
  if (getReasoningEffortOptions(provider, model).length) badges.push({ key: 'reasoning', icon: 'reasoning', label: t('chat.modelCapability.reasoning') })
  if (providerSupportsNativeSearch(provider)) badges.push({ key: 'search', icon: 'search-check', label: t('chat.modelCapability.search') })
  if (providerSupportsVisionInput(provider, config)) badges.push({ key: 'vision', icon: 'image', label: t('chat.modelCapability.vision') })
  if (resolveProviderNativeToolSupport(provider, config).supported) badges.push({ key: 'tools', icon: 'tools', label: t('chat.modelCapability.tools') })
  return badges
}

function getSwitchableProviderModels(provider: AIProvider, query = '', settings?: ProviderModelAccessInput['settings']): string[] {
  const models = getPolicyAllowedProviderModels(provider, settings)
    .filter((id) => getModelConfig(resolveProviderModelAlias(provider, id), provider.type, provider.modelConfigs).chatCompatible !== false)
  if (!query) return models
  return models.filter((id) => normalizeSearchText(`${id} ${getProviderDisplayModel(provider, id)} ${resolveProviderModelAlias(provider, id)}`).includes(query))
}

function disambiguateModelPickerItems(models: ModelPickerItem[]): ModelPickerItem[] {
  const nameCounts = new Map<string, number>()
  for (const model of models) {
    const key = model.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  return models.map((model) => {
    const key = model.name.trim().toLowerCase()
    return (nameCounts.get(key) ?? 0) > 1
      ? { ...model, subtitle: model.id }
      : model
  })
}

function groupModelPickerItemsByToken(provider: AIProvider, models: ModelPickerItem[], t: TFunction): ModelPickerGroup[] {
  if (!models.length) return []
  const byId = new Map(models.map((model) => [model.id, model]))
  const used = new Set<string>()
  const groups: ModelPickerGroup[] = []
  for (const [index, group] of (provider.credentialGroups ?? []).entries()) {
    const groupModels = (group.availableModels ?? [])
      .map((modelId) => byId.get(modelId))
      .filter((model): model is ModelPickerItem => {
        if (!model || used.has(model.id)) return false
        used.add(model.id)
        return true
      })
    if (!groupModels.length) continue
    groups.push({
      id: group.id,
      label: group.label || t('apiKeyPanel.groupName', { index: index + 1 }),
      models: groupModels,
    })
  }
  const remainingModels = models.filter((model) => !used.has(model.id))
  if (remainingModels.length) {
    groups.push({
      id: 'provider',
      label: t('apiKeyPanel.providerMergedModels'),
      models: remainingModels,
    })
  }
  return groups
}

function sortSwitchableProviders(providers: AIProvider[], currentProviderId: string, query: string, settings?: ProviderModelAccessInput['settings']): AIProvider[] {
  return [...providers].sort((a, b) => {
    const aScore = getProviderPickerScore(a, currentProviderId, query, settings)
    const bScore = getProviderPickerScore(b, currentProviderId, query, settings)
    if (aScore !== bScore) return bScore - aScore
    return a.name.localeCompare(b.name)
  })
}

function getProviderPickerScore(provider: AIProvider, currentProviderId: string, query: string, settings?: ProviderModelAccessInput['settings']): number {
  let score = 0
  if (provider.id === currentProviderId) score += 120
  if (provider.enabled) score += 32
  const modelCount = getSwitchableProviderModels(provider, '', settings).length
  score += Math.min(modelCount, 24)
  if (query) {
    if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) score += 80
    if (getSwitchableProviderModels(provider, query, settings).length) score += 48
  }
  return score
}

function providerMatchesQuery(provider: AIProvider, query: string, settings?: ProviderModelAccessInput['settings']): boolean {
  if (!query) return true
  if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) return true
  return getSwitchableProviderModels(provider, query, settings).length > 0
}

function ParamInput({ label, value, accessibilityHint, onChange }: { label: string; value: string; accessibilityHint?: string; onChange: (value: string) => void }) {
  const { colors, isCartoon } = useAppTheme()
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        placeholderTextColor={colors.textTertiary}
        style={{ minHeight: 46, borderRadius: colors.ui.radius.field, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: isCartoon ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.input.border, fontSize: 14, fontWeight: '700' }}
      />
    </View>
  )
}
