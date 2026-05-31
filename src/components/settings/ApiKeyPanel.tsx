import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native'
import { Check, ChevronDown, KeyRound, ListFilter, Plus, Power, RotateCw, SearchCheck, Sparkles, Star, Trash2 } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AIProvider, ProviderCapabilities, ProviderCredentialGroup, ProviderPresetId, ProviderWireProtocol } from '@/types'
import { getModelConfig, getModelName } from '@/types'
import { applyProviderPreset, detectProviderPreset, getProviderPreset, maskSecret, parseCredentialGroups, probeProviderPreset, PROVIDER_PRESETS } from '@/services/ai/providerRegistry'
import { DEFAULT_PROVIDER_PRESET_ID, PROVIDER_WIRE_PROTOCOL_OPTIONS, inferProviderWireProtocolFromBaseUrl, initialProviderPresetId, initialProviderWireProtocol, resolveProviderConfigDraft, shouldSyncWireProtocolFromBaseUrl } from '@/services/ai/providerConfigPolicy'
import { syncAndTestProvider, summarizeProviderActivation } from '@/services/providerActivation'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleField } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { parseModelEntries } from '@/utils/text'
import { getProviderAvailableModels, getProviderManualModels, getProviderPreferredModel, summarizeProviderModelInventory } from '@/utils/providerModels'

interface ApiKeyPanelProps {
  provider: AIProvider
  initiallyExpanded?: boolean
}

type PanelTask = 'idle' | 'saving' | 'syncing' | 'testing' | 'probing'

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
  'topP',
]

