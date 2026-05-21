import { useMemo, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { ChevronLeft, ClipboardPaste, FileJson, GripVertical, Import, ListChecks, Plus, Search, SlidersHorizontal, X, Zap } from 'lucide-react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { IslandField, IslandHeader, IslandIconButton, IslandSection } from '@/components/ui/IslandPrimitives'
import { IslandButton } from '@/components/ui/IslandButton'
import { PressableScale } from '@/components/ui/PressableScale'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { type AIProvider, type ProviderPresetId } from '@/types'
import { applyProviderPreset, getProviderPreset, parseCredentialGroups, parseProviderImportText, PROVIDER_PRESETS } from '@/services/ai/providerRegistry'
import { syncAndTestProvider, summarizeProviderActivation } from '@/services/providerActivation'
import { MiniStat } from '@/components/ui/MiniStat'
import { normalizeSearchText, parseModels } from '@/utils/text'

type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'

const SORT_OPTIONS: { id: ProviderSortMode; labelKey: string }[] = [
  { id: 'manual', labelKey: 'providerSettings.sort.manual' },
  { id: 'recent', labelKey: 'providerSettings.sort.recent' },
  { id: 'enabled', labelKey: 'providerSettings.sort.enabled' },
  { id: 'models', labelKey: 'providerSettings.sort.models' },
  { id: 'health', labelKey: 'providerSettings.sort.health' },
  { id: 'name', labelKey: 'providerSettings.sort.name' },
]

interface ProviderSettingsContentProps {
  embedded?: boolean
  onClose?: () => void
}

export function ProviderSettingsContent({ embedded = false, onClose }: ProviderSettingsContentProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIslandDialog()
  const providers = useSettingsStore((state) => state.providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const addProviders = useSettingsStore((state) => state.addProviders)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateProviderCredentialGroupHealth = useSettingsStore((state) => state.updateProviderCredentialGroupHealth)
  const conversations = useChatStore((state) => state.conversations)
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<ProviderSortMode>('manual')
  const [modelFilter, setModelFilter] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

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
      ? providers.filter((provider) => providerMatchesModelFilter(provider, normalizedFilter))
      : providers
    return [...filtered].sort((a, b) => compareProviders(a, b, sortMode, usageByProvider))
  }, [modelFilter, providers, sortMode, usageByProvider])

  const enabled = providers.filter((provider) => provider.enabled).length
  const credentialGroups = providers.reduce((sum, provider) => sum + (provider.credentialGroups?.length ?? 0), 0)
  const effectiveSelectedIds = selectedIds.size ? selectedIds : new Set(visibleProviders.map((provider) => provider.id))

  async function addProviderFromForm(provider: AIProvider) {
    await addProvider(provider)
    setExpandedProviderId(provider.id)
    setSortMode('manual')
    setModelFilter('')
    setAddOpen(false)
    dialog.toast({ title: t('providerSettings.added'), message: t('providerSettings.addedMessage', { name: provider.name }), tone: 'mint' })
  }

  async function importProvidersFromText(input: string) {
    const result = parseProviderImportText(input)
    if (!result.providers.length) {
      dialog.notice({ title: t('providerSettings.importEmpty'), message: result.warnings.join('\n') || t('providerSettings.importEmptyMessage'), tone: 'amber' })
      return
    }
    await addProviders(result.providers)
    setExpandedProviderId(result.providers[0]?.id ?? null)
    setSortMode('manual')
    setModelFilter('')
    setImportOpen(false)
    dialog.notice({
      title: t('providerSettings.importDone'),
      message: [t('providerSettings.importDoneMessage', { count: result.providers.length }), ...result.warnings].join('\n'),
      tone: result.warnings.length ? 'amber' : 'mint',
    })
  }

  async function enableEffectiveSelection() {
    const ids = Array.from(effectiveSelectedIds).filter((id) => visibleProviders.some((provider) => provider.id === id))
    if (!ids.length) {
      dialog.toast({ title: t('providerSettings.enableNone'), tone: 'amber' })
      return
    }
    const chosen = ids.map((id) => providers.find((provider) => provider.id === id)).filter((provider): provider is AIProvider => !!provider)
    const successful: Awaited<ReturnType<typeof syncAndTestProvider>>[] = []
    const failedProviders: AIProvider[] = []
    for (const provider of chosen) {
      try {
        successful.push(await syncAndTestProvider(provider, { updateProvider, hydrateProviderKey, updateProviderCredentialGroupHealth }, { enable: true }))
      } catch {
        failedProviders.push(provider)
      }
    }
    const summary = summarizeProviderActivation(successful)
    const primaryReady = successful.find((result) => result.testOk || result.modelCount > 0)
    if (primaryReady) {
      useSettingsStore.getState().updateSettings({ defaultProvider: primaryReady.providerId, onboardingCompleted: true })
    }
    dialog.notice({
      title: t('providerSettings.enableDone'),
      message: failedProviders.length
        ? [summary.message, t('providerSettings.failedProviders', { names: failedProviders.map((provider) => provider.name).join(', ') })].join('\n')
        : summary.message,
      tone: failedProviders.length ? 'danger' : summary.tone,
    })
    setBatchMode(false)
    setSelectedIds(new Set())
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96 }}
        >
          <IslandHeader
            title={t('settings.providerManagement')}
            leading={
              <HeaderBackButton onPress={onClose ?? closeStandaloneProviderSettings} />
            }
            trailing={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <IslandIconButton label={batchMode ? t('providerSettings.exitBatch') : t('providerSettings.batchMode')} tone={batchMode ? 'amber' : 'default'} onPress={() => {
                  setBatchMode((value) => !value)
                  setSelectedIds(new Set())
                  dialog.toast({ title: batchMode ? t('providerSettings.batchExited') : t('providerSettings.batchEntered'), tone: 'mint' })
                }}>
                  <ListChecks color={batchMode ? colors.warning : colors.textSecondary} size={18} strokeWidth={2} />
                </IslandIconButton>
                <IslandIconButton label={t('settings.addProvider')} tone="ink" onPress={() => setAddOpen(true)}>
                  <Plus color={colors.surface} size={20} strokeWidth={2} />
                </IslandIconButton>
              </View>
            }
          />

          <IslandSection title={t('providerSettings.overview')} style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <MiniStat label={t('providerSettings.enabledCount', { count: enabled })} />
              <MiniStat label={t('providerSettings.credentialGroupCount', { count: credentialGroups })} />
              <MiniStat label={t('providerSettings.providerCount', { count: providers.length })} />
              <MiniStat label={t('providerSettings.visibleCount', { count: visibleProviders.length })} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <IslandButton label={t('settings.addProvider')} compact icon={<Plus color={colors.textSecondary} size={16} />} onPress={() => setAddOpen(true)} />
              <IslandButton label={t('settings.batchImport')} compact icon={<Import color={colors.textSecondary} size={16} />} onPress={() => setImportOpen(true)} />
              <IslandButton
                label={selectedIds.size ? t('providerSettings.enableSelected', { count: selectedIds.size }) : t('settings.enableAll')}
                compact
                tone="mint"
                icon={<Zap color={colors.textSecondary} size={16} />}
                onPress={() => void enableEffectiveSelection()}
                disabled={!visibleProviders.length}
              />
            </View>
          </IslandSection>

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
              <PressableScale haptic accessibilityLabel={t('common.clearSearch')} onPress={() => setModelFilter('')} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}>
                <X color={colors.textSecondary} size={15} />
              </PressableScale>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <SlidersHorizontal color={colors.textTertiary} size={16} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
              {SORT_OPTIONS.map((option) => (
                <ChoicePill
                  key={option.id}
                  label={t(option.labelKey)}
                  active={sortMode === option.id}
                  onPress={() => {
                    setSortMode(option.id)
                    dialog.toast({ title: t('providerSettings.sortChanged', { label: t(option.labelKey) }), tone: 'mint' })
                  }}
                />
              ))}
            </ScrollView>
          </View>

          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 22, marginBottom: 10 }}>{t('providerSettings.list')}</Text>
          <View style={{ gap: 12 }}>
            {visibleProviders.map((provider, index) => (
              <ProviderListRow
                key={provider.id}
                provider={provider}
                selected={selectedIds.has(provider.id)}
                batchMode={batchMode}
                expanded={expandedProviderId === provider.id || (expandedProviderId === null && index === 0 && !provider.enabled)}
                canMoveUp={providers.findIndex((item) => item.id === provider.id) > 0}
                canMoveDown={providers.findIndex((item) => item.id === provider.id) < providers.length - 1}
                onToggleSelected={() => toggleSelection(provider.id)}
                onMove={(direction) => moveProvider(provider.id, direction)}
              />
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.islandRaised,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <ChevronLeft color={colors.text} size={24} strokeWidth={1.9} />
    </Pressable>
  )
}

function closeStandaloneProviderSettings() {
  if (router.canGoBack()) router.back()
  else router.push('/settings')
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
        <PressableScale haptic onPress={onToggleSelected} accessibilityLabel={selected ? t('providerSettings.unselectProvider') : t('providerSettings.selectProvider')} style={{ width: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.mintSoft : colors.islandRaised, borderWidth: 1, borderColor: selected ? colors.primary : colors.border }}>
          <Text style={{ color: selected ? colors.primary : colors.textTertiary, fontSize: 13, fontWeight: '900' }}>{selected ? '✓' : ''}</Text>
        </PressableScale>
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

function ChoicePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale haptic onPress={onPress} style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.text : colors.islandRaised, borderWidth: active ? 0 : 1, borderColor: colors.border }}>
      <Text style={{ color: active ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{label}</Text>
    </PressableScale>
  )
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
  const [presetId, setPresetId] = useState<ProviderPresetId>('custom-openai-compatible')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [keysText, setKeysText] = useState('')
  const preset = getProviderPreset(presetId)

  function submit() {
    const modelList = parseModels(modelsText)
    const provider = applyProviderPreset({
      id: `custom-${Date.now().toString(36)}`,
      presetId,
      detectedPresetId: presetId,
      detectionStatus: 'manual',
      type: preset.type,
      name: name.trim() || preset.name,
      baseUrl: baseUrl.trim() || preset.baseUrl,
      apiKey: '',
      credentialGroups: parseCredentialGroups(keysText),
      models: modelList,
      enabled: false,
    } satisfies AIProvider, presetId)
    onSubmit(provider)
    setName('')
    setBaseUrl('')
    setModelsText('')
    setKeysText('')
    setPresetId('custom-openai-compatible')
  }

  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ maxHeight: '88%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, padding: 16, borderWidth: 1, borderColor: colors.border }}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>{t('settings.addProvider')}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>{t('providerSettings.addSubtitle')}</Text>
                </View>
                <IslandIconButton label={t('dialog.close')} onPress={onClose}>
                  <X color={colors.textSecondary} size={18} />
                </IslandIconButton>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {PROVIDER_PRESETS.map((item) => (
                  <ChoicePill
                    key={item.id}
                    label={item.name}
                    active={presetId === item.id}
                    onPress={() => {
                      setPresetId(item.id)
                      if (!name.trim()) setName(item.name)
                      if (!baseUrl.trim() && item.baseUrl) setBaseUrl(item.baseUrl)
                    }}
                  />
                ))}
              </ScrollView>
              <IslandField label={t('providerSettings.name')} inputProps={{ value: name, onChangeText: setName, placeholder: preset.name, autoCapitalize: 'none' }} />
              <IslandField label={t('providerSettings.baseUrl')} inputProps={{ value: baseUrl, onChangeText: setBaseUrl, placeholder: preset.baseUrl ?? 'https://example.com/v1', autoCapitalize: 'none', autoCorrect: false }} />
              <IslandField
                label={t('providerSettings.tokens')}
                note={t('providerSettings.tokensNote')}
                inputProps={{ value: keysText, onChangeText: setKeysText, placeholder: 'sk-...\nsk-...', autoCapitalize: 'none', autoCorrect: false, multiline: true, secureTextEntry: false, style: { minHeight: 104 } }}
              />
              <IslandField
                label={t('settings.models')}
                note={t('providerSettings.modelsNote')}
                inputProps={{ value: modelsText, onChangeText: setModelsText, placeholder: preset.defaultModels.join('\n') || t('providerSettings.oneModelPerLine'), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 96 } }}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <IslandButton label={t('common.cancel')} onPress={onClose} style={{ flex: 1 }} />
                <IslandButton label={t('common.save')} tone="primary" onPress={submit} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
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
  const dialog = useIslandDialog()
  const [input, setInput] = useState('')
  function submit() {
    onSubmit(input)
    setInput('')
  }

  async function pasteFromClipboard() {
    const text = await Clipboard.getStringAsync()
    if (!text.trim()) {
      dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
      return
    }
    setInput((current) => [current.trim(), text.trim()].filter(Boolean).join('\n\n'))
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
    setInput((current) => [current.trim(), text.trim()].filter(Boolean).join('\n\n'))
    dialog.toast({ title: t('providerSettings.fileRead'), message: asset.name, tone: 'mint' })
  }

  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ maxHeight: '82%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, padding: 16, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>{t('settings.batchImport')}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>{t('providerSettings.importSubtitle')}</Text>
              </View>
              <IslandIconButton label={t('dialog.close')} onPress={onClose}>
                <X color={colors.textSecondary} size={18} />
              </IslandIconButton>
            </View>
            <IslandField
              label={t('providerSettings.importContent')}
              note={t('providerSettings.importNote')}
              inputProps={{
                value: input,
                onChangeText: setInput,
                multiline: true,
                autoCapitalize: 'none',
                autoCorrect: false,
                placeholder: 'https://api.example.com/v1\nsk-...\nsk-...\n\nhttps://api.other.com/v1\nsk-...',
                style: { minHeight: 180, maxHeight: 300 },
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <IslandButton label={t('settings.pasteClipboard')} icon={<ClipboardPaste color={colors.textSecondary} size={16} />} onPress={() => void pasteFromClipboard()} style={{ flex: 1 }} />
              <IslandButton label={t('settings.chooseFile')} icon={<FileJson color={colors.textSecondary} size={16} />} onPress={() => void importFromFile()} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <IslandButton label={t('common.cancel')} onPress={onClose} style={{ flex: 1 }} />
              <IslandButton label={t('providerSettings.import')} tone="primary" disabled={!input.trim()} onPress={submit} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function compareProviders(a: AIProvider, b: AIProvider, mode: ProviderSortMode, usageByProvider: Map<string, number>): number {
  if (mode === 'recent') return (usageByProvider.get(b.id) ?? 0) - (usageByProvider.get(a.id) ?? 0)
  if (mode === 'enabled') return Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)
  if (mode === 'models') return b.models.length - a.models.length || a.name.localeCompare(b.name)
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

function providerMatchesModelFilter(provider: AIProvider, filter: string): boolean {
  const values = [
    provider.name,
    provider.type,
    ...provider.models,
    ...(provider.modelConfigs ?? []).flatMap((model) => [model.id, model.name]),
    ...(provider.credentialGroups ?? []).flatMap((group) => group.availableModels ?? []),
  ]
  return values.some((value) => normalizeSearchText(value).includes(filter))
}
