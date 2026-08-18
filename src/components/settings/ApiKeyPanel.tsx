import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AIProvider } from '@/types/providerContracts'
import type { ModelAlias, ProviderCapabilities, ProviderCredentialGroup, ProviderPresetId, ProviderWireProtocol } from '@/types/providerContracts'
import { getModelName } from '@/types/modelCatalog'
import { applyProviderPreset, detectProviderPreset, getProviderPreset, looksLikeProviderImportConnectionText, maskSecret, parseCredentialGroups, parseProviderImportDraft, probeProviderPreset, PROVIDER_VENDOR_PRESETS } from '@/bootstrap/providerRegistry'
import { DEFAULT_PROVIDER_PRESET_ID, PROVIDER_WIRE_PROTOCOL_OPTIONS, getCompatibleProviderClientCompatibilityModes, inferProviderWireProtocolFromBaseUrl, initialProviderPresetId, initialProviderWireProtocol, normalizeProviderClientCompatibilityMode, shouldSyncWireProtocolFromBaseUrl, type ProviderClientCompatibilityMode } from '@/modules/providers'
import { resolveProviderConfigDraft } from '@/bootstrap/providerPolicies'
import { isProviderActivationReady, syncAndTestProvider, summarizeProviderActivation } from '@/bootstrap/providerActivationRuntime'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { AppIcon } from '@/components/ui/AppIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleField } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { parseModelEntries } from '@/utils/text'
import { getProviderManualModels, summarizeProviderModelInventory } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels, getPolicyPreferredProviderModel } from '@/bootstrap/providerModelAccess'
import {
  buildProviderCapabilityMatrix,
  buildProviderModelCapabilityMatrix,
  providerModelCapabilityCanBeSent,
  summarizeProviderCapabilityMatrix,
  summarizeProviderCapabilityMatrixDetails,
} from '@/bootstrap/providerCapabilityMatrix'
import { PROVIDER_MODEL_CAPABILITY_KEYS } from '@/modules/providers'
import { providerCompatibilityCapabilityCanBeSentForProvider, type ProviderCompatibilityBehavior } from '@/modules/providers'
import type { RuntimeDiagnosticsProviderDetail } from '@/services/runtimeDiagnostics'
import { useProviderActivationJob } from '@/components/providers/useProviderActivationJob'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

interface ApiKeyPanelProps {
  provider: AIProvider
  runtimeDetail?: RuntimeDiagnosticsProviderDetail
  initiallyExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  hideHeader?: boolean
  style?: StyleProp<ViewStyle>
}

type PanelTask = 'idle' | 'saving' | 'syncing' | 'testing' | 'probing' | 'clipboard'
type TokenModelGroupTone = 'success' | 'warning' | 'danger' | 'muted'
type ProviderWorkspaceView = 'connection' | 'models' | 'advanced'

const API_KEY_PANEL_MODEL_SAMPLE_LIMIT = 96
const API_KEY_PANEL_CREDENTIAL_GROUP_INLINE_LIMIT = 3

interface TokenModelGroup {
  id: string
  label: string
  models: string[]
  tone: TokenModelGroupTone
  statusLabel?: string
}

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

function panelCardStyle(colors: ReturnType<typeof useAppTheme>['colors'], borderColor = colors.material.stroke) {
  const resolvedBorderColor = colors.ui.limeRoad
    ? borderColor
    : borderColor === colors.material.stroke
      ? colors.ui.glass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
      : borderColor
  return {
    borderRadius: Math.min(colors.ui.radius.card, 8),
    backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
    borderColor: resolvedBorderColor,
  }
}

function ApiKeyEmptyRow({ icon, label }: { icon: ReactNode; label: string }) {
  const { colors } = useAppTheme()
  const borderColor = colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: 44, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      {icon}
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
        {label}
      </Text>
    </View>
  )
}

function ApiKeyInlineEmpty({ label }: { label: string }) {
  const { colors } = useAppTheme()
  const borderColor = colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: 34, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), paddingHorizontal: 9, paddingVertical: 6, justifyContent: 'center', backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>
        {label}
      </Text>
    </View>
  )
}

function quietControlSurface(colors: ReturnType<typeof useAppTheme>['colors'], active: boolean) {
  return {
    backgroundColor: active
      ? colors.ui.control.primaryBackground
      : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.limeRoad
          ? colors.ui.semantic.surface.muted
          : colors.ui.semantic.surface.muted,
    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
    borderColor: active
      ? colors.ui.control.primaryBorder
      : colors.ui.glass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.limeRoad
          ? colors.material.stroke
          : colors.ui.semantic.chrome.border,
  }
}

