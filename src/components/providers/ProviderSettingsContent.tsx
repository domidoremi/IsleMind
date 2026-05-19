import { useMemo, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { ChevronLeft, GripVertical, Import, ListChecks, Plus, Search, SlidersHorizontal, X, Zap } from 'lucide-react-native'
import { router } from 'expo-router'
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

type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'

const SORT_OPTIONS: { id: ProviderSortMode; label: string }[] = [
  { id: 'manual', label: '手动' },
  { id: 'recent', label: '最近使用' },
  { id: 'enabled', label: '启用优先' },
  { id: 'models', label: '模型数' },
  { id: 'health', label: '健康状态' },
  { id: 'name', label: '名称' },
]

interface ProviderSettingsContentProps {
  embedded?: boolean
  onClose?: () => void
}

export function ProviderSettingsContent({ embedded = false, onClose }: ProviderSettingsContentProps) {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  const providers = useSettingsStore((state) => state.providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const addProviders = useSettingsStore((state) => state.addProviders)
  const updateProviders = useSettingsStore((state) => state.updateProviders)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
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
    const normalizedFilter = normalizeSearch(modelFilter)
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
    dialog.toast({ title: '已添加供应商', message: `${provider.name} 默认停用，已置顶。`, tone: 'mint' })
  }

  async function importProvidersFromText(input: string) {
    const result = parseProviderImportText(input)
    if (!result.providers.length) {
      dialog.notice({ title: '未导入供应商', message: result.warnings.join('\n') || '没有识别到可导入的供应商。', tone: 'amber' })
      return
    }
    await addProviders(result.providers)
    setExpandedProviderId(result.providers[0]?.id ?? null)
    setSortMode('manual')
    setModelFilter('')
    setImportOpen(false)
    dialog.notice({
      title: '批量导入完成',
      message: [`已导入 ${result.providers.length} 个供应商，默认停用。`, ...result.warnings].join('\n'),
      tone: result.warnings.length ? 'amber' : 'mint',
    })
  }

  async function enableEffectiveSelection() {
    const ids = Array.from(effectiveSelectedIds).filter((id) => visibleProviders.some((provider) => provider.id === id))
    if (!ids.length) {
      dialog.toast({ title: '没有可启用项', tone: 'amber' })
      return
    }
    const results = await Promise.allSettled(ids.map((id) => updateProviders([id], { enabled: true })))
    const enabledIds = ids.filter((_, index) => results[index]?.status === 'fulfilled')
    const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected')
    const chosen = providers.filter((provider) => enabledIds.includes(provider.id))
    const hydrated = await Promise.all(enabledIds.map((id) => hydrateProviderKey(id)))
    const missingModels = chosen.filter((provider) => !provider.models.length)
    const missingKeys = chosen.filter((provider) => {
      const keyed = hydrated.find((item) => item?.id === provider.id)
      return !providerHasAnyCredential(keyed ?? provider)
    })
    const failedProviders = providers.filter((provider) => failedIds.includes(provider.id))
    dialog.notice({
      title: '批量启用完成',
      message: buildEnableNotice(enabledIds.length, 0, failedProviders, missingModels, missingKeys),
      tone: failedProviders.length ? 'danger' : missingModels.length || missingKeys.length ? 'amber' : 'mint',
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
    dialog.toast({ title: '顺序已更新', message: item.name, tone: 'mint' })
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
            title="供应商"
            leading={
              <HeaderBackButton onPress={onClose ?? closeStandaloneProviderSettings} />
            }
            trailing={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <IslandIconButton label={batchMode ? '退出批量' : '批量模式'} tone={batchMode ? 'amber' : 'default'} onPress={() => {
                  setBatchMode((value) => !value)
                  setSelectedIds(new Set())
                  dialog.toast({ title: batchMode ? '已退出批量模式' : '已进入批量模式', tone: 'mint' })
                }}>
                  <ListChecks color={batchMode ? colors.warning : colors.textSecondary} size={18} strokeWidth={2} />
                </IslandIconButton>
                <IslandIconButton label="添加供应商" tone="ink" onPress={() => setAddOpen(true)}>
                  <Plus color={colors.surface} size={20} strokeWidth={2} />
                </IslandIconButton>
              </View>
            }
          />

          <IslandSection title="连接概况" style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <MiniStat label={`已启用 ${enabled}`} />
              <MiniStat label={`令牌组 ${credentialGroups}`} />
              <MiniStat label={`供应商 ${providers.length}`} />
              <MiniStat label={`显示 ${visibleProviders.length}`} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <IslandButton label="新增供应商" compact icon={<Plus color={colors.textSecondary} size={16} />} onPress={() => setAddOpen(true)} />
              <IslandButton label="批量导入" compact icon={<Import color={colors.textSecondary} size={16} />} onPress={() => setImportOpen(true)} />
              <IslandButton
                label={selectedIds.size ? `启用所选 ${selectedIds.size}` : '快捷启用'}
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
              placeholder="筛选模型"
              placeholderTextColor={colors.textTertiary}
              style={{ flex: 1, minHeight: 46, padding: 0, color: colors.text, fontSize: 14, fontWeight: '800' }}
            />
            {modelFilter ? (
              <PressableScale haptic accessibilityLabel="清空筛选" onPress={() => setModelFilter('')} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}>
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
                  label={option.label}
                  active={sortMode === option.id}
                  onPress={() => {
                    setSortMode(option.id)
                    dialog.toast({ title: `排序：${option.label}`, tone: 'mint' })
                  }}
                />
              ))}
            </ScrollView>
          </View>

          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 22, marginBottom: 10 }}>供应商列表</Text>
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
          {!visibleProviders.length ? <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginTop: 16 }}>没有匹配的供应商</Text> : null}
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="返回"
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
  router.replace('/settings')
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}>
      <DragRail disabledUp={!canMoveUp} disabledDown={!canMoveDown} onMove={onMove} />
      {batchMode ? (
        <PressableScale haptic onPress={onToggleSelected} accessibilityLabel={selected ? '取消选择供应商' : '选择供应商'} style={{ width: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.mintSoft : colors.islandRaised, borderWidth: 1, borderColor: selected ? colors.primary : colors.border }}>
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

function MiniStat({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 30, borderRadius: 15, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </View>
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
      models: modelList.length ? modelList : preset.defaultModels,
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
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>新增供应商</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>保存后默认停用，可再手动启用。</Text>
                </View>
                <IslandIconButton label="关闭" onPress={onClose}>
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
                      if (!modelsText.trim() && item.defaultModels.length) setModelsText(item.defaultModels.join('\n'))
                    }}
                  />
                ))}
              </ScrollView>
              <IslandField label="名称" inputProps={{ value: name, onChangeText: setName, placeholder: preset.name, autoCapitalize: 'none' }} />
              <IslandField label="站点 / Base URL" inputProps={{ value: baseUrl, onChangeText: setBaseUrl, placeholder: preset.baseUrl ?? 'https://example.com/v1', autoCapitalize: 'none', autoCorrect: false }} />
              <IslandField
                label="令牌"
                note="可粘贴单个或多个令牌，每行或逗号分隔。"
                inputProps={{ value: keysText, onChangeText: setKeysText, placeholder: 'sk-...\nsk-...', autoCapitalize: 'none', autoCorrect: false, multiline: true, secureTextEntry: false, style: { minHeight: 104 } }}
              />
              <IslandField
                label="模型"
                note="可留空，使用快速预设的模型；也可每行一个模型 ID。"
                inputProps={{ value: modelsText, onChangeText: setModelsText, placeholder: preset.defaultModels.join('\n') || '每行一个模型 ID', autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 96 } }}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <IslandButton label="取消" onPress={onClose} style={{ flex: 1 }} />
                <IslandButton label="保存" tone="primary" onPress={submit} style={{ flex: 1 }} />
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
  const [input, setInput] = useState('')
  function submit() {
    onSubmit(input)
    setInput('')
  }
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ maxHeight: '82%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, padding: 16, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>批量导入</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>导入后默认停用，可再批量启用。</Text>
              </View>
              <IslandIconButton label="关闭" onPress={onClose}>
                <X color={colors.textSecondary} size={18} />
              </IslandIconButton>
            </View>
            <IslandField
              label="供应商文本"
              note="示例：供应商A: https://api.example.com/v1, 秘钥: sk-1, 秘钥2: sk-2; Provider B, Base URL=https://b.example/v1, API Key=sk-b"
              inputProps={{
                value: input,
                onChangeText: setInput,
                multiline: true,
                autoCapitalize: 'none',
                autoCorrect: false,
                placeholder: '供应商A: https://..., 秘钥: sk-...; 供应商B: https://..., key: sk-...',
                style: { minHeight: 180, maxHeight: 300 },
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <IslandButton label="取消" onPress={onClose} style={{ flex: 1 }} />
              <IslandButton label="导入" tone="primary" disabled={!input.trim()} onPress={submit} style={{ flex: 1 }} />
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
  return values.some((value) => normalizeSearch(value).includes(filter))
}

function normalizeSearch(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function parseModels(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function providerHasAnyCredential(provider: AIProvider): boolean {
  return !!provider.apiKey?.trim() || !!provider.credentialGroups?.some((group) => group.apiKey?.trim())
}

function buildEnableNotice(successCount: number, skippedCount: number, failedProviders: AIProvider[], missingModels: AIProvider[], missingKeys: AIProvider[]): string {
  const parts = [`成功 ${successCount} · 跳过 ${skippedCount} · 异常 ${failedProviders.length}`]
  if (failedProviders.length) parts.push(`异常：${failedProviders.map((provider) => provider.name).join('、')}`)
  if (missingModels.length) parts.push(`无模型：${missingModels.map((provider) => provider.name).join('、')}`)
  if (missingKeys.length) parts.push(`缺令牌：${missingKeys.map((provider) => provider.name).join('、')}`)
  return parts.join('\n')
}