export function ApiKeyPanel({ provider, initiallyExpanded = false }: ApiKeyPanelProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const defaultProvider = useSettingsStore((state) => state.settings.defaultProvider)
  const modelTestModel = useSettingsStore((state) => state.settings.modelTestModel)
  const modelTestCheckParameters = useSettingsStore((state) => state.settings.modelTestCheckParameters)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [presetId, setPresetId] = useState<ProviderPresetId>(initialProviderPresetId(provider))
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(initialProviderWireProtocol(provider))
  const [singleCredentialText, setSingleCredentialText] = useState('')
  const [credentialText, setCredentialText] = useState('')
  const [modelsText, setModelsText] = useState(formatModelEntries(provider))
  const [draftGroups, setDraftGroups] = useState<ProviderCredentialGroup[]>(provider.credentialGroups ?? [])
  const [modelEditing, setModelEditing] = useState(false)
  const [groupKeyMasks, setGroupKeyMasks] = useState<Record<string, string>>({})
  const [task, setTask] = useState<PanelTask>('idle')
  const [notice, setNotice] = useState('')

  const hydratedGroups = draftGroups
  const detection = useMemo(() => detectProviderPreset({ baseUrl, name: provider.name, apiKey: singleCredentialText || credentialText }), [baseUrl, credentialText, provider.name, singleCredentialText])
  const selectedPreset = getProviderPreset(presetId)
  const providerConfigDraft = useMemo(() => resolveProviderConfigDraft({ provider, presetId, baseUrl, wireProtocol }), [baseUrl, presetId, provider, wireProtocol])
  const modelEntries = useMemo(() => parseModelEntries(modelsText), [modelsText])
  const currentModels = modelEntries.models
  const availableModels = useMemo(() => getProviderAvailableModels(provider), [provider])
  const modelInventory = useMemo(() => summarizeProviderModelInventory(provider), [provider])
  const preferredModel = getProviderPreferredModel(provider)
  const primaryModel = preferredModel ?? availableModels[0] ?? currentModels[0] ?? t('apiKeyPanel.noModelSet')
  const primaryModelConfig = getModelConfig(primaryModel, provider.type, provider.modelConfigs)
  const groupCount = hydratedGroups.length
  const syncedGroups = hydratedGroups.filter((group) => group.lastModelSyncStatus === 'ok').length
  const hasKey = hydratedGroups.some((group) => group.enabled) || !!singleCredentialText.trim() || !!credentialText.trim()
  const isDefault = defaultProvider === provider.id
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
    setGroupKeyMasks({})
    setSingleCredentialText('')
    setCredentialText('')
    setNotice('')
  }, [provider.baseUrl, provider.detectedPresetId, provider.id, provider.manualModels, provider.modelAliases, provider.models, provider.presetId, provider.wireProtocol])

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
    const pastedGroups = createIncomingGroups(draftGroups.length, [singleCredentialText, credentialText].filter(Boolean).join('\n'), t)
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
    })
    if (credentialGroups.some((group) => group.enabled)) {
      updateSettings({ onboardingCompleted: true })
    }
    setSingleCredentialText('')
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
    const incoming = createIncomingGroups(draftGroups.length, [singleCredentialText, credentialText].filter(Boolean).join('\n'), t)
    if (!incoming.length) {
      setNotice(t('apiKeyPanel.enterTokensFirst'))
      dialog.toast({ title: t('apiKeyPanel.noTokenAdded'), message: t('apiKeyPanel.enterTokensFirst'), tone: 'amber' })
      return
    }
    setDraftGroups((current) => mergeGroups(current, incoming, t))
    setSingleCredentialText('')
    setCredentialText('')
    setNotice(t('apiKeyPanel.pendingGroupsAdded', { count: incoming.length }))
    dialog.toast({ title: t('apiKeyPanel.groupsAdded', { count: incoming.length }), message: provider.name, tone: 'mint' })
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
    }, { enable: provider.enabled, testModel: modelTestModel, checkParameters: modelTestCheckParameters })
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
    }, { enable: true, testModel: modelTestModel, checkParameters: modelTestCheckParameters })
    const summary = summarizeProviderActivation([result])
    if (result.testOk) {
      updateSettings({ defaultProvider: result.providerId, onboardingCompleted: true })
    }
    setTask('idle')
    setNotice(summary.message)
    dialog.notice({ title: t('apiKeyPanel.providerEnabled', { name: provider.name }), message: summary.message, tone: summary.tone })
  }

  function setDefaultProvider() {
    updateSettings({ defaultProvider: provider.id, onboardingCompleted: true })
    dialog.toast({ title: t('apiKeyPanel.defaultUpdated'), message: provider.name, tone: 'mint' })
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
    const typed = credentialText.split(/[\n,，]+/).map((item) => item.trim()).find(Boolean)
      ?? singleCredentialText.trim()
    if (typed) return typed
    const keyed = await hydrateProviderKey(provider.id)
    return keyed?.credentialGroups?.find((group) => group.enabled && group.apiKey?.trim())?.apiKey ?? keyed?.apiKey
  }

  return (
    <MotiView
      animate={{ scale: expanded ? 1 : 0.995, opacity: provider.enabled ? 1 : 0.82 }}
      transition={{ type: 'spring', damping: 22, stiffness: 180 }}
      style={{
        borderRadius: 26,
        padding: 14,
        backgroundColor: colors.material.paper,
        borderWidth: 1,
        borderColor: expanded ? colors.borderStrong : colors.border,
        marginBottom: 12,
      }}
    >
      <IslePressable haptic onPress={() => setExpanded((value) => !value)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>
          {provider.presetId === 'newapi' || provider.presetId === 'sub2api' ? <Sparkles color={colors.text} size={18} /> : <KeyRound color={colors.text} size={18} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }}>{provider.name}</Text>
            {isDefault ? <Badge label={t('settings.default')} tone="warning" /> : null}
            <Badge label={provider.enabled ? t('apiKeyPanel.enabled') : t('apiKeyPanel.disabled')} tone={provider.enabled ? 'success' : 'muted'} />
            <Badge label={t('apiKeyPanel.tokenGroups', { count: Math.max(groupCount, hasKey ? 1 : 0) })} tone={hasKey ? 'success' : 'muted'} />
            <Badge label={lastStatusLabel} tone={lastStatusTone} />
          </View>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>
            {getModelName(primaryModel)} · {t('apiKeyPanel.modelCount', { count: availableModels.length })} · {getProviderPreset(provider.presetId).name}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
            {t('apiKeyPanel.contextGroups', { context: formatTokenLimit(primaryModelConfig.contextWindow), synced: syncedGroups, total: groupCount })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
            <MiniBadge label={provider.capabilities?.responsesWebSocket ? 'WS' : 'HTTP'} tone={provider.capabilities?.responsesWebSocket ? 'success' : 'muted'} />
            <MiniBadge label={provider.capabilities?.remoteCompact ? 'Compact' : 'Local'} tone={provider.capabilities?.remoteCompact ? 'success' : 'muted'} />
            <MiniBadge label={t('apiKeyPanel.manualModelShort', { count: modelInventory.manualModels })} tone={modelInventory.manualModels ? 'warning' : 'muted'} />
            <MiniBadge label={t('apiKeyPanel.aliasShort', { count: modelInventory.aliases })} tone={modelInventory.aliases ? 'warning' : 'muted'} />
          </View>
        </View>
        {provider.lastTestStatus === 'ok' ? <Check color={colors.success} size={18} /> : null}
        {provider.lastTestStatus === 'bad' ? <RotateCw color={colors.error} size={18} /> : null}
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 180 }}>
          <ChevronDown color={colors.textTertiary} size={19} />
        </MotiView>
      </IslePressable>

      {expanded ? (
        <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'spring', damping: 20, stiffness: 180 }} style={{ marginTop: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <MiniAction active={isDefault} label={isDefault ? t('settings.default') : t('apiKeyPanel.setDefault')} onPress={setDefaultProvider}>
              <Star color={isDefault ? colors.warning : colors.textTertiary} size={15} fill={isDefault ? colors.warning : 'transparent'} />
            </MiniAction>
            <MiniAction active={provider.enabled} label={provider.enabled ? t('apiKeyPanel.enabledState') : t('apiKeyPanel.disabledState')} onPress={() => void toggleProviderEnabled()}>
              <Power color={provider.enabled ? colors.success : colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={t('apiKeyPanel.applyDetection')} onPress={() => void acceptDetection()}>
              <SearchCheck color={colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={task === 'probing' ? t('apiKeyPanel.probing') : t('apiKeyPanel.detectInterface')} onPress={() => void probeDetection()} disabled={isBusy || !baseUrl.trim() || !hasKey}>
              <Sparkles color={colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={t('apiKeyPanel.fetchModelsAndTest')} onPress={() => void syncAndTest()} disabled={isBusy || !hasKey}>
              <ListFilter color={colors.textTertiary} size={15} />
            </MiniAction>
          </View>

          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('apiKeyPanel.autoDetect')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
              {detection.reason} · {t('apiKeyPanel.suggestedPreset', { name: getProviderPreset(detection.presetId).name })}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
              {t('apiKeyPanel.actionHelp')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {PROVIDER_PRESETS.map((preset) => (
                <ChoiceButton key={preset.id} active={presetId === preset.id} label={preset.name} onPress={() => selectPreset(preset.id)} />
              ))}
            </View>
          </View>

          {providerConfigDraft.isProtocolSelectable ? (
            <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, gap: 9 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('providerSettings.protocol.title')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {PROVIDER_WIRE_PROTOCOL_OPTIONS.map((protocol) => (
                  <ChoiceButton key={protocol} active={wireProtocol === protocol} label={t(`providerSettings.protocol.${protocol}`)} onPress={() => selectWireProtocol(protocol)} />
                ))}
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('providerSettings.protocol.endpointNote')}</Text>
            </View>
          ) : null}

          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, gap: 10 }}>
            <SectionHeader
              title={t('apiKeyPanel.capabilityMatrix')}
              description={t('apiKeyPanel.capabilityMatrixDescription')}
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

          <IsleField
            label={t('providerSettings.baseUrl')}
            inputProps={{
              value: baseUrl,
              onChangeText: (value) => {
                setBaseUrl(value)
                if (shouldSyncWireProtocolFromBaseUrl(providerConfigDraft)) setWireProtocol(inferProviderWireProtocolFromBaseUrl(value))
                setNotice('')
              },
              autoCapitalize: 'none',
              autoCorrect: false,
              returnKeyType: 'done',
              placeholder: selectedPreset.baseUrl ?? (resolveProviderConfigDraft({ provider, presetId: DEFAULT_PROVIDER_PRESET_ID }).baseUrl || 'https://new-api.example.com/v1'),
            }}
          />

          <View style={{ gap: 10 }}>
            <SectionHeader
              title={t('apiKeyPanel.credentialGroups')}
              action={
                <MiniAction label={t('apiKeyPanel.add')} onPress={addPendingGroups} disabled={isBusy || !(singleCredentialText.trim() || credentialText.trim())}>
                  <Plus color={colors.textTertiary} size={15} />
                </MiniAction>
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
              <View style={{ borderRadius: 18, padding: 12, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>{t('apiKeyPanel.noCredentialGroups')}</Text>
              </View>
            )}
            <IsleField
              label={t('apiKeyPanel.addSingleToken')}
              inputProps={{
                value: singleCredentialText,
                onChangeText: (value) => {
                  setSingleCredentialText(value)
                  setNotice('')
                },
                secureTextEntry: false,
                autoCapitalize: 'none',
                autoCorrect: false,
                returnKeyType: 'done',
                placeholder: 'sk-...',
              }}
            />
            <IsleField
              label={t('apiKeyPanel.addMultipleTokens')}
              note={t('apiKeyPanel.addMultipleTokensNote')}
              inputProps={{
                value: credentialText,
                onChangeText: (value) => {
                  setCredentialText(value)
                  setNotice('')
                },
                secureTextEntry: false,
                autoCapitalize: 'none',
                autoCorrect: false,
                multiline: true,
                blurOnSubmit: false,
                placeholder: 'sk-...\nsk-...\nsk-...',
                style: { minHeight: 84, maxHeight: 140, textAlignVertical: 'top' },
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
                      <RotateCw color={colors.textTertiary} size={15} />
                    </MiniAction>
                    <MiniAction label={t('common.save')} onPress={() => void save()} disabled={isBusy}>
                      <Check color={colors.textTertiary} size={15} />
                    </MiniAction>
                  </View>
                ) : (
                  <MiniAction label={t('common.edit')} onPress={enterModelEditing}>
                    <ListFilter color={colors.textTertiary} size={15} />
                  </MiniAction>
                )
              }
            />
            {modelEditing ? (
              <IsleField
                label={t('apiKeyPanel.modelId')}
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
                  placeholder: t('providerSettings.oneModelPerLine'),
                  style: { minHeight: 116, maxHeight: 190, paddingVertical: 12, lineHeight: 20, textAlignVertical: 'top' },
                }}
              />
            ) : (
              <ModelSummary models={currentModels} providerType={provider.type} aliases={provider.modelAliases ?? []} manualCount={modelInventory.manualModels} />
            )}
          </View>

          {provider.lastModelSyncMessage || provider.lastTestMessage ? (
            <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.islandRaised }}>
              {provider.lastModelSyncMessage ? <Text style={{ color: provider.lastModelSyncStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 11, lineHeight: 16 }}>{t('apiKeyPanel.syncAndTestLabel', { message: provider.lastModelSyncMessage })}</Text> : null}
              {provider.lastTestMessage && provider.lastTestMessage !== provider.lastModelSyncMessage ? <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: provider.lastModelSyncMessage ? 3 : 0 }}>{provider.lastTestMessage}</Text> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton label={task === 'saving' ? t('apiKeyPanel.saving') : t('common.save')} busy={task === 'saving'} onPress={() => void save()} />
            <ActionButton label={t('apiKeyPanel.fetchModelsAndTest')} busy={task === 'syncing'} disabled={!hasKey || isBusy} onPress={() => void syncAndTest()} secondary />
          </View>

          {notice ? <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{notice}</Text> : null}
        </MotiView>
      ) : null}
    </MotiView>
  )
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
  const background = tone === 'success' ? colors.mintSoft : tone === 'warning' ? colors.amberSoft : colors.islandRaised
  return (
    <View style={{ minHeight: 24, borderRadius: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: background, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '900' }}>{label}</Text>
    </View>
  )
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic onPress={onPress} style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.text : colors.material.field }}>
      <Text style={{ color: active ? colors.surface : colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </IslePressable>
  )
}

