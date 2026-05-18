import { useMemo, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { ChevronLeft, GripVertical, ListChecks, Plus, Search, SlidersHorizontal, X, Zap } from 'lucide-react-native'
import { router } from 'expo-router'
import { Screen } from '@/components/ui/Screen'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { IslandHeader, IslandIconButton, IslandSection } from '@/components/ui/IslandPrimitives'
import { IslandButton } from '@/components/ui/IslandButton'
import { PressableScale } from '@/components/ui/PressableScale'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getModelName, type AIProvider } from '@/types'

type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'

const SORT_OPTIONS: { id: ProviderSortMode; label: string }[] = [
  { id: 'manual', label: '手动' },
  { id: 'recent', label: '最近使用' },
  { id: 'enabled', label: '启用优先' },
  { id: 'models', label: '模型数' },
  { id: 'health', label: '健康状态' },
  { id: 'name', label: '名称' },
]

export default function ProviderSettingsScreen() {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  const providers = useSettingsStore((state) => state.providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const updateProviders = useSettingsStore((state) => state.updateProviders)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const conversations = useChatStore((state) => state.conversations)
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<ProviderSortMode>('manual')
  const [modelFilter, setModelFilter] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

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

  async function addCustomProvider() {
    const id = `custom-${Date.now().toString(36)}`
    const provider: AIProvider = {
      id,
      presetId: 'custom-openai-compatible',
      detectedPresetId: 'custom-openai-compatible',
      detectionStatus: 'manual',
      type: 'openai-compatible',
      name: '自定义供应商',
      apiKey: '',
      models: [],
      enabled: false,
    }
    await addProvider(provider)
    setExpandedProviderId(id)
    setSortMode('manual')
    setModelFilter('')
    dialog.toast({ title: '已添加供应商', message: '默认停用，已置顶编辑。', tone: 'mint' })
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

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96 }}
        >
          <IslandHeader
            title="供应商"
            leading={
              <IslandIconButton label="返回" onPress={() => router.back()}>
                <ChevronLeft color={colors.text} size={23} strokeWidth={1.9} />
              </IslandIconButton>
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
                <IslandIconButton label="添加供应商" tone="ink" onPress={() => void addCustomProvider()}>
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
              <IslandButton label="添加自定义供应商" compact icon={<Plus color={colors.textSecondary} size={16} />} onPress={() => void addCustomProvider()} />
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
    </Screen>
  )
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
