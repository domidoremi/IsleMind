import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { findNodeHandle, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { MotiView } from 'moti'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { IsleField, IsleHeader, IsleIconButton } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import type { IsleBackgroundState } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveActivationJobProgress, useActivationJobStore, type ActivationJobItemState, type ActivationJobState } from '@/store/activationJobStore'
import type { AIProvider, ProviderPresetId, ProviderWireProtocol } from '@/types'
import { applyProviderPreset, getProviderPreset, parseCredentialGroups, parseProviderImportText, PROVIDER_PRESETS } from '@/services/ai/providerRegistry'
import { looksLikeProviderImportConnectionText, parseProviderImportDraft } from '@/services/ai/providerImportDraft'
import { DEFAULT_PROVIDER_PRESET_ID, DEFAULT_PROVIDER_WIRE_PROTOCOL, PROVIDER_WIRE_PROTOCOL_OPTIONS, inferProviderWireProtocolFromBaseUrl, resolveProviderConfigDraft, shouldSyncWireProtocolFromBaseUrl } from '@/services/ai/providerConfigPolicy'
import { activationItemProgress } from '@/services/providerActivationJob'
import { countDetectedProviderImports, formatProviderNameList } from '@/services/providerImportSummary'
import { deleteTemporaryImportCopy, isFileTooLargeError, MAX_IMPORT_TEXT_FILE_BYTES, readUtf8ImportFile } from '@/services/fileImportGuards'
import { buildProviderCapabilityMatrix, summarizeProviderCapabilityMatrix, summarizeProviderCapabilityMatrixDetails } from '@/services/ai/providerCapabilityMatrix'
import { providerCompatibilityCapabilityCanBeSentForProvider, type ProviderCompatibilityBehavior } from '@/services/ai/providerCompatibilityContract'
import { IsleMetric } from '@/components/ui/isle'
import { parseModels } from '@/utils/text'
import { isProviderConversationReady } from '@/utils/providerModels'
import { providerHasPolicyAllowedModel } from '@/services/ai/policy/providerModelAccess'
import { filterAndSortProviders, type ProviderSortMode } from '@/services/providerSettingsList'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useProviderActivationJob } from '@/components/providers/useProviderActivationJob'

type ClipboardReadState = 'idle' | 'requesting'
type AppThemeColors = ReturnType<typeof useAppTheme>['colors']

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
const PROVIDER_ROW_HEIGHT = 72
const PROVIDER_DRAG_STEP = 64
const PROVIDER_CARD_RADIUS = 16
type ProviderFormFieldId = 'name' | 'baseUrl' | 'tokens' | 'models'

function resolveProviderChrome(colors: AppThemeColors) {
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const chromeSurface = colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const chromeBorder = colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const mutedSurface = colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const raisedSurface = colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.glass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base
  return { subtleBorderWidth, chromeSurface, chromeBorder, mutedSurface, raisedSurface }
}

interface ProviderSettingsContentProps {
  embedded?: boolean
  onClose?: () => void
  onBackgroundStateChange?: (state: IsleBackgroundState) => void
}

