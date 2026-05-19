import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Text, TextInput, View } from 'react-native'
import { Check, ChevronDown, KeyRound, ListFilter, Plus, Power, RotateCw, SearchCheck, Sparkles, Star, Trash2 } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { AIProvider, ProviderCredentialGroup, ProviderPresetId } from '@/types'
import { getModelConfig, getModelName, getProviderModels } from '@/types'
import { syncProviderCredentialGroupsDetailed, testProviderModelDetailed } from '@/services/ai/base'
import { applyProviderPreset, detectProviderPreset, getProviderPreset, maskSecret, parseCredentialGroups, probeProviderPreset, PROVIDER_PRESETS } from '@/services/ai/providerRegistry'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandChip } from '@/components/ui/IslandChip'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandField } from '@/components/ui/IslandPrimitives'
import { useIslandDialog } from '@/components/ui/IslandDialog'

interface ApiKeyPanelProps {
  provider: AIProvider
  initiallyExpanded?: boolean
}

type PanelTask = 'idle' | 'saving' | 'syncing' | 'testing' | 'probing'

export function ApiKeyPanel({ provider, initiallyExpanded = false }: ApiKeyPanelProps) {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const defaultProvider = useSettingsStore((state) => state.settings.defaultProvider)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [presetId, setPresetId] = useState<ProviderPresetId>(provider.presetId ?? 'custom-openai-compatible')
  const [singleCredentialText, setSingleCredentialText] = useState('')
  const [credentialText, setCredentialText] = useState('')
  const [modelsText, setModelsText] = useState(provider.models.join('\n'))
  const [draftGroups, setDraftGroups] = useState<ProviderCredentialGroup[]>(provider.credentialGroups ?? [])
  const [modelEditing, setModelEditing] = useState(false)
  const [groupKeyMasks, setGroupKeyMasks] = useState<Record<string, string>>({})
  const [task, setTask] = useState<PanelTask>('idle')
  const [notice, setNotice] = useState('')

  const hydratedGroups = draftGroups
  const detection = useMemo(() => detectProviderPreset({ baseUrl, name: provider.name, apiKey: singleCredentialText || credentialText }), [baseUrl, credentialText, provider.name, singleCredentialText])
  const selectedPreset = getProviderPreset(presetId)
  const currentModels = useMemo(() => parseModels(modelsText), [modelsText])
  const primaryModel = currentModels[0] ?? getProviderModels(provider.type)[0]?.id ?? '未设置模型'
  const primaryModelConfig = getModelConfig(primaryModel, provider.type, provider.modelConfigs)
  const groupCount = hydratedGroups.length
  const syncedGroups = hydratedGroups.filter((group) => group.lastModelSyncStatus === 'ok').length
  const hasKey = hydratedGroups.some((group) => group.enabled) || !!singleCredentialText.trim() || !!credentialText.trim()
  const isDefault = defaultProvider === provider.id
  const isBusy = task !== 'idle'
  const lastStatusLabel = provider.lastTestStatus === 'ok' ? '模型可用' : provider.lastTestStatus === 'bad' ? '需检查' : provider.lastModelSyncStatus === 'ok' ? '已同步' : provider.lastModelSyncStatus === 'bad' ? '同步失败' : '待验证'

  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? '')
    setPresetId(provider.presetId ?? provider.detectedPresetId ?? 'custom-openai-compatible')
    setModelsText(provider.models.join('\n'))
    setDraftGroups(provider.credentialGroups ?? [])
    setModelEditing(false)
    setGroupKeyMasks({})
    setSingleCredentialText('')
    setCredentialText('')
    setNotice('')
  }, [provider.baseUrl, provider.detectedPresetId, provider.id, provider.models, provider.presetId])

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
    const pastedGroups = createIncomingGroups(draftGroups.length, [singleCredentialText, credentialText].filter(Boolean).join('\n'))
    const credentialGroups = mergeGroups(draftGroups, pastedGroups)
    const models = parseModels(modelsText)
    const applied = applyProviderPreset({
      ...provider,
      baseUrl: baseUrl.trim() || selectedPreset.baseUrl,
      credentialGroups,
      models: models.length ? models : provider.models,
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
      const message = pastedGroups.length ? `已保存 ${credentialGroups.length} 个令牌分组。` : '已保存配置。'
      setNotice(message)
      dialog.toast({ title: `已保存 ${provider.name}`, message, tone: 'mint' })
    }
  }

  function addPendingGroups() {
    const incoming = createIncomingGroups(draftGroups.length, [singleCredentialText, credentialText].filter(Boolean).join('\n'))
    if (!incoming.length) {
      setNotice('先输入一个或多个令牌。')
      dialog.toast({ title: '未加入令牌', message: '先输入一个或多个令牌。', tone: 'amber' })
      return
    }
    setDraftGroups((current) => mergeGroups(current, incoming))
    setSingleCredentialText('')
    setCredentialText('')
    setNotice(`已加入 ${incoming.length} 个令牌分组，点保存后生效。`)
    dialog.toast({ title: `已加入 ${incoming.length} 个令牌分组`, message: provider.name, tone: 'mint' })
  }

  function updateDraftGroup(groupId: string, updates: Partial<ProviderCredentialGroup>) {
    setDraftGroups((groups) => groups.map((group) => group.id === groupId ? { ...group, ...updates } : group))
    setNotice('分组变更待保存。')
    if (updates.enabled !== undefined) {
      const group = draftGroups.find((item) => item.id === groupId)
      dialog.toast({ title: updates.enabled ? '令牌分组已启用' : '令牌分组已停用', message: group?.label ?? provider.name, tone: 'mint' })
    }
  }

  async function deleteDraftGroup(groupId: string) {
    const group = draftGroups.find((item) => item.id === groupId)
    const nextGroups = draftGroups.filter((group) => group.id !== groupId)
    setDraftGroups(nextGroups)
    await updateProvider(provider.id, { credentialGroups: nextGroups })
    setNotice('分组已删除。')
    dialog.toast({ title: '令牌分组已删除', message: group?.label ?? provider.name, tone: 'amber' })
  }

  async function acceptDetection() {
    setPresetId(detection.presetId)
    const preset = getProviderPreset(detection.presetId)
    if (!baseUrl.trim() && preset.baseUrl) setBaseUrl(preset.baseUrl)
    setNotice(`已选择 ${preset.name}。`)
    dialog.toast({ title: '已接受识别', message: `${provider.name} · ${preset.name}`, tone: 'mint' })
  }

  async function probeDetection() {
    setTask('probing')
    dialog.toast({ title: '网络探测开始', message: provider.name, tone: 'mint' })
    const result = await probeProviderPreset({ baseUrl, name: provider.name, apiKey: await getProbeApiKey() })
    setPresetId(result.presetId)
    const preset = getProviderPreset(result.presetId)
    if (!baseUrl.trim() && preset.baseUrl) setBaseUrl(preset.baseUrl)
    setTask('idle')
    setNotice(result.reason)
    dialog.toast({ title: '网络探测完成', message: `${provider.name} · ${getProviderPreset(result.presetId).name}`, tone: 'mint' })
  }

  async function syncModels() {
    setTask('syncing')
    dialog.toast({ title: '模型同步开始', message: provider.name, tone: 'mint' })
    await save(false)
    const keyed = await hydrateProviderKey(provider.id)
    if (!keyed) {
      setTask('idle')
      setNotice('服务商不存在。')
      dialog.toast({ title: '模型同步失败', message: '服务商不存在。', tone: 'danger' })
      return
    }
    const result = await syncProviderCredentialGroupsDetailed(keyed)
    if (result.data) {
      await updateProvider(provider.id, result.data)
      setModelsText(result.data.models.join('\n'))
    }
    setTask('idle')
    setNotice(result.ok ? '令牌分组已低速同步，模型列表已合并。' : result.message)
    dialog.toast({ title: result.ok ? '模型同步完成' : '模型同步失败', message: result.ok ? `${provider.name} · ${result.data?.models.length ?? provider.models.length} 个模型` : result.message, tone: result.ok ? 'mint' : 'danger' })
  }

  async function verifyModel() {
    setTask('testing')
    dialog.toast({ title: '模型测试开始', message: provider.name, tone: 'mint' })
    await save(false)
    const keyed = await hydrateProviderKey(provider.id)
    const model = parseModels(modelsText)[0] ?? primaryModel
    const group = keyed?.credentialGroups?.find((item) => item.enabled && (!item.availableModels?.length || item.availableModels.includes(model)))
    const apiKey = group?.apiKey ?? keyed?.apiKey ?? ''
    const result = keyed ? await testProviderModelDetailed(keyed, model, apiKey) : { ok: false, message: '服务商不存在。', code: 'unknown' as const }
    if (keyed) {
      await useSettingsStore.getState().updateProviderCredentialGroupHealth(keyed.id, result.credentialGroupId ?? group?.id, result.ok)
    }
    await updateProvider(provider.id, {
      lastTestStatus: result.ok ? 'ok' : 'bad',
      lastTestedAt: Date.now(),
      lastTestModel: model,
      lastTestMessage: result.message,
      lastTestCode: result.code,
    })
    setTask('idle')
    setNotice(result.ok ? `${model} 可用。` : result.message)
    dialog.toast({ title: result.ok ? '模型测试通过' : '模型测试失败', message: result.ok ? `${provider.name} · ${model}` : result.message, tone: result.ok ? 'mint' : 'danger' })
  }

  async function toggleProviderEnabled() {
    const enabled = !provider.enabled
    await updateProvider(provider.id, { enabled })
    dialog.toast({ title: enabled ? `已启用 ${provider.name}` : `已停用 ${provider.name}`, tone: 'mint' })
  }

  function setDefaultProvider() {
    updateSettings({ defaultProvider: provider.id, onboardingCompleted: true })
    dialog.toast({ title: '默认供应商已更新', message: provider.name, tone: 'mint' })
  }

  function cancelModelEditing() {
    setModelsText(provider.models.join('\n'))
    setModelEditing(false)
    setNotice('')
    dialog.toast({ title: '已取消模型编辑', message: provider.name, tone: 'amber' })
  }

  function enterModelEditing() {
    setModelEditing(true)
    dialog.toast({ title: '模型列表可编辑', message: provider.name, tone: 'mint' })
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
      <PressableScale haptic onPress={() => setExpanded((value) => !value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>
          {provider.presetId === 'newapi' || provider.presetId === 'sub2api' ? <Sparkles color={colors.text} size={18} /> : <KeyRound color={colors.text} size={18} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }}>{provider.name}</Text>
            {isDefault ? <Badge label="默认" tone="warning" /> : null}
            <Badge label={provider.enabled ? '启用' : '停用'} tone={provider.enabled ? 'success' : 'muted'} />
            <Badge label={`${Math.max(groupCount, hasKey ? 1 : 0)} 组令牌`} tone={hasKey ? 'success' : 'muted'} />
            <Badge label={lastStatusLabel} tone={provider.lastTestStatus === 'ok' || provider.lastModelSyncStatus === 'ok' ? 'success' : provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad' ? 'danger' : 'muted'} />
          </View>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>
            {getModelName(primaryModel)} · {provider.models.length} 个模型 · {getProviderPreset(provider.presetId).name}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
            上下文 {formatTokenLimit(primaryModelConfig.contextWindow)} · 已同步分组 {syncedGroups}/{groupCount}
          </Text>
        </View>
        {provider.lastTestStatus === 'ok' ? <Check color={colors.success} size={18} /> : null}
        {provider.lastTestStatus === 'bad' ? <RotateCw color={colors.error} size={18} /> : null}
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 180 }}>
          <ChevronDown color={colors.textTertiary} size={19} />
        </MotiView>
      </PressableScale>

      {expanded ? (
        <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'spring', damping: 20, stiffness: 180 }} style={{ marginTop: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <MiniAction active={isDefault} label={isDefault ? '默认' : '设默认'} onPress={setDefaultProvider}>
              <Star color={isDefault ? colors.warning : colors.textTertiary} size={15} fill={isDefault ? colors.warning : 'transparent'} />
            </MiniAction>
            <MiniAction active={provider.enabled} label={provider.enabled ? '已启用' : '已停用'} onPress={() => void toggleProviderEnabled()}>
              <Power color={provider.enabled ? colors.success : colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label="接受识别" onPress={() => void acceptDetection()}>
              <SearchCheck color={colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={task === 'probing' ? '探测中' : '网络探测'} onPress={() => void probeDetection()} disabled={isBusy || !baseUrl.trim() || !hasKey}>
              <Sparkles color={colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label="低速同步" onPress={() => void syncModels()} disabled={isBusy || !hasKey}>
              <ListFilter color={colors.textTertiary} size={15} />
            </MiniAction>
          </View>

          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>自动识别</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
              {detection.reason} · 建议 {getProviderPreset(detection.presetId).name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {PROVIDER_PRESETS.map((preset) => (
                <ChoiceButton key={preset.id} active={presetId === preset.id} label={preset.name} onPress={() => setPresetId(preset.id)} />
              ))}
            </View>
          </View>

          <IslandField
            label="站点 / Base URL"
            inputProps={{
              value: baseUrl,
              onChangeText: (value) => {
                setBaseUrl(value)
                setNotice('')
              },
              autoCapitalize: 'none',
              autoCorrect: false,
              placeholder: selectedPreset.baseUrl ?? 'https://new-api.example.com/v1',
            }}
          />

          <View style={{ gap: 10 }}>
            <SectionHeader
              title="令牌分组"
              action={
                <MiniAction label="加入" onPress={addPendingGroups} disabled={isBusy || !(singleCredentialText.trim() || credentialText.trim())}>
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
                <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>暂无令牌分组</Text>
              </View>
            )}
            <IslandField
              label="新增单个令牌"
              inputProps={{
                value: singleCredentialText,
                onChangeText: (value) => {
                  setSingleCredentialText(value)
                  setNotice('')
                },
                secureTextEntry: false,
                autoCapitalize: 'none',
                autoCorrect: false,
                placeholder: 'sk-...',
              }}
            />
            <IslandField
              label="批量新增令牌"
              note="每行、逗号或中文逗号分隔；点“加入”后先进入待保存分组。"
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
                placeholder: 'sk-...\nsk-...\nsk-...',
                style: { minHeight: 84, maxHeight: 140 },
              }}
            />
          </View>

          <View style={{ gap: 10 }}>
            <SectionHeader
              title="模型列表"
              description={modelEditing ? '编辑中' : `${currentModels.length} 个模型`}
              action={
                modelEditing ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <MiniAction label="取消" onPress={cancelModelEditing}>
                      <RotateCw color={colors.textTertiary} size={15} />
                    </MiniAction>
                    <MiniAction label="保存" onPress={() => void save()} disabled={isBusy}>
                      <Check color={colors.textTertiary} size={15} />
                    </MiniAction>
                  </View>
                ) : (
                  <MiniAction label="编辑" onPress={enterModelEditing}>
                    <ListFilter color={colors.textTertiary} size={15} />
                  </MiniAction>
                )
              }
            />
            {modelEditing ? (
              <IslandField
                label="模型 ID"
                inputProps={{
                  value: modelsText,
                  onChangeText: (value) => {
                    setModelsText(value)
                    setNotice('')
                  },
                  autoCapitalize: 'none',
                  autoCorrect: false,
                  multiline: true,
                  placeholder: getProviderModels(provider.type).map((model) => model.id).join('\n') || '每行一个模型 ID',
                  style: { minHeight: 116, maxHeight: 190, paddingVertical: 12, lineHeight: 20 },
                }}
              />
            ) : (
              <ModelSummary models={currentModels} providerType={provider.type} />
            )}
          </View>

          {provider.lastModelSyncMessage || provider.lastTestMessage ? (
            <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.islandRaised }}>
              {provider.lastModelSyncMessage ? <Text style={{ color: provider.lastModelSyncStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 11, lineHeight: 16 }}>模型同步：{provider.lastModelSyncMessage}</Text> : null}
              {provider.lastTestMessage ? <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: provider.lastModelSyncMessage ? 3 : 0 }}>模型测试：{provider.lastTestMessage}</Text> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton label={task === 'saving' ? '保存中' : '保存'} busy={task === 'saving'} onPress={() => void save()} />
            <ActionButton label="低速获取模型" busy={task === 'syncing'} disabled={!hasKey || isBusy} onPress={() => void syncModels()} secondary />
            <ActionButton label="测试首选模型" busy={task === 'testing'} disabled={!hasKey || isBusy} onPress={() => void verifyModel()} secondary />
          </View>

          {notice ? <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{notice}</Text> : null}
        </MotiView>
      ) : null}
    </MotiView>
  )
}

