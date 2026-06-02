import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { ChevronDown, ChevronLeft, ClipboardPaste, FileJson, GripVertical, Import, ListChecks, Plus, Search, SlidersHorizontal, X, Zap } from 'lucide-react-native'
import { MotiView } from 'moti'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { IsleField, IsleHeader, IsleIconButton, IsleSection } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useActivationJobStore, type ActivationJobState } from '@/store/activationJobStore'
import type { AIProvider, ProviderPresetId, ProviderWireProtocol } from '@/types'
import { applyProviderPreset, getProviderPreset, parseCredentialGroups, parseProviderImportText, PROVIDER_PRESETS } from '@/services/ai/providerRegistry'
import { DEFAULT_PROVIDER_PRESET_ID, DEFAULT_PROVIDER_WIRE_PROTOCOL, PROVIDER_WIRE_PROTOCOL_OPTIONS, inferProviderWireProtocolFromBaseUrl, resolveProviderConfigDraft, shouldSyncWireProtocolFromBaseUrl } from '@/services/ai/providerConfigPolicy'
import { syncAndTestProvider, summarizeProviderActivation } from '@/services/providerActivation'
import { IsleMetric } from '@/components/ui/isle'
import { normalizeSearchText, parseModels } from '@/utils/text'
import { isProviderConversationReady } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels, getProviderModelDisplayCandidates, providerHasPolicyAllowedModel, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'

const SORT_OPTIONS: { id: ProviderSortMode; labelKey: string }[] = [
  { id: 'manual', labelKey: 'providerSettings.sort.manual' },
  { id: 'recent', labelKey: 'providerSettings.sort.recent' },
  { id: 'enabled', labelKey: 'providerSettings.sort.enabled' },
  { id: 'models', labelKey: 'providerSettings.sort.models' },
  { id: 'health', labelKey: 'providerSettings.sort.health' },
  { id: 'name', labelKey: 'providerSettings.sort.name' },
]

const IMPORT_INPUT_LINE_HEIGHT = 20
const IMPORT_INPUT_VERTICAL_PADDING = 24
const IMPORT_INPUT_MAX_LINES = 14
const IMPORT_SHEET_MARGIN = 16
const IMPORT_HEADER_HEIGHT = 78
const IMPORT_FOOTER_HEIGHT = 76
const IMPORT_BODY_FIXED_SPACE = 118

interface ProviderSettingsContentProps {
  embedded?: boolean
  onClose?: () => void
}

