import { getConversationReasoningEffortOptions as getReasoningEffortOptions } from '@/bootstrap/providerConversationGeneration'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text, TextInput } from '@/components/ui/AppText'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useNetworkState } from 'expo-network'
import { router } from 'expo-router'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { acceptNumericDraft, commitNumericDraft, type NumericDraftKind, type NumericDraftRange } from '@/components/ui/numericDraft'
import { ISLE_MIN_TOUCH_TARGET, IsleChip, IslePanel, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getSettingsModelDisplayAlias, getSettingsModelIdentityKey, SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH, SETTINGS_MODEL_FAVORITE_LIMIT, SettingsModelFavoriteLimitError, upsertSettingsModelDisplayAlias } from '@/modules/settings'
import { getModelConfig } from '@/types/modelCatalog'
import type { Conversation } from '@/types/chatContracts'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { normalizeSearchText } from '@/utils/text'
import { getReasoningControlOptions, getReasoningControlValue, modelSupportsSamplingControls, resolveReasoningControlValue } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { isProviderNetworkBlocked } from '@/utils/providerGateway'
import { getProviderModelDisplayCandidates, resolveProviderModelAliasAccess, type ProviderModelAccessInput } from '@/bootstrap/providerModelAccess'
import { providerModelAvailabilityPort, providerModelAvailabilityIntegrationProfile } from '@/bootstrap/providerModelAvailabilityRuntime'
import { resolveProviderProtocolAdapter } from '@/bootstrap/providerRequestBinding'
import { resolveProviderEndpointVariant, type ProviderModelCurrent } from '@/modules/providers'
import { credentialSourceLabel, hasCredentialBlockEvidence, projectModelAvailability, selectModelAvailabilityEvidence } from '@/presentation/features/conversations/modelStatusPresentation'
import { resolveProviderRequestParameters } from '@/bootstrap/providerRequestPolicies'
import { getProviderParameterEntry } from '@/bootstrap/providerParameterMatrix'
import { resolveConversationGenerationParameterRanges } from '@/bootstrap/providerConversationGeneration'
import { providerSupportsNativeSearch } from '@/bootstrap/conversationProviderNativeSearchAdmission'
import { providerSupportsVisionInput, resolveProviderNativeToolSupport } from '@/services/chatProviderNativeToolUtils'
import { resolveGenerationParameterSources, type GenerationParameterKey } from '@/core'
import { getChatModelCanonicalDisplayName, resolveChatModelDisplayName } from './chatIdentityPresentation'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { groupProviderModelsBySource } from '@/utils/providerModelSources'
import { ProviderModelSourceFilter, ProviderModelPagination, PROVIDER_MODEL_PAGE_SIZE } from '@/components/providers/ProviderModelSourceFilter'
import { buildChatModelPickerCandidates, filterChatModelPickerCandidates, sortChatModelPickerProviders, type ChatModelPickerScope } from './chatModelPickerPresentation'
import { ChatRoutingPlanPicker } from './ChatRoutingPlanPicker'

interface ModelPickerItem {
  key: string
  provider: AIProvider
  id: string
  favorite: boolean
  name: string
  subtitle?: string
  badges: ModelCapabilityBadge[]
  availabilityLabel?: string
  evidenceLabel?: string
  blockedReason?: string
}

interface ModelPickerGroup {
  id: string
  label: string
  connectionLabel?: string
  connectionId?: string
  models: ModelPickerItem[]
}