export function ProviderSettingsContent({ embedded = false, onClose, onBackgroundStateChange }: ProviderSettingsContentProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const compactWidth = width < 430
  const pagePadding = compactWidth ? 12 : 16
  const pagerGestureLock = useMainPagerGestureLock()
  const providers = useSettingsStore((state) => state.providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const addProviders = useSettingsStore((state) => state.addProviders)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const clearAllProviders = useSettingsStore((state) => state.clearAllProviders)
  const settings = useSettingsStore((state) => state.settings)
  const conversations = useChatStore((state) => state.conversations)
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<ProviderSortMode>('manual')
  const [modelFilter, setModelFilter] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const { activationBusy, activationJob, clearActivationJob, activateProviders, isActivationRunning } = useProviderActivationJob({
    onActivationCompleted: () => {
      setBatchMode(false)
      setSelectedIds(new Set())
    },
  })
  const backgroundState: IsleBackgroundState = keyboardHeight > 0
    ? 'input'
    : addOpen || importOpen
      ? 'modal'
      : activationJob?.status === 'failed'
        ? 'error'
        : isActivationRunning
          ? 'active'
          : 'idle'

  useEffect(() => {
    if (!embedded) return undefined
    pagerGestureLock?.setLocked(true)
    return () => pagerGestureLock?.setLocked(false)
  }, [embedded, pagerGestureLock])

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  useEffect(() => {
    onBackgroundStateChange?.(backgroundState)
  }, [backgroundState, onBackgroundStateChange])

  const usageByProvider = useMemo(() => {
    const usage = new Map<string, number>()
    for (const conversation of conversations) {
      if (conversation.providerId === 'local-setup') continue
      usage.set(conversation.providerId, Math.max(usage.get(conversation.providerId) ?? 0, conversation.updatedAt))
    }
    return usage
  }, [conversations])

  const visibleProviders = useMemo(() => {
    return filterAndSortProviders(providers, { filter: modelFilter, sortMode, usageByProvider, settings })
  }, [modelFilter, providers, settings, sortMode, usageByProvider])
  const manualOrdering = sortMode === 'manual'
  const providerOrderById = useMemo(
    () => new Map(providers.map((provider, index) => [provider.id, index] as const)),
    [providers]
  )

  const enabled = providers.filter((provider) => provider.enabled).length
  const available = providers.filter((provider) => isProviderConversationReady(provider) && providerHasPolicyAllowedModel(provider, settings)).length
  const credentialGroups = providers.reduce((sum, provider) => sum + (provider.credentialGroups?.length ?? 0), 0)
  const { subtleBorderWidth, chromeSurface, chromeBorder, mutedSurface, raisedSurface } = resolveProviderChrome(colors)
  const activeSortLabel = t(SORT_OPTIONS.find((option) => option.id === sortMode)?.labelKey ?? SORT_OPTIONS[0].labelKey)
  const providerListHint = manualOrdering
    ? t('providerSettings.manualSortHint')
    : t('providerSettings.sortedViewHint', { label: activeSortLabel })

  async function addProviderFromForm(provider: AIProvider) {
    setAddOpen(false)
    await addProvider(provider)
    setExpandedProviderId(provider.id)
    setSortMode('manual')
    setModelFilter('')
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
    setImportOpen(false)

    await addProviders(result.providers)
    updateSettings({ defaultProvider: result.providers[0].id })

    setExpandedProviderId(result.providers[0]?.id ?? null)
    setSortMode('manual')
    setModelFilter('')
    dialog.toast({
      title: t('providerSettings.importDone'),
      message: t('providerSettings.importDoneMessage', { count: result.providers.length }),
      tone: result.warnings.length ? 'amber' : 'mint',
      durationMs: 1800,
    })

    const enableNow = await dialog.confirm({
      title: t('providerSettings.enableImportedTitle'),
      message: [t('providerSettings.enableImportedMessage', { count: result.providers.length }), formatProviderNameList(result.providers), ...result.warnings].filter(Boolean).join('\n'),
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

  async function confirmClearAllProviders() {
    const confirmed = await dialog.confirm({
      title: t('providerSettings.clearAllTitle'),
      message: t('providerSettings.clearAllMessage', { count: providers.length }),
      confirmLabel: t('providerSettings.clearAllConfirm'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await clearAllProviders()
    setBatchMode(false)
    setSelectedIds(new Set())
    setExpandedProviderId(null)
    setModelFilter('')
    dialog.toast({ title: t('providerSettings.clearAllDone'), tone: 'mint' })
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function moveProvider(sourceId: string, offset: number) {
    if (!manualOrdering) {
      setSortMode('manual')
      dialog.toast({ title: t('providerSettings.manualSortRequired'), tone: 'amber' })
      return
    }
    if (!offset) return
    const currentIndex = providers.findIndex((provider) => provider.id === sourceId)
    if (currentIndex < 0) return
    const targetIndex = Math.max(0, Math.min(providers.length - 1, currentIndex + offset))
    if (targetIndex < 0 || targetIndex >= providers.length) return
    if (targetIndex === currentIndex) return
    const ordered = [...providers]
    const [item] = ordered.splice(currentIndex, 1)
    ordered.splice(targetIndex, 0, item)
    reorderProviders(ordered.map((provider) => provider.id))
    setSortMode('manual')
  }

  const content = (
    <>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: pagePadding, paddingTop: Math.max(insets.top, 0) + 8, paddingBottom: Math.max(insets.bottom, 20) + 76 }}
        >
          <IsleHeader
            title={t('settings.providerManagement')}
            subtitle={providerListHint}
            collapsed
            leading={
              <HeaderBackButton onPress={onClose ?? closeStandaloneProviderSettings} />
            }
          />

          <View style={{ marginTop: 8, gap: 10 }}>
            <View style={{ borderRadius: colors.ui.radius.panel, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, gap: 10 }}>
              <View style={{ flexDirection: compactWidth ? 'column' : 'row', alignItems: compactWidth ? 'stretch' : 'center', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }} />
                {providers.length ? (
                  <IslePressable
                    haptic
                    accessibilityLabel={t('providerSettings.clearAll')}
                    onPress={() => void confirmClearAllProviders()}
                    style={{ alignSelf: compactWidth ? 'stretch' : 'center', minHeight: 34, borderRadius: colors.ui.radius.chip, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.ui.tone.danger.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.tone.danger.border }}
                  >
                    <AppIcon name="close" color={colors.ui.tone.danger.foreground} size={13} />
                    <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 10.5, lineHeight: 13, fontWeight: '900', includeFontPadding: false }}>
                      {t('providerSettings.clearAll')}
                    </Text>
                  </IslePressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <OperatorMetric label={t('providerSettings.providerCount', { count: providers.length })} />
                <OperatorMetric label={t('providerSettings.enabledCount', { count: enabled })} />
                <OperatorMetric label={t('providerSettings.availableCount', { count: available })} />
                <OperatorMetric label={t('providerSettings.credentialGroupCount', { count: credentialGroups })} />
                <OperatorMetric label={t('providerSettings.visibleCount', { count: visibleProviders.length })} />
              </View>
            </View>

            <View style={{ borderRadius: colors.ui.radius.panel, padding: 9, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <IsleButton
                  label={t('settings.addProvider')}
                  compact
                  block
                  icon={<AppIcon name="add" color={colors.textSecondary} size={15} />}
                  onPress={() => setAddOpen(true)}
                  style={{ flexGrow: 1, flexShrink: 1, flexBasis: '48%', minWidth: 0 }}
                />
                <IsleButton
                  label={t('providerSettings.batchImportProviders')}
                  accessibilityLabel={t('providerSettings.batchImportProviders')}
                  compact
                  block
                  icon={<AppIcon name="import" color={colors.textSecondary} size={15} />}
                  onPress={() => setImportOpen(true)}
                  style={{ flexGrow: 1, flexShrink: 1, flexBasis: '48%', minWidth: 0 }}
                />
                <IsleButton
                  label={batchMode ? t('providerSettings.enableSelected', { count: selectedIds.size }) : t('settings.enableAll')}
                  compact
                  block
                  tone="mint"
                  icon={<AppIcon name="zap" color={colors.textSecondary} size={15} />}
                  onPress={() => void enableEffectiveSelection()}
                  disabled={activationBusy || activationJob?.status === 'running' || (batchMode ? !selectedIds.size : !providers.length)}
                  style={{ flexGrow: 1, flexShrink: 1, flexBasis: '48%', minWidth: 0 }}
                />
                <IsleButton
                  label={batchMode ? t('providerSettings.exitBatch') : t('providerSettings.selectionMode')}
                  compact
                  block
                  accessibilityLabel={batchMode ? t('providerSettings.exitSelectionMode') : t('providerSettings.enterSelectionMode')}
                  tone={batchMode ? 'amber' : 'soft'}
                  icon={<AppIcon name="list-check" color={batchMode ? colors.ui.tone.warning.foreground : colors.textSecondary} size={15} />}
                  onPress={() => {
                    setBatchMode((value) => !value)
                    setSelectedIds(new Set())
                    dialog.toast({ title: batchMode ? t('providerSettings.batchExited') : t('providerSettings.batchEntered'), tone: 'mint' })
                  }}
                  style={{ flexGrow: 1, flexShrink: 1, flexBasis: '48%', minWidth: 0 }}
                />
              </View>
            </View>
          </View>

          {activationJob ? (
            <ActivationProgressCard job={activationJob} onDismiss={clearActivationJob} />
          ) : null}

          <View style={{ borderRadius: colors.ui.radius.panel, padding: 10, marginTop: 2, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, gap: 8 }}>
            <View style={{ flexDirection: compactWidth ? 'column' : 'row', alignItems: compactWidth ? 'stretch' : 'center', gap: 8 }}>
              <View style={{ minHeight: 44, flex: 1, minWidth: 0, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}>
                <AppIcon name="search" color={colors.textTertiary} size={16} />
                <TextInput
                  value={modelFilter}
                  onChangeText={setModelFilter}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t('providerSettings.filterModels')}
                  placeholderTextColor={colors.textTertiary}
                  style={{ flex: 1, minWidth: 0, minHeight: 42, padding: 0, color: colors.text, fontSize: 14, fontWeight: '800' }}
                />
                {modelFilter ? (
                  <IslePressable haptic accessibilityLabel={t('common.clearSearch')} onPress={() => setModelFilter('')} style={{ width: 32, height: 32, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: mutedSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder }}>
                    <AppIcon name="close" color={colors.textSecondary} size={15} />
                  </IslePressable>
                ) : null}
              </View>
              {!manualOrdering ? (
                <IslePressable haptic accessibilityLabel={t('providerSettings.switchToManualSort')} onPress={() => setSortMode('manual')} style={{ minHeight: 44, borderRadius: colors.ui.radius.controlMiddle, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: raisedSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder }}>
                  <AppIcon name="grab" color={colors.textSecondary} size={14} />
                  <Text style={{ color: colors.textSecondary, fontSize: 11.5, fontWeight: '900' }}>{t('providerSettings.sort.manual')}</Text>
                </IslePressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
          <View style={{ gap: 10, marginTop: 2 }}>
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
                  sortEnabled={manualOrdering}
                  position={(providerOrderById.get(provider.id) ?? index) + 1}
                  total={providers.length}
                  canMoveUp={(providerOrderById.get(provider.id) ?? index) > 0}
                  canMoveDown={(providerOrderById.get(provider.id) ?? index) < providers.length - 1}
                  onToggleSelected={() => toggleSelection(provider.id)}
                  onMove={(offset) => moveProvider(provider.id, offset)}
                  onExpandedChange={(next) => setExpandedProviderId(next ? provider.id : null)}
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
  const { mutedSurface } = resolveProviderChrome(colors)
  return (
    <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} size="md" glyph="back" onNavigate={onPress} color={colors.text} style={{ backgroundColor: mutedSurface }} />
  )
}

function OperatorMetric({ label }: { label: string }) {
  return <IsleMetric label={label} />
}

function providerCapabilityLabelEnabled(provider: AIProvider, capability: ProviderCompatibilityBehavior, enabled: boolean | undefined): boolean {
  return enabled === true && providerCompatibilityCapabilityCanBeSentForProvider(provider, capability, true)
}

function closeStandaloneProviderSettings() {
  if (router.canGoBack()) {
    router.back()
    return
  }
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
  sortEnabled,
  position,
  total,
  canMoveUp,
  canMoveDown,
  onToggleSelected,
  onMove,
  onExpandedChange,
}: {
  provider: AIProvider
  selected: boolean
  batchMode: boolean
  expanded: boolean
  sortEnabled: boolean
  position: number
  total: number
  canMoveUp: boolean
  canMoveDown: boolean
  onToggleSelected: () => void
  onMove: (offset: number) => void
  onExpandedChange: (next: boolean) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { subtleBorderWidth, mutedSurface, raisedSurface } = resolveProviderChrome(colors)
  const activityState = provider.enabled
    ? t('apiKeyPanel.enabledState')
    : t('apiKeyPanel.disabledState')
  const statusTone = provider.lastTestStatus === 'ok'
    ? colors.ui.tone.success
    : provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad'
      ? colors.ui.tone.warning
      : colors.ui.tone.neutral
  const capabilityLabels = [
    summarizeProviderCapabilityMatrix(buildProviderCapabilityMatrix(provider)),
    summarizeProviderCapabilityMatrixDetails(provider),
    providerCapabilityLabelEnabled(provider, 'responsesApi', provider.capabilities?.responsesApi) ? 'Responses' : '',
    providerCapabilityLabelEnabled(provider, 'responsesWebSocket', provider.capabilities?.responsesWebSocket) ? 'WebSocket' : '',
    providerCapabilityLabelEnabled(provider, 'remoteCompact', provider.capabilities?.remoteCompact) ? 'Remote compact' : '',
  ].filter(Boolean)
  const showDragRail = total > 1 && sortEnabled
  return (
    <View
      style={{
        borderRadius: PROVIDER_CARD_RADIUS - 2,
        padding: 10,
        backgroundColor: raisedSurface,
        borderWidth: subtleBorderWidth,
        borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        {batchMode ? (
          <IslePressable
            haptic
            onPress={onToggleSelected}
            accessibilityLabel={selected ? t('providerSettings.unselectProvider') : t('providerSettings.selectProvider')}
            accessibilityState={{ selected }}
            style={{
              width: 42,
              minHeight: 42,
              borderRadius: colors.ui.radius.controlMiddle,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.base,
              borderWidth: subtleBorderWidth,
              borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
            }}
          >
            {selected ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={17} /> : <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary }} />}
          </IslePressable>
        ) : null}
        <IslePressable
          haptic
          onPress={() => onExpandedChange(!expanded)}
          accessibilityRole="button"
          accessibilityLabel={provider.name}
          style={{ flex: 1, minWidth: 0, gap: 8, borderRadius: colors.ui.radius.controlMiddle, paddingVertical: 2 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
            <View style={{ width: 38, height: 38, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: mutedSurface, flexShrink: 0 }}>
              <AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={16} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3, paddingTop: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '900', includeFontPadding: false }}>
                {provider.name}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>
                {provider.baseUrl || t('providerSettings.baseUrl')}
              </Text>
            </View>
            <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 180 }} style={{ paddingTop: 2 }}>
              <AppIcon name="collapse" color={colors.textTertiary} size={16} />
            </MotiView>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <View style={{ minHeight: 22, borderRadius: colors.ui.radius.chip, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: statusTone.background, borderWidth: subtleBorderWidth, borderColor: statusTone.border }}>
              <Text style={{ color: statusTone.foreground, fontSize: 9.5, lineHeight: 11, fontWeight: '900', includeFontPadding: false }}>
                {activityState}
              </Text>
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false }}>
              {t('providerSettings.orderPosition', { index: position, total })}
            </Text>
            {!!provider.models?.length ? (
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false }}>
                {t('apiKeyPanel.modelCount', { count: provider.models.length })}
              </Text>
            ) : null}
            {!!provider.credentialGroups?.length ? (
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false }}>
                {t('apiKeyPanel.tokenGroups', { count: provider.credentialGroups.length })}
              </Text>
            ) : null}
            {capabilityLabels.length ? (
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false }}>
                {capabilityLabels.join(' · ')}
              </Text>
            ) : null}
          </View>
        </IslePressable>
      </View>
      {showDragRail ? (
        <View style={{ marginTop: 10, marginLeft: batchMode ? 52 : 0 }}>
          <DragRail
            providerName={provider.name}
            position={position}
            total={total}
            disabled={!sortEnabled}
            disabledUp={!canMoveUp}
            disabledDown={!canMoveDown}
            onMove={onMove}
          />
        </View>
      ) : null}
      {expanded ? (
        <View style={{ minWidth: 0, minHeight: PROVIDER_ROW_HEIGHT - 10, marginTop: 3 }}>
          <ApiKeyPanel
            provider={provider}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
            hideHeader
            style={{
              marginBottom: 0,
              padding: 0,
              backgroundColor: 'transparent',
              borderWidth: 0,
            }}
          />
        </View>
      ) : null}
    </View>
  )
}