function createIncomingGroups(offset: number, input: string): ProviderCredentialGroup[] {
  return parseCredentialGroups(input).map((group, index) => ({
    ...group,
    label: `令牌分组 ${offset + index + 1}`,
  }))
}

function mergeGroups(existing: ProviderCredentialGroup[], incoming: ProviderCredentialGroup[]): ProviderCredentialGroup[] {
  const seenKeys = new Set<string>()
  return [...existing, ...incoming].filter((group) => {
    const key = group.apiKey?.trim()
    if (!key) return true
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  }).map((group, index) => ({
    ...group,
    label: group.label || `令牌分组 ${index + 1}`,
  }))
}

function parseModels(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  return <IslandChip tone={tone === 'warning' ? 'amber' : tone === 'danger' ? 'danger' : tone === 'success' ? 'mint' : 'default'}>{label}</IslandChip>
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale haptic onPress={onPress} style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.text : colors.material.field }}>
      <Text style={{ color: active ? colors.surface : colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </PressableScale>
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
  const statusTone = group.lastModelSyncStatus === 'bad' ? colors.error : group.enabled ? colors.success : colors.textTertiary
  const statusText = group.lastModelSyncStatus === 'ok'
    ? '已同步'
    : group.lastModelSyncStatus === 'bad'
      ? '同步失败'
      : group.enabled ? '启用' : '停用'
  return (
    <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: group.enabled ? colors.borderStrong : colors.border, gap: 9 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={group.label}
          onChangeText={onChangeLabel}
          placeholder={`令牌分组 ${index + 1}`}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            flex: 1,
            minHeight: 42,
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
        <IconPill label={group.enabled ? '停用' : '启用'} onPress={onToggle} tone={group.enabled ? 'mint' : 'default'}>
          <Power color={group.enabled ? colors.success : colors.textTertiary} size={15} />
        </IconPill>
        <IconPill label="删除" onPress={onDelete} tone="danger">
          <Trash2 color={colors.error} size={15} />
        </IconPill>
      </View>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{maskedKey || '新令牌待保存'}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>{group.availableModels?.length ?? 0} 模型</Text>
        <Text style={{ color: statusTone, fontSize: 11, fontWeight: '900' }}>{statusText}</Text>
        {group.failureCount ? <Text style={{ color: colors.error, fontSize: 11, fontWeight: '900' }}>失败 {group.failureCount}</Text> : null}
      </View>
    </View>
  )
}

function ModelSummary({ models, providerType }: { models: string[]; providerType: AIProvider['type'] }) {
  const { colors } = useAppTheme()
  const defaults = getProviderModels(providerType).map((model) => model.id)
  const shown = (models.length ? models : defaults).slice(0, 8)
  if (!shown.length) {
    return (
      <View style={{ borderRadius: 18, padding: 12, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>暂无模型</Text>
      </View>
    )
  }
  return (
    <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 9 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {shown.map((model) => <ModelChip key={model} label={getModelName(model)} />)}
      </View>
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

function IconPill({ label, children, tone, onPress }: { label: string; children: ReactNode; tone: 'default' | 'mint' | 'danger'; onPress: () => void }) {
  const { colors } = useAppTheme()
  const background = tone === 'mint' ? colors.mintSoft : tone === 'danger' ? colors.coralWash : colors.material.field
  return (
    <PressableScale haptic accessibilityLabel={label} onPress={onPress} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: background, borderWidth: 1, borderColor: colors.border }}>
      {children}
    </PressableScale>
  )
}

function MiniAction({ label, children, active = false, disabled = false, onPress }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale haptic disabled={disabled} onPress={onPress} style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: active ? colors.amberSoft : colors.islandRaised, opacity: disabled ? 0.5 : 1 }}>
      {children}
      <Text style={{ color: active ? colors.text : colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </PressableScale>
  )
}

function ActionButton({ label, busy = false, secondary = false, disabled = false, onPress }: { label: string; busy?: boolean; secondary?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslandButton
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