type FavoriteChange = { providerId: string; modelId: string; favorite: boolean }

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
  onSwitchModel: (provider: AIProvider, model: string, routingPlan?: Conversation['routingPlan']) => void
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
  const { isLiquidGlass, isMonet, canonicalThemeId } = useAppTheme()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const modelDisplayAliases = useSettingsStore((state) => state.settings.modelDisplayAliases)
  const modelFavorites = useSettingsStore((state) => state.settings.modelFavorites)
  const setModelFavorite = useSettingsStore((state) => state.setModelFavorite)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const configuredProviders = useSettingsStore((state) => state.providers)
  const network = useNetworkState()
  const [availabilitySnapshot, setAvailabilitySnapshot] = useState<{ request: object | null; rows: readonly ProviderModelCurrent[]; failedKeys: ReadonlySet<string> }>(() => ({ request: null, rows: [], failedKeys: new Set() }))
  const [modelPickerScope, setModelPickerScope] = useState<ChatModelPickerScope>({ kind: 'all' })
  const [favoriteSavePending, setFavoriteSavePending] = useState(false)
  const [favoriteSaveError, setFavoriteSaveError] = useState<{ change: FavoriteChange; kind: 'storage' | 'limit' | 'connection' } | null>(null)
  const favoriteSaveSequence = useRef(0)
  const favoriteSaveInFlight = useRef(false)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelSourceId, setModelSourceId] = useState<string | null>(null)
  const [modelPage, setModelPage] = useState(0)
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
    // Cached models remain visible offline or after a failed provider test. Policy
    // is evaluated per row and again at dispatch, never bypassed by this display.
    () => {
      const configured = [...new Map([...configuredProviders, ...switchableProviders, ...(provider ? [provider] : [])].map((item) => [item.id, item])).values()]
      const displayed = getProviderModelDisplayCandidates({ providers: configured, includeDisabled: true, modelLimit: 1, includePreferredModel: false }).map((candidate) => candidate.provider)
      if (provider && !displayed.some((item) => item.id === provider.id)) displayed.unshift(provider)
      return displayed
    },
    [configuredProviders, provider, switchableProviders]
  )
  const orderedProviders = useMemo(
    () => sortChatModelPickerProviders(policySwitchableProviders, conversation.providerId),
    [conversation.providerId, policySwitchableProviders]
  )
  const selectedProvider = modelPickerScope.kind === 'provider'
    ? orderedProviders.find((item) => item.id === modelPickerScope.providerId)
    : undefined
  const allModelCandidates = useMemo(() => buildChatModelPickerCandidates({
    providers: orderedProviders, currentProviderId: conversation.providerId, currentModel: conversation.model,
    displayAliases: modelDisplayAliases, providerFallbackName,
  }), [orderedProviders, conversation.providerId, conversation.model, modelDisplayAliases, providerFallbackName])
  const allQueryMatches = useMemo(() => filterChatModelPickerCandidates({
    candidates: allModelCandidates, scope: { kind: 'all' }, query: normalizedQuery,
  }), [allModelCandidates, normalizedQuery])
  const favoriteQueryMatches = useMemo(() => filterChatModelPickerCandidates({
    candidates: allQueryMatches, scope: { kind: 'favorites' }, query: '', favorites: modelFavorites,
  }), [allQueryMatches, modelFavorites])
  const visibleProviderIds = new Set(allQueryMatches.map((item) => item.provider.id))
  const visibleProviders = orderedProviders.filter((item) => visibleProviderIds.has(item.id) || item.id === selectedProvider?.id)
  const allSelectedModelIds = useMemo(() => selectedProvider
    ? allModelCandidates.filter((item) => item.provider.id === selectedProvider.id).map((item) => item.id)
    : [], [allModelCandidates, selectedProvider])
  const modelSources = useMemo(() => selectedProvider ? groupProviderModelsBySource(selectedProvider, allSelectedModelIds) : [], [selectedProvider, allSelectedModelIds])
  const matchingModelCandidates = useMemo(() => filterChatModelPickerCandidates({
    candidates: allQueryMatches, scope: modelPickerScope, query: '', favorites: modelFavorites, sourceId: modelSourceId,
  }), [allQueryMatches, modelPickerScope, modelFavorites, modelSourceId])
  const currentModelPage = Math.min(modelPage, Math.max(0, Math.ceil(matchingModelCandidates.length / PROVIDER_MODEL_PAGE_SIZE) - 1))
  const pageModelCandidates = useMemo(() => matchingModelCandidates.slice(currentModelPage * PROVIDER_MODEL_PAGE_SIZE, (currentModelPage + 1) * PROVIDER_MODEL_PAGE_SIZE), [matchingModelCandidates, currentModelPage])
  const availabilityTargetsKey = JSON.stringify([...new Map(pageModelCandidates.map((item) => [
    getSettingsModelIdentityKey(item.provider.id, item.upstreamModel), [item.provider.id, item.upstreamModel],
  ])).values()])
  const availabilityRequest = useMemo(() => ({
    targets: JSON.parse(availabilityTargetsKey) as [string, string][],
  }), [availabilityTargetsKey, configuredProviders, switchableProviders, provider])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rows: ProviderModelCurrent[] = []
      const failedKeys = new Set<string>()
      // Read only visible targets, in small local-storage batches. Aliases of
      // the same upstream target share evidence, but retain separate identities.
      for (let offset = 0; offset < availabilityRequest.targets.length && !cancelled; offset += 4) {
        const targets = availabilityRequest.targets.slice(offset, offset + 4)
        const results = await Promise.allSettled(targets.map(([providerId, modelId]) => providerModelAvailabilityPort.listCurrentModels({
          providerId, modelId, limit: providerModelAvailabilityIntegrationProfile.pageSize,
        })))
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') rows.push(...result.value)
          else failedKeys.add(getSettingsModelIdentityKey(...targets[index]))
        })
      }
      if (!cancelled) setAvailabilitySnapshot({ request: availabilityRequest, rows, failedKeys })
    })()
    return () => { cancelled = true }
  }, [availabilityRequest])
  const availabilityRows = availabilitySnapshot.request === availabilityRequest ? availabilitySnapshot.rows : []
  const favoriteKeys = useMemo(() => new Set(modelFavorites?.map((item) => getSettingsModelIdentityKey(item.providerId, item.modelId))), [modelFavorites])
  const selectedModels = useMemo(() => disambiguateModelPickerItems(pageModelCandidates
      .map(({ key, provider: modelProvider, id, upstreamModel }) => {
        const config = getModelConfig(upstreamModel, modelProvider.type, modelProvider.modelConfigs)
        const canonicalName = getChatModelCanonicalDisplayName(modelProvider, id)
        const displayName = resolveChatModelDisplayName(modelProvider, id, modelDisplayAliases)
        const adapter = resolveProviderProtocolAdapter({ provider: modelProvider, model: upstreamModel, requestedModel: id, messages: [], generationParameterSources: {} })
        const endpointVariant = resolveProviderEndpointVariant(modelProvider)
        const current = selectModelAvailabilityEvidence({ provider: modelProvider, modelId: upstreamModel,
          protocolAdapterId: adapter.id, endpointVariant, rows: availabilityRows })
        const projection = projectModelAvailability({ current, offline: isProviderNetworkBlocked(modelProvider, network),
          credentialBlocked: hasCredentialBlockEvidence(modelProvider), providerDisabled: !modelProvider.enabled,
          policyBlocked: !resolveProviderModelAliasAccess({ provider: modelProvider, model: id, settings }).allowed,
          incompatible: config.chatCompatible === false,
          activeReply: conversation.messages.some((message) => message.status === 'streaming'),
        })
        return {
          key, provider: modelProvider, id, favorite: favoriteKeys.has(key),
          name: displayName,
          subtitle: displayName === canonicalName ? undefined : canonicalName,
          badges: getModelCapabilityBadges(modelProvider, upstreamModel, config, t),
          availabilityLabel: [modelProvider.id === conversation.providerId && id === conversation.model ? t('modelStatus.preferred') : '',
            t(`modelStatus.${projection.availability}`),
            projection.advertisement === 'not-advertised' ? t('modelStatus.notAdvertised') : '',
            ...projection.labels.map((label) => t(`modelStatus.${label}`))].filter(Boolean).join(' · '),
          evidenceLabel: current && !current.invalidated ? [credentialSourceLabel(current.credentialSource, modelProvider, t),
            current.evidence ? t(`modelStatus.source.${current.evidence.source}`) : '',
            new Date(current.evidence?.observedAt ?? current.updatedAt).toLocaleString()].filter(Boolean).join(' · ')
            : t(availabilitySnapshot.request === availabilityRequest && availabilitySnapshot.failedKeys.has(getSettingsModelIdentityKey(modelProvider.id, upstreamModel)) ? 'modelStatus.readFailed' : 'modelStatus.noEvidence'),
          blockedReason: projection.blockedReason ? t(`modelStatus.${projection.blockedReason}`) : undefined,
        }
      })), [pageModelCandidates, modelDisplayAliases, favoriteKeys, availabilityRows, availabilitySnapshot, availabilityRequest, network.isConnected, network.isInternetReachable, settings, conversation.providerId, conversation.model, conversation.messages, t])
  const selectedModelGroups = useMemo(() => orderedProviders.flatMap((item) => {
    const groups = groupModelPickerItemsByToken(item, selectedModels.filter((model) => model.provider.id === item.id), t)
    const isCurrent = (model: ModelPickerItem) => model.provider.id === conversation.providerId && model.id === conversation.model
    groups.sort((left, right) => Number(right.models.some(isCurrent)) - Number(left.models.some(isCurrent)))
    return groups.map((group) => ({
      ...group, id: getSettingsModelIdentityKey(item.id, group.id),
      ...(selectedProvider ? {} : { connectionLabel: resolveProviderDisplayName(item, providerFallbackName), connectionId: item.id }),
      models: [...group.models].sort((left, right) => Number(isCurrent(right)) - Number(isCurrent(left))),
    }))
  }), [orderedProviders, selectedModels, selectedProvider, providerFallbackName, conversation.providerId, conversation.model, t])
  const noSwitchableProviderCandidates = policySwitchableProviders.length === 0
  const pickerEmptyTitle = noSwitchableProviderCandidates
    ? switchableProviders.length ? t('chat.noAvailableModels') : t('chat.noProviderConnected')
    : t('chat.noProviderModelMatches')
  const pickerEmptyDescription = noSwitchableProviderCandidates
    ? switchableProviders.length ? t('chat.syncModelsBeforeChat') : t('chat.configureProviderBeforeChat')
    : t('chat.noProviderModelMatchesDescription')
  const modelEmptyTitle = noSwitchableProviderCandidates ? pickerEmptyTitle : normalizedQuery || modelSourceId !== null
    ? t('chat.noProviderModelMatches') : modelPickerScope.kind === 'favorites' ? t('chat.noFavoriteModels')
    : selectedProvider ? t('chat.noModelsForSelectedProvider', { provider: resolveProviderDisplayName(selectedProvider, providerFallbackName) }) : t('chat.noAvailableModels')
  const modelEmptyDescription = noSwitchableProviderCandidates ? pickerEmptyDescription : normalizedQuery || modelSourceId !== null
    ? t('chat.noProviderModelMatchesDescription') : modelPickerScope.kind === 'favorites' ? t('chat.noFavoriteModelsDescription') : t('chat.providerNoModelsSyncHint')
  const resultScopeLabel = selectedProvider ? resolveProviderDisplayName(selectedProvider, providerFallbackName)
    : t(modelPickerScope.kind === 'favorites' ? 'chat.favoriteModels' : 'chat.allModels')
  const reasoningModel = currentProvider ? resolveProviderModelAlias(currentProvider, conversation.model ?? '') : conversation.model ?? ''
  const reasoningOptions = getReasoningEffortOptions(currentProvider, conversation.model ?? '')
  const selectedReasoningControlValue = getReasoningControlValue(conversation.reasoningEffort)
  const currentModelConfig = getModelConfig(reasoningModel, currentProvider?.type, currentProvider?.modelConfigs)
  const reasoningParameterEntry = currentProvider && conversation.model ? getProviderParameterEntry(currentProvider, conversation.model, 'reasoning') : undefined
  const samplingParameterEntry = currentProvider && conversation.model ? getProviderParameterEntry(currentProvider, conversation.model, 'sampling') : undefined
  const tokenBudgetParameterEntry = currentProvider && conversation.model ? getProviderParameterEntry(currentProvider, conversation.model, 'token-budget') : undefined
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
  const panelRadius = sheetMode ? colors.ui.radius.modal : colors.ui.radius.panel
  const fieldRadius = colors.ui.radius.field
  const controlRadius = colors.ui.radius.controlLarge
  const sheetMaterial = colors.material.sheet
  const panelSurface = sheetMode ? sheetMaterial.surface : isLiquidGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const panelBody = sheetMode ? sheetMaterial.body : isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.base
  const panelChrome = sheetMode ? sheetMaterial.chrome : isLiquidGlass ? colors.ui.semantic.chrome.toolbar : isMonet ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base
  const panelBorder = sheetMode ? sheetMaterial.border : isMonet ? colors.material.stroke : isLiquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const panelDivider = sheetMode ? sheetMaterial.divider : colors.ui.section.divider
  const actionSurface = isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const actionBorder = isMonet ? colors.material.stroke : colors.ui.semantic.chrome.border
  const subtleBorderWidth = isMonet ? 1 : StyleSheet.hairlineWidth

  useEffect(() => {
    setModelAliasDraft(currentModelAlias ?? '')
  }, [conversation.model, currentModelAlias, currentProvider?.id])

  useEffect(() => {
    if (modelPickerScope.kind === 'provider' && !selectedProvider) selectPickerScope({ kind: 'all' })
  }, [modelPickerScope, selectedProvider])

  useEffect(() => () => { favoriteSaveSequence.current += 1 }, [])

  function selectPickerScope(nextScope: ChatModelPickerScope) {
    setModelPickerScope(nextScope)
    setModelSourceId(null)
    setModelPage(0)
  }

  function changeModelQuery(query: string) {
    setModelPickerQuery(query)
    setModelPage(0)
  }

  async function saveFavorite(change: FavoriteChange) {
    if (favoriteSaveInFlight.current) return
    favoriteSaveInFlight.current = true
    const sequence = ++favoriteSaveSequence.current
    setFavoriteSavePending(true)
    setFavoriteSaveError(null)
    try {
      await setModelFavorite(change.providerId, change.modelId, change.favorite)
    } catch (error) {
      if (sequence === favoriteSaveSequence.current) setFavoriteSaveError({
        change, kind: error instanceof SettingsModelFavoriteLimitError ? 'limit'
          : !useSettingsStore.getState().providers.some((item) => item.id === change.providerId) ? 'connection' : 'storage',
      })
    } finally {
      favoriteSaveInFlight.current = false
      if (sequence === favoriteSaveSequence.current) setFavoriteSavePending(false)
    }
  }

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
    if (!currentProvider || !conversation.model) return
    const nextAliases = upsertSettingsModelDisplayAlias(modelDisplayAliases, {
      providerId: currentProvider.id,
      modelId: conversation.model,
      displayName: modelAliasDraft,
    })
    updateSettings({ modelDisplayAliases: nextAliases })
  }

  return (
    <IslePanel
      material={sheetMode || isLiquidGlass ? 'chrome' : 'paper'}
      intensity={isLiquidGlass ? 44 : 30}
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
            onChangeText={changeModelQuery}
            maxLength={200}
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
              onPress={() => changeModelQuery('')}
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
        {scope === 'full' ? <IslePressable accessibilityRole="button" accessibilityLabel={t('agentTasks.title')}
          onPress={() => { onClose(); router.push({ pathname: '/agent', params: { conversationId: conversation.id } }) }}
          style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center', padding: 12, marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('agentTasks.title')}</Text>
        </IslePressable> : null}
        {scope === 'full' ? <View testID="chat-scene-actions" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {conversation.scenePlanSource ? <Text testID="chat-scene-source" style={{ width: '100%', color: colors.textSecondary }}>
            {t('scenes.lastApplied', { name: conversation.scenePlanSource.name, revision: conversation.scenePlanSource.revision })}
          </Text> : null}
          {(['choose', 'capture'] as const).map(action => <IslePressable key={action} testID={`chat-scene-${action}`}
            accessibilityRole="button" accessibilityLabel={t(action === 'capture' ? 'scenes.capture' : 'scenes.choose')}
            onPress={() => { onClose(); router.push({ pathname: '/settings/scenes', params: { conversationId: conversation.id, ...(action === 'capture' ? { action: 'capture' } : {}) } }) }}
            style={{ minHeight: ISLE_MIN_TOUCH_TARGET, padding: 12, justifyContent: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{t(action === 'capture' ? 'scenes.capture' : 'scenes.choose')}</Text>
          </IslePressable>)}
        </View> : null}
        <View testID="chat-ai-model-selection-section">
        <ChatRoutingPlanPicker conversation={conversation} providers={orderedProviders} query={modelPickerQuery} settings={settings}
          onSelect={onSwitchModel} onManage={() => { onClose(); router.push('/settings/routing') }} />
        {selectedProvider ? <ProviderModelSourceFilter sources={modelSources} selectedSourceId={modelSourceId} onSelect={(sourceId) => { setModelSourceId(sourceId); setModelPage(0) }} colors={colors} /> : null}
          <ThemeModelPicker
            family={canonicalThemeId}
            colors={colors}
            compactPicker={compactPicker}
            panelWidth={panelWidth}
            providerFallbackName={providerFallbackName}
            visibleProviders={visibleProviders}
            providerCount={policySwitchableProviders.length}
            normalizedQuery={normalizedQuery}
            pickerScope={modelPickerScope}
            allModelCount={allQueryMatches.length}
            favoriteModelCount={favoriteQueryMatches.length}
            resultTotalCount={matchingModelCandidates.length}
            resultScopeLabel={resultScopeLabel}
            selectedProvider={selectedProvider}
            selectedModels={selectedModels}
            selectedModelGroups={selectedModelGroups}
            conversationProviderId={conversation.providerId}
            conversationModel={conversation.routingPlan ? '' : conversation.model ?? ''}
            modelEmptyTitle={modelEmptyTitle}
            modelEmptyDescription={modelEmptyDescription}
            modelListHeight={modelListHeight}
            pickerMinHeight={pickerMinHeight}
            onSelectScope={selectPickerScope}
            onSwitchModel={(model) => {
              const selected = selectedModels.find((item) => item.key === model.key)
              if (selected && !selected.blockedReason) onSwitchModel(selected.provider, selected.id)
            }}
            favoriteSavePending={favoriteSavePending}
            onToggleFavorite={(model) => { void saveFavorite({ providerId: model.provider.id, modelId: model.id, favorite: !model.favorite }) }}
            t={t}
          />
        <ProviderModelPagination total={matchingModelCandidates.length} page={currentModelPage} onChange={setModelPage} colors={colors} />
        {favoriteSaveError ? (
          <View testID="chat-model-favorite-save-error" style={{ marginTop: 8, gap: 4 }}>
            <Text accessibilityRole="alert" style={{ color: colors.textSecondary, fontSize: 12 }}>
              {t(favoriteSaveError.kind === 'limit' ? 'chat.modelFavoriteLimit' : favoriteSaveError.kind === 'connection' ? 'chat.modelFavoriteConnectionRemoved' : 'chat.modelFavoriteSaveFailed', { count: SETTINGS_MODEL_FAVORITE_LIMIT, model: favoriteSaveError.change.modelId })}
            </Text>
            {favoriteSaveError.kind === 'storage' ? <IslePressable
              accessibilityRole="button" accessibilityLabel={t('chat.retryModelFavoriteSave')}
              disabled={favoriteSavePending} accessibilityState={{ disabled: favoriteSavePending }}
              onPress={() => { void saveFavorite(favoriteSaveError.change) }}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8 }}
            >
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}>{t('chat.retryModelFavoriteSave')}</Text>
            </IslePressable> : null}
          </View>
        ) : null}
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 8 }}>{t('modelStatus.selectorScopeHint')}</Text>
        {selectedModels.length > 0 && selectedModels.every((model) => !!model.blockedReason) ? <Text style={{ color: colors.textSecondary, marginTop: 6 }}>{t('modelStatus.noSelectableModel')}</Text> : null}
        </View>
        {currentCapabilityBadges.length ? (
          <ModelCapabilityStrip badges={currentCapabilityBadges} />
        ) : null}
        {showAdvancedControls && currentProvider && conversation.model && conversation.providerId !== 'local-setup' ? (
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
                        modelId: conversation.model ?? '',
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
                    // RN Web no longer maps accessibilityState; buttons expose toggles through aria-pressed.
                    {...(Platform.OS === 'web' ? { 'aria-pressed': selectedReasoningControlValue === effort } : {})}
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

type ThemeModelPickerProps = {
  family: CanonicalThemeId
  colors: ReturnType<typeof useAppTheme>['colors']
  compactPicker: boolean
  panelWidth: number
  providerFallbackName: string
  visibleProviders: AIProvider[]
  providerCount: number
  normalizedQuery: string
  pickerScope: ChatModelPickerScope
  allModelCount: number
  favoriteModelCount: number
  resultTotalCount: number
  resultScopeLabel: string
  selectedProvider?: AIProvider
  selectedModels: ModelPickerItem[]
  selectedModelGroups: ModelPickerGroup[]
  conversationProviderId: string | null
  conversationModel: string
  modelEmptyTitle: string
  modelEmptyDescription: string
  modelListHeight: number
  pickerMinHeight?: number
  onSelectScope: (scope: ChatModelPickerScope) => void
  onSwitchModel: (model: ModelPickerItem) => void
  favoriteSavePending: boolean
  onToggleFavorite: (model: ModelPickerItem) => void
  t: TFunction
}

function ThemeModelPicker(props: ThemeModelPickerProps) {
  switch (props.family) {
    case 'minimal': return <MinimalModelPicker {...props} />
    case 'monet': return <MonetModelPicker {...props} />
    case 'material': return <MaterialModelPicker {...props} />
    case 'liquid-glass': return <LiquidGlassModelPicker {...props} />
    case 'animal-island-ui': return <IsleModelPicker {...props} />
  }
}

function PickerSectionHeading({ label, detail, colors, accent = false }: { label: string; detail?: string; colors: ThemeModelPickerProps['colors']; accent?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: accent ? colors.text : colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: accent ? 0.2 : 0 }}>{label}</Text>
      {detail ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', flexShrink: 1 }}>{detail}</Text> : null}
    </View>
  )
}

function ProviderOption({ item, active, family, maxWidth, colors, providerFallbackName, t, onPress }: { item: AIProvider; active: boolean; family: CanonicalThemeId; maxWidth: number; colors: ThemeModelPickerProps['colors']; providerFallbackName: string; t: TFunction; onPress: () => void }) {
  const name = resolveProviderDisplayName(item, providerFallbackName)
  const label = `${name}${item.enabled ? '' : ` · ${t('settings.disabledState')}`}`
  return <PickerCategoryOption label={label} subtitle={item.id} accessibilityLabel={`${label} · ${item.id}`}
    accessibilityHint={t('chat.selectProviderAccessibilityHint', { provider: name })}
    active={active} family={family} maxWidth={maxWidth} colors={colors} onPress={onPress} />
}

function PickerCategoryOption({ label, subtitle, detail, active, family, maxWidth, colors, accessibilityLabel = label, accessibilityHint, testID, onPress }: {
  label: string; subtitle?: string; detail?: string; active: boolean; family: CanonicalThemeId; maxWidth: number;
  colors: ThemeModelPickerProps['colors']; accessibilityLabel?: string; accessibilityHint: string; testID?: string; onPress: () => void
}) {
  const foreground = active && family === 'monet' ? colors.ui.control.primaryForeground
    : active && family !== 'minimal' ? colors.ui.icon.accentForeground : active ? colors.text : colors.textSecondary
  return (
    <IslePressable haptic onPress={onPress} testID={testID}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})}
      hitSlop={MODEL_MENU_CHIP_HIT_SLOP}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, minWidth: 0, maxWidth, flexShrink: 1, justifyContent: 'center' }}
    >
      <View style={{ minHeight: 44, minWidth: 0, maxWidth, paddingVertical: 8, paddingHorizontal: family === 'minimal' ? 4 : 12, justifyContent: 'center',
        ...(family === 'minimal' ? { borderBottomWidth: active ? 2 : StyleSheet.hairlineWidth, borderBottomColor: active ? colors.text : colors.ui.semantic.chrome.border }
          : { borderWidth: 1, borderColor: active ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
            backgroundColor: family === 'monet' ? active ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.base
              : family === 'material' ? active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.muted
              : active ? colors.ui.semantic.surface.overlay : colors.ui.actionBar.itemBackground,
            ...(family === 'monet' ? { borderTopLeftRadius: 14, borderBottomRightRadius: 16 } : { borderRadius: family === 'material' ? 12 : colors.ui.radius.controlLarge }) }),
      }}>
        {active && family === 'material' ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.primary }} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 6 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, color: foreground, fontSize: 12, fontWeight: '800' }}>{label}</Text>
          {detail ? <Text style={{ color: foreground, fontSize: 10 }}>{detail}</Text> : null}
        </View>
        {subtitle ? <Text numberOfLines={1} style={{ color: active && family === 'monet' ? foreground : colors.textTertiary, fontSize: 10, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
    </IslePressable>
  )
}

function PickerCategories({ props, family, maxWidth }: { props: ThemeModelPickerProps; family: CanonicalThemeId; maxWidth: number }) {
  return (
    <>
      {(['all', 'favorites'] as const).map((kind) => {
        const label = props.t(kind === 'all' ? 'chat.allModels' : 'chat.favoriteModels')
        return <PickerCategoryOption key={kind} testID={`chat-model-scope-${kind}`} label={label}
          detail={String(kind === 'all' ? props.allModelCount : props.favoriteModelCount)}
          accessibilityHint={props.t('chat.modelPickerScopeHint', { scope: label })}
          active={props.pickerScope.kind === kind} family={family} maxWidth={maxWidth} colors={props.colors}
          onPress={() => props.onSelectScope({ kind })} />
      })}
      {props.visibleProviders.map((item) => <ProviderOption key={item.id} item={item}
        active={props.pickerScope.kind === 'provider' && props.pickerScope.providerId === item.id}
        family={family} maxWidth={maxWidth} colors={props.colors} providerFallbackName={props.providerFallbackName} t={props.t}
        onPress={() => props.onSelectScope({ kind: 'provider', providerId: item.id })} />)}
    </>
  )
}

function ModelOption({ model, groupLabel, active, family, maxWidth, colors, providerFallbackName, t, favoriteSavePending, onPress, onToggleFavorite }: { model: ModelPickerItem; groupLabel: string; active: boolean; family: CanonicalThemeId; maxWidth: number; colors: ThemeModelPickerProps['colors']; providerFallbackName: string; t: TFunction; favoriteSavePending: boolean; onPress: () => void; onToggleFavorite: () => void }) {
  const providerName = resolveProviderDisplayName(model.provider, providerFallbackName)
  const foreground = active && family === 'monet' ? colors.ui.control.primaryForeground
    : active && family !== 'minimal' ? colors.ui.icon.accentForeground : active ? colors.text : colors.textSecondary
  const secondary = active && family === 'monet' ? colors.ui.control.primaryForeground : colors.textTertiary
  const surface = family === 'minimal' ? 'transparent' : family === 'monet'
    ? active ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.base
    : family === 'material' ? active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.muted
    : active ? colors.ui.semantic.surface.overlay : colors.ui.actionBar.itemBackground
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, width: maxWidth, maxWidth: '100%', minWidth: 0 }}>
      <IslePressable
        testID={`chat-model-option-${model.key}`}
        haptic
        onPress={onPress}
        disabled={!!model.blockedReason}
        accessibilityRole="button"
        accessibilityLabel={`${providerName} · ${model.provider.id} · ${groupLabel} · ${model.name} · ${model.id}`}
        accessibilityHint={[model.blockedReason, model.availabilityLabel, model.evidenceLabel, t('chat.selectModelAccessibilityHint', { provider: providerName, model: `${model.name} · ${model.id}` })].filter(Boolean).join('. ')}
        accessibilityState={{ selected: active, disabled: !!model.blockedReason }}
        {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})}
        style={{ flex: 1, minHeight: ISLE_MIN_TOUCH_TARGET, minWidth: 0, justifyContent: 'center' }}
      >
        <View style={{ minHeight: 48, minWidth: 0, paddingVertical: 8, paddingHorizontal: family === 'minimal' ? 4 : 12, justifyContent: 'center', backgroundColor: surface,
          ...(family === 'minimal' ? { borderBottomWidth: active ? 2 : StyleSheet.hairlineWidth, borderBottomColor: active ? colors.text : colors.ui.semantic.chrome.border }
            : { borderWidth: 1, borderColor: active ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
              ...(family === 'monet' ? { borderTopLeftRadius: 14, borderBottomRightRadius: 16 } : { borderRadius: family === 'material' ? 12 : colors.ui.radius.controlLarge }) }),
        }}>
          {active && family === 'material' ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.primary }} /> : null}
          <Text numberOfLines={1} style={{ minWidth: 0, color: foreground, fontSize: 12, fontWeight: '800' }}>{model.name}</Text>
          {model.subtitle ? <Text numberOfLines={1} style={{ minWidth: 0, color: secondary, fontSize: 10, marginTop: 2 }}>{model.subtitle}</Text> : null}
          {model.id !== model.name && model.id !== model.subtitle ? <Text numberOfLines={1} style={{ minWidth: 0, color: secondary, fontSize: 10, marginTop: 2 }}>{model.id}</Text> : null}
          {model.badges.length ? <Text numberOfLines={1} style={{ minWidth: 0, color: secondary, fontSize: 9, marginTop: 2 }}>{model.badges.map((badge) => badge.label).join(' · ')}</Text> : null}
        </View>
        {model.availabilityLabel ? <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 10, marginTop: 4 }}>{model.availabilityLabel}</Text> : null}
        {model.evidenceLabel ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10 }}>{model.evidenceLabel}</Text> : null}
        {model.blockedReason ? <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{model.blockedReason}</Text> : null}
      </IslePressable>
      <IslePressable
        testID={`chat-model-favorite-${model.key}`}
        haptic onPress={onToggleFavorite} disabled={favoriteSavePending}
        accessibilityRole="button"
        accessibilityLabel={t(model.favorite ? 'chat.removeModelFavorite' : 'chat.addModelFavorite', { provider: `${providerName} · ${model.provider.id}`, model: model.id })}
        accessibilityHint={t('chat.modelFavoriteAccessibilityHint')}
        accessibilityState={{ selected: model.favorite, disabled: favoriteSavePending, busy: favoriteSavePending }}
        {...(Platform.OS === 'web' ? { 'aria-pressed': model.favorite } : {})}
        style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlLarge }}
      >
        <AppIcon name="star" color={model.favorite ? colors.ui.icon.accentForeground : colors.textTertiary} fill={model.favorite ? colors.ui.icon.accentForeground : 'none'} size={18} />
      </IslePressable>
    </View>
  )
}