function DragRail({
  providerName,
  position,
  total,
  disabled,
  disabledUp,
  disabledDown,
  onMove,
}: {
  providerName: string
  position: number
  total: number
  disabled: boolean
  disabledUp: boolean
  disabledDown: boolean
  onMove: (offset: number) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { subtleBorderWidth, mutedSurface, raisedSurface } = resolveProviderChrome(colors)
  const translateY = useSharedValue(0)
  const dragging = useSharedValue(0)
  const dragStepCount = useRef(0)
  const gesture = Gesture.Pan()
    .enabled(!disabled && !(disabledUp && disabledDown))
    .activateAfterLongPress(180)
    .onBegin(() => {
      dragStepCount.current = 0
      dragging.value = 1
    })
    .onUpdate((event) => {
      translateY.value = Math.max(-48, Math.min(48, event.translationY))
      const nextStep = event.translationY < 0
        ? Math.ceil((event.translationY + PROVIDER_DRAG_STEP * 0.5) / PROVIDER_DRAG_STEP)
        : Math.floor((event.translationY - PROVIDER_DRAG_STEP * 0.5) / PROVIDER_DRAG_STEP)
      const boundedStep = Math.max(-(position - 1), Math.min(total - position, nextStep))
      while (boundedStep > dragStepCount.current) {
        dragStepCount.current += 1
        runOnJS(onMove)(1)
      }
      while (boundedStep < dragStepCount.current) {
        dragStepCount.current -= 1
        runOnJS(onMove)(-1)
      }
    })
    .onEnd(() => {
      translateY.value = withSpring(0)
      dragging.value = withSpring(0)
      dragStepCount.current = 0
    })
    .onFinalize(() => {
      translateY.value = withSpring(0)
      dragging.value = withSpring(0)
      dragStepCount.current = 0
    })
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: active ? 1 : 0.58,
  }))
  const animatedRailStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dragging.value ? 1.04 : 1 }],
  }))
  const active = !disabled && !(disabledUp && disabledDown)
  const railBorder = disabled ? colors.ui.semantic.chrome.border : colors.ui.control.primaryBorder
  const railBackground = disabled ? mutedSurface : raisedSurface
  const positionLabel = total ? t('providerSettings.orderPosition', { index: position, total }) : ''
  return (
    <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }, animatedRailStyle]}>
      <MoveButton
        label={t('providerSettings.moveUpProvider', { name: providerName })}
        icon="arrow-up"
        disabled={disabled || disabledUp}
        onPress={() => onMove(-1)}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityRole="adjustable"
          accessibilityLabel={disabled ? t('providerSettings.dragDisabledLabel', { name: providerName }) : t('providerSettings.dragProviderLabel', { name: providerName })}
          accessibilityHint={disabled ? t('providerSettings.dragDisabledHint') : t('providerSettings.dragProviderHint')}
          accessibilityValue={{ text: positionLabel }}
          style={[{
            minWidth: 94,
            height: 40,
            borderRadius: colors.ui.radius.controlLarge,
            paddingHorizontal: 10,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            backgroundColor: railBackground,
            borderWidth: subtleBorderWidth,
            borderColor: railBorder,
            shadowColor: colors.shadowTint,
            shadowOpacity: colors.ui.cartoon && active ? 0.05 : 0,
            shadowRadius: colors.ui.cartoon ? 8 : 0,
            shadowOffset: { width: 0, height: colors.ui.cartoon ? 3 : 0 },
            elevation: colors.ui.cartoon && active ? 1 : 0,
          }, animatedStyle]}
          >
          <MotiView
            animate={{ scale: active ? 1 : 0.96 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
            style={{ width: 28, height: 28, borderRadius: colors.ui.radius.chip, alignItems: 'center', justifyContent: 'center', backgroundColor: disabled ? mutedSurface : colors.ui.control.primaryBackground }}
          >
            <AppIcon name="grab" color={disabled ? colors.textTertiary : colors.ui.control.primaryForeground} size={15} />
          </MotiView>
          <Text style={{ color: disabled ? colors.textTertiary : colors.textSecondary, fontSize: 10, lineHeight: 12, fontWeight: '900', includeFontPadding: false }}>
            {position}
          </Text>
        </Animated.View>
      </GestureDetector>
      <MoveButton
        label={t('providerSettings.moveDownProvider', { name: providerName })}
        icon="arrow-down"
        disabled={disabled || disabledDown}
        onPress={() => onMove(1)}
      />
    </Animated.View>
  )
}