export function ProviderSettingsContent({ embedded = false, onClose }: ProviderSettingsContentProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const motion = useMotionPreference()
  const pagerGestureLock = useMainPagerGestureLock()
  const providers = useSettingsStore((state) => state.providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const addProviders = useSettingsStore((state) => state.addProviders)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateProviderCredentialGroupHealth = useSettingsStore((state) => state.updateProviderCredentialGroupHealth)
  const settings = useSettingsStore((state) => state.settings)
  const modelTestModel = settings.modelTestModel
  const modelTestCheckParameters = settings.modelTestCheckParameters
  const activationJob = useActivationJobStore((state) => state.job)
  const startActivationJob = useActivationJobStore((state) => state.start)
  const updateActivationJob = useActivationJobStore((state) => state.update)
  const finishActivationJob = useActivationJobStore((state) => state.finish)
  const clearActivationJob = useActivationJobStore((state) => state.clear)
  const conversations = useChatStore((state) => state.conversations)
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<ProviderSortMode>('manual')
  const [modelFilter, setModelFilter] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [activationBusy, setActivationBusy] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!embedded) return undefined
    pagerGestureLock?.setLocked(true)
    return () => pagerGestureLock?.setLocked(false)
  }, [embedded, pagerGestureLock])

  const usageByProvider = useMemo(() => {
    const usage = new Map<string, number>()
    for (const conversation of conversations) {
      if (conversation.providerId === 'local-setup') continue
      usage.set(conversation.providerId, Math.max(usage.get(conversation.providerId) ?? 0, conversation.updatedAt))
    }
    return usage
  }, [conversations])

  const visibleProviders = useMemo(() => {
    const normalizedFilter = normalizeSearchText(modelFilter)
    const filtered = normalizedFilter
      ? providers.filter((provider) => providerMatchesModelFilter(provider, normalizedFilter, settings))
      : providers
    return [...filtered].sort((a, b) => compareProviders(a, b, sortMode, usageByProvider, settings))
  }, [modelFilter, providers, settings, sortMode, usageByProvider])

  const enabled = providers.filter((provider) => provider.enabled).length
  const available = providers.filter((provider) => isProviderConversationReady(provider) && providerHasPolicyAllowedModel(provider, settings)).length
  const credentialGroups = providers.reduce((sum, provider) => sum + (provider.credentialGroups?.length ?? 0), 0)

  async function addProviderFromForm(provider: AIProvider) {
    await addProvider(provider)
    setExpandedProviderId(provider.id)
    setSortMode('manual')
    setModelFilter('')
    setAddOpen(false)
    dialog.toast({ title: t('providerSettings.added'), message: t('providerSettings.addedMessage', { name: provider.name }), tone: 'mint' })
    const enableNow = await dialog.confirm({
      title: t('providerSettings.enableAddedTitle'),
      message: t('providerSettings.enableAddedMessage', { name: provider.name }),
      confirmLabel: t('providerSettings.enableAddedConfirm'),
      cancelLabel: t('providerSettings.enableLater'),
      tone: 'mint',
    })
    if (enableNow) {
      void activateProviders([provider.id], 'single')
    }
  }

  async function importProvidersFromText(input: string) {
    const result = parseProviderImportText(input, { accessSettings: settings })
    if (!result.providers.length) {
      dialog.notice({ title: t('providerSettings.importEmpty'), message: result.warnings.join('\n') || t('providerSettings.importEmptyMessage'), tone: 'amber' })
      return
    }
    await addProviders(result.providers)
    setExpandedProviderId(result.providers[0]?.id ?? null)
    setSortMode('manual')
    setModelFilter('')
    setImportOpen(false)
    dialog.toast({
      title: t('providerSettings.importDone'),
      message: t('providerSettings.importDoneMessage', { count: result.providers.length }),
      tone: result.warnings.length ? 'amber' : 'mint',
      durationMs: 1800,
    })
    const enableNow = await dialog.confirm({
      title: t('providerSettings.enableImportedTitle'),
      message: [t('providerSettings.enableImportedMessage', { count: result.providers.length }), ...result.warnings].join('\n'),
      confirmLabel: t('providerSettings.enableImportedConfirm'),
      cancelLabel: t('providerSettings.enableLater'),
      tone: result.warnings.length ? 'amber' : 'mint',
    })
    if (enableNow) {
      void activateProviders(result.providers.map((provider) => provider.id), 'batch')
    }
  }

  async function enableEffectiveSelection() {
    const ids = batchMode ? Array.from(selectedIds) : providers.map((provider) => provider.id)
    if (!ids.length) {
      dialog.toast({ title: t('providerSettings.enableNone'), tone: 'amber' })
      return
    }
    void activateProviders(ids, batchMode ? 'batch' : 'all')
  }

  async function activateProviders(ids: string[], mode: 'single' | 'batch' | 'all') {
    if (activationBusy || activationJob?.status === 'running') return
    const currentProviders = useSettingsStore.getState().providers
    const chosen = ids.map((id) => currentProviders.find((provider) => provider.id === id)).filter((provider): provider is AIProvider => !!provider)
    if (!chosen.length) {
      dialog.toast({ title: t('providerSettings.enableNone'), tone: 'amber' })
      return
    }
    const startTitle = chosen.length === 1 ? t('providerSettings.activatingProvider') : t('providerSettings.activationStarted')
    setActivationBusy(true)
    try {
      dialog.toast({
        title: startTitle,
        message: t('providerSettings.activationStartedMessage', { count: chosen.length }),
        tone: 'mint',
        position: 'bottom',
        durationMs: 1800,
      })
      const results = []
      let completed = 0
      let synced = 0
      let tested = 0
      let failed = 0
      startActivationJob({
        status: 'running',
        total: chosen.length,
        completed: 0,
        synced: 0,
        tested: 0,
        failed: 0,
        stage: t('providerSettings.activationQueued'),
      })
      for (const provider of chosen) {
        updateActivationJob({
          status: 'running',
          total: chosen.length,
          completed,
          synced,
          tested,
          failed,
          currentName: provider.name,
          stage: t('providerSettings.activationCurrent', { name: provider.name }),
        })
        dialog.toast({
          title: t('providerSettings.activationRunning'),
          message: t('providerSettings.activationCurrent', { name: provider.name }),
          tone: 'mint',
          position: 'bottom',
          durationMs: 1300,
        })
        const result = await syncAndTestProvider(provider, {
          updateProvider,
          hydrateProviderKey,
          updateProviderCredentialGroupHealth,
          onStage: (event) => {
            updateActivationJob({ currentName: event.providerName, stage: event.message })
            dialog.toast({
              title: stageToastTitle(event.stage, t),
              message: event.message,
              tone: event.tone,
              position: 'bottom',
              durationMs: 1300,
            })
          },
        }, { enable: true, testModel: modelTestModel, checkParameters: modelTestCheckParameters, accessSettings: settings }).catch((error) => ({
          providerId: provider.id,
          providerName: provider.name,
          enabled: provider.enabled,
          hadCredential: !!provider.apiKey?.trim() || !!provider.credentialGroups?.some((group) => group.enabled && group.apiKey?.trim()),
          synced: false,
          syncAttempted: true,
          modelCount: provider.models.length,
          syncedGroups: 0,
          missingToken: false,
          tested: false,
          testOk: false,
          messages: [],
          failures: [{
            providerName: provider.name,
            message: error instanceof Error ? error.message : t('providerSettings.activationFailed'),
          }],
        }))
        results.push(result)
        completed += 1
        if (result.synced) synced += 1
        if (result.testOk) tested += 1
        if (result.failures.length && !result.testOk) failed += 1
        updateActivationJob({
          status: 'running',
          total: chosen.length,
          completed,
          synced,
          tested,
          failed,
          currentName: result.providerName,
          stage: result.testOk
            ? t('providerSettings.activationProviderReady', { name: result.providerName })
            : t('providerSettings.activationProviderNeedsCheck', { name: result.providerName }),
        })
        dialog.toast({
          title: result.testOk ? t('providerSettings.activationSuccess') : t('providerSettings.activationPartial'),
          message: result.testOk
            ? t('providerSettings.activationProviderReady', { name: result.providerName })
            : t('providerSettings.activationProviderNeedsCheck', { name: result.providerName }),
          tone: result.testOk ? 'mint' : 'amber',
          position: 'bottom',
          durationMs: 1600,
        })
      }
      const summary = summarizeProviderActivation(results)
      const primaryReady = results.find((result) => result.testOk)
      if (primaryReady) {
        useSettingsStore.getState().updateSettings({ defaultProvider: primaryReady.providerId, onboardingCompleted: true })
      }
      if (mode === 'single') {
        const result = results[0]
        const title = result?.testOk
          ? t('providerSettings.activationSuccess')
          : result?.synced
            ? t('providerSettings.activationPartial')
            : t('providerSettings.activationFailed')
        dialog.toast({ title, message: summary.message, tone: summary.tone, position: 'bottom', durationMs: 3800 })
      } else {
        dialog.toast({
          title: t('providerSettings.enableDone'),
          message: summary.message,
          tone: summary.tone,
          position: 'bottom',
          durationMs: 4200,
        })
      }
      if (mountedRef.current) {
        setBatchMode(false)
        setSelectedIds(new Set())
      }
      finishActivationJob({
        status: summary.tone === 'danger' ? 'failed' : 'done',
        total: chosen.length,
        completed,
        synced,
        tested,
        failed,
        stage: t('providerSettings.enableDone'),
      })
    } finally {
      if (mountedRef.current) setActivationBusy(false)
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function moveProvider(sourceId: string, direction: -1 | 1) {
    const currentIndex = providers.findIndex((provider) => provider.id === sourceId)
    if (currentIndex < 0) return
    const targetIndex = currentIndex + direction
    if (targetIndex < 0 || targetIndex >= providers.length) return
    const ordered = [...providers]
    const [item] = ordered.splice(currentIndex, 1)
    ordered.splice(targetIndex, 0, item)
    reorderProviders(ordered.map((provider) => provider.id))
    setSortMode('manual')
    dialog.toast({ title: t('providerSettings.orderUpdated'), message: item.name, tone: 'mint' })
  }

  const content = (
    <>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96 }}
        >
          <IsleHeader
            title={t('settings.providerManagement')}
            leading={
              <HeaderBackButton onPress={onClose ?? closeStandaloneProviderSettings} />
            }
            trailing={
              <IsleIconButton label={batchMode ? t('providerSettings.exitBatch') : t('providerSettings.batchMode')} tone={batchMode ? 'amber' : 'default'} onPress={() => {
                setBatchMode((value) => !value)
                setSelectedIds(new Set())
                dialog.toast({ title: batchMode ? t('providerSettings.batchExited') : t('providerSettings.batchEntered'), tone: 'mint' })
              }}>
                <ListChecks color={batchMode ? colors.warning : colors.textSecondary} size={18} strokeWidth={2} />
              </IsleIconButton>
            }
          />

          <IsleSection title={t('providerSettings.overview')} style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <IsleMetric label={t('providerSettings.enabledCount', { count: enabled })} />
              <IsleMetric label={t('providerSettings.availableCount', { count: available })} />
              <IsleMetric label={t('providerSettings.credentialGroupCount', { count: credentialGroups })} />
              <IsleMetric label={t('providerSettings.providerCount', { count: providers.length })} />
              <IsleMetric label={t('providerSettings.visibleCount', { count: visibleProviders.length })} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <IsleButton label={t('settings.addProvider')} compact icon={<Plus color={colors.textSecondary} size={16} />} onPress={() => setAddOpen(true)} />
              <IsleButton label={t('settings.batchImport')} compact icon={<Import color={colors.textSecondary} size={16} />} onPress={() => setImportOpen(true)} />
              <IsleButton
                label={batchMode ? t('providerSettings.enableSelected', { count: selectedIds.size }) : t('settings.enableAll')}
                compact
                tone="mint"
                icon={<Zap color={colors.textSecondary} size={16} />}
                onPress={() => void enableEffectiveSelection()}
                disabled={activationBusy || activationJob?.status === 'running' || (batchMode ? !selectedIds.size : !providers.length)}
              />
            </View>
          </IsleSection>

          {activationJob ? (
            <ActivationProgressCard job={activationJob} onDismiss={clearActivationJob} />
          ) : null}

          <View style={{ minHeight: 48, borderRadius: 24, paddingHorizontal: 12, marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
            <Search color={colors.textTertiary} size={17} />
            <TextInput
              value={modelFilter}
              onChangeText={setModelFilter}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('providerSettings.filterModels')}
              placeholderTextColor={colors.textTertiary}
              style={{ flex: 1, minHeight: 46, padding: 0, color: colors.text, fontSize: 14, fontWeight: '800' }}
            />
            {modelFilter ? (
              <IslePressable haptic accessibilityLabel={t('common.clearSearch')} onPress={() => setModelFilter('')} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}>
                <X color={colors.textSecondary} size={15} />
              </IslePressable>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 }}>
            <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <SlidersHorizontal color={colors.textTertiary} size={16} />
            </View>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SORT_OPTIONS.map((option) => (
                <ChoiceIsleChip
                  key={option.id}
                  label={t(option.labelKey)}
                  active={sortMode === option.id}
                  onPress={() => {
                    setSortMode(option.id)
                    dialog.toast({ title: t('providerSettings.sortChanged', { label: t(option.labelKey) }), tone: 'mint' })
                  }}
                />
              ))}
            </View>
          </View>

          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 22, marginBottom: 10 }}>{t('providerSettings.list')}</Text>
          <View style={{ gap: 12 }}>
            {visibleProviders.map((provider, index) => (
              <MotiView
                key={provider.id}
                from={motion === 'full' ? { opacity: 0, translateY: 10, scale: 0.99 } : { opacity: 0 }}
                animate={{ opacity: 1, translateY: 0, scale: 1 }}
                transition={motion === 'full'
                  ? { type: 'spring', ...motionTokens.spring.gentle, delay: Math.min(index * 24, 160) }
                  : { type: 'timing', duration: motionTokens.duration.fast }}
              >
                <ProviderListRow
                  provider={provider}
                  selected={selectedIds.has(provider.id)}
                  batchMode={batchMode}
                  expanded={expandedProviderId === provider.id || (expandedProviderId === null && index === 0 && !provider.enabled)}
                  canMoveUp={providers.findIndex((item) => item.id === provider.id) > 0}
                  canMoveDown={providers.findIndex((item) => item.id === provider.id) < providers.length - 1}
                  onToggleSelected={() => toggleSelection(provider.id)}
                  onMove={(direction) => moveProvider(provider.id, direction)}
                />
              </MotiView>
            ))}
          </View>
          {!visibleProviders.length ? <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginTop: 16 }}>{t('providerSettings.noMatches')}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <ProviderFormModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(provider) => void addProviderFromForm(provider)}
      />
      <ProviderImportModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onSubmit={(input) => void importProvidersFromText(input)}
      />
    </>
  )

  if (embedded) return <View style={{ flex: 1 }}>{content}</View>
  return content
}

