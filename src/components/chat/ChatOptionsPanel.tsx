import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { acceptNumericDraft, commitNumericDraft, type NumericDraftKind, type NumericDraftRange } from '@/components/ui/numericDraft'
import { ISLE_MIN_TOUCH_TARGET, IsleChip, IslePanel, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getSettingsModelDisplayAlias, SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH, upsertSettingsModelDisplayAlias } from '@/modules/settings'
import { getModelConfig } from '@/types/modelCatalog'
import type { Conversation } from '@/types/chatContracts'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { SettingsModelDisplayAlias } from '@/types/settingsContracts'
import { normalizeSearchText } from '@/utils/text'
import { getReasoningControlOptions, getReasoningControlValue, getReasoningEffortOptions, modelSupportsSamplingControls, resolveReasoningControlValue } from '@/utils/modelReasoning'
import { getProviderDisplayModel, resolveProviderModelAlias } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels, getProviderModelDisplayCandidates, type ProviderModelAccessInput } from '@/bootstrap/providerModelAccess'
import { resolveProviderRequestParameters } from '@/bootstrap/providerRequestPolicies'
import { getProviderParameterEntry } from '@/bootstrap/providerParameterMatrix'
import { resolveConversationGenerationParameterRanges } from '@/bootstrap/providerConversationGeneration'
import { providerSupportsNativeSearch } from '@/bootstrap/conversationProviderNativeSearchAdmission'
import { providerSupportsVisionInput, resolveProviderNativeToolSupport } from '@/services/chatProviderNativeToolUtils'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { resolveGenerationParameterSources, type GenerationParameterKey } from '@/core'
import { getChatModelCanonicalDisplayName, resolveChatModelDisplayName } from './chatIdentityPresentation'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

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

const MODEL_PICKER_PROVIDER_MODEL_LIMIT = 96
const MODEL_PICKER_QUERY_MODEL_LIMIT = 160