function MoveButton({ label, icon, disabled, onPress }: { label: string; icon: 'arrow-up' | 'arrow-down'; disabled: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { subtleBorderWidth, mutedSurface, chromeBorder } = resolveProviderChrome(colors)
  return (
    <IslePressable
      haptic
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 40,
        height: 40,
        borderRadius: colors.ui.radius.controlMiddle,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: mutedSurface,
        borderWidth: subtleBorderWidth,
        borderColor: chromeBorder,
        opacity: disabled ? 0.42 : 1,
      }}
    >
      <AppIcon name={icon} color={disabled ? colors.textTertiary : colors.textSecondary} size={16} />
    </IslePressable>
  )
}

function ChoiceIsleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { subtleBorderWidth, mutedSurface, chromeBorder } = resolveProviderChrome(colors)
  return (
    <IslePressable haptic onPress={onPress} style={{ minHeight: 40, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center' }}>
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.control.primaryBackground : mutedSurface,
          borderColor: active ? colors.ui.control.primaryBorder : chromeBorder,
          scale: active ? 1.025 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{ minHeight: 40, borderRadius: colors.ui.radius.controlMiddle, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderWidth: subtleBorderWidth }}
      >
        <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11.5, lineHeight: 15, fontWeight: '900', includeFontPadding: false }}>{label}</Text>
      </MotiView>
    </IslePressable>
  )
}

