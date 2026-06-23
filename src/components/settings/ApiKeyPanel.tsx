import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AIProvider, ProviderCapabilities, ProviderCredentialGroup, ProviderModelTestCapabilityCheck, ProviderModelTestCapabilityCheckStatus, ProviderPresetId, ProviderWireProtocol } from '@/types'
import { getModelName } from '@/types'
import { applyProviderPreset, detectProviderPreset, getProviderPreset, maskSecret, parseCredentialGroups, probeProviderPreset, PROVIDER_PRESETS } from '@/services/ai/providerRegistry'
import { looksLikeProviderImportConnectionText, parseProviderImportDraft } from '@/services/ai/providerImportDraft'
import { DEFAULT_PROVIDER_PRESET_ID, PROVIDER_WIRE_PROTOCOL_OPTIONS, inferProviderWireProtocolFromBaseUrl, initialProviderPresetId, initialProviderWireProtocol, resolveProviderConfigDraft, shouldSyncWireProtocolFromBaseUrl } from '@/services/ai/providerConfigPolicy'
import { syncAndTestProvider, summarizeProviderActivation } from '@/services/providerActivation'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { AppIcon } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleField } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { parseModelEntries } from '@/utils/text'
import { getProviderManualModels, summarizeProviderModelInventory } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels, getPolicyPreferredProviderModel } from '@/services/ai/policy/providerModelAccess'
import {
  buildProviderCapabilityMatrix,
  buildProviderModelCapabilityMatrix,
  PROVIDER_MODEL_CAPABILITY_KEYS,
  summarizeProviderCapabilityMatrix,
  summarizeProviderCapabilityMatrixDetails,
  type ProviderModelCapabilityEvidenceStatus,
} from '@/services/ai/providerCapabilityMatrix'
import { providerCompatibilityCapabilityCanBeSentForProvider, type ProviderCompatibilityBehavior } from '@/services/ai/providerCompatibilityContract'

interface ApiKeyPanelProps {
  provider: AIProvider
  initiallyExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  hideHeader?: boolean
  style?: StyleProp<ViewStyle>
}

type PanelTask = 'idle' | 'saving' | 'syncing' | 'testing' | 'probing' | 'clipboard'

const CAPABILITY_KEYS: (keyof ProviderCapabilities)[] = [
  'modelList',
  'responsesApi',
  'responsesWebSocket',
  'remoteCompact',
  'payloadPolicy',
  'streaming',
  'vision',
  'files',
  'nativeSearch',
  'reasoningEffort',
  'embeddings',
  'topP',
]

const MODEL_TEST_CAPABILITY_DISPLAY_ORDER: ProviderModelTestCapabilityCheck['capability'][] = [
  'chat',
  'streaming',
  'tools',
  'vision',
  'reasoning',
  'responseFormat',
  'responsesApi',
  'files',
  'nativeSearch',
]

function panelCardStyle(colors: ReturnType<typeof useAppTheme>['colors'], borderColor = colors.material.stroke) {
  const resolvedBorderColor = colors.ui.cartoon
    ? borderColor
    : borderColor === colors.material.stroke
      ? colors.ui.glass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
      : borderColor
  return {
    borderRadius: colors.ui.radius.card,
    backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    borderColor: resolvedBorderColor,
  }
}

function quietControlSurface(colors: ReturnType<typeof useAppTheme>['colors'], active: boolean) {
  return {
    backgroundColor: active
      ? colors.ui.control.primaryBackground
      : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.cartoon
          ? colors.ui.semantic.surface.muted
          : colors.ui.semantic.surface.muted,
    borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    borderColor: active
      ? colors.ui.control.primaryBorder
      : colors.ui.glass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.cartoon
          ? colors.material.stroke
          : colors.ui.semantic.chrome.border,
  }
}