export default ProviderSettingsContent

function HeaderBackButton({ onPress }: { onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <IsleIconButton label={t('common.back')} size="lg" onPress={onPress} style={{ backgroundColor: colors.islandRaised }}>
      <ChevronLeft color={colors.text} size={24} strokeWidth={1.9} />
    </IsleIconButton>
  )
}

function closeStandaloneProviderSettings() {
  router.replace('/settings')
}

function useKeyboardAwareModalRequestClose(onClose: () => void) {
  const keyboardActiveRef = useRef(false)

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      keyboardActiveRef.current = true
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardActiveRef.current = false
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  function markKeyboardActive() {
    keyboardActiveRef.current = true
  }

  function handleRequestClose() {
    if (Platform.OS === 'android' && keyboardActiveRef.current) {
      Keyboard.dismiss()
      keyboardActiveRef.current = false
      return
    }
    onClose()
  }

  return { handleRequestClose, markKeyboardActive }
}

function ProviderListRow({
  provider,
  selected,
  batchMode,
  expanded,
  canMoveUp,
  canMoveDown,
  onToggleSelected,
  onMove,
}: {
  provider: AIProvider
  selected: boolean
  batchMode: boolean
  expanded: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onToggleSelected: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}>
      <DragRail disabledUp={!canMoveUp} disabledDown={!canMoveDown} onMove={onMove} />
      {batchMode ? (
        <IslePressable haptic onPress={onToggleSelected} accessibilityLabel={selected ? t('providerSettings.unselectProvider') : t('providerSettings.selectProvider')} style={{ width: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.mintSoft : colors.islandRaised, borderWidth: 1, borderColor: selected ? colors.primary : colors.border }}>
          <Text style={{ color: selected ? colors.primary : colors.textTertiary, fontSize: 13, fontWeight: '900' }}>{selected ? '✓' : ''}</Text>
        </IslePressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <ApiKeyPanel provider={provider} initiallyExpanded={expanded} />
      </View>
    </View>
  )
}

function DragRail({ disabledUp, disabledDown, onMove }: { disabledUp: boolean; disabledDown: boolean; onMove: (direction: -1 | 1) => void }) {
  const { colors } = useAppTheme()
  const translateY = useSharedValue(0)
  const gesture = Gesture.Pan()
    .activateAfterLongPress(220)
    .onUpdate((event) => {
      translateY.value = Math.max(-26, Math.min(26, event.translationY))
    })
    .onEnd((event) => {
      const direction = event.translationY < -18 ? -1 : event.translationY > 18 ? 1 : 0
      translateY.value = withSpring(0)
      if (direction === -1 && !disabledUp) runOnJS(onMove)(-1)
      if (direction === 1 && !disabledDown) runOnJS(onMove)(1)
    })
    .onFinalize(() => {
      translateY.value = withSpring(0)
    })
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, opacity: disabledUp && disabledDown ? 0.42 : 1 }, animatedStyle]}>
        <GripVertical color={colors.textTertiary} size={17} />
      </Animated.View>
    </GestureDetector>
  )
}

function ChoiceIsleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic onPress={onPress} style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.text : colors.islandRaised, borderWidth: active ? 0 : 1, borderColor: colors.border }}>
      <Text style={{ color: active ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{label}</Text>
    </IslePressable>
  )
}

function ActivationProgressCard({ job, onDismiss }: { job: ActivationJobState; onDismiss: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const progress = job.total ? job.completed / job.total : 0
  const done = job.status !== 'running'
  return (
    <MotiView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 190 }}
      style={{ marginTop: 14 }}
    >
      <View style={{ borderRadius: 24, padding: 13, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.borderStrong, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>
              {done ? t('providerSettings.enableDone') : t('providerSettings.activationRunning')}
            </Text>
            <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2, fontWeight: '800' }}>
              {job.stage ?? job.currentName ?? t('providerSettings.activationQueued')}
            </Text>
          </View>
          {done ? (
            <IsleIconButton label={t('dialog.close')} size="sm" onPress={onDismiss}>
              <X color={colors.textSecondary} size={15} />
            </IsleIconButton>
          ) : null}
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.islandRaised, overflow: 'hidden' }}>
          <MotiView
            animate={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
            transition={{ type: 'timing', duration: 180 }}
            style={{ height: 8, borderRadius: 4, backgroundColor: job.failed ? colors.warning : colors.primary }}
          />
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '900' }}>
          {t('providerSettings.activationProgressMessage', { completed: job.completed, total: job.total, synced: job.synced, tested: job.tested, failed: job.failed })}
        </Text>
      </View>
    </MotiView>
  )
}