function ActivationProgressCard({ job, onDismiss }: { job: ActivationJobState; onDismiss: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { subtleBorderWidth, chromeSurface, chromeBorder } = resolveProviderChrome(colors)
  const progress = resolveActivationJobProgress(job)
  const done = job.status !== 'running'
  const providerItems = job.items ?? []
  const showProviderItems = providerItems.length > 1
  const title = done
    ? job.status === 'failed' ? t('providerSettings.activationFailed') : activationDoneTitle(job.total === 1 ? 'single' : 'batch', job.total, t)
    : t('providerSettings.activationRunning')
  return (
    <MotiView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 190 }}
      style={{ marginTop: 14 }}
    >
      <View style={{ borderRadius: colors.ui.radius.panel, padding: 13, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, shadowColor: colors.ui.control.shadow, shadowOpacity: colors.ui.cartoon ? Math.min(colors.ui.card.shadowOpacity, 0.08) : 0, shadowRadius: colors.ui.cartoon ? Math.max(2, colors.ui.card.shadowRadius - 4) : 0, shadowOffset: { width: 0, height: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowOffset - 2) : 0 }, elevation: colors.ui.cartoon && colors.ui.card.shadowOpacity > 0 ? 1 : 0, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>
              {title}
            </Text>
            <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2, fontWeight: '800' }}>
              {job.stage ?? job.currentName ?? t('providerSettings.activationQueued')}
            </Text>
          </View>
          {done ? (
            <IsleIconButton label={t('dialog.close')} size="sm" onPress={onDismiss}>
              <AppIcon name="close" color={colors.textSecondary} size={15} />
            </IsleIconButton>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <ActivationProgressPill label={`${job.completed}/${job.total}`} />
          {!showProviderItems && job.currentName ? <ActivationProgressPill label={job.currentName} /> : null}
          <ActivationProgressPill label={activationStatusLabel(job, t)} tone={job.status === 'failed' ? 'danger' : job.failed ? 'amber' : done ? 'mint' : 'default'} />
        </View>
        {showProviderItems ? <ActivationProviderProgressList items={providerItems} /> : null}
        <View style={{ height: 8, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.divider, overflow: 'hidden' }}>
          <MotiView
            animate={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
            transition={{ type: 'timing', duration: 180 }}
            style={{ height: 8, borderRadius: colors.ui.radius.chip, backgroundColor: job.failed ? colors.ui.tone.warning.foreground : colors.ui.control.primaryBackground }}
          />
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '900' }}>
          {t('providerSettings.activationProgressMessage', { completed: job.completed, total: job.total, synced: job.synced, tested: job.tested, failed: job.failed })}
        </Text>
      </View>
    </MotiView>
  )
}