export function ApiKeyPanel({
  provider,
  initiallyExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  hideHeader = false,
  style,
}: ApiKeyPanelProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const removeProvider = useSettingsStore((state) => state.removeProvider)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const settings = useSettingsStore((state) => state.settings)
  const defaultProvider = settings.defaultProvider
  const modelTestModel = settings.modelTestModel
  const modelTestCheckParameters = settings.modelTestCheckParameters
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const [localExpanded, setLocalExpanded] = useState(initiallyExpanded)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [presetId, setPresetId] = useState<ProviderPresetId>(initialProviderPresetId(provider))
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(initialProviderWireProtocol(provider))
  const [credentialText, setCredentialText] = useState('')
  const [modelsText, setModelsText] = useState(formatModelEntries(provider))
  const [draftGroups, setDraftGroups] = useState<ProviderCredentialGroup[]>(provider.credentialGroups ?? [])
  const [modelEditing, setModelEditing] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [groupKeyMasks, setGroupKeyMasks] = useState<Record<string, string>>({})
  const [task, setTask] = useState<PanelTask>('idle')
  const [notice, setNotice] = useState('')

  const hydratedGroups = draftGroups
  const detection = useMemo(() => detectProviderPreset({ baseUrl, name: provider.name, apiKey: credentialText }), [baseUrl, credentialText, provider.name])
  const selectedPreset = getProviderPreset(presetId)
  const providerConfigDraft = useMemo(() => resolveProviderConfigDraft({ provider, presetId, baseUrl, wireProtocol }), [baseUrl, presetId, provider, wireProtocol])
  const modelEntries = useMemo(() => parseModelEntries(modelsText), [modelsText])
  const currentModels = modelEntries.models
  const customModels = useMemo(() => getProviderManualModels(provider), [provider])
  const availableModels = useMemo(() => getPolicyAllowedProviderModels(provider, settings), [provider, settings])
  const remoteModels = useMemo(() => getRemoteModelIds(provider, availableModels), [availableModels, provider])
  const modelInventory = useMemo(() => summarizeProviderModelInventory(provider), [provider])
  const preferredModel = getPolicyPreferredProviderModel(provider, settings)
  const primaryModel = preferredModel ?? availableModels[0] ?? currentModels[0] ?? t('apiKeyPanel.noModelSet')
  const expanded = controlledExpanded ?? localExpanded
  const groupCount = hydratedGroups.length
  const hasKey = hydratedGroups.some((group) => group.enabled) || !!credentialText.trim()
  const isDefault = defaultProvider === provider.id
  const capabilitySummary = buildCapabilitySummary(provider, selectedPreset, t)
  const isBusy = task !== 'idle'
  const lastStatusLabel = provider.lastTestStatus === 'ok' ? t('apiKeyPanel.modelAvailable') : provider.lastTestStatus === 'bad' ? t('apiKeyPanel.needsCheck') : provider.lastModelSyncStatus === 'ok' ? t('apiKeyPanel.syncedNeedsTest') : provider.lastModelSyncStatus === 'bad' ? t('apiKeyPanel.syncFailed') : availableModels.length ? t('apiKeyPanel.pendingCheck') : t('apiKeyPanel.noAvailableModels')
  const lastStatusTone = provider.lastTestStatus === 'ok' ? 'success' : provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad' ? 'danger' : provider.lastModelSyncStatus === 'ok' ? 'warning' : 'muted'

  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? '')
    setPresetId(initialProviderPresetId(provider))
    setWireProtocol(initialProviderWireProtocol(provider))
    setModelsText(formatModelEntries(provider))
    setDraftGroups(provider.credentialGroups ?? [])
    setModelEditing(false)
    setAdvancedOpen(false)
    setGroupKeyMasks({})
    setCredentialText('')
    setNotice('')
  }, [provider.baseUrl, provider.detectedPresetId, provider.id, provider.manualModels, provider.modelAliases, provider.models, provider.presetId, provider.wireProtocol])

  useEffect(() => {
    if (controlledExpanded !== undefined) return
    setLocalExpanded(initiallyExpanded)
  }, [controlledExpanded, initiallyExpanded, provider.id])

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    void hydrateProviderKey(provider.id).then((keyed) => {
      if (cancelled || !keyed) return
      const masks = Object.fromEntries((keyed.credentialGroups ?? []).map((group) => [group.id, maskSecret(group.apiKey ?? '')]))
      setGroupKeyMasks(masks)
    })
    return () => {
      cancelled = true
    }
  }, [expanded, hydrateProviderKey, provider.id, provider.credentialGroups])

  async function save(showNotice = true) {
    setTask('saving')
    const pastedGroups = createIncomingGroups(draftGroups.length, credentialText, t)
    const credentialGroups = mergeGroups(draftGroups, pastedGroups, t)
    const parsedModels = parseModelEntries(modelsText)
    const models = parsedModels.models
    const applied = applyProviderPreset({
      ...provider,
      baseUrl: providerConfigDraft.baseUrl,
      credentialMode: providerConfigDraft.credentialMode,
      tokenPlanRegion: providerConfigDraft.tokenPlanRegion,
      wireProtocol: providerConfigDraft.wireProtocol,
      credentialGroups,
      models,
      manualModels: models,
      modelAliases: parsedModels.aliases,
      enabled: provider.enabled,
      detectionStatus: provider.detectionStatus ?? 'detected',
    }, presetId)
    await updateProvider(provider.id, {
      ...applied,
      lastTestStatus: 'idle',
      lastTestModel: undefined,
      lastTestMessage: undefined,
      lastTestCode: undefined,
      lastModelTestCapabilityChecks: undefined,
    })
    if (credentialGroups.some((group) => group.enabled)) {
      updateSettings({ onboardingCompleted: true })
    }
    setCredentialText('')
    setModelEditing(false)
    setTask('idle')
    if (showNotice) {
      const message = pastedGroups.length ? t('apiKeyPanel.savedGroups', { count: credentialGroups.length }) : t('apiKeyPanel.savedConfig')
      setNotice(message)
      dialog.toast({ title: t('apiKeyPanel.providerSaved', { name: provider.name }), message, tone: 'mint' })
    }
  }

  function addPendingGroups() {
    const incoming = createIncomingGroups(draftGroups.length, credentialText, t)
    if (!incoming.length) {
      setNotice(t('apiKeyPanel.enterTokensFirst'))
      dialog.toast({ title: t('apiKeyPanel.noTokenAdded'), message: t('apiKeyPanel.enterTokensFirst'), tone: 'amber' })
      return
    }
    setDraftGroups((current) => mergeGroups(current, incoming, t))
    setCredentialText('')
    setNotice(t('apiKeyPanel.pendingGroupsAdded', { count: incoming.length }))
    dialog.toast({ title: t('apiKeyPanel.groupsAdded', { count: incoming.length }), message: provider.name, tone: 'mint' })
  }

  function applyProviderImportDraftText(text: string, source: 'clipboard' | 'manual'): boolean {
    const draft = parseProviderImportDraft(text, { requireConnection: source === 'manual', preferredWireProtocol: wireProtocol })
    if (!draft) return false
    if (draft.baseUrl) {
      const nextDraft = resolveProviderConfigDraft({ provider: draft.provider, presetId: draft.presetId, baseUrl: draft.baseUrl, wireProtocol: draft.wireProtocol })
      setPresetId(draft.presetId)
      setWireProtocol(draft.wireProtocol)
      setBaseUrl(nextDraft.baseUrl)
    }
    setDraftGroups((current) => mergeGroups(current, draft.provider.credentialGroups ?? [], t))
    setCredentialText('')
    if (draft.modelText) setModelsText(draft.modelText)
    const messageKey = source === 'clipboard' && draft.count > 1 ? 'providerSettings.importAppliedFirst' : 'providerSettings.importDetected'
    setNotice(t(messageKey, { count: draft.count }))
    dialog.toast({
      title: t('providerSettings.clipboardDetected'),
      message: t(messageKey, { count: draft.count }),
      tone: 'mint',
    })
    return true
  }

  function handleBaseUrlText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setBaseUrl(value)
    if (shouldSyncWireProtocolFromBaseUrl(providerConfigDraft)) setWireProtocol(inferProviderWireProtocolFromBaseUrl(value))
    setNotice('')
  }

  function handleCredentialText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setCredentialText(value)
    setNotice('')
  }

  async function readProviderClipboard() {
    if (isBusy) return
    setTask('clipboard')
    dialog.toast({
      title: t('providerSettings.clipboardPermissionRequest'),
      message: t('providerSettings.clipboardPermissionMessage'),
      tone: 'mint',
      durationMs: 1400,
    })
    try {
      const hasText = await Clipboard.hasStringAsync()
      if (!hasText) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      const text = await Clipboard.getStringAsync()
      if (!text.trim()) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      if (!applyProviderImportDraftText(text, 'clipboard')) {
        dialog.toast({ title: t('providerSettings.clipboardRead'), message: t('providerSettings.clipboardNoConfig'), tone: 'amber' })
      }
    } catch (error) {
      dialog.toast({
        title: t('providerSettings.clipboardReadFailed'),
        message: clipboardReadFailureMessage(error, t),
        tone: 'amber',
      })
    } finally {
      setTask('idle')
    }
  }

  function updateDraftGroup(groupId: string, updates: Partial<ProviderCredentialGroup>) {
    setDraftGroups((groups) => groups.map((group) => group.id === groupId ? { ...group, ...updates } : group))
    setNotice(t('apiKeyPanel.groupChangePending'))
    if (updates.enabled !== undefined) {
      const group = draftGroups.find((item) => item.id === groupId)
      dialog.toast({ title: updates.enabled ? t('apiKeyPanel.groupEnabled') : t('apiKeyPanel.groupDisabled'), message: group?.label ?? provider.name, tone: 'mint' })
    }
  }

  async function deleteDraftGroup(groupId: string) {
    const group = draftGroups.find((item) => item.id === groupId)
    const nextGroups = draftGroups.filter((group) => group.id !== groupId)
    setDraftGroups(nextGroups)
    await updateProvider(provider.id, { credentialGroups: nextGroups })
    setNotice(t('apiKeyPanel.groupDeleted'))
    dialog.toast({ title: t('apiKeyPanel.groupDeleted'), message: group?.label ?? provider.name, tone: 'amber' })
  }

  async function acceptDetection() {
    setPresetId(detection.presetId)
    const preset = getProviderPreset(detection.presetId)
    applyPresetDraft(detection.presetId, inferProviderWireProtocolFromBaseUrl(baseUrl))
    setNotice(t('apiKeyPanel.presetSelected', { name: preset.name }))
    dialog.toast({ title: t('apiKeyPanel.detectionApplied'), message: `${provider.name} · ${preset.name}`, tone: 'mint' })
  }

  async function probeDetection() {
    setTask('probing')
    dialog.toast({ title: t('apiKeyPanel.interfaceProbeStarted'), message: provider.name, tone: 'mint' })
    const result = await probeProviderPreset({ baseUrl, name: provider.name, apiKey: await getProbeApiKey() })
    setPresetId(result.presetId)
    const preset = getProviderPreset(result.presetId)
    applyPresetDraft(result.presetId, inferProviderWireProtocolFromBaseUrl(baseUrl))
    setTask('idle')
    setNotice(result.reason)
    dialog.toast({ title: t('apiKeyPanel.interfaceProbeDone'), message: `${provider.name} · ${getProviderPreset(result.presetId).name}`, tone: 'mint' })
  }

  async function syncAndTest() {
    setTask('syncing')
    dialog.toast({ title: t('apiKeyPanel.fetchAndTestStarted'), message: provider.name, tone: 'mint' })
    await save(false)
    const current = useSettingsStore.getState().providers.find((item) => item.id === provider.id) ?? provider
    const result = await syncAndTestProvider(current, {
      updateProvider: useSettingsStore.getState().updateProvider,
      hydrateProviderKey: useSettingsStore.getState().hydrateProviderKey,
      updateProviderCredentialGroupHealth: useSettingsStore.getState().updateProviderCredentialGroupHealth,
    }, { enable: provider.enabled, testModel: modelTestModel, checkParameters: modelTestCheckParameters, accessSettings: settings })
    const latest = useSettingsStore.getState().providers.find((item) => item.id === provider.id)
    if (latest) setModelsText(formatModelEntries(latest))
    setTask('idle')
    const summary = summarizeProviderActivation([result])
    if (result.testOk) {
      updateSettings({ defaultProvider: result.providerId, onboardingCompleted: true })
    }
    setNotice(summary.message)
    dialog.notice({ title: result.testOk ? t('apiKeyPanel.fetchAndTestDone') : t('apiKeyPanel.fetchAndTestNeedsCheck'), message: summary.message, tone: summary.tone })
  }

  async function toggleProviderEnabled() {
    const enabled = !provider.enabled
    if (!enabled) {
      await updateProvider(provider.id, { enabled })
      dialog.toast({ title: t('apiKeyPanel.providerDisabled', { name: provider.name }), tone: 'mint' })
      return
    }
    await save(false)
    setTask('syncing')
    dialog.toast({ title: t('providerSettings.activatingProvider'), message: provider.name, tone: 'mint', durationMs: 1600 })
    const current = useSettingsStore.getState().providers.find((item) => item.id === provider.id) ?? provider
    const result = await syncAndTestProvider(current, {
      updateProvider: useSettingsStore.getState().updateProvider,
      hydrateProviderKey: useSettingsStore.getState().hydrateProviderKey,
      updateProviderCredentialGroupHealth: useSettingsStore.getState().updateProviderCredentialGroupHealth,
    }, { enable: true, testModel: modelTestModel, checkParameters: modelTestCheckParameters, accessSettings: settings })
    const summary = summarizeProviderActivation([result])
    if (result.testOk) {
      updateSettings({ defaultProvider: result.providerId, onboardingCompleted: true })
    }
    setTask('idle')
    setNotice(summary.message)
    dialog.toast({ title: t('apiKeyPanel.providerEnabled', { name: provider.name }), message: summary.message, tone: summary.tone, position: 'bottom', durationMs: summary.tone === 'danger' ? 6500 : summary.tone === 'amber' ? 5200 : 3600 })
  }

  function setDefaultProvider() {
    updateSettings({ defaultProvider: provider.id, onboardingCompleted: true })
    dialog.toast({ title: t('apiKeyPanel.defaultUpdated'), message: provider.name, tone: 'mint' })
  }

  async function confirmRemoveProvider() {
    const confirmed = await dialog.confirm({
      title: t('apiKeyPanel.deleteProviderTitle'),
      message: t('apiKeyPanel.deleteProviderMessage', { name: provider.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await removeProvider(provider.id)
    dialog.toast({ title: t('apiKeyPanel.providerDeleted'), message: provider.name, tone: 'mint' })
  }

  function cancelModelEditing() {
    setModelsText(formatModelEntries(provider))
    setModelEditing(false)
    setNotice('')
    dialog.toast({ title: t('apiKeyPanel.modelEditCancelled'), message: provider.name, tone: 'amber' })
  }

  function enterModelEditing() {
    setModelEditing(true)
    dialog.toast({ title: t('apiKeyPanel.modelListEditable'), message: provider.name, tone: 'mint' })
  }

  function appendModelEntry(model: string) {
    const parsed = parseModelEntries(modelsText)
    if (parsed.models.includes(model)) {
      setModelEditing(true)
      return
    }
    setModelsText([modelsText.trim(), model].filter(Boolean).join('\n'))
    setModelEditing(true)
    setNotice(t('apiKeyPanel.modelInserted', { model }))
  }

  function selectPreset(nextPresetId: ProviderPresetId) {
    applyPresetDraft(nextPresetId, wireProtocol)
  }

  function selectWireProtocol(nextProtocol: ProviderWireProtocol) {
    setWireProtocol(nextProtocol)
    setBaseUrl(resolveProviderConfigDraft({ provider, presetId, baseUrl, wireProtocol: nextProtocol }).baseUrl)
    setNotice(t('apiKeyPanel.protocolChanged', { protocol: t(`providerSettings.protocol.${nextProtocol}`) }))
  }

  async function toggleCapability(key: keyof ProviderCapabilities) {
    const current = provider.capabilities ?? selectedPreset.capabilities
    const next = { ...current, [key]: current[key] !== true }
    if (key === 'responsesApi' && next.responsesApi !== true) {
      next.responsesWebSocket = false
      next.remoteCompact = false
    }
    if ((key === 'responsesWebSocket' || key === 'remoteCompact') && next[key] === true) {
      next.responsesApi = true
    }
    await updateProvider(provider.id, { capabilities: next })
    dialog.toast({ title: t('apiKeyPanel.capabilityUpdated'), message: t(`apiKeyPanel.capability.${key}`), tone: 'mint' })
  }

  function applyPresetDraft(nextPresetId: ProviderPresetId, nextWireProtocol: ProviderWireProtocol) {
    const nextDraft = resolveProviderConfigDraft({ provider, presetId: nextPresetId, baseUrl, wireProtocol: nextWireProtocol })
    setPresetId(nextPresetId)
    setWireProtocol(nextWireProtocol)
    setBaseUrl(nextDraft.baseUrl)
  }

  async function getProbeApiKey(): Promise<string | undefined> {
    const typed = parseCredentialGroups(credentialText)[0]?.apiKey
    if (typed) return typed
    const keyed = await hydrateProviderKey(provider.id)
    return keyed?.credentialGroups?.find((group) => group.enabled && group.apiKey?.trim())?.apiKey ?? keyed?.apiKey
  }

  function setPanelExpanded(next: boolean) {
    if (controlledExpanded === undefined) setLocalExpanded(next)
    onExpandedChange?.(next)
  }

  return (
    <MotiView
      animate={{ scale: hideHeader ? 1 : expanded ? 1 : 0.995, opacity: provider.enabled ? 1 : 0.82 }}
      transition={{ type: 'spring', damping: 22, stiffness: 180 }}
      style={[{
        borderRadius: colors.ui.radius.panel,
        padding: compact ? 8 : 10,
        backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
        borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
        borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border,
        marginBottom: hideHeader ? 0 : 8,
      }, style]}
    >
      {!hideHeader ? (
        <IslePressable haptic onPress={() => setPanelExpanded(!expanded)} style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
            {provider.presetId === 'newapi' || provider.presetId === 'sub2api' ? <AppIcon name="spark" color={colors.ui.icon.accentForeground} size={18} /> : <AppIcon name="key" color={colors.ui.icon.accentForeground} size={18} />}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '900', flexShrink: 1, minWidth: 0, includeFontPadding: false }}>{provider.name}</Text>
              {isDefault ? <Badge label={t('settings.default')} tone="warning" /> : null}
              <MiniBadge label={provider.enabled ? t('apiKeyPanel.enabled') : t('apiKeyPanel.disabled')} tone={provider.enabled ? 'success' : 'muted'} />
              <MiniBadge label={lastStatusLabel} tone={lastStatusTone === 'danger' ? 'warning' : lastStatusTone === 'success' ? 'success' : 'muted'} />
            </View>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 14, marginTop: 2, includeFontPadding: false }}>
              {getModelName(primaryModel)} · {t('apiKeyPanel.modelCount', { count: availableModels.length })} · {t('apiKeyPanel.tokenGroups', { count: Math.max(groupCount, hasKey ? 1 : 0) })}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 12, marginTop: 2, fontWeight: '800', includeFontPadding: false }}>
              {capabilitySummary}
            </Text>
          </View>
          {provider.lastTestStatus === 'ok' ? <AppIcon name="check" color={colors.ui.tone.success.foreground} size={17} /> : null}
          {provider.lastTestStatus === 'bad' ? <AppIcon name="refresh" color={colors.ui.tone.danger.foreground} size={17} /> : null}
          <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 180 }}>
            <AppIcon name="collapse" color={colors.textTertiary} size={18} />
          </MotiView>
        </IslePressable>
      ) : null}

      {expanded ? (
        <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'spring', damping: 20, stiffness: 180 }} style={{ marginTop: hideHeader ? 0 : 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <MiniAction active={isDefault} label={isDefault ? t('settings.default') : t('apiKeyPanel.setDefault')} onPress={setDefaultProvider}>
              <AppIcon name="star" color={isDefault ? colors.ui.control.primaryForeground : colors.textTertiary} size={15} fill={isDefault ? colors.ui.control.primaryForeground : 'transparent'} />
            </MiniAction>
            <MiniAction active={provider.enabled} label={provider.enabled ? t('apiKeyPanel.enabledState') : t('apiKeyPanel.disabledState')} onPress={() => void toggleProviderEnabled()}>
              <AppIcon name="power" color={provider.enabled ? colors.ui.control.primaryForeground : colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={t('common.delete')} onPress={() => void confirmRemoveProvider()} disabled={isBusy}>
              <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
            </MiniAction>
            <MiniAction label={t('apiKeyPanel.fetchModelsAndTest')} onPress={() => void syncAndTest()} disabled={isBusy || !hasKey}>
              <AppIcon name="filter" color={colors.textTertiary} size={15} />
            </MiniAction>
          </View>

          {providerConfigDraft.isProtocolSelectable ? (
            <View style={{ padding: 11, gap: 9, ...panelCardStyle(colors) }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('providerSettings.protocol.title')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {PROVIDER_WIRE_PROTOCOL_OPTIONS.map((protocol) => (
                  <ChoiceButton key={protocol} active={wireProtocol === protocol} label={t(`providerSettings.protocol.${protocol}`)} onPress={() => selectWireProtocol(protocol)} />
                ))}
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('providerSettings.protocol.endpointNote')}</Text>
            </View>
          ) : null}

          <IsleField
            label={t('providerSettings.baseUrl')}
            inputProps={{
              value: baseUrl,
              onChangeText: handleBaseUrlText,
              autoCapitalize: 'none',
              autoCorrect: false,
              returnKeyType: 'done',
              placeholder: selectedPreset.baseUrl ?? (resolveProviderConfigDraft({ provider, presetId: DEFAULT_PROVIDER_PRESET_ID }).baseUrl || 'https://new-api.example.com/v1'),
            }}
          />

          <IslePressable
            haptic
            onPress={() => setAdvancedOpen((value) => !value)}
            style={{ minHeight: 42, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border }}
          >
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '900', includeFontPadding: false }}>{t('apiKeyPanel.advancedInterfaceSettings')}</Text>
            <MotiView animate={{ rotate: advancedOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
              <AppIcon name="collapse" color={colors.textTertiary} size={16} />
            </MotiView>
          </IslePressable>

          {advancedOpen ? (
            <View style={{ gap: 10 }}>
              <View style={{ padding: 11, ...panelCardStyle(colors) }}>
                <SectionHeader
                  title={t('apiKeyPanel.autoDetect')}
                  description={`${detection.reason} · ${t('apiKeyPanel.suggestedPreset', { name: getProviderPreset(detection.presetId).name })}`}
                  action={
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <MiniAction label={t('apiKeyPanel.applyDetection')} onPress={() => void acceptDetection()}>
                        <AppIcon name="search-check" color={colors.textTertiary} size={15} />
                      </MiniAction>
                      <MiniAction label={task === 'probing' ? t('apiKeyPanel.probing') : t('apiKeyPanel.detectInterface')} onPress={() => void probeDetection()} disabled={isBusy || !baseUrl.trim() || !hasKey}>
                        <AppIcon name="spark" color={colors.textTertiary} size={15} />
                      </MiniAction>
                    </View>
                  }
                />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {PROVIDER_PRESETS.map((preset) => (
                    <ChoiceButton key={preset.id} active={presetId === preset.id} label={preset.name} onPress={() => selectPreset(preset.id)} />
                  ))}
                </View>
              </View>

              <View style={{ padding: 11, gap: 10, ...panelCardStyle(colors) }}>
                <SectionHeader
                  title={t('apiKeyPanel.capabilityMatrix')}
                  description={`${t('apiKeyPanel.capabilityMatrixDescription')} ${t('apiKeyPanel.capabilityDependencyHint')}`}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CAPABILITY_KEYS.map((key) => (
                    <CapabilityToggle
                      key={key}
                      label={t(`apiKeyPanel.capability.${key}`)}
                      active={(provider.capabilities ?? selectedPreset.capabilities)[key] === true}
                      onPress={() => void toggleCapability(key)}
                    />
                  ))}
                </View>
              </View>
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <SectionHeader
              title={t('apiKeyPanel.credentialGroups')}
              action={
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <MiniAction label={task === 'clipboard' ? t('providerSettings.clipboardChecking') : t('settings.pasteClipboard')} onPress={() => void readProviderClipboard()} disabled={isBusy}>
                    <AppIcon name="paste" color={colors.textTertiary} size={15} />
                  </MiniAction>
                  <MiniAction label={t('apiKeyPanel.add')} onPress={addPendingGroups} disabled={isBusy || !credentialText.trim()}>
                    <AppIcon name="add" color={colors.textTertiary} size={15} />
                  </MiniAction>
                </View>
              }
            />
            {hydratedGroups.length ? (
              <View style={{ gap: 8 }}>
                {hydratedGroups.map((group, index) => (
                  <CredentialGroupRow
                    key={group.id}
                    group={group}
                    index={index}
                    maskedKey={groupKeyMasks[group.id] || maskSecret(group.apiKey ?? '')}
                    onChangeLabel={(label) => updateDraftGroup(group.id, { label })}
                    onToggle={() => updateDraftGroup(group.id, { enabled: !group.enabled })}
                    onDelete={() => void deleteDraftGroup(group.id)}
                  />
                ))}
              </View>
            ) : (
              <View style={{ padding: 12, ...panelCardStyle(colors) }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>{t('apiKeyPanel.noCredentialGroups')}</Text>
              </View>
            )}
            <IsleField
              label={t('apiKeyPanel.addTokens')}
              note={t('apiKeyPanel.addTokensNote')}
              inputProps={{
                value: credentialText,
                onChangeText: handleCredentialText,
                secureTextEntry: false,
                autoCapitalize: 'none',
                autoCorrect: false,
                multiline: true,
                blurOnSubmit: false,
                placeholder: 'sk-...\nsk-...\n{\"keys\":[\"sk-...\"]}',
                style: { minHeight: 98, maxHeight: 160, textAlignVertical: 'top' },
              }}
            />
          </View>

          <View style={{ gap: 10 }}>
            <SectionHeader
              title={t('apiKeyPanel.modelList')}
              description={modelEditing ? t('apiKeyPanel.editing') : t('apiKeyPanel.modelInventory', {
                remote: modelInventory.remoteModels,
                manual: modelInventory.manualModels,
                alias: modelInventory.aliases,
                selectable: modelInventory.selectableModels,
              })}
              action={
                modelEditing ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <MiniAction label={t('common.cancel')} onPress={cancelModelEditing}>
                      <AppIcon name="refresh" color={colors.textTertiary} size={15} />
                    </MiniAction>
                    <MiniAction label={t('common.save')} onPress={() => void save()} disabled={isBusy}>
                      <AppIcon name="check" color={colors.textTertiary} size={15} />
                    </MiniAction>
                  </View>
                ) : (
                  <MiniAction label={t('common.edit')} onPress={enterModelEditing}>
                    <AppIcon name="filter" color={colors.textTertiary} size={15} />
                  </MiniAction>
                )
              }
            />
            {modelEditing ? (
              <View style={{ gap: 10 }}>
                {remoteModels.length ? (
                  <View style={{ padding: 11, gap: 8, ...panelCardStyle(colors) }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{t('apiKeyPanel.remoteModels')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                      {remoteModels.slice(0, 16).map((model) => (
                        <ChoiceButton key={model} active={false} label={getModelName(model)} onPress={() => appendModelEntry(model)} />
                      ))}
                      {remoteModels.length > 16 ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{remoteModels.length - 16}</Text> : null}
                    </View>
                  </View>
                ) : null}
                <IsleField
                  label={t('apiKeyPanel.customModelAliases')}
                  note={t('apiKeyPanel.modelAliasHelp')}
                  inputProps={{
                    value: modelsText,
                    onChangeText: (value) => {
                      setModelsText(value)
                      setNotice('')
                    },
                    autoCapitalize: 'none',
                    autoCorrect: false,
                    multiline: true,
                    blurOnSubmit: false,
                    placeholder: `${t('providerSettings.oneModelPerLine')}\n${t('apiKeyPanel.aliasPlaceholder')}`,
                    style: { minHeight: 116, maxHeight: 190, paddingVertical: 12, lineHeight: 20, textAlignVertical: 'top' },
                  }}
                />
              </View>
            ) : (
              <>
                <ModelSummary remoteModels={remoteModels} customModels={customModels} aliases={provider.modelAliases ?? []} manualCount={modelInventory.manualModels} selectableCount={availableModels.length} />
                <ModelCapabilityEvidencePanel provider={provider} models={availableModels.length ? availableModels : currentModels} />
                <ModelTestCapabilityPanel provider={provider} />
              </>
            )}
          </View>

          {provider.lastModelSyncMessage || provider.lastTestMessage ? (
            <View style={{ padding: 10, ...panelCardStyle(colors) }}>
              {provider.lastModelSyncMessage ? <Text style={{ color: provider.lastModelSyncStatus === 'bad' ? colors.ui.tone.danger.foreground : colors.textSecondary, fontSize: 11, lineHeight: 16 }}>{t('apiKeyPanel.syncAndTestLabel', { message: provider.lastModelSyncMessage })}</Text> : null}
              {provider.lastTestMessage && provider.lastTestMessage !== provider.lastModelSyncMessage ? <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.ui.tone.danger.foreground : colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: provider.lastModelSyncMessage ? 3 : 0 }}>{provider.lastTestMessage}</Text> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton label={task === 'saving' ? t('apiKeyPanel.saving') : t('common.save')} busy={task === 'saving'} onPress={() => void save()} />
            <ActionButton label={t('apiKeyPanel.fetchModelsAndTest')} busy={task === 'syncing'} disabled={!hasKey || isBusy} onPress={() => void syncAndTest()} secondary />
          </View>

          {notice ? <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.ui.tone.danger.foreground : colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{notice}</Text> : null}
        </MotiView>
      ) : null}
    </MotiView>
  )
}

function clipboardReadFailureMessage(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  return /permission|denied|not.?allowed|nopermission/i.test(message)
    ? t('providerSettings.clipboardPermissionDenied')
    : t('providerSettings.clipboardUnavailable')
}

function createIncomingGroups(offset: number, input: string, t: TFunction): ProviderCredentialGroup[] {
  return parseCredentialGroups(input).map((group, index) => ({
    ...group,
    label: t('apiKeyPanel.groupName', { index: offset + index + 1 }),
  }))
}

function mergeGroups(existing: ProviderCredentialGroup[], incoming: ProviderCredentialGroup[], t: TFunction): ProviderCredentialGroup[] {
  const seenKeys = new Set<string>()
  return [...existing, ...incoming].filter((group) => {
    const key = group.apiKey?.trim()
    if (!key) return true
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  }).map((group, index) => ({
    ...group,
    label: group.label || t('apiKeyPanel.groupName', { index: index + 1 }),
  }))
}

function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  return <IsleChip tone={tone === 'warning' ? 'amber' : tone === 'danger' ? 'danger' : tone === 'success' ? 'mint' : 'default'}>{label}</IsleChip>
}

function MiniBadge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'muted' }) {
  const { colors } = useAppTheme()
  const toneToken = tone === 'success'
    ? colors.ui.tone.success
    : tone === 'warning'
      ? colors.ui.tone.warning
      : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 22, borderRadius: colors.ui.radius.chip, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: toneToken.background, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: toneToken.border }}>
      <Text style={{ color: toneToken.foreground, fontSize: 10, fontWeight: '900' }}>{label}</Text>
    </View>
  )
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic onPress={onPress} style={{ minHeight: 40, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', ...quietControlSurface(colors, active) }}>
      <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false }}>{label}</Text>
    </IslePressable>
  )
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900', includeFontPadding: false }}>{title}</Text>
        {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, includeFontPadding: false }}>{description}</Text> : null}
      </View>
      {action}
    </View>
  )
}