function ModelGroups({ props, family, modelMaxWidth, groupStyle }: { props: ThemeModelPickerProps; family: CanonicalThemeId; modelMaxWidth: number; groupStyle?: object }) {
  return (
    <View style={[{ gap: family === 'minimal' ? 8 : 12 }, groupStyle]} pointerEvents="box-none">
      {props.selectedModelGroups.map((group) => (
        <View key={group.id} style={{ minWidth: 0, gap: family === 'material' ? 7 : 8 }}>
          <PickerSectionHeading label={group.connectionLabel ?? group.label} detail={props.t('chat.countItems', { count: group.models.length })} colors={props.colors} accent={family === 'material'} />
          {group.connectionLabel ? <Text numberOfLines={2} style={{ color: props.colors.textTertiary, fontSize: 10 }}>{group.connectionId} · {group.label}</Text> : null}
          <View style={{ flexDirection: 'row', gap: family === 'minimal' ? 10 : 8, flexWrap: 'wrap', minWidth: 0 }}>
            {group.models.map((model) => (
              <ModelOption key={model.key} model={model} groupLabel={group.label} active={props.conversationProviderId === model.provider.id && props.conversationModel === model.id} family={family} maxWidth={modelMaxWidth} colors={props.colors} providerFallbackName={props.providerFallbackName} t={props.t} favoriteSavePending={props.favoriteSavePending} onPress={() => props.onSwitchModel(model)} onToggleFavorite={() => props.onToggleFavorite(model)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

function MinimalModelPicker(props: ThemeModelPickerProps) {
  return (
    <View testID="chat-model-picker-minimal" style={{ flexDirection: props.compactPicker ? 'column' : 'row', gap: 18, minHeight: props.pickerMinHeight }}>
      <View style={{ flex: props.compactPicker ? undefined : 0.36, gap: 8 }}>
        <PickerSectionHeading label={props.t('settings.providerManagement')} detail={props.normalizedQuery ? `${props.visibleProviders.length}/${props.providerCount}` : props.t('chat.countItems', { count: props.providerCount })} colors={props.colors} />
        <View style={{ gap: props.compactPicker ? 8 : 2, flexDirection: props.compactPicker ? 'row' : 'column', flexWrap: props.compactPicker ? 'wrap' : 'nowrap' }} pointerEvents="box-none">
          <PickerCategories props={props} family="minimal" maxWidth={props.compactPicker ? Math.min(160, props.panelWidth - 48) : props.panelWidth * 0.34} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <PickerSectionHeading label={props.resultScopeLabel} detail={props.t('chat.countItems', { count: props.resultTotalCount })} colors={props.colors} />
        {props.selectedModels.length ? <ModelGroups props={props} family="minimal" modelMaxWidth={props.compactPicker ? props.panelWidth - 48 : props.panelWidth * 0.42} /> : <PickerEmptyState title={props.modelEmptyTitle} description={props.modelEmptyDescription} minHeight={props.modelListHeight} />}
      </View>
    </View>
  )
}

function MonetModelPicker(props: ThemeModelPickerProps) {
  return (
    <View testID="chat-model-picker-monet" style={{ gap: 14, minHeight: props.pickerMinHeight, paddingHorizontal: 2 }}>
      <View style={{ gap: 9 }}>
        <PickerSectionHeading label={props.t('settings.providerManagement')} detail={props.normalizedQuery ? `${props.visibleProviders.length}/${props.providerCount}` : props.t('chat.countItems', { count: props.providerCount })} colors={props.colors} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} pointerEvents="box-none">
          <PickerCategories props={props} family="monet" maxWidth={props.compactPicker ? Math.min(160, props.panelWidth - 52) : props.panelWidth * 0.36} />
        </View>
      </View>
      <View style={{ marginLeft: props.compactPicker ? 0 : 12, paddingTop: 2 }}>
        <PickerSectionHeading label={props.resultScopeLabel} detail={props.t('chat.countItems', { count: props.resultTotalCount })} colors={props.colors} />
        <View style={{ marginTop: 10 }}>{props.selectedModels.length ? <ModelGroups props={props} family="monet" modelMaxWidth={props.compactPicker ? props.panelWidth - 52 : props.panelWidth * 0.44} /> : <PickerEmptyState title={props.modelEmptyTitle} description={props.modelEmptyDescription} minHeight={props.modelListHeight} />}</View>
      </View>
    </View>
  )
}

function MaterialModelPicker(props: ThemeModelPickerProps) {
  return (
    <View testID="chat-model-picker-material" style={{ flexDirection: props.compactPicker ? 'column' : 'row', gap: 10, minHeight: props.pickerMinHeight }}>
      <View style={{ flex: props.compactPicker ? undefined : 0.4, padding: 10, borderRadius: 14, backgroundColor: props.colors.ui.semantic.surface.muted, borderWidth: 1, borderColor: props.colors.ui.semantic.chrome.border, gap: 8 }}>
        <PickerSectionHeading label={props.t('settings.providerManagement')} detail={props.normalizedQuery ? `${props.visibleProviders.length}/${props.providerCount}` : props.t('chat.countItems', { count: props.providerCount })} colors={props.colors} accent />
        <View style={{ gap: 7, flexDirection: props.compactPicker ? 'row' : 'column', flexWrap: props.compactPicker ? 'wrap' : 'nowrap' }} pointerEvents="box-none">
          <PickerCategories props={props} family="material" maxWidth={props.compactPicker ? Math.min(160, props.panelWidth - 44) : props.panelWidth * 0.34} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0, padding: 10, borderRadius: 14, backgroundColor: props.colors.ui.semantic.surface.raised, borderWidth: 1, borderColor: props.colors.ui.semantic.chrome.border, gap: 8 }}>
        <PickerSectionHeading label={props.resultScopeLabel} detail={props.t('chat.countItems', { count: props.resultTotalCount })} colors={props.colors} accent />
        {props.selectedModels.length ? <ModelGroups props={props} family="material" modelMaxWidth={props.compactPicker ? props.panelWidth - 44 : props.panelWidth * 0.44} /> : <PickerEmptyState title={props.modelEmptyTitle} description={props.modelEmptyDescription} minHeight={props.modelListHeight} />}
      </View>
    </View>
  )
}

function LiquidGlassModelPicker(props: ThemeModelPickerProps) {
  return (
    <View testID="chat-model-picker-liquid-glass" style={{ gap: 12, minHeight: props.pickerMinHeight, padding: 2, borderRadius: 20, backgroundColor: props.colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: props.colors.ui.actionBar.itemBorder }}>
      <View style={{ padding: 8 }}>
        <PickerSectionHeading label={props.t('settings.providerManagement')} detail={props.normalizedQuery ? `${props.visibleProviders.length}/${props.providerCount}` : props.t('chat.countItems', { count: props.providerCount })} colors={props.colors} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }} pointerEvents="box-none">
          <PickerCategories props={props} family="liquid-glass" maxWidth={props.compactPicker ? Math.min(160, props.panelWidth - 52) : props.panelWidth * 0.36} />
        </View>
      </View>
      <View style={{ marginLeft: props.compactPicker ? 0 : 10, padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: props.colors.ui.actionBar.itemBorder }}>
        <PickerSectionHeading label={props.resultScopeLabel} detail={props.t('chat.countItems', { count: props.resultTotalCount })} colors={props.colors} />
        <View style={{ marginTop: 8 }}>{props.selectedModels.length ? <ModelGroups props={props} family="liquid-glass" modelMaxWidth={props.compactPicker ? props.panelWidth - 52 : props.panelWidth * 0.44} /> : <PickerEmptyState title={props.modelEmptyTitle} description={props.modelEmptyDescription} minHeight={props.modelListHeight} />}</View>
      </View>
    </View>
  )
}

function IsleModelPicker(props: ThemeModelPickerProps) {
  return (
    <View testID="chat-model-picker-animal-island-ui" style={{ gap: 12, minHeight: props.pickerMinHeight }}>
      <IslePanel radius={props.colors.ui.radius.panel} contentStyle={{ padding: 10, gap: 8 }}>
        <PickerSectionHeading label={props.t('settings.providerManagement')} detail={props.t('chat.countItems', { count: props.providerCount })} colors={props.colors} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <PickerCategories props={props} family="animal-island-ui" maxWidth={props.compactPicker ? Math.min(160, props.panelWidth - 44) : props.panelWidth * 0.36} />
        </View>
      </IslePanel>
      <View style={{ minWidth: 0, gap: 10, padding: 10 }}>
        <PickerSectionHeading label={props.resultScopeLabel} detail={props.t('chat.countItems', { count: props.resultTotalCount })} colors={props.colors} />
        {props.selectedModels.length ? <ModelGroups props={props} family="animal-island-ui" modelMaxWidth={props.compactPicker ? props.panelWidth - 44 : props.panelWidth * 0.44} /> : <PickerEmptyState title={props.modelEmptyTitle} description={props.modelEmptyDescription} minHeight={props.modelListHeight} />}
      </View>
    </View>
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

function PickerEmptyState({ title, description, minHeight }: { title: string; description: string; minHeight: number }) {
  const { colors, isLiquidGlass, isMonet } = useAppTheme()
  const surface = isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const borderColor = isMonet ? colors.material.stroke : isLiquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight, borderRadius: colors.ui.radius.field, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', backgroundColor: surface, borderWidth: isMonet ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{description}</Text>
    </View>
  )
}

function ModelCapabilityStrip({ badges }: { badges: ModelCapabilityBadge[] }) {
  const { colors, isLiquidGlass, isMonet } = useAppTheme()
  const surface = isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const borderColor = isMonet ? colors.material.stroke : isLiquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
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
            borderWidth: isMonet ? 1 : StyleSheet.hairlineWidth,
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

function disambiguateModelPickerItems(models: ModelPickerItem[]): ModelPickerItem[] {
  const nameCounts = new Map<string, number>()
  for (const model of models) {
    const key = model.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  return models.map((model) => {
    const key = model.name.trim().toLowerCase()
    return (nameCounts.get(key) ?? 0) > 1 && !model.subtitle
      ? { ...model, subtitle: model.id }
      : model
  })
}

function groupModelPickerItemsByToken(provider: AIProvider, models: ModelPickerItem[], t: TFunction): ModelPickerGroup[] {
  if (!models.length) return []
  const byId = new Map(models.map((model) => [model.id, model]))
  if (provider.modelConfigs?.some(model => model.upstreamProvider)) {
    return groupProviderModelsBySource(provider, models.map(model => model.id)).map(source => ({
      id: source.id || 'provider',
      label: source.automatic ? t('providerSettings.automaticRouting') : source.name,
      models: source.models.map(id => byId.get(id)!),
    }))
  }
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
  const { colors, isMonet } = useAppTheme()
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
        style={{ minHeight: 46, borderRadius: colors.ui.radius.field, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: isMonet ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.input.border, fontSize: 14, fontWeight: '700' }}
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