function ActivationProviderProgressList({ items }: { items: ActivationJobItemState[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: 8 }}>
      {items.map((item) => {
        const progress = activationItemProgress(item.progress)
        const warning = item.status === 'failed' || item.failed
        const ready = item.status === 'done' && item.tested
        return (
          <View key={item.providerId} style={{ gap: 5 }}>
            <View style={{ minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '900' }}>{item.providerName}</Text>
              <Text numberOfLines={1} style={{ color: warning ? colors.ui.tone.warning.foreground : ready ? colors.ui.control.link : colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '900' }}>
                {activationItemStatusLabel(item, t)}
              </Text>
            </View>
            <View style={{ height: 5, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.divider, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(4, Math.round(progress * 100))}%`, height: 5, borderRadius: colors.ui.radius.chip, backgroundColor: warning ? colors.ui.tone.warning.foreground : colors.ui.control.primaryBackground }} />
            </View>
            {item.stage ? (
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '800' }}>{item.stage}</Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function ActivationProgressPill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'mint' | 'amber' | 'danger' }) {
  const { colors } = useAppTheme()
  const { subtleBorderWidth } = resolveProviderChrome(colors)
  const toneToken = tone === 'mint'
    ? colors.ui.tone.success
    : tone === 'amber'
      ? colors.ui.tone.warning
      : tone === 'danger'
        ? colors.ui.tone.danger
        : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 28, borderRadius: colors.ui.radius.chip, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: toneToken.background, borderWidth: subtleBorderWidth, borderColor: toneToken.border }}>
      <Text numberOfLines={1} style={{ color: toneToken.foreground, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </View>
  )
}

function activationDoneTitle(mode: 'single' | 'batch' | 'all', total: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (mode === 'single' || total === 1) return t('providerSettings.activationSingleDone')
  if (mode === 'all') return t('providerSettings.activationAllDone')
  return t('providerSettings.activationBatchDone')
}

function activationItemStatusLabel(item: ActivationJobItemState, t: ReturnType<typeof useTranslation>['t']): string {
  if (item.status === 'queued') return t('providerSettings.activationQueued')
  if (item.status === 'running') return t('providerSettings.activationRunning')
  if (item.status === 'failed' || item.failed) return t('providerSettings.activationFailed')
  if (item.tested) return t('providerSettings.activationSuccess')
  return t('providerSettings.activationPartial')
}

function activationStatusLabel(job: ActivationJobState, t: ReturnType<typeof useTranslation>['t']): string {
  if (job.status === 'running') return t('providerSettings.activationRunning')
  if (job.status === 'failed') return t('providerSettings.activationFailed')
  if (job.failed > 0) return t('providerSettings.activationPartial')
  return t('providerSettings.activationSuccess')
}

function isPresetDefaultBaseUrl(value: string, presetId: ProviderPresetId, wireProtocol: ProviderWireProtocol): boolean {
  const current = normalizeDraftBaseUrl(value)
  if (!current) return true
  const preset = getProviderPreset(presetId)
  const draft = resolveProviderConfigDraft({ provider: {}, presetId, baseUrl: '', wireProtocol })
  return [preset.baseUrl, draft.baseUrl].some((candidate) => normalizeDraftBaseUrl(candidate ?? '') === current)
}

function normalizeDraftBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
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
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const motion = useMotionPreference()
  const bodyScrollRef = useRef<ScrollView>(null)
  const fieldOffsetsRef = useRef<Partial<Record<ProviderFormFieldId, number>>>({})
  const focusedFieldRef = useRef<ProviderFormFieldId | null>(null)
  const [presetId, setPresetId] = useState<ProviderPresetId>(DEFAULT_PROVIDER_PRESET_ID)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [baseUrlDirty, setBaseUrlDirty] = useState(false)
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  const [modelsText, setModelsText] = useState('')
  const [keysText, setKeysText] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [clipboardState, setClipboardState] = useState<ClipboardReadState>('idle')
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const preset = getProviderPreset(presetId)
  const providerConfigDraft = resolveProviderConfigDraft({ provider: {}, presetId, baseUrl, wireProtocol })
  const compact = height < 680
  const compactWidth = width < 430
  const footerCompact = width < 380
  const clipboardBusy = clipboardState !== 'idle'
  const keyboardInset = Platform.OS === 'android' ? keyboardHeight : 0
  const keyboardVisible = keyboardHeight > 0
  const availableSheetHeight = Math.max(
    keyboardVisible ? 300 : 360,
    height - insets.top - Math.max(insets.bottom, 10) - keyboardInset - IMPORT_SHEET_MARGIN,
  )
  const sheetMaxHeight = Math.min(availableSheetHeight, height * (keyboardVisible ? 0.82 : compact ? 0.96 : 0.88))
  const sheetMaterial = colors.material.sheet
  const { subtleBorderWidth, chromeBorder, chromeSurface } = resolveProviderChrome(colors)
  const modalPadding = compactWidth ? 12 : 16
  const modalActionStyle = footerCompact ? { alignSelf: 'stretch' as const, minHeight: 44 } : { flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minWidth: 0 }
  const footerScrollReserve = Math.max(insets.bottom, 10) + 132
  const focusedInputKeyboardOffset = Platform.OS === 'android' ? footerScrollReserve + 72 : 96
  const fieldScrollViewportOffset: Record<ProviderFormFieldId, number> = {
    name: 72,
    baseUrl: 48,
    tokens: -56,
    models: -56,
  }

  function resetDraft() {
    setName('')
    setBaseUrl('')
    setNameDirty(false)
    setBaseUrlDirty(false)
    setModelsText('')
    setKeysText('')
    setAdvancedOpen(false)
    setClipboardState('idle')
    setPresetId(DEFAULT_PROVIDER_PRESET_ID)
    setWireProtocol(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  }

  function closeWithoutSubmit() {
    resetDraft()
    onClose()
  }

  const keyboardRequestClose = useKeyboardAwareModalRequestClose(closeWithoutSubmit)

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0)
      return undefined
    }
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
      scrollFocusedInputAboveKeyboard()
      scheduleFocusedFieldScroll()
      setTimeout(scrollFocusedInputAboveKeyboard, 120)
      setTimeout(scheduleFocusedFieldScroll, 180)
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [visible])

  function rememberFieldLayout(id: ProviderFormFieldId) {
    return (event: LayoutChangeEvent) => {
      fieldOffsetsRef.current[id] = event.nativeEvent.layout.y
    }
  }

  function scrollFocusedFieldIntoView() {
    const focusedField = focusedFieldRef.current
    if (!focusedField) return
    const fieldOffset = fieldOffsetsRef.current[focusedField]
    if (fieldOffset === undefined) return
    bodyScrollRef.current?.scrollTo({ y: Math.max(0, fieldOffset - fieldScrollViewportOffset[focusedField]), animated: true })
  }

  function scheduleFocusedFieldScroll() {
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollFocusedFieldIntoView)
    })
  }

  function scrollFocusedInputAboveKeyboard() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        type TextInputState = {
          currentlyFocusedInput?: () => unknown
        }
        type ScrollResponder = {
          scrollResponderScrollNativeHandleToKeyboard?: (
            nodeHandle: number | null,
            additionalOffset?: number,
            preventNegativeScrollOffset?: boolean,
          ) => void
        }
        const textInputState = (TextInput as unknown as { State?: TextInputState }).State
        const focusedInput = textInputState?.currentlyFocusedInput?.()
        const focusedHandle = typeof focusedInput === 'number'
          ? focusedInput
          : focusedInput
            ? findNodeHandle(focusedInput as Parameters<typeof findNodeHandle>[0])
            : null
        if (focusedHandle) {
          const responder = (bodyScrollRef.current as unknown as { getScrollResponder?: () => ScrollResponder }).getScrollResponder?.()
          responder?.scrollResponderScrollNativeHandleToKeyboard?.(focusedHandle, focusedInputKeyboardOffset, true)
        }
        scrollFocusedFieldIntoView()
      })
    })
  }

  function markInputFocused(fieldId: ProviderFormFieldId) {
    focusedFieldRef.current = fieldId
    keyboardRequestClose.markKeyboardActive()
    scrollFocusedInputAboveKeyboard()
    scheduleFocusedFieldScroll()
    setTimeout(scrollFocusedInputAboveKeyboard, 120)
    setTimeout(scheduleFocusedFieldScroll, 180)
  }

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
    const currentPreset = getProviderPreset(presetId)
    const nextPreset = getProviderPreset(nextPresetId)
    const shouldReplaceName = !nameDirty || !name.trim() || name.trim() === currentPreset.name
    const shouldReplaceBaseUrl = !baseUrlDirty || !baseUrl.trim() || isPresetDefaultBaseUrl(baseUrl, presetId, wireProtocol)
    const draftBaseUrl = shouldReplaceBaseUrl ? '' : baseUrl
    const nextProtocol = inferProviderWireProtocolFromBaseUrl(draftBaseUrl)
    const nextDraft = resolveProviderConfigDraft({ provider: {}, presetId: nextPresetId, baseUrl: draftBaseUrl, wireProtocol: nextProtocol })
    setPresetId(nextPresetId)
    setWireProtocol(nextProtocol)
    setBaseUrl(nextDraft.baseUrl)
    setBaseUrlDirty(!shouldReplaceBaseUrl)
    if (shouldReplaceName) {
      setName(nextPreset.name)
      setNameDirty(false)
    }
  }

  function selectWireProtocol(nextProtocol: ProviderWireProtocol) {
    setWireProtocol(nextProtocol)
    const shouldReplaceBaseUrl = !baseUrlDirty || isPresetDefaultBaseUrl(baseUrl, presetId, wireProtocol)
    setBaseUrl(resolveProviderConfigDraft({ provider: {}, presetId, baseUrl: shouldReplaceBaseUrl ? '' : baseUrl, wireProtocol: nextProtocol }).baseUrl)
    setBaseUrlDirty(!shouldReplaceBaseUrl)
  }

  function applyProviderImportDraftText(text: string, source: 'clipboard' | 'manual'): boolean {
    const draft = parseProviderImportDraft(text, { requireConnection: source === 'manual', preferredWireProtocol: wireProtocol })
    if (!draft) return false
    const nextDraft = resolveProviderConfigDraft({ provider: draft.provider, presetId: draft.presetId, baseUrl: draft.baseUrl, wireProtocol: draft.wireProtocol })
    setPresetId(draft.presetId)
    setWireProtocol(draft.wireProtocol)
    setBaseUrl(nextDraft.baseUrl)
    setName(draft.provider.name)
    setNameDirty(false)
    setBaseUrlDirty(false)
    setKeysText(draft.credentialText)
    if (draft.modelText) setModelsText(draft.modelText)
    dialog.toast({
      title: t('providerSettings.clipboardDetected'),
      message: t(source === 'clipboard' && draft.count > 1 ? 'providerSettings.importAppliedFirst' : 'providerSettings.importDetected', { count: draft.count }),
      tone: 'mint',
    })
    return true
  }

  function handleBaseUrlText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setBaseUrl(value)
    setBaseUrlDirty(true)
    if (shouldSyncWireProtocolFromBaseUrl(providerConfigDraft)) setWireProtocol(inferProviderWireProtocolFromBaseUrl(value))
  }

  function handleKeysText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setKeysText(value)
  }

  async function readProviderClipboard() {
    setClipboardState('requesting')
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
      setClipboardState('idle')
    }
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: keyboardInset }}>
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateY: 32, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={motion === 'full' ? { type: 'spring', damping: 23, stiffness: 190 } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{ maxHeight: sheetMaxHeight, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: sheetMaterial.surface, borderWidth: subtleBorderWidth, borderColor: sheetMaterial.border, overflow: 'hidden' }}
          >
            <View style={{ paddingHorizontal: modalPadding, paddingTop: 16, paddingBottom: 10, backgroundColor: sheetMaterial.chrome, borderBottomWidth: 1, borderBottomColor: sheetMaterial.divider }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>{t('settings.addProvider')}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>{t('providerSettings.addSubtitle')}</Text>
                </View>
                <IsleIconButton label={t('dialog.close')} onPress={closeWithoutSubmit}>
                  <AppIcon name="close" color={colors.textSecondary} size={18} />
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
              <View style={{ paddingTop: 10, alignItems: compactWidth ? 'stretch' : 'flex-start' }}>
                <IsleButton
                  label={clipboardBusy ? t('providerSettings.clipboardChecking') : t('settings.pasteClipboard')}
                  compact
                  icon={<AppIcon name="paste" color={colors.textSecondary} size={16} />}
                  onPress={() => void readProviderClipboard()}
                  disabled={clipboardBusy}
                  style={compactWidth ? { alignSelf: 'stretch' } : undefined}
                />
              </View>
            </View>
            <ScrollView
              ref={bodyScrollRef}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={compact}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 10, paddingHorizontal: modalPadding, paddingBottom: 12, backgroundColor: sheetMaterial.body }}
            >
              <View onLayout={rememberFieldLayout('name')}>
                <IsleField label={t('providerSettings.name')} inputProps={{ value: name, onChangeText: (value) => {
                  setName(value)
                  setNameDirty(true)
                }, onFocus: () => markInputFocused('name'), placeholder: preset.name, autoCapitalize: 'none' }} />
              </View>
              {providerConfigDraft.isProtocolSelectable ? (
                <View style={{ borderRadius: colors.ui.radius.panel, padding: 11, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, gap: 9 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('providerSettings.protocol.title')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {PROVIDER_WIRE_PROTOCOL_OPTIONS.map((protocol) => (
                      <ChoiceIsleChip key={protocol} active={wireProtocol === protocol} label={t(`providerSettings.protocol.${protocol}`)} onPress={() => selectWireProtocol(protocol)} />
                    ))}
                  </View>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('providerSettings.protocol.endpointNote')}</Text>
                </View>
              ) : null}
              <View onLayout={rememberFieldLayout('baseUrl')}>
                <IsleField
                  label={t('providerSettings.baseUrl')}
                  inputProps={{
                    value: baseUrl,
                    onFocus: () => markInputFocused('baseUrl'),
                    onChangeText: handleBaseUrlText,
                    placeholder: preset.baseUrl ?? 'https://example.com/v1',
                    autoCapitalize: 'none',
                    autoCorrect: false,
                  }}
                />
              </View>
              <View onLayout={rememberFieldLayout('tokens')}>
                <IsleField
                  label={t('providerSettings.tokens')}
                  note={t('providerSettings.tokensNote')}
                  inputProps={{ value: keysText, onChangeText: handleKeysText, onFocus: () => markInputFocused('tokens'), placeholder: 'sk-...\nsk-...', autoCapitalize: 'none', autoCorrect: false, multiline: true, secureTextEntry: false, style: { minHeight: compact ? 72 : 92, maxHeight: compact ? 110 : 140 } }}
                />
              </View>
              <IslePressable
                haptic
                onPress={() => setAdvancedOpen((value) => !value)}
                style={{ minHeight: 44, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}
              >
                <Text style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('providerSettings.advancedModels')}</Text>
                <MotiView animate={{ rotate: advancedOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                  <AppIcon name="collapse" color={colors.textTertiary} size={16} />
                </MotiView>
              </IslePressable>
              {advancedOpen ? (
                <View onLayout={rememberFieldLayout('models')}>
                  <IsleField
                    label={t('settings.models')}
                    note={t('providerSettings.modelsNote')}
                    inputProps={{ value: modelsText, onChangeText: setModelsText, onFocus: () => markInputFocused('models'), placeholder: t('providerSettings.oneModelPerLine'), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 76, maxHeight: 120 } }}
                  />
                </View>
              ) : null}
            </ScrollView>
            {!keyboardVisible ? (
              <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 10, paddingHorizontal: modalPadding, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + 10, backgroundColor: sheetMaterial.chrome, borderTopWidth: 1, borderTopColor: sheetMaterial.divider }}>
                <IsleButton label={t('common.cancel')} onPress={closeWithoutSubmit} style={modalActionStyle} />
                <IsleButton label={t('common.save')} tone="primary" onPress={submit} style={modalActionStyle} />
              </View>
            ) : null}
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
  const inputRef = useRef<TextInput>(null)
  const [input, setInput] = useState('')
  const [clipboardState, setClipboardState] = useState<ClipboardReadState>('idle')
  const [contentHeight, setContentHeight] = useState(0)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const compact = height < 680
  const keyboardInset = Platform.OS === 'android' ? keyboardHeight : 0
  const keyboardVisible = keyboardHeight > 0
  const availableSheetHeight = Math.max(
    keyboardVisible ? 300 : 360,
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
  const sheetMaxHeight = Math.min(availableSheetHeight, height * (keyboardVisible ? 0.82 : compact ? 0.96 : 0.9))
  const sheetMaterial = colors.material.sheet
  const { subtleBorderWidth } = resolveProviderChrome(colors)
  const compactWidth = width < 430
  const footerCompact = width < 380
  const modalPadding = compactWidth ? 12 : 16
  const modalActionStyle = footerCompact ? { alignSelf: 'stretch' as const, minHeight: 44 } : { flex: 1, minHeight: 44 }
  const detectedImportCount = useMemo(() => countDetectedProviderImports(input), [input])
  const clipboardBusy = clipboardState !== 'idle'
  const keyboardRequestClose = useKeyboardAwareModalRequestClose(onClose)

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0)
      setContentHeight(0)
      setClipboardState('idle')
      return
    }
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus()
    }, Platform.OS === 'android' ? 260 : 120)
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
      // 只在有较多内容时才滚动到底部，避免初始打开时输入框被推到顶部
      if (input.trim() && input.split(/\r\n|\r|\n/).length > 5) {
        scrollBodyToEndSoon()
      }
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      clearTimeout(focusTimer)
      showSub.remove()
      hideSub.remove()
    }
  }, [visible, input])

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
    if (!input.trim()) return
    onSubmit(input)
    setInput('')
    setContentHeight(0)
  }

  async function pasteFromClipboard() {
    setClipboardState('requesting')
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
      appendInputText(text)
      const detected = parseProviderImportText(text)
      dialog.toast({
        title: detected.providers.length ? t('providerSettings.clipboardDetected') : t('providerSettings.clipboardRead'),
        message: detected.providers.length
          ? t('providerSettings.clipboardDetectedMessage', { count: detected.providers.length })
          : t('providerSettings.clipboardNoConfig'),
        tone: detected.providers.length ? 'mint' : 'amber',
      })
    } catch (error) {
      dialog.toast({
        title: t('providerSettings.clipboardReadFailed'),
        message: clipboardReadFailureMessage(error, t),
        tone: 'amber',
      })
    } finally {
      setClipboardState('idle')
    }
  }

  async function importFromFile() {
    let importUri: string | undefined
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      importUri = asset.uri
      const name = asset.name.toLowerCase()
      const supported = /\.(txt|csv|json)$/i.test(name) || ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json'].includes(asset.mimeType ?? '')
      if (!supported) {
        dialog.toast({ title: t('providerSettings.fileUnsupported'), message: t('providerSettings.fileUnsupportedMessage'), tone: 'amber' })
        return
      }
      const text = await readUtf8ImportFile(importUri, {
        size: asset.size,
        limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
      })
      appendInputText(text)
      dialog.toast({ title: t('providerSettings.fileRead'), message: asset.name, tone: 'mint' })
    } catch (error) {
      dialog.toast({
        title: isFileTooLargeError(error) ? t('error.fileTooLarge') : t('providerSettings.fileUnsupported'),
        message: isFileTooLargeError(error) ? t('chat.fileTooLarge20') : t('providerSettings.fileUnsupportedMessage'),
        tone: 'amber',
      })
    } finally {
      await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
    }
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateY: 32, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={motion === 'full' ? { type: 'spring', damping: 23, stiffness: 190 } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{
              maxHeight: sheetMaxHeight,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              backgroundColor: sheetMaterial.surface,
              borderWidth: subtleBorderWidth,
              borderColor: sheetMaterial.border,
              overflow: 'hidden',
            }}
          >
            <View style={{ minHeight: IMPORT_HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: modalPadding, paddingTop: 16, paddingBottom: 12, backgroundColor: sheetMaterial.chrome, borderBottomWidth: 1, borderBottomColor: sheetMaterial.divider }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>{t('settings.batchImport')}</Text>
              </View>
              <IsleIconButton label={t('dialog.close')} onPress={onClose}>
                <AppIcon name="close" color={colors.textSecondary} size={18} />
              </IsleIconButton>
            </View>
            <ScrollView
              ref={bodyScrollRef}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={compact || inputScrollEnabled}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: modalPadding, paddingTop: 12, paddingBottom: 14, backgroundColor: sheetMaterial.body }}
            >
              <View>
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', marginBottom: 7 }}>{t('providerSettings.importSources')}</Text>
                  <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 8 }}>
                    <IsleButton
                      label={clipboardBusy ? t('providerSettings.clipboardChecking') : t('settings.pasteClipboard')}
                      compact
                      icon={<AppIcon name="paste" color={colors.textSecondary} size={16} />}
                      onPress={() => void pasteFromClipboard()}
                      disabled={clipboardBusy}
                      style={modalActionStyle}
                    />
                    <IsleButton
                      label={t('settings.chooseFile')}
                      compact
                      icon={<AppIcon name="json" color={colors.textSecondary} size={16} />}
                      onPress={() => void importFromFile()}
                      style={modalActionStyle}
                    />
                  </View>
                </View>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>{t('providerSettings.importContent')}</Text>
                <View
                  style={{
                    height: inputHeight,
                    borderRadius: colors.ui.radius.panel,
                    paddingHorizontal: 14,
                    backgroundColor: colors.ui.input.background,
                    borderWidth: colors.ui.cartoon ? 1 : subtleBorderWidth,
                    borderColor: colors.ui.input.border,
                    overflow: 'hidden',
                    shadowColor: colors.shadow.color,
                    shadowOpacity: colors.ui.cartoon ? 0.08 : 0,
                    shadowRadius: 0,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: colors.ui.cartoon ? 1 : 0,
                  }}
                >
                  <TextInput
                    ref={inputRef}
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
                <Text style={{ color: detectedImportCount ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8, fontWeight: detectedImportCount ? '900' : '700' }}>
                  {input.trim()
                    ? detectedImportCount
                      ? t('providerSettings.importDetected', { count: detectedImportCount })
                      : t('providerSettings.importDetectionEmpty')
                    : t('providerSettings.importNote')}
                </Text>
              </View>
            </ScrollView>
            <View style={{ minHeight: keyboardVisible ? 56 : IMPORT_FOOTER_HEIGHT, flexDirection: footerCompact ? 'column' : 'row', alignItems: footerCompact ? 'stretch' : 'center', gap: footerCompact ? 8 : 10, paddingHorizontal: modalPadding, paddingTop: keyboardVisible ? 8 : 12, paddingBottom: (keyboardVisible ? 8 : Math.max(insets.bottom, 10) + 10), backgroundColor: colors.ui.cartoon ? sheetMaterial.chrome : colors.ui.glass ? colors.ui.semantic.chrome.background : sheetMaterial.chrome, borderTopWidth: subtleBorderWidth, borderTopColor: sheetMaterial.divider }}>
                <IsleButton label={t('common.cancel')} compact onPress={onClose} style={modalActionStyle} />
                <IsleButton label={t('providerSettings.import')} compact tone="primary" disabled={!input.trim()} onPress={submit} style={modalActionStyle} />
            </View>
          </MotiView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function clipboardReadFailureMessage(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  return /permission|denied|not.?allowed|nopermission/i.test(message)
    ? t('providerSettings.clipboardPermissionDenied')
    : t('providerSettings.clipboardUnavailable')
}