export function ChatOptionsPanel({
  conversation,
  provider,
  switchableProviders,
  colors,
  maxHeight,
  onSwitchModel,
  onCopyLink,
  onManageProviders,
  onClose,
  onDraftChange,
  settings,
  placement = 'popover',
  embedded = false,
  scope = 'full',
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  switchableProviders: AIProvider[]
  colors: ReturnType<typeof useAppTheme>['colors']
  maxHeight: number
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink?: () => void
  onManageProviders?: () => void
  onClose: () => void
  onDraftChange?: (updates: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens' | 'generationParameterOverrides'>>) => void
  settings?: ProviderModelAccessInput['settings']
  placement?: 'popover' | 'sheet'
  embedded?: boolean
  scope?: 'essential' | 'full'
}) {
  const { t } = useTranslation()
  const { isGlass, isLimeRoad } = useAppTheme()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const modelDisplayAliases = useSettingsStore((state) => state.settings.modelDisplayAliases)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [selectedProviderId, setSelectedProviderId] = useState(provider?.id ?? conversation.providerId)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const currentProvider = provider
  const currentModelAlias = currentProvider
    ? getSettingsModelDisplayAlias(modelDisplayAliases, currentProvider.id, conversation.model)
    : undefined
  const [modelAliasDraft, setModelAliasDraft] = useState(currentModelAlias ?? '')
  const normalizedQuery = normalizeSearchText(modelPickerQuery)
  const providerFallbackName = t('providerSettings.customProvider')
  const currentProviderDisplayName = currentProvider
    ? resolveProviderDisplayName(currentProvider, providerFallbackName)
    : providerFallbackName
  const policySwitchableProviders = useMemo(
    () => getProviderModelDisplayCandidates({ providers: switchableProviders, settings, modelLimit: 1, includePreferredModel: false }).map((candidate) => candidate.provider),
    [settings, switchableProviders]
  )
  const orderedProviders = useMemo(
    () => sortSwitchableProviders(policySwitchableProviders, conversation.providerId, normalizedQuery, settings, modelDisplayAliases),
    [conversation.providerId, modelDisplayAliases, normalizedQuery, policySwitchableProviders, settings]
  )
  const selectedProvider =
    orderedProviders.find((item) => item.id === selectedProviderId) ??
    orderedProviders[0]
  const visibleProviders = normalizedQuery
    ? orderedProviders.filter((item) => providerMatchesQuery(item, normalizedQuery, settings, modelDisplayAliases))
    : orderedProviders
  const selectedModels = selectedProvider
    ? disambiguateModelPickerItems(getSwitchableProviderModels(selectedProvider, normalizedQuery, settings, modelDisplayAliases)
      .map((id) => {
        const upstreamModel = resolveProviderModelAlias(selectedProvider, id)
        const config = getModelConfig(upstreamModel, selectedProvider.type, selectedProvider.modelConfigs)
        const canonicalName = getChatModelCanonicalDisplayName(selectedProvider, id)
        const displayName = resolveChatModelDisplayName(selectedProvider, id, modelDisplayAliases)
        return {
          id,
          name: displayName,
          subtitle: displayName === canonicalName ? undefined : canonicalName,
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
  const modelEmptyTitle = selectedProvider ? t('chat.noModelsForSelectedProvider', { provider: resolveProviderDisplayName(selectedProvider, providerFallbackName) }) : t('chat.noAvailableModels')
  const selectedProviderIsCurrent = selectedProvider?.id === conversation.providerId
  const reasoningModel = currentProvider ? resolveProviderModelAlias(currentProvider, conversation.model) : conversation.model
  const reasoningOptions = getReasoningEffortOptions(currentProvider, reasoningModel)
  const selectedReasoningControlValue = getReasoningControlValue(conversation.reasoningEffort)
  const currentModelConfig = getModelConfig(reasoningModel, currentProvider?.type, currentProvider?.modelConfigs)
  const reasoningParameterEntry = currentProvider ? getProviderParameterEntry(currentProvider, conversation.model, 'reasoning') : undefined
  const samplingParameterEntry = currentProvider ? getProviderParameterEntry(currentProvider, conversation.model, 'sampling') : undefined
  const tokenBudgetParameterEntry = currentProvider ? getProviderParameterEntry(currentProvider, conversation.model, 'token-budget') : undefined
  const reasoningControlOptions = reasoningParameterEntry?.status === 'sendable'
    ? getReasoningControlOptions(reasoningOptions)
    : []
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
    generationParameterSources: resolveGenerationParameterSources({
      values: conversation,
      overrides: conversation.generationParameterOverrides,
    }),
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
  const samplingParametersSendable = samplingParameterEntry?.status === 'sendable'
  const tokenBudgetSendable = tokenBudgetParameterEntry?.status === 'sendable'
  const showTemperatureControl = samplingParametersSendable && matrixParameterSendable(samplingParameterEntry, 'temperature') && (requestParameters?.temperatureSupported ?? samplingControlsSupported)
  const showMaxTokensControl = tokenBudgetSendable && matrixParameterSendable(tokenBudgetParameterEntry, 'maxTokens') && (requestParameters?.maxTokensSupported ?? false)
  const showTopPControl = samplingParametersSendable && matrixParameterSendable(samplingParameterEntry, 'topP') && (requestParameters?.topPSupported ?? false)
  const showTopKControl = samplingParametersSendable && matrixParameterSendable(samplingParameterEntry, 'topK') && (requestParameters?.topKSupported ?? false)
  const temperatureRange = requestParameters?.temperatureRange ?? conversationParameterRanges.temperature
  const topPRange = requestParameters?.topPRange ?? conversationParameterRanges.topP
  const topKRange = requestParameters?.topKRange ?? conversationParameterRanges.topK
  const maxTokensRange = requestParameters?.maxTokensRange ?? conversationParameterRanges.maxTokens
  const compactPicker = windowWidth < 430 || windowHeight < 620
  const sheetMode = placement === 'sheet'
  const showAdvancedControls = scope === 'full'
  const panelBodyMaxHeight = Math.max(250, maxHeight - 104)
  const panelWidth = sheetMode
    ? Math.min(windowWidth - 24, Math.max(320, windowWidth - 24))
    : windowWidth >= 900
    ? Math.min(720, Math.round(windowWidth * 0.7))
    : Math.min(windowWidth - 24, Math.max(320, Math.round(windowWidth * 0.92)))
  const bodyVerticalPadding = 26
  const panelHeaderReserve = 128
  const pickerHeaderReserve = 30
  const copyLinkReserve = showAdvancedControls && onCopyLink ? 52 : 0
  const primaryParamReserve = showAdvancedControls && (showTemperatureControl || showMaxTokensControl) ? 79 : 0
  const secondaryParamReserve = (showAdvancedControls && (showTopPControl || showTopKControl)) || reasoningOptions.length ? 90 : 10
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
  const panelSurface = sheetMode ? sheetMaterial.surface : isGlass ? colors.ui.semantic.chrome.background : isLimeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const panelBody = sheetMode ? sheetMaterial.body : isGlass ? colors.ui.actionBar.itemBackground : isLimeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const panelChrome = sheetMode ? sheetMaterial.chrome : isGlass ? colors.ui.semantic.chrome.toolbar : isLimeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base
  const panelBorder = sheetMode ? sheetMaterial.border : isLimeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const panelDivider = sheetMode ? sheetMaterial.divider : colors.ui.section.divider
  const actionSurface = isGlass ? colors.ui.actionBar.itemBackground : isLimeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const actionBorder = isLimeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  const subtleBorderWidth = isLimeRoad ? 1 : StyleSheet.hairlineWidth

  useEffect(() => {
    setSelectedProviderId(provider?.id ?? conversation.providerId)
  }, [conversation.providerId, provider?.id])

  useEffect(() => {
    setModelAliasDraft(currentModelAlias ?? '')
  }, [conversation.model, currentModelAlias, currentProvider?.id])

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

  function patchConversation(updates: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens' | 'generationParameterOverrides'>>) {
    if (onDraftChange) {
      onDraftChange(updates)
      return
    }
    updateConversation(conversation.id, updates)
  }

  function commitGenerationParameter(parameter: GenerationParameterKey, value: number) {
    patchConversation({
      [parameter]: value,
      generationParameterOverrides: { [parameter]: true },
    })
  }

  function resetGenerationParameter(parameter: GenerationParameterKey) {
    patchConversation({ generationParameterOverrides: { [parameter]: false } })
  }

  function commitModelAlias() {
    if (!currentProvider) return
    const nextAliases = upsertSettingsModelDisplayAlias(modelDisplayAliases, {
      providerId: currentProvider.id,
      modelId: conversation.model,
      displayName: modelAliasDraft,
    })
    updateSettings({ modelDisplayAliases: nextAliases })
  }

  return (
    <IslePanel
      material={sheetMode || isGlass ? 'chrome' : 'paper'}
      intensity={isGlass ? 44 : 30}
      elevated={false}
      style={{ alignSelf: 'center', width: embedded ? '100%' : panelWidth, height: embedded ? '100%' : undefined, maxWidth: '100%', marginTop: embedded || sheetMode ? 0 : 10, maxHeight: embedded ? undefined : maxHeight, borderWidth: embedded ? 0 : subtleBorderWidth, borderColor: panelBorder, backgroundColor: panelSurface }}
      radius={embedded ? 0 : panelRadius}
      contentStyle={{ padding: 0, backgroundColor: panelBody }}
    >
      <View style={{ padding: 12, paddingBottom: 10, borderBottomWidth: subtleBorderWidth, borderBottomColor: panelDivider, backgroundColor: panelChrome }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' }}>{t('chat.aiConfiguration')}</Text>
          <IslePressable
            haptic
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('dialog.closeLayer')}
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
        style={{ flex: embedded ? 1 : undefined, maxHeight: embedded ? undefined : panelBodyMaxHeight, backgroundColor: panelBody }}
        contentContainerStyle={{ padding: 12, paddingBottom: 14 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <View
          testID="chat-ai-provider-connection-section"
          style={{ minHeight: 54, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: fieldRadius, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: actionSurface, borderWidth: subtleBorderWidth, borderColor: actionBorder }}
        >
          <View style={{ width: 34, height: 34, borderRadius: controlRadius, alignItems: 'center', justifyContent: 'center', backgroundColor: panelSurface }}>
            <AppIcon name="provider-key" color={colors.textSecondary} size={16} strokeWidth={appIconStroke.strong} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '800' }}>{t('settings.providerManagement')}</Text>
            <Text numberOfLines={1} style={{ color: currentProvider ? colors.text : colors.textTertiary, fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 1 }}>
              {currentProvider ? resolveProviderDisplayName(currentProvider, providerFallbackName) : t('chat.noProviderConnected')}
            </Text>
          </View>
          {onManageProviders ? (
            <IslePressable
              haptic
              onPress={onManageProviders}
              accessibilityRole="button"
              accessibilityLabel={currentProvider ? t('settings.providerManagement') : t('chat.connectProvider')}
              hitSlop={MODEL_MENU_ACTION_HIT_SLOP}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: controlRadius, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: currentProvider ? panelSurface : colors.ui.control.primaryBackground, borderWidth: subtleBorderWidth, borderColor: currentProvider ? actionBorder : colors.ui.control.primaryBorder }}
            >
              <Text style={{ color: currentProvider ? colors.textSecondary : colors.ui.control.primaryForeground, fontSize: 11, fontWeight: '900' }}>
                {currentProvider ? t('settings.providerManagement') : t('chat.connectProvider')}
              </Text>
            </IslePressable>
          ) : null}
        </View>
        <View testID="chat-ai-model-selection-section">
        {showPickerEmptyState ? (
          <PickerEmptyState title={pickerEmptyTitle} description={pickerEmptyDescription} minHeight={pickerEmptyMinHeight} />
        ) : (
          <View style={{ flexDirection: compactPicker ? 'column' : 'row', gap: 12, alignItems: 'stretch', minHeight: pickerMinHeight }}>
            <View style={{ flex: compactPicker ? undefined : 0.42, minWidth: compactPicker ? undefined : 0, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{t('settings.providerManagement')}</Text>
                <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
                  {normalizedQuery ? `${visibleProviders.length}/${policySwitchableProviders.length}` : t('chat.countItems', { count: policySwitchableProviders.length })}
                </Text>
              </View>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                pointerEvents="box-none"
              >
                {visibleProviders.map((item) => (
                  <IslePressable
                    key={item.id}
                    haptic
                    onPress={() => setSelectedProviderId(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${resolveProviderDisplayName(item, providerFallbackName)}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`}
                    accessibilityHint={t('chat.selectProviderAccessibilityHint', { provider: resolveProviderDisplayName(item, providerFallbackName) })}
                    accessibilityState={{ selected: selectedProvider?.id === item.id }}
                    hitSlop={MODEL_MENU_CHIP_HIT_SLOP}
                    style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}
                  >
                    <PickerChip
                      active={selectedProvider?.id === item.id}
                      label={`${resolveProviderDisplayName(item, providerFallbackName)}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`}
                      maxWidth={compactPicker ? panelWidth - 48 : Math.max(112, panelWidth * 0.34)}
                    />
                  </IslePressable>
                ))}
              </View>
            </View>

            <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{t('chat.model')}</Text>
                <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', flexShrink: 1 }}>
                  {selectedProvider ? resolveProviderDisplayName(selectedProvider, providerFallbackName) : t('chat.notSelected')} · {selectedModels.length || t('chat.none')}
                </Text>
              </View>
              {selectedModels.length ? (
                <View
                  style={{ gap: 10, paddingRight: 4, paddingBottom: 2 }}
                  pointerEvents="box-none"
                >
                  {selectedModelGroups.map((group) => (
                    <View key={group.id} style={{ gap: 7 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700' }}>
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
                            accessibilityLabel={`${group.label} · ${model.name} · ${model.id}`}
                            accessibilityHint={t('chat.selectModelAccessibilityHint', { provider: selectedProvider ? resolveProviderDisplayName(selectedProvider, providerFallbackName) : t('chat.notSelected'), model: `${model.name} · ${model.id}` })}
                            accessibilityState={{ selected: selectedProviderIsCurrent && conversation.model === model.id }}
                            hitSlop={MODEL_MENU_CHIP_HIT_SLOP}
                            style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}
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
                </View>
              ) : (
                <PickerEmptyState title={modelEmptyTitle} description={t('chat.providerNoModelsSyncHint')} minHeight={modelListHeight} />
              )}
            </View>
          </View>
        )}
        </View>
        {currentCapabilityBadges.length ? (
          <ModelCapabilityStrip badges={currentCapabilityBadges} />
        ) : null}
        {showAdvancedControls && currentProvider && conversation.providerId !== 'local-setup' ? (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 5 }}>{t('chat.modelDisplayName')}</Text>
            <View style={{ minHeight: 46, borderRadius: fieldRadius, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}>
              <TextInput
                value={modelAliasDraft}
                onChangeText={setModelAliasDraft}
                onBlur={commitModelAlias}
                onSubmitEditing={commitModelAlias}
                maxLength={SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH * 2}
                placeholder={getChatModelCanonicalDisplayName(currentProvider, conversation.model)}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('chat.modelDisplayName')}
                accessibilityHint={`${currentProviderDisplayName} · ${conversation.model}`}
                style={{ flex: 1, minHeight: 44, padding: 0, color: colors.text, fontSize: 13, fontWeight: '800' }}
              />
              {currentModelAlias ? (
                <IslePressable
                  onPress={() => {
                    setModelAliasDraft('')
                    updateSettings({
                      modelDisplayAliases: upsertSettingsModelDisplayAlias(modelDisplayAliases, {
                        providerId: currentProvider.id,
                        modelId: conversation.model,
                        displayName: '',
                      }),
                    })
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.resetModelDisplayName')}
                  hitSlop={MODEL_MENU_ACTION_HIT_SLOP}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <AppIcon name="undo" color={colors.textTertiary} size={14} />
                </IslePressable>
              ) : null}
            </View>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 13, marginTop: 4 }}>{currentProviderDisplayName} · {conversation.model}</Text>
          </View>
        ) : null}
        {showAdvancedControls && onCopyLink ? (
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
        ) : null}
        {showAdvancedControls && (showTemperatureControl || showMaxTokensControl) ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {showTemperatureControl ? (
              <ParamInput
                label={t('chat.temperature')}
                accessibilityHint={t('chat.parameterAccessibilityHint', { min: temperatureRange.min, max: temperatureRange.max })}
                value={conversation.temperature}
                automatic={!conversationGenerationParameterIsExplicit(conversation, 'temperature')}
                range={temperatureRange}
                kind="decimal"
                automaticLabel={t('chat.followModel')}
                resetLabel={t('chat.restoreModelDefault')}
                onCommit={(value) => commitGenerationParameter('temperature', value)}
                onReset={() => resetGenerationParameter('temperature')}
              />
            ) : null}
            {showMaxTokensControl ? (
              <ParamInput
                label={t('chat.maxTokens')}
                accessibilityHint={t('chat.parameterAccessibilityHint', { min: maxTokensRange.min, max: maxTokensRange.max })}
                value={conversation.maxTokens}
                automatic={!conversationGenerationParameterIsExplicit(conversation, 'maxTokens')}
                range={maxTokensRange}
                kind="integer"
                automaticLabel={t('chat.followModel')}
                resetLabel={t('chat.restoreModelDefault')}
                onCommit={(value) => commitGenerationParameter('maxTokens', value)}
                onReset={() => resetGenerationParameter('maxTokens')}
              />
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {showAdvancedControls && showTopPControl ? (
            <ParamInput
              label={t('chat.topP')}
              accessibilityHint={t('chat.parameterAccessibilityHint', { min: topPRange.min, max: topPRange.max })}
              value={conversation.topP}
              automatic={!conversationGenerationParameterIsExplicit(conversation, 'topP')}
              range={topPRange}
              kind="decimal"
              automaticLabel={t('chat.followModel')}
              resetLabel={t('chat.restoreModelDefault')}
              onCommit={(value) => commitGenerationParameter('topP', value)}
              onReset={() => resetGenerationParameter('topP')}
            />
          ) : null}
          {showAdvancedControls && showTopKControl ? (
            <ParamInput
              label={t('chat.topK')}
              accessibilityHint={t('chat.parameterAccessibilityHint', { min: topKRange.min, max: topKRange.max })}
              value={conversation.topK}
              automatic={!conversationGenerationParameterIsExplicit(conversation, 'topK')}
              range={topKRange}
              kind="integer"
              automaticLabel={t('chat.followModel')}
              resetLabel={t('chat.restoreModelDefault')}
              onCommit={(value) => commitGenerationParameter('topK', value)}
              onReset={() => resetGenerationParameter('topK')}
            />
          ) : null}
          {reasoningControlOptions.length ? (
            <View testID="chat-ai-reasoning-section" style={{ flex: 1 }}>
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
                    style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}
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

function matrixParameterSendable(
  entry: ReturnType<typeof getProviderParameterEntry>,
  parameter: 'temperature' | 'topP' | 'topK' | 'maxTokens',
): boolean {
  const field = entry?.parameters?.find((candidate) => candidate.parameter === parameter)
  return field ? field.status === 'sendable' : entry?.status === 'sendable'
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

function PickerEmptyState({ title, description, minHeight }: { title: string; description: string; minHeight: number }) {
  const { colors, isGlass, isLimeRoad } = useAppTheme()
  const surface = isGlass ? colors.ui.actionBar.itemBackground : isLimeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const borderColor = isLimeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight, borderRadius: colors.ui.radius.field, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', backgroundColor: surface, borderWidth: isLimeRoad ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{description}</Text>
    </View>
  )
}

function PickerChip({ label, subtitle, active, maxWidth, badges = [] }: { label: string; subtitle?: string; active: boolean; maxWidth: number; badges?: ModelCapabilityBadge[] }) {
  const { colors, isGlass, isLimeRoad } = useAppTheme()
  const motion = useMotionPreference()
  const activeBackground = colors.ui.control.primaryBackground
  const activeForeground = colors.ui.control.primaryForeground
  const idleBackground = isLimeRoad ? colors.ui.semantic.surface.base : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const idleBorder = isLimeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const labelMaxWidth = Math.max(24, maxWidth - 22 - (badges.length ? badges.length * 18 + 6 : 0))
  return (
    <MotiView
      animate={{
        backgroundColor: active ? activeBackground : idleBackground,
        borderColor: active ? colors.ui.control.primaryBorder : idleBorder,
      }}
      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
      style={{
        maxWidth,
        minHeight: subtitle ? 52 : 44,
        borderRadius: colors.ui.radius.controlLarge,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        alignSelf: 'flex-start',
        borderWidth: isLimeRoad ? 1 : StyleSheet.hairlineWidth,
      }}
    >
      <View style={{ maxWidth: labelMaxWidth, minWidth: 0 }}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: active ? activeForeground : colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>
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
  const { colors, isGlass, isLimeRoad } = useAppTheme()
  const surface = isGlass ? colors.ui.actionBar.itemBackground : isLimeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const borderColor = isLimeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
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
            borderWidth: isLimeRoad ? 1 : StyleSheet.hairlineWidth,
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
  if (providerSupportsNativeSearch(provider, config)) badges.push({ key: 'search', icon: 'search-check', label: t('chat.modelCapability.search') })
  if (providerSupportsVisionInput(provider, config)) badges.push({ key: 'vision', icon: 'image', label: t('chat.modelCapability.vision') })
  if (resolveProviderNativeToolSupport(provider, config).supported) badges.push({ key: 'tools', icon: 'tools', label: t('chat.modelCapability.tools') })
  return badges
}

function getSwitchableProviderModels(provider: AIProvider, query = '', settings?: ProviderModelAccessInput['settings'], aliases?: readonly SettingsModelDisplayAlias[]): string[] {
  const models = getPolicyAllowedProviderModels(provider, settings, { limit: query ? MODEL_PICKER_QUERY_MODEL_LIMIT : MODEL_PICKER_PROVIDER_MODEL_LIMIT })
    .filter((id) => getModelConfig(resolveProviderModelAlias(provider, id), provider.type, provider.modelConfigs).chatCompatible !== false)
  if (!query) return models
  return models.filter((id) => normalizeSearchText(`${id} ${getProviderDisplayModel(provider, id)} ${resolveChatModelDisplayName(provider, id, aliases)} ${resolveProviderModelAlias(provider, id)}`).includes(query))
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

function sortSwitchableProviders(providers: AIProvider[], currentProviderId: string, query: string, settings?: ProviderModelAccessInput['settings'], aliases?: readonly SettingsModelDisplayAlias[]): AIProvider[] {
  return [...providers].sort((a, b) => {
    const aScore = getProviderPickerScore(a, currentProviderId, query, settings, aliases)
    const bScore = getProviderPickerScore(b, currentProviderId, query, settings, aliases)
    if (aScore !== bScore) return bScore - aScore
    return a.name.localeCompare(b.name)
  })
}

function getProviderPickerScore(provider: AIProvider, currentProviderId: string, query: string, settings?: ProviderModelAccessInput['settings'], aliases?: readonly SettingsModelDisplayAlias[]): number {
  let score = 0
  if (provider.id === currentProviderId) score += 120
  if (provider.enabled) score += 32
  const modelCount = getSwitchableProviderModels(provider, '', settings, aliases).length
  score += Math.min(modelCount, 24)
  if (query) {
    if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) score += 80
    if (getSwitchableProviderModels(provider, query, settings, aliases).length) score += 48
  }
  return score
}

function providerMatchesQuery(provider: AIProvider, query: string, settings?: ProviderModelAccessInput['settings'], aliases?: readonly SettingsModelDisplayAlias[]): boolean {
  if (!query) return true
  if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) return true
  return getSwitchableProviderModels(provider, query, settings, aliases).length > 0
}

function ParamInput({
  label,
  value,
  automatic,
  range,
  kind,
  automaticLabel,
  resetLabel,
  accessibilityHint,
  onCommit,
  onReset,
}: {
  label: string
  value: number | undefined
  automatic: boolean
  range: NumericDraftRange
  kind: NumericDraftKind
  automaticLabel: string
  resetLabel: string
  accessibilityHint?: string
  onCommit: (value: number) => void
  onReset: () => void
}) {
  const { colors, isLimeRoad } = useAppTheme()
  const externalDraft = automatic || value === undefined ? '' : String(value)
  const [draft, setDraft] = useState(externalDraft)
  const commitPending = useRef(false)

  useEffect(() => {
    setDraft(externalDraft)
    commitPending.current = false
  }, [externalDraft])

  function commit() {
    if (!commitPending.current) return
    commitPending.current = false
    if (!draft.trim()) {
      setDraft('')
      onReset()
      return
    }
    const next = commitNumericDraft(draft, range, kind)
    if (next === undefined) {
      setDraft(externalDraft)
      return
    }
    setDraft(String(next))
    onCommit(next)
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 10 }}>{formatParameterRange(range)}</Text>
        {!automatic ? (
          <IslePressable
            onPress={() => {
              commitPending.current = false
              setDraft('')
              onReset()
            }}
            accessibilityLabel={resetLabel}
            accessibilityHint={automaticLabel}
            style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
          >
            <AppIcon name="undo" color={colors.textTertiary} size={14} />
          </IslePressable>
        ) : null}
      </View>
      <TextInput
        value={draft}
        onChangeText={(next) => {
          const accepted = acceptNumericDraft(draft, next, kind)
          if (accepted === draft) return
          commitPending.current = true
          setDraft(accepted)
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType={kind === 'integer' ? 'number-pad' : 'decimal-pad'}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        placeholder={automaticLabel}
        placeholderTextColor={colors.textTertiary}
        style={{ minHeight: 46, borderRadius: colors.ui.radius.field, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: isLimeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.input.border, fontSize: 14, fontWeight: '700' }}
      />
    </View>
  )
}

function conversationGenerationParameterIsExplicit(
  conversation: Conversation,
  parameter: GenerationParameterKey,
): boolean {
  if (conversation.generationParameterOverrides) {
    return conversation.generationParameterOverrides[parameter] === true
  }
  const value = conversation[parameter]
  return typeof value === 'number' && Number.isFinite(value)
}

function formatParameterRange(range: NumericDraftRange): string {
  return `${range.min}-${range.max}`
}