function CredentialGroupRow({
  group,
  index,
  maskedKey,
  onChangeLabel,
  onToggle,
  onDelete,
}: {
  group: ProviderCredentialGroup
  index: number
  maskedKey: string
  onChangeLabel: (label: string) => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const statusTone = group.lastModelSyncStatus === 'bad' ? colors.ui.tone.danger.foreground : group.enabled ? colors.ui.tone.success.foreground : colors.textTertiary
  const statusText = group.lastModelSyncStatus === 'ok'
    ? t('apiKeyPanel.synced')
    : group.lastModelSyncStatus === 'bad'
      ? t('apiKeyPanel.syncFailed')
      : group.enabled ? t('apiKeyPanel.enabled') : t('apiKeyPanel.disabled')
  return (
    <View style={{ padding: 11, gap: 9, ...panelCardStyle(colors, group.enabled ? colors.material.strokeStrong : colors.material.stroke) }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextInput
          value={group.label}
          onChangeText={onChangeLabel}
          placeholder={t('apiKeyPanel.groupName', { index: index + 1 })}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => onChangeLabel(group.label.trim())}
          textAlignVertical={Platform.OS === 'android' ? 'center' : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            borderRadius: colors.ui.radius.field,
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.ui.input.background,
            borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
            borderColor: colors.ui.input.border,
            fontSize: 13,
            fontWeight: '900',
          }}
        />
        <IconIsleChip label={group.enabled ? t('apiKeyPanel.disabled') : t('apiKeyPanel.enabled')} onPress={onToggle} tone={group.enabled ? 'mint' : 'default'}>
          <AppIcon name="power" color={group.enabled ? colors.ui.tone.success.foreground : colors.textTertiary} size={15} />
        </IconIsleChip>
        <IconIsleChip label={t('common.delete')} onPress={onDelete} tone="danger">
          <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
        </IconIsleChip>
      </View>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', maxWidth: '100%', includeFontPadding: false }}>{maskedKey || t('apiKeyPanel.newTokenPending')}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{t('apiKeyPanel.modelCount', { count: group.availableModels?.length ?? 0 })}</Text>
        <Text numberOfLines={1} style={{ color: statusTone, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false }}>{statusText}</Text>
        {group.failureCount ? <Text numberOfLines={1} style={{ color: colors.ui.tone.danger.foreground, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false }}>{t('apiKeyPanel.failureCount', { count: group.failureCount })}</Text> : null}
      </View>
    </View>
  )
}