export function ApiKeyPanel({
  provider,
  runtimeDetail,
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
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const { activateProviders, isActivationRunning } = useProviderActivationJob()
  const [localExpanded, setLocalExpanded] = useState(initiallyExpanded)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [presetId, setPresetId] = useState<ProviderPresetId>(initialProviderPresetId(provider))
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(initialProviderWireProtocol(provider))
  const [credentialText, setCredentialText] = useState('')
  const [credentialEditorOpen, setCredentialEditorOpen] = useState(false)
  const [modelsText, setModelsText] = useState(formatModelEntries(provider))
  const [aliasDrafts, setAliasDrafts] = useState<ModelAlias[]>(provider.modelAliases ?? [])
  const [draftGroups, setDraftGroups] = useState<ProviderCredentialGroup[]>(provider.credentialGroups ?? [])
  const [modelEditing, setModelEditing] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<ProviderWorkspaceView>('connection')
  const [modelEvidenceOpen, setModelEvidenceOpen] = useState(false)
  const [providerIdentityOpen, setProviderIdentityOpen] = useState(false)
  const [capabilityOverridesOpen, setCapabilityOverridesOpen] = useState(false)
  const [credentialGroupsOpen, setCredentialGroupsOpen] = useState(false)
  const [groupKeyMasks, setGroupKeyMasks] = useState<Record<string, string>>({})
  const [task, setTask] = useState<PanelTask>('idle')
  const syncAndTestAbortController = useRef<AbortController | null>(null)

  const hydratedGroups = draftGroups
  const detection = useMemo(() => detectProviderPreset({ baseUrl, name: provider.name, apiKey: credentialText }), [baseUrl, credentialText, provider.name])
  const selectedPreset = getProviderPreset(presetId)
  const providerConfigDraft = useMemo(() => resolveProviderConfigDraft({ provider, presetId, baseUrl, wireProtocol }), [baseUrl, presetId, provider, wireProtocol])
  const clientCompatibilityModes = useMemo(
    () => getCompatibleProviderClientCompatibilityModes({ ...provider, wireProtocol: providerConfigDraft.wireProtocol }),
    [provider, providerConfigDraft.wireProtocol],
  )
  const normalizedClientCompatibilityMode = normalizeProviderClientCompatibilityMode(provider.clientCompatibilityProfile)
  const selectedClientCompatibilityMode = clientCompatibilityModes.includes(normalizedClientCompatibilityMode)
    ? normalizedClientCompatibilityMode
    : 'islemind'
  const modelEntries = useMemo(() => parseModelEntries(modelsText), [modelsText])
  const currentModels = modelEntries.models
  const customModels = useMemo(() => getProviderManualModels(provider), [provider])
  const availableModels = useMemo(() => getPolicyAllowedProviderModels(provider, settings, { limit: API_KEY_PANEL_MODEL_SAMPLE_LIMIT }), [provider, settings])
  const remoteModels = useMemo(() => getRemoteModelIds(provider, availableModels), [availableModels, provider])
  const remoteModelGroups = useMemo(() => buildRemoteModelGroups(provider, availableModels, t), [availableModels, provider, t])
  const modelInventory = useMemo(() => summarizeProviderModelInventory(provider), [provider])
  const preferredModel = getPolicyPreferredProviderModel(provider, settings)
  const capabilityModel = preferredModel ?? availableModels[0] ?? currentModels[0]
  const primaryModel = preferredModel ?? availableModels[0] ?? currentModels[0] ?? t('apiKeyPanel.noModelSet')
  const expanded = controlledExpanded ?? localExpanded
  const groupCount = hydratedGroups.length
  const hasKey = hydratedGroups.some((group) => group.enabled) || !!credentialText.trim()
  const credentialEditorExpanded = credentialEditorOpen || credentialText.trim().length > 0
  const isDefault = defaultProvider === provider.id
  const capabilitySummary = buildCapabilitySummary(provider, selectedPreset, t)
  const isBusy = task !== 'idle'
  const enabledGroupCount = hydratedGroups.filter((group) => group.enabled).length
  const problemGroupCount = hydratedGroups.filter((group) => group.lastModelSyncStatus === 'bad' || (group.failureCount ?? 0) > 0).length
  const credentialGroupsExpanded = credentialGroupsOpen || problemGroupCount > 0 || hydratedGroups.length <= API_KEY_PANEL_CREDENTIAL_GROUP_INLINE_LIMIT
  const visibleCredentialGroups = credentialGroupsExpanded ? hydratedGroups : hydratedGroups.slice(0, API_KEY_PANEL_CREDENTIAL_GROUP_INLINE_LIMIT)
  const hiddenCredentialGroupCount = Math.max(0, hydratedGroups.length - visibleCredentialGroups.length)
  const checkMessageNeedsAttention = provider.lastModelSyncStatus === 'bad'
  const protocolLabel = t(`providerSettings.protocol.${wireProtocol}`)
  const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
  const selectedPresetLabel = presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProvider') : selectedPreset.name
  const detectedPreset = getProviderPreset(detection.presetId)
  const detectedPresetLabel = detection.presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProvider') : detectedPreset.name
  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? '')
    setPresetId(initialProviderPresetId(provider))
    setWireProtocol(initialProviderWireProtocol(provider))
    setModelsText(formatModelEntries(provider))
    setAliasDrafts(provider.modelAliases ?? [])
    setDraftGroups(provider.credentialGroups ?? [])
    setModelEditing(false)
    setWorkspaceView('connection')
    setModelEvidenceOpen(false)
    setProviderIdentityOpen(false)
    setCapabilityOverridesOpen(false)
    setCredentialGroupsOpen(false)
    setGroupKeyMasks({})
    setCredentialText('')
  }, [provider.baseUrl, provider.detectedPresetId, provider.id, provider.manualModels, provider.modelAliases, provider.models, provider.presetId, provider.wireProtocol])

  useEffect(() => () => {
    syncAndTestAbortController.current?.abort()
    syncAndTestAbortController.current = null
  }, [provider.id])

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
    const models = parseModelEntries(modelsText).models
    const modelAliases = normalizeAliasDrafts(aliasDrafts)
    const applied = applyProviderPreset({
      ...provider,
      baseUrl: providerConfigDraft.baseUrl,
      credentialMode: providerConfigDraft.credentialMode,
      tokenPlanRegion: providerConfigDraft.tokenPlanRegion,
      wireProtocol: providerConfigDraft.wireProtocol,
      clientCompatibilityProfile: clientCompatibilityModes.includes(normalizedClientCompatibilityMode)
        ? normalizedClientCompatibilityMode
        : 'islemind',
      credentialGroups,
      models,
      manualModels: models,
      modelAliases,
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
    setCredentialText('')
    setModelEditing(false)
    setTask('idle')
    if (showNotice) {
      const message = pastedGroups.length ? t('apiKeyPanel.savedGroups', { count: credentialGroups.length }) : t('apiKeyPanel.savedConfig')
      dialog.toast({ title: t('apiKeyPanel.providerSaved', { name: providerDisplayName }), message, tone: 'mint' })
    }
  }

  async function selectClientCompatibilityMode(mode: ProviderClientCompatibilityMode) {
    if (mode === selectedClientCompatibilityMode) return
    await updateProvider(provider.id, { clientCompatibilityProfile: mode })
  }

  async function savePendingTokens() {
    const incoming = createIncomingGroups(draftGroups.length, credentialText, t)
    if (!incoming.length) {
      dialog.toast({ title: t('apiKeyPanel.noTokenAdded'), message: t('apiKeyPanel.enterTokensFirst'), tone: 'amber' })
      return
    }
    const credentialGroups = mergeGroups(draftGroups, incoming, t)
    setTask('saving')
    setDraftGroups(credentialGroups)
    setCredentialText('')
    await updateProvider(provider.id, { credentialGroups })
    setTask('idle')
    dialog.toast({ title: t('apiKeyPanel.tokensSaved', { count: incoming.length }), message: providerDisplayName, tone: 'mint' })
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
  }

  function handleCredentialText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setCredentialText(value)
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
    if (updates.enabled !== undefined) {
      const group = draftGroups.find((item) => item.id === groupId)
      dialog.toast({ title: updates.enabled ? t('apiKeyPanel.groupEnabled') : t('apiKeyPanel.groupDisabled'), message: group?.label ?? providerDisplayName, tone: 'mint' })
    }
  }

  async function deleteDraftGroup(groupId: string) {
    const group = draftGroups.find((item) => item.id === groupId)
    const nextGroups = draftGroups.filter((group) => group.id !== groupId)
    setDraftGroups(nextGroups)
    await updateProvider(provider.id, { credentialGroups: nextGroups })
    dialog.toast({ title: t('apiKeyPanel.groupDeleted'), message: group?.label ?? providerDisplayName, tone: 'amber' })
  }

  async function acceptDetection() {
    setPresetId(detection.presetId)
    const preset = getProviderPreset(detection.presetId)
    applyPresetDraft(detection.presetId, detection.wireProtocol ?? inferProviderWireProtocolFromBaseUrl(baseUrl))
    const presetLabel = detection.presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProvider') : preset.name
    dialog.toast({ title: t('apiKeyPanel.detectionApplied'), message: `${providerDisplayName} · ${presetLabel}`, tone: 'mint' })
  }

  async function probeDetection() {
    setTask('probing')
    dialog.toast({ title: t('apiKeyPanel.interfaceProbeStarted'), message: providerDisplayName, tone: 'mint' })
    const result = await probeProviderPreset({ baseUrl, name: provider.name, apiKey: await getProbeApiKey() })
    setPresetId(result.presetId)
    applyPresetDraft(result.presetId, result.wireProtocol ?? inferProviderWireProtocolFromBaseUrl(baseUrl))
    setTask('idle')
    const presetLabel = result.presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProvider') : getProviderPreset(result.presetId).name
    dialog.toast({ title: t('apiKeyPanel.interfaceProbeDone'), message: `${providerDisplayName} · ${presetLabel}`, tone: 'mint' })
  }

  async function syncAndTest() {
    syncAndTestAbortController.current?.abort()
    const abortController = new AbortController()
    syncAndTestAbortController.current = abortController
    setTask('syncing')
    dialog.toast({ title: t('apiKeyPanel.fetchAndTestStarted'), message: providerDisplayName, tone: 'mint' })
    try {
      await save(false)
      if (abortController.signal.aborted) return
      const current = useSettingsStore.getState().providers.find((item) => item.id === provider.id) ?? provider
      const result = await syncAndTestProvider(current, {
        updateProvider: (providerId, updates) => useSettingsStore.getState().updateProvider(providerId, updates),
        hydrateProviderKey: (providerId) => useSettingsStore.getState().hydrateProviderKey(providerId),
        updateProviderCredentialGroupHealth: (providerId, groupId, ok) => useSettingsStore.getState().updateProviderCredentialGroupHealth(providerId, groupId, ok),
      }, {
        enable: provider.enabled,
        testModels: false,
        accessSettings: settings,
        signal: abortController.signal,
      })
      if (abortController.signal.aborted || syncAndTestAbortController.current !== abortController) return
      const latest = useSettingsStore.getState().providers.find((item) => item.id === provider.id)
      if (latest) setModelsText(formatModelEntries(latest))
      const summary = summarizeProviderActivation([result])
      const ready = isProviderActivationReady(result)
      if (ready) {
        updateSettings({ defaultProvider: result.providerId })
      }
      dialog.notice({ title: ready ? t('apiKeyPanel.fetchAndTestDone') : t('apiKeyPanel.fetchAndTestNeedsCheck'), message: summary.message, tone: summary.tone })
    } catch (error) {
      if (!isProviderOperationAbort(error)) throw error
    } finally {
      if (syncAndTestAbortController.current === abortController) {
        syncAndTestAbortController.current = null
        setTask('idle')
      }
    }
  }

  async function toggleProviderEnabled() {
    if (isBusy || isActivationRunning) return
    const enabled = !provider.enabled
    if (!enabled) {
      await updateProvider(provider.id, { enabled })
      dialog.toast({ title: t('apiKeyPanel.providerDisabled', { name: providerDisplayName }), tone: 'mint' })
      return
    }
    await save(false)
    void activateProviders([provider.id], 'single')
  }

  function setDefaultProvider() {
    updateSettings({ defaultProvider: provider.id })
    dialog.toast({ title: t('apiKeyPanel.defaultUpdated'), message: providerDisplayName, tone: 'mint' })
  }

  async function confirmRemoveProvider() {
    const confirmed = await dialog.confirm({
      title: t('apiKeyPanel.deleteProviderTitle'),
      message: t('apiKeyPanel.deleteProviderMessage', { name: providerDisplayName }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await removeProvider(provider.id)
    dialog.toast({ title: t('apiKeyPanel.providerDeleted'), message: providerDisplayName, tone: 'mint' })
  }

  function cancelModelEditing() {
    setModelsText(formatModelEntries(provider))
    setAliasDrafts(provider.modelAliases ?? [])
    setModelEditing(false)
    dialog.toast({ title: t('apiKeyPanel.modelEditCancelled'), message: providerDisplayName, tone: 'amber' })
  }

  function enterModelEditing() {
    setModelEditing(true)
    dialog.toast({ title: t('apiKeyPanel.modelListEditable'), message: providerDisplayName, tone: 'mint' })
  }

  function appendModelEntry(model: string) {
    const parsed = parseModelEntries(modelsText)
    if (parsed.models.includes(model)) {
      setModelEditing(true)
      return
    }
    setModelsText([modelsText.trim(), model].filter(Boolean).join('\n'))
    setModelEditing(true)
    dialog.toast({ title: t('apiKeyPanel.modelInserted', { model }), tone: 'mint' })
  }

  function selectPreset(nextPresetId: ProviderPresetId) {
    applyPresetDraft(nextPresetId, wireProtocol)
  }

  function selectWireProtocol(nextProtocol: ProviderWireProtocol) {
    setWireProtocol(nextProtocol)
    setBaseUrl(resolveProviderConfigDraft({ provider, presetId, baseUrl, wireProtocol: nextProtocol }).baseUrl)
    dialog.toast({ title: t('apiKeyPanel.protocolChanged', { protocol: t(`providerSettings.protocol.${nextProtocol}`) }), tone: 'mint' })
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
      animate={{ opacity: provider.enabled ? 1 : 0.82 }}
      transition={{ type: 'timing', duration: 144 }}
      style={[{
        borderRadius: Math.min(colors.ui.radius.panel, 8),
        padding: compact ? 8 : 10,
        backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
        borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
        borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border,
        marginBottom: hideHeader ? 0 : 8,
      }, style]}
    >
      {!hideHeader ? (
        <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${providerDisplayName}. ${provider.baseUrl || t('providerSettings.baseUrl')}`} accessibilityState={{ expanded }} onPress={() => setPanelExpanded(!expanded)} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
            {provider.presetId === 'newapi' || provider.presetId === 'sub2api' ? <AppIcon name="spark" color={colors.ui.icon.accentForeground} size={18} /> : <AppIcon name="key" color={colors.ui.icon.accentForeground} size={18} />}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800', flexShrink: 1, minWidth: 0, includeFontPadding: false }}>{providerDisplayName}</Text>
              {isDefault ? <Badge label={t('settings.default')} tone="warning" /> : null}
              <MiniBadge label={provider.enabled ? t('apiKeyPanel.enabled') : t('apiKeyPanel.disabled')} tone={provider.enabled ? 'success' : 'muted'} />
              {provider.lastModelSyncStatus === 'bad' ? <MiniBadge label={t('apiKeyPanel.syncFailed')} tone="warning" /> : null}
            </View>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 14, marginTop: 2, includeFontPadding: false }}>
              {getModelName(primaryModel)} · {t('apiKeyPanel.modelCount', { count: availableModels.length })} · {t('apiKeyPanel.tokenGroups', { count: Math.max(groupCount, hasKey ? 1 : 0) })}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 12, marginTop: 2, fontWeight: '800', includeFontPadding: false }}>
              {capabilitySummary}
            </Text>
          </View>
          {provider.lastModelSyncStatus === 'bad' ? <AppIcon name="refresh" color={colors.ui.tone.danger.foreground} size={17} /> : null}
          <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 176 }}>
            <AppIcon name="collapse" color={colors.textTertiary} size={18} />
          </MotiView>
        </IslePressable>
      ) : null}

      {expanded ? (
        <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ marginTop: hideHeader ? 0 : 10, gap: 10 }}>
          <ProviderWorkspaceTabs value={workspaceView} onChange={setWorkspaceView} />
          <CompactDisclosureRow
            title={t('apiKeyPanel.workspaceAdvanced')}
            detail={t('providerSettings.protocol.summary', { protocol: protocolLabel })}
            icon={<AppIcon name="settings-sliders" color={colors.textTertiary} size={15} />}
            open={workspaceView === 'advanced'}
            onPress={() => setWorkspaceView((current) => current === 'advanced' ? 'connection' : 'advanced')}
          />

          {workspaceView === 'connection' && providerConfigDraft.isProtocolSelectable ? (
            <View style={{ padding: 10, gap: 8, ...panelCardStyle(colors) }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('providerSettings.protocol.title')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {PROVIDER_WIRE_PROTOCOL_OPTIONS.map((protocol) => (
                  <ChoiceButton key={protocol} active={wireProtocol === protocol} label={t(`providerSettings.protocol.${protocol}`)} onPress={() => selectWireProtocol(protocol)} />
                ))}
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('providerSettings.protocol.endpointNote')}</Text>
            </View>
          ) : null}

          {workspaceView === 'connection' ? (
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
          ) : null}

          {workspaceView === 'advanced' ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <MiniAction active={isDefault} label={isDefault ? t('settings.default') : t('apiKeyPanel.setDefault')} onPress={setDefaultProvider}>
                  <AppIcon name="star" color={isDefault ? colors.ui.control.primaryForeground : colors.textTertiary} size={15} fill={isDefault ? colors.ui.control.primaryForeground : 'transparent'} />
                </MiniAction>
                <MiniAction active={provider.enabled} label={provider.enabled ? t('apiKeyPanel.enabledState') : t('apiKeyPanel.disabledState')} onPress={() => void toggleProviderEnabled()} disabled={isBusy || isActivationRunning}>
                  <AppIcon name="power" color={provider.enabled ? colors.ui.control.primaryForeground : colors.textTertiary} size={15} />
                </MiniAction>
              </View>
              {runtimeDetail ? <ProviderRuntimeDiagnosticsPanel detail={runtimeDetail} /> : null}
              <View style={{ gap: 8 }}>
                <SectionHeader
                  title={t('providerSettings.clientCompatibility.title')}
                  description={t('providerSettings.clientCompatibility.description')}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {clientCompatibilityModes.map((mode) => (
                    <ChoiceButton
                      key={mode}
                      active={selectedClientCompatibilityMode === mode}
                      label={t(`providerSettings.clientCompatibility.${mode}`)}
                      onPress={() => void selectClientCompatibilityMode(mode)}
                    />
                  ))}
                </View>
              </View>

              <View style={{ padding: 10, ...panelCardStyle(colors) }}>
                <SectionHeader
                  title={t('apiKeyPanel.autoDetect')}
                  description={`${detection.reason} · ${t('apiKeyPanel.suggestedPreset', { name: detectedPresetLabel })}`}
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
              </View>

              <CompactDisclosureRow
                title={t('apiKeyPanel.advancedInterfaceSettings')}
                detail={`${selectedPresetLabel} · ${t('apiKeyPanel.suggestedPreset', { name: detectedPresetLabel })}`}
                icon={<AppIcon name="settings-sliders" color={colors.textTertiary} size={15} />}
                open={providerIdentityOpen}
                onPress={() => setProviderIdentityOpen((value) => !value)}
              />
              {providerIdentityOpen ? (
                <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ padding: 10, ...panelCardStyle(colors) }}>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {PROVIDER_VENDOR_PRESETS.map((preset) => (
                    <ChoiceButton key={preset.id} active={presetId === preset.id} label={preset.name} onPress={() => selectPreset(preset.id)} />
                  ))}
                  </View>
                </MotiView>
              ) : null}

              <CompactDisclosureRow
                title={t('apiKeyPanel.capabilityMatrix')}
                detail={t('apiKeyPanel.capabilityMatrixDescription')}
                icon={<AppIcon name="spark" color={colors.textTertiary} size={15} />}
                open={capabilityOverridesOpen}
                onPress={() => setCapabilityOverridesOpen((value) => !value)}
              />
              {capabilityOverridesOpen ? (
                <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ padding: 10, gap: 8, ...panelCardStyle(colors) }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('apiKeyPanel.capabilityDependencyHint')}</Text>
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
                </MotiView>
              ) : null}
              <View style={{ paddingTop: 2, alignItems: 'flex-start' }}>
                <MiniAction label={t('common.delete')} onPress={() => void confirmRemoveProvider()} disabled={isBusy}>
                  <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
                </MiniAction>
              </View>
            </View>
          ) : null}

          {workspaceView === 'connection' ? <View style={{ gap: 10 }}>
            <SectionHeader
              title={t('apiKeyPanel.credentialGroups')}
              action={
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <MiniAction label={task === 'clipboard' ? t('providerSettings.clipboardChecking') : t('settings.pasteClipboard')} onPress={() => void readProviderClipboard()} disabled={isBusy}>
                    <AppIcon name="paste" color={colors.textTertiary} size={15} />
                  </MiniAction>
                  <MiniAction label={t('apiKeyPanel.saveTokens')} onPress={() => void savePendingTokens()} disabled={isBusy || !credentialText.trim()}>
                    <AppIcon name="check" color={colors.textTertiary} size={15} />
                  </MiniAction>
                </View>
              }
            />
            {hydratedGroups.length ? (
              <View style={{ gap: 8 }}>
                {hydratedGroups.length > API_KEY_PANEL_CREDENTIAL_GROUP_INLINE_LIMIT ? (
                  <CompactDisclosureRow
                    title={credentialGroupsExpanded ? t('apiKeyPanel.hideCredentialGroups') : t('apiKeyPanel.showAllCredentialGroups', { count: hydratedGroups.length })}
                    detail={credentialGroupsExpanded
                      ? t('apiKeyPanel.credentialGroupsExpandedDetail', { total: hydratedGroups.length, enabled: enabledGroupCount })
                      : t('apiKeyPanel.credentialGroupsCollapsedDetail', { shown: visibleCredentialGroups.length, total: hydratedGroups.length, enabled: enabledGroupCount, problem: problemGroupCount })}
                    icon={<AppIcon name="key" color={problemGroupCount ? colors.ui.tone.danger.foreground : colors.textTertiary} size={15} />}
                    open={credentialGroupsExpanded}
                    tone={problemGroupCount ? 'danger' : undefined}
                    onPress={() => setCredentialGroupsOpen((value) => !value)}
                  />
                ) : null}
                {visibleCredentialGroups.map((group, index) => (
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
                {hiddenCredentialGroupCount ? (
                  <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>
                    {t('apiKeyPanel.hiddenCredentialGroups', { count: hiddenCredentialGroupCount })}
                  </Text>
                ) : null}
              </View>
            ) : (
              <ApiKeyEmptyRow icon={<AppIcon name="key" color={colors.textTertiary} size={15} />} label={t('apiKeyPanel.noCredentialGroups')} />
            )}
            <IslePressable
              haptic
              accessibilityRole="button"
              accessibilityLabel={t('apiKeyPanel.addTokens')}
              accessibilityState={{ expanded: credentialEditorExpanded }}
              onPress={() => setCredentialEditorOpen((value) => !value)}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border }}
            >
              <AppIcon name="add" color={colors.textTertiary} size={15} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>{t('apiKeyPanel.addTokens')}</Text>
                <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{credentialText.trim() ? t('apiKeyPanel.addTokensDraftReady', { count: credentialText.trim().length }) : t('apiKeyPanel.addTokensCollapsedDetail')}</Text>
              </View>
              <MotiView animate={{ rotate: credentialEditorExpanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                <AppIcon name="collapse" color={colors.textTertiary} size={16} />
              </MotiView>
            </IslePressable>
            {credentialEditorExpanded ? (
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
                  style: { minHeight: 60, maxHeight: 108, textAlignVertical: 'top' },
                }}
              />
            ) : null}
          </View> : null}

          {workspaceView === 'models' ? <View style={{ gap: 10 }}>
              <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 10 }}>
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
                    {remoteModelGroups.length ? (
                      <View style={{ padding: 10, gap: 8, ...panelCardStyle(colors) }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{t('apiKeyPanel.remoteModels')}</Text>
                        <RemoteModelChoiceGroups groups={remoteModelGroups} onModelPress={appendModelEntry} />
                      </View>
                    ) : null}
                    <IsleField
                      label={t('apiKeyPanel.customModels')}
                      note={t('providerSettings.modelsNote')}
                      inputProps={{
                        value: modelsText,
                        onChangeText: setModelsText,
                        autoCapitalize: 'none',
                        autoCorrect: false,
                        multiline: true,
                        blurOnSubmit: false,
                        placeholder: t('providerSettings.oneModelPerLine'),
                        style: { minHeight: 88, maxHeight: 144, paddingVertical: 9, lineHeight: 20, textAlignVertical: 'top' },
                      }}
                    />
                    <ModelAliasEditor
                      aliases={aliasDrafts}
                      models={Array.from(new Set([...availableModels, ...parseModelEntries(modelsText).models]))}
                      onChange={setAliasDrafts}
                    />
                  </View>
                ) : (
                  <>
                    <ModelSummary remoteModels={remoteModels} remoteModelGroups={remoteModelGroups} customModels={customModels} aliases={provider.modelAliases ?? []} manualCount={modelInventory.manualModels} selectableCount={availableModels.length} />
                    <IslePressable
                      haptic
                      accessibilityRole="button"
                      accessibilityLabel={modelEvidenceOpen ? t('apiKeyPanel.hideCompatibilityDetails') : t('apiKeyPanel.showCompatibilityDetails')}
                      accessibilityState={{ expanded: modelEvidenceOpen }}
                      onPress={() => setModelEvidenceOpen((value) => !value)}
                      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border }}
                    >
                      <AppIcon name="list-check" color={colors.textTertiary} size={15} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>{modelEvidenceOpen ? t('apiKeyPanel.hideCompatibilityDetails') : t('apiKeyPanel.showCompatibilityDetails')}</Text>
                      </View>
                      <MotiView animate={{ rotate: modelEvidenceOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
                      </MotiView>
                    </IslePressable>
                    {modelEvidenceOpen ? (
                      <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 10 }}>
                        <ModelCapabilityEvidencePanel provider={provider} modelId={capabilityModel} />
                      </MotiView>
                    ) : null}
                  </>
                )}
              </MotiView>
          </View> : null}

          {workspaceView === 'connection' && checkMessageNeedsAttention && provider.lastModelSyncMessage ? (
            <MotiView
              from={{ opacity: 0, translateY: -4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 144 }}
              style={{ padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8, ...panelCardStyle(colors, colors.ui.tone.danger.foreground) }}
            >
              <AppIcon name="warning" color={colors.ui.tone.danger.foreground} size={15} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>{t('apiKeyPanel.latestCheck')}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>{provider.lastModelSyncMessage}</Text>
              </View>
            </MotiView>
          ) : null}

          {workspaceView === 'models' ? (
            <ActionButton label={t('apiKeyPanel.fetchModelsAndTest')} busy={task === 'syncing'} disabled={!hasKey || isBusy} onPress={() => void syncAndTest()} />
          ) : null}
          {workspaceView === 'connection' ? (
            <ActionButton label={t('apiKeyPanel.saveConnection')} busy={task === 'saving'} disabled={isBusy} onPress={() => void save()} />
          ) : null}
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

function MiniBadge({ label, tone }: { label: string; tone: TokenModelGroupTone }) {
  const { colors } = useAppTheme()
  const toneToken = tone === 'success'
    ? colors.ui.tone.success
    : tone === 'warning'
      ? colors.ui.tone.warning
      : tone === 'danger'
        ? colors.ui.tone.danger
        : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 22, borderRadius: colors.ui.radius.chip, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: toneToken.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: toneToken.border }}>
      <Text style={{ color: toneToken.foreground, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}

function ProviderWorkspaceTabs({
  value,
  onChange,
}: {
  value: ProviderWorkspaceView
  onChange: (value: ProviderWorkspaceView) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tabs: { value: ProviderWorkspaceView; label: string; icon: Parameters<typeof AppIcon>[0]['name'] }[] = [
    { value: 'connection', label: t('apiKeyPanel.workspaceConnection'), icon: 'network' },
    { value: 'models', label: t('apiKeyPanel.workspaceModels'), icon: 'model' },
  ]
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        padding: 3,
        gap: 3,
        borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
        backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
      }}
    >
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <IslePressable
            key={tab.value}
            haptic
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.value)}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 46,
              borderRadius: Math.min(colors.ui.radius.controlMiddle, 7),
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              backgroundColor: active ? colors.ui.control.primaryBackground : 'transparent',
            }}
          >
            <AppIcon name={tab.icon} color={active ? colors.ui.control.primaryForeground : colors.textTertiary} size={15} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800', includeFontPadding: false }}>
              {tab.label}
            </Text>
          </IslePressable>
        )
      })}
    </View>
  )
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', ...quietControlSurface(colors, active) }}>
      <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{label}</Text>
    </IslePressable>
  )
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800', includeFontPadding: false }}>{title}</Text>
        {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, includeFontPadding: false }}>{description}</Text> : null}
      </View>
      {action}
    </View>
  )
}

function CompactDisclosureRow({
  title,
  detail,
  icon,
  open,
  tone,
  onPress,
}: {
  title: string
  detail: string
  icon: ReactNode
  open: boolean
  tone?: 'danger'
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const toneToken = tone === 'danger' ? colors.ui.tone.danger : undefined
  const backgroundColor = toneToken?.background ?? (colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted)
  const borderColor = toneToken?.border ?? (colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border)
  const titleColor = toneToken?.foreground ?? colors.textSecondary
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: titleColor, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, marginTop: 1, includeFontPadding: false }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
      </MotiView>
    </IslePressable>
  )
}

function ProviderRuntimeDiagnosticsPanel({ detail }: { detail: RuntimeDiagnosticsProviderDetail }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const health = detail.credentialHealth
  const protocolValue = t('apiKeyPanel.runtimeProtocolValue', {
    declared: detail.declaredProtocol ?? t('common.unknown'),
    ready: detail.readyProtocol ?? t('common.unknown'),
    observed: detail.observedProtocol ?? t('common.unknown'),
  })
  const credentialValue = t('apiKeyPanel.runtimeCredentialHealthValue', {
    healthy: health.healthy,
    enabled: health.enabled,
    total: health.total,
    cooldown: health.cooldown,
    circuit: health.circuitOpen,
    quota: health.quotaExhausted,
    credential: health.credentialUnhealthy,
  })
  const sessionStatus = detail.sessionAffinity.status ?? 'unknown'
  const sessionValue = detail.sessionAffinity.enabled
    ? t('apiKeyPanel.runtimeSessionAffinityValue', {
        status: t(`providerSettings.runtimeSessionAffinityStatus.${sessionStatus}`),
        group: detail.sessionAffinity.credentialGroupId ?? t('common.none'),
        trigger: detail.sessionAffinity.trigger ?? t('common.none'),
      })
    : t('apiKeyPanel.runtimeSessionAffinityOff')
  const unavailableValue = detail.lastUnavailableReason
    ? t('apiKeyPanel.runtimeUnavailableValue', {
        reason: t(`providerSettings.runtimeUnavailableReason.${detail.lastUnavailableReason}`),
        detail: detail.lastUnavailableDetail ?? t('common.none'),
      })
    : t('apiKeyPanel.runtimeUnavailableNone')
  const rows = [
    { key: 'protocol', label: t('apiKeyPanel.runtimeProtocol'), value: protocolValue },
    { key: 'credentials', label: t('apiKeyPanel.runtimeCredentialHealth'), value: credentialValue },
    { key: 'session', label: t('apiKeyPanel.runtimeSessionAffinity'), value: sessionValue },
    { key: 'unavailable', label: t('apiKeyPanel.runtimeUnavailable'), value: unavailableValue, warning: Boolean(detail.lastUnavailableReason) },
  ]
  return (
    <View style={{ padding: 10, gap: 8, ...panelCardStyle(colors, detail.lastUnavailableReason ? colors.ui.tone.warning.border : colors.material.stroke) }}>
      <SectionHeader title={t('apiKeyPanel.runtimeDiagnostics')} />
      <View style={{ gap: 8 }}>
        {rows.map((row) => (
          <View key={row.key} style={{ gap: 3 }}>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '700', includeFontPadding: false }}>{row.label}</Text>
            <Text numberOfLines={2} style={{ color: row.warning ? colors.ui.tone.warning.foreground : colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>{row.value}</Text>
          </View>
        ))}
      </View>
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
  const statusText = group.lastModelSyncStatus === 'bad'
    ? t('apiKeyPanel.syncFailed')
    : group.enabled ? undefined : t('apiKeyPanel.disabled')
  return (
    <View style={{ padding: 10, gap: 8, ...panelCardStyle(colors, group.enabled ? colors.material.strokeStrong : colors.material.stroke) }}>
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
            borderRadius: Math.min(colors.ui.radius.field, 8),
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.ui.input.background,
            borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
            borderColor: colors.ui.input.border,
            fontSize: 13,
            fontWeight: '800',
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
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', maxWidth: '100%', includeFontPadding: false }}>{maskedKey || t('apiKeyPanel.newTokenPending')}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{t('apiKeyPanel.modelCount', { count: group.availableModels?.length ?? 0 })}</Text>
        {statusText ? <Text numberOfLines={1} style={{ color: group.lastModelSyncStatus === 'bad' ? colors.ui.tone.danger.foreground : colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{statusText}</Text> : null}
        {group.failureCount ? <Text numberOfLines={1} style={{ color: colors.ui.tone.danger.foreground, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{t('apiKeyPanel.failureCount', { count: group.failureCount })}</Text> : null}
      </View>
    </View>
  )
}

function formatModelEntries(provider: AIProvider): string {
  return getProviderManualModels(provider).join('\n')
}

function normalizeAliasDrafts(aliases: readonly ModelAlias[]): ModelAlias[] {
  const byAlias = new Map<string, ModelAlias>()
  for (const entry of aliases) {
    const alias = entry.alias.trim()
    const model = entry.model.trim()
    if (!alias || !model || alias === model) continue
    byAlias.set(alias.toLowerCase(), { alias, model })
  }
  return Array.from(byAlias.values())
}

function ModelAliasEditor({ aliases, models, onChange }: { aliases: ModelAlias[]; models: string[]; onChange: (aliases: ModelAlias[]) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const updateAlias = (index: number, updates: Partial<ModelAlias>) => {
    onChange(aliases.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...updates } : entry))
  }
  return (
    <View style={{ padding: 10, gap: 9, ...panelCardStyle(colors) }}>
      <SectionHeader
        title={t('apiKeyPanel.modelAliases')}
        description={t('apiKeyPanel.modelAliasStructuredHelp')}
        action={
          <MiniAction label={t('apiKeyPanel.addAlias')} onPress={() => onChange([...aliases, { alias: '', model: models[0] ?? '' }])}>
            <AppIcon name="add" color={colors.textTertiary} size={15} />
          </MiniAction>
        }
      />
      {aliases.length ? aliases.map((entry, index) => (
        <View key={`alias-${index}`} style={{ gap: 7, padding: 9, ...panelCardStyle(colors, colors.ui.semantic.chrome.border) }}>
          <TextInput
            value={entry.alias}
            onChangeText={(alias) => updateAlias(index, { alias })}
            placeholder={t('apiKeyPanel.aliasDisplayName')}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.field, 8), paddingHorizontal: 11, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.input.border, fontSize: 12.5, fontWeight: '700' }}
          />
          <TextInput
            value={entry.model}
            onChangeText={(model) => updateAlias(index, { model })}
            placeholder={t('apiKeyPanel.aliasTargetModel')}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.field, 8), paddingHorizontal: 11, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.input.border, fontSize: 12.5, fontWeight: '700' }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
            {models.slice(0, 5).map((model) => (
              <ChoiceButton key={`${index}:${model}`} label={getModelName(model)} active={entry.model === model} onPress={() => updateAlias(index, { model })} />
            ))}
            <MiniAction label={t('common.delete')} onPress={() => onChange(aliases.filter((_, entryIndex) => entryIndex !== index))}>
              <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
            </MiniAction>
          </View>
        </View>
      )) : <ApiKeyInlineEmpty label={t('apiKeyPanel.noModelAliases')} />}
    </View>
  )
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

function buildRemoteModelGroups(provider: AIProvider, allowedModels: string[], t: TFunction): TokenModelGroup[] {
  const manual = new Set(getProviderManualModels(provider))
  const allowed = new Set(allowedModels)
  const normalizeModels = (models: string[] | undefined): string[] => {
    const seen = new Set<string>()
    return (models ?? [])
      .map((model) => model.trim())
      .filter((model) => {
        if (!model || manual.has(model) || seen.has(model)) return false
        if (allowed.size && !allowed.has(model)) return false
        seen.add(model)
        return true
      })
  }
  const groups = (provider.credentialGroups ?? []).map((group, index): TokenModelGroup => ({
    id: group.id,
    label: group.label || t('apiKeyPanel.groupName', { index: index + 1 }),
    models: normalizeModels(group.availableModels),
    tone: group.lastModelSyncStatus === 'ok'
      ? 'success'
      : group.lastModelSyncStatus === 'bad'
        ? 'danger'
        : group.enabled ? 'warning' : 'muted',
    statusLabel: group.lastModelSyncStatus === 'bad'
      ? t('apiKeyPanel.syncFailed')
      : group.enabled ? undefined : t('apiKeyPanel.disabled'),
  }))
  if (groups.length) return groups
  const models = normalizeModels([
    ...provider.models,
    ...(provider.modelAvailability ?? []).map((item) => item.modelId),
  ])
  return models.length
    ? [{
      id: 'provider',
      label: t('apiKeyPanel.providerMergedModels'),
      models,
      tone: provider.lastModelSyncStatus === 'bad' ? 'danger' : provider.lastModelSyncStatus === 'ok' ? 'success' : 'muted',
      statusLabel: provider.lastModelSyncStatus === 'bad' ? t('apiKeyPanel.syncFailed') : undefined,
    }]
    : []
}

function ModelSummary({ remoteModels, remoteModelGroups, customModels, aliases, manualCount, selectableCount }: { remoteModels: string[]; remoteModelGroups: TokenModelGroup[]; customModels: string[]; aliases: NonNullable<AIProvider['modelAliases']>; manualCount: number; selectableCount: number }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const shownCustom = customModels.slice(0, 8)
  const hasRemoteGroupModels = remoteModelGroups.some((group) => group.models.length)
  if (!remoteModelGroups.length && !shownCustom.length && !aliases.length) {
    return (
      <ApiKeyEmptyRow icon={<AppIcon name="model" color={colors.textTertiary} size={15} />} label={t('apiKeyPanel.noModels')} />
    )
  }
  return (
    <View style={{ padding: 10, gap: 8, ...panelCardStyle(colors) }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <MiniBadge label={t('apiKeyPanel.remoteModelShort', { count: remoteModels.length })} tone={remoteModels.length ? 'success' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.customModelShort', { count: manualCount })} tone={manualCount ? 'warning' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.aliasShort', { count: aliases.length })} tone={aliases.length ? 'warning' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.selectableModelShort', { count: selectableCount })} tone={selectableCount ? 'success' : 'muted'} />
      </View>
      {remoteModelGroups.length ? (
        <TokenModelGroupList groups={remoteModelGroups} />
      ) : null}
      {remoteModelGroups.length && !hasRemoteGroupModels ? (
        <ApiKeyInlineEmpty label={t('apiKeyPanel.noModels')} />
      ) : null}
      {shownCustom.length ? (
        <ModelChipGroup title={t('apiKeyPanel.customModels')} models={shownCustom} remaining={customModels.length - shownCustom.length} />
      ) : null}
      {aliases.length ? (
        <View style={{ gap: 5 }}>
          {aliases.slice(0, 4).map((alias) => (
            <View key={alias.alias} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>{alias.alias}</Text>
                <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600', includeFontPadding: false }}>{alias.model}</Text>
              </View>
              <AppIcon name="back-next" color={colors.textTertiary} size={13} />
            </View>
          ))}
          {aliases.length > 4 ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{aliases.length - 4}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

function TokenModelGroupList({ groups }: { groups: TokenModelGroup[] }) {
  return (
    <View style={{ gap: 8 }}>
      {groups.map((group) => (
        <TokenModelGroupPreview key={group.id} group={group} />
      ))}
    </View>
  )
}

function TokenModelGroupPreview({ group }: { group: TokenModelGroup }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const shownModels = group.models.slice(0, 6)
  return (
    <View style={{ gap: 7 }}>
      <View style={{ minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', includeFontPadding: false }}>
          {group.label}
        </Text>
        <MiniBadge label={t('apiKeyPanel.modelCount', { count: group.models.length })} tone={group.models.length ? group.tone : 'muted'} />
        {group.statusLabel ? <MiniBadge label={group.statusLabel} tone={group.tone} /> : null}
      </View>
      {shownModels.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {shownModels.map((model) => <ModelChip key={`${group.id}:${model}`} label={getModelName(model)} />)}
          {group.models.length > shownModels.length ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{group.models.length - shownModels.length}</Text> : null}
        </View>
      ) : (
        <ApiKeyInlineEmpty label={t('apiKeyPanel.noModels')} />
      )}
    </View>
  )
}

function RemoteModelChoiceGroups({ groups, onModelPress }: { groups: TokenModelGroup[]; onModelPress: (model: string) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: 10 }}>
      {groups.map((group) => {
        const shownModels = group.models.slice(0, 8)
        return (
          <View key={group.id} style={{ gap: 7 }}>
            <View style={{ minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', includeFontPadding: false }}>
                {group.label}
              </Text>
              <MiniBadge label={t('apiKeyPanel.modelCount', { count: group.models.length })} tone={group.models.length ? group.tone : 'muted'} />
            </View>
            {shownModels.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {shownModels.map((model) => (
                  <ChoiceButton key={`${group.id}:${model}`} active={false} label={getModelName(model)} onPress={() => onModelPress(model)} />
                ))}
                {group.models.length > shownModels.length ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{group.models.length - shownModels.length}</Text> : null}
              </View>
            ) : (
              <ApiKeyInlineEmpty label={t('apiKeyPanel.noModels')} />
            )}
          </View>
        )
      })}
    </View>
  )
}

function ModelChipGroup({ title, models, remaining }: { title: string; models: string[]; remaining: number }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{title}</Text>
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
    <View style={{ minHeight: 28, borderRadius: colors.ui.radius.chip, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border }}>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', maxWidth: labelMaxWidth, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
    </View>
  )
}

function ModelCapabilityEvidencePanel({ provider, modelId }: { provider: AIProvider; modelId?: string }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (!modelId) return null
  const matrix = buildProviderModelCapabilityMatrix(provider, modelId)
  const capabilities = PROVIDER_MODEL_CAPABILITY_KEYS.filter((key) => key !== 'responsesApi')
  return (
    <View style={{ padding: 10, gap: 8, ...panelCardStyle(colors) }}>
      <SectionHeader
        title={t('apiKeyPanel.modelCapabilityEvidence')}
      />
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>
        {getModelName(modelId)}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {capabilities.map((key) => {
          const capability = matrix.capabilities.find((item) => item.capability === key)
          if (!capability) return null
          return (
            <ModelCapabilityEvidenceBadge
              key={key}
              label={t(`apiKeyPanel.modelCapability.${key}`)}
              supported={providerModelCapabilityCanBeSent(provider, modelId, key)}
            />
          )
        })}
      </View>
    </View>
  )
}

function ModelCapabilityEvidenceBadge({ label, supported }: { label: string; supported: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tone = supported ? colors.ui.tone.success : colors.ui.tone.danger
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${t(`apiKeyPanel.modelCapabilityAvailability.${supported ? 'available' : 'unavailable'}`)}`}
      style={{ minHeight: 28, maxWidth: 176, borderRadius: Math.min(colors.ui.radius.chip, 8), paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: tone.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: tone.border }}
    >
      <AppIcon name={supported ? 'check' : 'close'} color={tone.foreground} size={12} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{ color: tone.foreground, fontSize: 10, lineHeight: 13, fontWeight: '800', includeFontPadding: false }}>
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
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={{
        minHeight: ISLE_MIN_TOUCH_TARGET,
        borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        ...quietControlSurface(colors, active),
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? colors.ui.control.primaryForeground : colors.textTertiary }} />
      <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11, fontWeight: '800' }}>{label}</Text>
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

function isProviderOperationAbort(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
}

function IconIsleChip({ label, children, tone, onPress }: { label: string; children: ReactNode; tone: 'default' | 'mint' | 'danger'; onPress: () => void }) {
  const { colors } = useAppTheme()
  const toneToken = tone === 'mint' ? colors.ui.tone.success : tone === 'danger' ? colors.ui.tone.danger : colors.ui.tone.neutral
  return (
    <IslePressable haptic accessibilityLabel={label} onPress={onPress} style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : toneToken.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : toneToken.border }}>
      {children}
    </IslePressable>
  )
}

function MiniAction({ label, children, active = false, disabled = false, onPress }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, ...quietControlSurface(colors, active), opacity: disabled ? 0.5 : 1 }}>
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
      icon={busy ? <HighFrameSpinner color={secondary ? colors.text : colors.ui.control.primaryForeground} size={16} /> : undefined}
      onPress={onPress}
      style={{ flexGrow: 1 }}
    />
  )
}