function formatTokenLimit(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>{title}</Text>
        {description ? <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>{description}</Text> : null}
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
  const statusTone = group.lastModelSyncStatus === 'bad' ? colors.error : group.enabled ? colors.success : colors.textTertiary
  const statusText = group.lastModelSyncStatus === 'ok'
    ? t('apiKeyPanel.synced')
    : group.lastModelSyncStatus === 'bad'
      ? t('apiKeyPanel.syncFailed')
      : group.enabled ? t('apiKeyPanel.enabled') : t('apiKeyPanel.disabled')
  return (
    <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: group.enabled ? colors.borderStrong : colors.border, gap: 9 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
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
            minHeight: 44,
            borderRadius: 16,
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.material.field,
            borderWidth: 1,
            borderColor: colors.border,
            fontSize: 13,
            fontWeight: '900',
          }}
        />
        <IconIsleChip label={group.enabled ? t('apiKeyPanel.disabled') : t('apiKeyPanel.enabled')} onPress={onToggle} tone={group.enabled ? 'mint' : 'default'}>
          <Power color={group.enabled ? colors.success : colors.textTertiary} size={15} />
        </IconIsleChip>
        <IconIsleChip label={t('common.delete')} onPress={onDelete} tone="danger">
          <Trash2 color={colors.error} size={15} />
        </IconIsleChip>
      </View>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{maskedKey || t('apiKeyPanel.newTokenPending')}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>{t('apiKeyPanel.modelCount', { count: group.availableModels?.length ?? 0 })}</Text>
        <Text style={{ color: statusTone, fontSize: 11, fontWeight: '900' }}>{statusText}</Text>
        {group.failureCount ? <Text style={{ color: colors.error, fontSize: 11, fontWeight: '900' }}>{t('apiKeyPanel.failureCount', { count: group.failureCount })}</Text> : null}
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