function formatModelEntries(provider: AIProvider): string {
  const manualModels = getProviderManualModels(provider)
  const aliases = provider.modelAliases ?? []
  return [
    ...manualModels,
    ...aliases.map((item) => `${item.alias}=${item.model}`),
  ].join('\n')
}

function getRemoteModelIds(provider: AIProvider, allowedModels: string[]): string[] {
  const manual = new Set(getProviderManualModels(provider))
  const allowed = new Set(allowedModels)
  const seen = new Set<string>()
  return [
    ...provider.models,
    ...(provider.credentialGroups ?? []).flatMap((group) => group.availableModels ?? []),
    ...(provider.modelAvailability ?? []).map((item) => item.modelId),
  ]
    .map((model) => model.trim())
    .filter((model) => {
      if (!model || manual.has(model) || seen.has(model)) return false
      if (allowed.size && !allowed.has(model)) return false
      seen.add(model)
      return true
    })
}

function ModelSummary({ remoteModels, customModels, aliases, manualCount, selectableCount }: { remoteModels: string[]; customModels: string[]; aliases: NonNullable<AIProvider['modelAliases']>; manualCount: number; selectableCount: number }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const shownRemote = remoteModels.slice(0, 8)
  const shownCustom = customModels.slice(0, 8)
  if (!shownRemote.length && !shownCustom.length && !aliases.length) {
    return (
      <View style={{ padding: 12, ...panelCardStyle(colors) }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>{t('apiKeyPanel.noModels')}</Text>
      </View>
    )
  }
  return (
    <View style={{ padding: 11, gap: 9, ...panelCardStyle(colors) }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <MiniBadge label={t('apiKeyPanel.remoteModelShort', { count: remoteModels.length })} tone={remoteModels.length ? 'success' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.customModelShort', { count: manualCount })} tone={manualCount ? 'warning' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.aliasShort', { count: aliases.length })} tone={aliases.length ? 'warning' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.selectableModelShort', { count: selectableCount })} tone={selectableCount ? 'success' : 'muted'} />
      </View>
      {shownRemote.length ? (
        <ModelChipGroup title={t('apiKeyPanel.remoteModels')} models={shownRemote} remaining={remoteModels.length - shownRemote.length} />
      ) : null}
      {shownCustom.length ? (
        <ModelChipGroup title={t('apiKeyPanel.customModels')} models={shownCustom} remaining={customModels.length - shownCustom.length} />
      ) : null}
      {aliases.length ? (
        <View style={{ gap: 5 }}>
          {aliases.slice(0, 4).map((alias) => (
            <Text key={alias.alias} numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>
              {`${alias.alias} -> ${alias.model}`}
            </Text>
          ))}
          {aliases.length > 4 ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{aliases.length - 4}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

function ModelChipGroup({ title, models, remaining }: { title: string; models: string[]; remaining: number }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {models.map((model) => <ModelChip key={model} label={getModelName(model)} />)}
        {remaining > 0 ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{remaining}</Text> : null}
      </View>
    </View>
  )
}

function ModelChip({ label }: { label: string }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const labelMaxWidth = Math.max(112, Math.min(180, width * 0.46))
  return (
    <View style={{ minHeight: 28, borderRadius: colors.ui.radius.chip, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border }}>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', maxWidth: labelMaxWidth, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
    </View>
  )
}

function ModelCapabilityEvidencePanel({ provider, models }: { provider: AIProvider; models: string[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const shownModels = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).slice(0, 3)
  if (!shownModels.length) return null
  return (
    <View style={{ padding: 11, gap: 10, ...panelCardStyle(colors) }}>
      <SectionHeader
        title={t('apiKeyPanel.modelCapabilityEvidence')}
        description={t('apiKeyPanel.modelCapabilityEvidenceDescription')}
      />
      {shownModels.map((modelId) => {
        const matrix = buildProviderModelCapabilityMatrix(provider, modelId)
        return (
          <View key={modelId} style={{ gap: 7 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false }}>
              {getModelName(modelId)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {PROVIDER_MODEL_CAPABILITY_KEYS.map((key) => {
                const capability = matrix.capabilities.find((item) => item.capability === key)
                if (!capability) return null
                return (
                  <ModelCapabilityEvidenceBadge
                    key={key}
                    label={`${t(`apiKeyPanel.modelCapability.${key}`)} ${t(`apiKeyPanel.modelCapabilityStatus.${capability.status}`)}`}
                    status={capability.status}
                  />
                )
              })}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function ModelCapabilityEvidenceBadge({ label, status }: { label: string; status: ProviderModelCapabilityEvidenceStatus }) {
  const { colors } = useAppTheme()
  const tone = status === 'verified'
    ? colors.ui.tone.success
    : status === 'manual'
      ? colors.ui.tone.warning
      : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 26, maxWidth: 176, borderRadius: colors.ui.radius.chip, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: tone.border }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{ color: tone.foreground, fontSize: 10, lineHeight: 13, fontWeight: '900', includeFontPadding: false }}>
        {label}
      </Text>
    </View>
  )
}

function ModelTestCapabilityPanel({ provider }: { provider: AIProvider }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const checks = sortModelTestCapabilityChecks(provider.lastModelTestCapabilityChecks ?? [])
  if (!checks.length) return null
  return (
    <View style={{ padding: 11, gap: 10, ...panelCardStyle(colors) }}>
      <SectionHeader
        title={t('apiKeyPanel.modelTestCapabilityResults')}
        description={t('apiKeyPanel.modelTestCapabilityResultsDescription', {
          model: provider.lastTestModel ? getModelName(provider.lastTestModel) : t('apiKeyPanel.noModels'),
          status: provider.lastTestStatus === 'ok'
            ? t('apiKeyPanel.modelAvailable')
            : provider.lastTestStatus === 'bad'
              ? t('apiKeyPanel.needsCheck')
              : t('apiKeyPanel.pendingCheck'),
        })}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {checks.map((check) => (
          <ModelTestCapabilityBadge
            key={check.capability}
            label={`${t(`apiKeyPanel.modelCapability.${check.capability}`)} ${t(`apiKeyPanel.modelTestCapabilityStatus.${check.status}`)}`}
            status={check.status}
          />
        ))}
      </View>
    </View>
  )
}

function sortModelTestCapabilityChecks(checks: ProviderModelTestCapabilityCheck[]): ProviderModelTestCapabilityCheck[] {
  return [...checks].sort((left, right) => modelTestCapabilityRank(left.capability) - modelTestCapabilityRank(right.capability))
}

function modelTestCapabilityRank(capability: ProviderModelTestCapabilityCheck['capability']): number {
  const index = MODEL_TEST_CAPABILITY_DISPLAY_ORDER.indexOf(capability)
  return index >= 0 ? index : MODEL_TEST_CAPABILITY_DISPLAY_ORDER.length
}

function ModelTestCapabilityBadge({ label, status }: { label: string; status: ProviderModelTestCapabilityCheckStatus }) {
  const { colors } = useAppTheme()
  const tone = status === 'sent'
    ? colors.ui.tone.success
    : status === 'available'
      ? colors.ui.tone.warning
      : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 26, maxWidth: 176, borderRadius: colors.ui.radius.chip, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: tone.border }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{ color: tone.foreground, fontSize: 10, lineHeight: 13, fontWeight: '900', includeFontPadding: false }}>
        {label}
      </Text>
    </View>
  )
}

function CapabilityToggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: 38,
        borderRadius: colors.ui.radius.controlMiddle,
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        ...quietControlSurface(colors, active),
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? colors.ui.control.primaryForeground : colors.textTertiary }} />
      <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </IslePressable>
  )
}

function buildCapabilitySummary(provider: AIProvider, preset: ReturnType<typeof getProviderPreset>, t: TFunction): string {
  const capabilities = provider.capabilities ?? preset.capabilities
  const matrix = buildProviderCapabilityMatrix(provider)
  const labels = [
    summarizeProviderCapabilityMatrix(matrix),
    summarizeProviderCapabilityMatrixDetails(provider, matrix),
    providerCapabilityLabelEnabled(provider, 'responsesApi', capabilities.responsesApi) ? t('apiKeyPanel.capability.responsesApi') : '',
    providerCapabilityLabelEnabled(provider, 'responsesWebSocket', capabilities.responsesWebSocket) ? t('apiKeyPanel.capability.responsesWebSocket') : '',
    providerCapabilityLabelEnabled(provider, 'remoteCompact', capabilities.remoteCompact) ? t('apiKeyPanel.capability.remoteCompact') : '',
    providerCapabilityLabelEnabled(provider, 'nativeSearch', capabilities.nativeSearch) ? t('apiKeyPanel.capability.nativeSearch') : '',
    providerCapabilityLabelEnabled(provider, 'embeddings', capabilities.embeddings) ? t('apiKeyPanel.capability.embeddings') : '',
  ].filter(Boolean)
  return labels.length ? labels.join(' · ') : t('apiKeyPanel.capabilityMatrix')
}

function providerCapabilityLabelEnabled(provider: AIProvider, capability: ProviderCompatibilityBehavior, enabled: boolean | undefined): boolean {
  return enabled === true && providerCompatibilityCapabilityCanBeSentForProvider(provider, capability, true)
}

function IconIsleChip({ label, children, tone, onPress }: { label: string; children: ReactNode; tone: 'default' | 'mint' | 'danger'; onPress: () => void }) {
  const { colors } = useAppTheme()
  const toneToken = tone === 'mint' ? colors.ui.tone.success : tone === 'danger' ? colors.ui.tone.danger : colors.ui.tone.neutral
  return (
    <IslePressable haptic accessibilityLabel={label} onPress={onPress} style={{ width: 42, height: 42, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : toneToken.background, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : toneToken.border }}>
      {children}
    </IslePressable>
  )
}

function MiniAction({ label, children, active = false, disabled = false, onPress }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic disabled={disabled} onPress={onPress} style={{ minHeight: 40, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, ...quietControlSurface(colors, active), opacity: disabled ? 0.5 : 1 }}>
      {children}
      <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>{label}</Text>
    </IslePressable>
  )
}

function ActionButton({ label, busy = false, secondary = false, disabled = false, onPress }: { label: string; busy?: boolean; secondary?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IsleButton
      label={label}
      tone={secondary ? 'soft' : 'primary'}
      disabled={disabled}
      busy={busy}
      icon={busy ? <ActivityIndicator size="small" color={secondary ? colors.text : colors.ui.control.primaryForeground} /> : undefined}
      onPress={onPress}
      style={{ flexGrow: 1 }}
    />
  )
}