function stageToastTitle(stage: 'enabled' | 'syncing' | 'testing' | 'done' | 'failed', t: ReturnType<typeof useTranslation>['t']): string {
  switch (stage) {
    case 'enabled':
      return t('providerSettings.activationEnabled')
    case 'syncing':
      return t('providerSettings.activationSyncing')
    case 'testing':
      return t('providerSettings.activationTesting')
    case 'done':
      return t('providerSettings.activationSuccess')
    case 'failed':
      return t('providerSettings.activationFailed')
  }
}

function ProviderFormModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean
  onClose: () => void
  onSubmit: (provider: AIProvider) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const motion = useMotionPreference()
  const [presetId, setPresetId] = useState<ProviderPresetId>(DEFAULT_PROVIDER_PRESET_ID)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  const [modelsText, setModelsText] = useState('')
  const [keysText, setKeysText] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const preset = getProviderPreset(presetId)
  const providerConfigDraft = resolveProviderConfigDraft({ provider: {}, presetId, baseUrl, wireProtocol })
  const compact = height < 680

  function resetDraft() {
    setName('')
    setBaseUrl('')
    setModelsText('')
    setKeysText('')
    setAdvancedOpen(false)
    setPresetId(DEFAULT_PROVIDER_PRESET_ID)
    setWireProtocol(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  }

  function closeWithoutSubmit() {
    resetDraft()
    onClose()
  }

  const keyboardRequestClose = useKeyboardAwareModalRequestClose(closeWithoutSubmit)

  function submit() {
    const modelList = parseModels(modelsText)
    const provider = applyProviderPreset({
      id: `custom-${Date.now().toString(36)}`,
      presetId,
      detectedPresetId: presetId,
      detectionStatus: 'manual',
      type: preset.type,
      name: name.trim() || preset.name,
      baseUrl: providerConfigDraft.baseUrl,
      credentialMode: providerConfigDraft.credentialMode,
      tokenPlanRegion: providerConfigDraft.tokenPlanRegion,
      wireProtocol: providerConfigDraft.wireProtocol,
      apiKey: '',
      credentialGroups: parseCredentialGroups(keysText),
      models: modelList,
      enabled: false,
    } satisfies AIProvider, presetId)
    onSubmit(provider)
    resetDraft()
  }

  function selectPreset(nextPresetId: ProviderPresetId) {
    const nextPreset = getProviderPreset(nextPresetId)
    const nextProtocol = inferProviderWireProtocolFromBaseUrl(baseUrl)
    const nextDraft = resolveProviderConfigDraft({ provider: {}, presetId: nextPresetId, baseUrl, wireProtocol: nextProtocol })
    setPresetId(nextPresetId)
    setWireProtocol(nextProtocol)
    setBaseUrl(nextDraft.baseUrl)
    if (!name.trim()) setName(nextPreset.name)
  }

  function selectWireProtocol(nextProtocol: ProviderWireProtocol) {
    setWireProtocol(nextProtocol)
    setBaseUrl(resolveProviderConfigDraft({ provider: {}, presetId, baseUrl, wireProtocol: nextProtocol }).baseUrl)
  }

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={keyboardRequestClose.handleRequestClose}>
      <View style={{ flex: 1 }}>
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <IsleOverlayPressable accessibilityLabel={t('dialog.close')} accessibilityRole="button" onPress={closeWithoutSubmit} style={{ flex: 1, backgroundColor: colors.backdrop }} />
        </MotiView>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateY: 32, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={motion === 'full' ? { type: 'spring', damping: 23, stiffness: 190 } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{ maxHeight: compact ? '94%' : '88%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}
          >
            <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, backgroundColor: colors.surface }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>{t('settings.addProvider')}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>{t('providerSettings.addSubtitle')}</Text>
                </View>
                <IsleIconButton label={t('dialog.close')} onPress={closeWithoutSubmit}>
                  <X color={colors.textSecondary} size={18} />
                </IsleIconButton>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 12 }}>
                {PROVIDER_PRESETS.map((item) => (
                  <ChoiceIsleChip
                    key={item.id}
                    label={item.name}
                    active={presetId === item.id}
                    onPress={() => selectPreset(item.id)}
                  />
                ))}
              </ScrollView>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={compact}
              contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: colors.surface }}
            >
              <IsleField label={t('providerSettings.name')} inputProps={{ value: name, onChangeText: setName, onFocus: keyboardRequestClose.markKeyboardActive, placeholder: preset.name, autoCapitalize: 'none' }} />
              {providerConfigDraft.isProtocolSelectable ? (
                <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, gap: 9 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('providerSettings.protocol.title')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {PROVIDER_WIRE_PROTOCOL_OPTIONS.map((protocol) => (
                      <ChoiceIsleChip key={protocol} active={wireProtocol === protocol} label={t(`providerSettings.protocol.${protocol}`)} onPress={() => selectWireProtocol(protocol)} />
                    ))}
                  </View>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('providerSettings.protocol.endpointNote')}</Text>
                </View>
              ) : null}
              <IsleField
                label={t('providerSettings.baseUrl')}
                inputProps={{
                  value: baseUrl,
                  onFocus: keyboardRequestClose.markKeyboardActive,
                  onChangeText: (value) => {
                    setBaseUrl(value)
                    if (shouldSyncWireProtocolFromBaseUrl(providerConfigDraft)) setWireProtocol(inferProviderWireProtocolFromBaseUrl(value))
                  },
                  placeholder: preset.baseUrl ?? 'https://example.com/v1',
                  autoCapitalize: 'none',
                  autoCorrect: false,
                }}
              />
              <IsleField
                label={t('providerSettings.tokens')}
                note={t('providerSettings.tokensNote')}
                inputProps={{ value: keysText, onChangeText: setKeysText, onFocus: keyboardRequestClose.markKeyboardActive, placeholder: 'sk-...\nsk-...', autoCapitalize: 'none', autoCorrect: false, multiline: true, secureTextEntry: false, style: { minHeight: compact ? 72 : 92, maxHeight: compact ? 110 : 140 } }}
              />
              <IslePressable
                haptic
                onPress={() => setAdvancedOpen((value) => !value)}
                style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('providerSettings.advancedModels')}</Text>
                <MotiView animate={{ rotate: advancedOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                  <ChevronDown color={colors.textTertiary} size={16} />
                </MotiView>
              </IslePressable>
              {advancedOpen ? (
                <IsleField
                  label={t('settings.models')}
                  note={t('providerSettings.modelsNote')}
                  inputProps={{ value: modelsText, onChangeText: setModelsText, onFocus: keyboardRequestClose.markKeyboardActive, placeholder: t('providerSettings.oneModelPerLine'), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 76, maxHeight: 120 } }}
                />
              ) : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
              <IsleButton label={t('common.cancel')} onPress={closeWithoutSubmit} style={{ flex: 1 }} />
              <IsleButton label={t('common.save')} tone="primary" onPress={submit} style={{ flex: 1 }} />
              </View>
          </MotiView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function ProviderImportModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean
  onClose: () => void
  onSubmit: (input: string) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const motion = useMotionPreference()
  const bodyScrollRef = useRef<ScrollView>(null)
  const [input, setInput] = useState('')
  const [contentHeight, setContentHeight] = useState(0)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const compact = height < 680
  const keyboardInset = keyboardHeight
  const availableSheetHeight = Math.max(
    360,
    height - insets.top - Math.max(insets.bottom, 10) - keyboardInset - IMPORT_SHEET_MARGIN,
  )
  const availableBodyHeight = Math.max(
    180,
    availableSheetHeight - IMPORT_HEADER_HEIGHT - IMPORT_FOOTER_HEIGHT - IMPORT_BODY_FIXED_SPACE,
  )
  const maxInputHeight = Math.max(
    IMPORT_INPUT_LINE_HEIGHT * 2 + IMPORT_INPUT_VERTICAL_PADDING,
    Math.min(
      availableBodyHeight * 0.72,
      IMPORT_INPUT_LINE_HEIGHT * IMPORT_INPUT_MAX_LINES + IMPORT_INPUT_VERTICAL_PADDING,
    ),
  )
  const logicalLines = Math.max(1, input.split(/\r\n|\r|\n/).length)
  const logicalVisibleLines = Math.max(2, logicalLines + 1)
  const logicalHeight = IMPORT_INPUT_VERTICAL_PADDING + logicalVisibleLines * IMPORT_INPUT_LINE_HEIGHT
  const measuredHeight = contentHeight ? contentHeight + IMPORT_INPUT_VERTICAL_PADDING : logicalHeight
  const targetInputHeight = Math.max(logicalHeight, measuredHeight)
  const inputHeight = Math.min(targetInputHeight, maxInputHeight)
  const inputScrollEnabled = targetInputHeight > maxInputHeight
  const sheetMaxHeight = Math.min(availableSheetHeight, height * (compact ? 0.96 : 0.9))
  const footerCompact = width < 380
  const keyboardRequestClose = useKeyboardAwareModalRequestClose(onClose)

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0)
      setContentHeight(0)
      return
    }
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
      scrollBodyToEndSoon()
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [visible])

  function scrollBodyToEndSoon() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bodyScrollRef.current?.scrollToEnd({ animated: true })
      })
    })
  }

  function appendInputText(text: string) {
    setInput((current) => [current.trim(), text.trim()].filter(Boolean).join('\n\n'))
    scrollBodyToEndSoon()
  }

  function submit() {
    onSubmit(input)
    setInput('')
    setContentHeight(0)
  }

  async function pasteFromClipboard() {
    const text = await Clipboard.getStringAsync()
    if (!text.trim()) {
      dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
      return
    }
    appendInputText(text)
    dialog.toast({ title: t('providerSettings.clipboardRead'), tone: 'mint' })
  }

  async function importFromFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json', '*/*'],
      copyToCacheDirectory: true,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    const name = asset.name.toLowerCase()
    const supported = /\.(txt|csv|json)$/i.test(name) || ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json'].includes(asset.mimeType ?? '')
    if (!supported) {
      dialog.toast({ title: t('providerSettings.fileUnsupported'), message: t('providerSettings.fileUnsupportedMessage'), tone: 'amber' })
      return
    }
    const text = await FileSystem.readAsStringAsync(asset.uri)
    appendInputText(text)
    dialog.toast({ title: t('providerSettings.fileRead'), message: asset.name, tone: 'mint' })
  }

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={keyboardRequestClose.handleRequestClose}>
      <View style={{ flex: 1 }}>
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <IsleOverlayPressable accessibilityLabel={t('dialog.close')} accessibilityRole="button" onPress={onClose} style={{ flex: 1, backgroundColor: colors.backdrop }} />
        </MotiView>
        <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: keyboardInset }}>
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateY: 32, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={motion === 'full' ? { type: 'spring', damping: 23, stiffness: 190 } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{
              maxHeight: sheetMaxHeight,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            <View style={{ minHeight: IMPORT_HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, backgroundColor: colors.surface }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>{t('settings.batchImport')}</Text>
              </View>
              <IsleIconButton label={t('dialog.close')} onPress={onClose}>
                <X color={colors.textSecondary} size={18} />
              </IsleIconButton>
            </View>
            <ScrollView
              ref={bodyScrollRef}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={compact || inputScrollEnabled}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 14, backgroundColor: colors.surface }}
            >
              <View>
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', marginBottom: 7 }}>{t('providerSettings.importSources')}</Text>
                  <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 8 }}>
                    <IsleButton
                      label={t('settings.pasteClipboard')}
                      compact
                      icon={<ClipboardPaste color={colors.textSecondary} size={16} />}
                      onPress={() => void pasteFromClipboard()}
                      style={{ flex: 1, minHeight: 44 }}
                    />
                    <IsleButton
                      label={t('settings.chooseFile')}
                      compact
                      icon={<FileJson color={colors.textSecondary} size={16} />}
                      onPress={() => void importFromFile()}
                      style={{ flex: 1, minHeight: 44 }}
                    />
                  </View>
                </View>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>{t('providerSettings.importContent')}</Text>
                <View
                  style={{
                    height: inputHeight,
                    borderRadius: 24,
                    paddingHorizontal: 14,
                    backgroundColor: colors.material.paper,
                    borderWidth: 2.5,
                    borderColor: colors.border,
                    overflow: 'hidden',
                    shadowColor: colors.shadow.color,
                    shadowOpacity: 0.16,
                    shadowRadius: 0,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 2,
                  }}
                >
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    onFocus={keyboardRequestClose.markKeyboardActive}
                    onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
                    multiline
                    scrollEnabled={inputScrollEnabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={'https://api.example.com/v1\nsk-...\nsk-...\n\nhttps://api.other.com/v1\nsk-...'}
                    placeholderTextColor={colors.textTertiary}
                    textAlignVertical="top"
                    style={{
                      height: inputHeight,
                      paddingTop: 12,
                      paddingBottom: 12,
                      paddingHorizontal: 0,
                      color: colors.text,
                      fontSize: 14,
                      fontWeight: '700',
                      lineHeight: IMPORT_INPUT_LINE_HEIGHT,
                    }}
                  />
                </View>
                <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{t('providerSettings.importNote')}</Text>
              </View>
            </ScrollView>
            <View style={{ minHeight: IMPORT_FOOTER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: footerCompact ? 8 : 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 10) + 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
              <IsleButton label={t('common.cancel')} compact onPress={onClose} style={{ flex: 1, minHeight: 44 }} />
              <IsleButton label={t('providerSettings.import')} compact tone="primary" disabled={!input.trim()} onPress={submit} style={{ flex: 1.12, minHeight: 44 }} />
            </View>
          </MotiView>
        </View>
      </View>
    </Modal>
  )
}

function compareProviders(a: AIProvider, b: AIProvider, mode: ProviderSortMode, usageByProvider: Map<string, number>, settings?: ProviderModelAccessInput['settings']): number {
  if (mode === 'recent') return (usageByProvider.get(b.id) ?? 0) - (usageByProvider.get(a.id) ?? 0)
  if (mode === 'enabled') return Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)
  if (mode === 'models') return getPolicyAllowedProviderModels(b, settings).length - getPolicyAllowedProviderModels(a, settings).length || a.name.localeCompare(b.name)
  if (mode === 'health') return providerHealthRank(b) - providerHealthRank(a) || a.name.localeCompare(b.name)
  if (mode === 'name') return a.name.localeCompare(b.name)
  return 0
}

function providerHealthRank(provider: AIProvider): number {
  if (provider.lastTestStatus === 'ok') return 4
  if (provider.lastModelSyncStatus === 'ok') return 3
  if (provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad') return 1
  return 2
}

function providerMatchesModelFilter(provider: AIProvider, filter: string, settings?: ProviderModelAccessInput['settings']): boolean {
  const policyModels = getProviderModelDisplayCandidates({ providers: [provider], settings, includeDisabled: true, includeLocalSetup: true })[0]?.models ?? []
  const allowedModelIds = new Set(policyModels.map((model) => model.toLowerCase()))
  const values = [
    provider.name,
    provider.type,
    ...policyModels,
    ...(provider.modelConfigs ?? [])
      .filter((model) => allowedModelIds.has(model.id.toLowerCase()))
      .flatMap((model) => [model.id, model.name]),
  ]
  return values.some((value) => normalizeSearchText(value).includes(filter))
}