function ModelSummary({ models, providerType, aliases, manualCount }: { models: string[]; providerType: AIProvider['type']; aliases: NonNullable<AIProvider['modelAliases']>; manualCount: number }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const shown = models.slice(0, 8)
  if (!shown.length) {
    return (
      <View style={{ borderRadius: 18, padding: 12, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>{t('apiKeyPanel.noModels')}</Text>
      </View>
    )
  }
  return (
    <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 9 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <MiniBadge label={t('apiKeyPanel.manualModelShort', { count: manualCount })} tone={manualCount ? 'warning' : 'muted'} />
        <MiniBadge label={t('apiKeyPanel.aliasShort', { count: aliases.length })} tone={aliases.length ? 'warning' : 'muted'} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {shown.map((model) => <ModelChip key={model} label={getModelName(model)} />)}
      </View>
      {aliases.length ? (
        <View style={{ gap: 5 }}>
          {aliases.slice(0, 4).map((alias) => (
            <Text key={alias.alias} numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>
              {`${alias.alias} -> ${alias.model}`}
            </Text>
          ))}
          {aliases.length > 4 ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{aliases.length - 4}</Text> : null}
        </View>
      ) : null}
      {models.length > shown.length ? <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>+{models.length - shown.length}</Text> : null}
    </View>
  )
}

function ModelChip({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 30, borderRadius: 15, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', maxWidth: 180 }}>{label}</Text>
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
        borderRadius: 19,
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: active ? colors.mintSoft : colors.material.field,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? colors.success : colors.textTertiary }} />
      <Text style={{ color: active ? colors.text : colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </IslePressable>
  )
}

function IconIsleChip({ label, children, tone, onPress }: { label: string; children: ReactNode; tone: 'default' | 'mint' | 'danger'; onPress: () => void }) {
  const { colors } = useAppTheme()
  const background = tone === 'mint' ? colors.mintSoft : tone === 'danger' ? colors.coralWash : colors.material.field
  return (
    <IslePressable haptic accessibilityLabel={label} onPress={onPress} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: background, borderWidth: 1, borderColor: colors.border }}>
      {children}
    </IslePressable>
  )
}

function MiniAction({ label, children, active = false, disabled = false, onPress }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic disabled={disabled} onPress={onPress} style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: active ? colors.amberSoft : colors.islandRaised, opacity: disabled ? 0.5 : 1 }}>
      {children}
      <Text style={{ color: active ? colors.text : colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
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
      icon={busy ? <ActivityIndicator size="small" color={secondary ? colors.text : colors.surface} /> : undefined}
      onPress={onPress}
      style={{ flexGrow: 1 }}
    />
  )
}
