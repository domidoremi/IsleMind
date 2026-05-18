import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Check, ChevronDown, KeyRound, ListFilter, Power, RotateCw, SearchCheck, Sparkles, Star } from 'lucide-react-native'
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

interface ApiKeyPanelProps {
  provider: AIProvider
  initiallyExpanded?: boolean
}

type PanelTask = 'idle' | 'saving' | 'syncing' | 'testing' | 'probing'

export function ApiKeyPanel({ provider, initiallyExpanded = false }: ApiKeyPanelProps) {
  const { colors } = useAppTheme()
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const defaultProvider = useSettingsStore((state) => state.settings.defaultProvider)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [presetId, setPresetId] = useState<ProviderPresetId>(provider.presetId ?? 'custom-openai-compatible')
  const [credentialText, setCredentialText] = useState('')
  const [modelsText, setModelsText] = useState(provider.models.join('\n'))
  const [task, setTask] = useState<PanelTask>('idle')
  const [notice, setNotice] = useState('')

  const hydratedGroups = provider.credentialGroups ?? []
  const detection = useMemo(() => detectProviderPreset({ baseUrl, name: provider.name, apiKey: credentialText }), [baseUrl, credentialText, provider.name])
  const selectedPreset = getProviderPreset(presetId)
  const primaryModel = provider.models[0] ?? getProviderModels(provider.type)[0]?.id ?? '未设置模型'
  const primaryModelConfig = getModelConfig(primaryModel, provider.type, provider.modelConfigs)
  const groupCount = hydratedGroups.length
  const syncedGroups = hydratedGroups.filter((group) => group.lastModelSyncStatus === 'ok').length
  const hasKey = hydratedGroups.some((group) => group.enabled) || !!credentialText.trim()
  const isDefault = defaultProvider === provider.id
  const isBusy = task !== 'idle'
  const lastStatusLabel = provider.lastTestStatus === 'ok' ? '模型可用' : provider.lastTestStatus === 'bad' ? '需检查' : provider.lastModelSyncStatus === 'ok' ? '已同步' : provider.lastModelSyncStatus === 'bad' ? '同步失败' : '待验证'

  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? '')
    setPresetId(provider.presetId ?? provider.detectedPresetId ?? 'custom-openai-compatible')
    setModelsText(provider.models.join('\n'))
    setCredentialText('')
    setNotice('')
  }, [provider.baseUrl, provider.detectedPresetId, provider.id, provider.models, provider.presetId])

  async function save(showNotice = true) {
    setTask('saving')
    const pastedGroups = parseCredentialGroups(credentialText)
    const existingGroups = hydratedGroups.map((group) => ({ ...group, apiKey: '' }))
    const credentialGroups = pastedGroups.length
      ? mergeGroups(existingGroups, pastedGroups)
      : existingGroups
    const models = parseModels(modelsText)
    const applied = applyProviderPreset({
      ...provider,
      baseUrl: baseUrl.trim() || selectedPreset.baseUrl,
      credentialGroups,
      models: models.length ? models : provider.models,
      enabled: credentialGroups.some((group) => group.enabled) ? provider.enabled : false,
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
    setTask('idle')
    if (showNotice) setNotice(pastedGroups.length ? `已保存 ${credentialGroups.length} 个令牌分组。` : '已保存配置。')
  }

  async function acceptDetection() {
    setPresetId(detection.presetId)
    const preset = getProviderPreset(detection.presetId)
    if (!baseUrl.trim() && preset.baseUrl) setBaseUrl(preset.baseUrl)
    setNotice(`已选择 ${preset.name}。`)
  }

  async function probeDetection() {
    setTask('probing')
    const result = await probeProviderPreset({ baseUrl, name: provider.name, apiKey: credentialText.split(/[\n,，]+/).map((item) => item.trim()).find(Boolean) })
    setPresetId(result.presetId)
    const preset = getProviderPreset(result.presetId)
    if (!baseUrl.trim() && preset.baseUrl) setBaseUrl(preset.baseUrl)
    setTask('idle')
    setNotice(result.reason)
  }

  async function syncModels() {
    setTask('syncing')
    await save(false)
    const keyed = await hydrateProviderKey(provider.id)
    if (!keyed) {
      setTask('idle')
      setNotice('服务商不存在。')
      return
    }
    const result = await syncProviderCredentialGroupsDetailed(keyed)
    if (result.data) {
      await updateProvider(provider.id, result.data)
      setModelsText(result.data.models.join('\n'))
    }
    setTask('idle')
    setNotice(result.ok ? '令牌分组已低速同步，模型列表已合并。' : result.message)
  }

  async function verifyModel() {
    setTask('testing')
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
            <MiniAction active={isDefault} label={isDefault ? '默认' : '设默认'} onPress={() => updateSettings({ defaultProvider: provider.id, onboardingCompleted: true })}>
              <Star color={isDefault ? colors.warning : colors.textTertiary} size={15} fill={isDefault ? colors.warning : 'transparent'} />
            </MiniAction>
            <MiniAction active={provider.enabled} label={provider.enabled ? '已启用' : '已停用'} onPress={() => void updateProvider(provider.id, { enabled: !provider.enabled })}>
              <Power color={provider.enabled ? colors.success : colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label="接受识别" onPress={() => void acceptDetection()}>
              <SearchCheck color={colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={task === 'probing' ? '探测中' : '网络探测'} onPress={() => void probeDetection()} disabled={isBusy || !baseUrl.trim() || !credentialText.trim()}>
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

          <IslandField
            label="令牌分组"
            note={hydratedGroups.length ? hydratedGroups.map((group) => `${group.label} ${maskSecret(group.apiKey ?? '')} · ${group.availableModels?.length ?? 0} 模型`).join('\n') : '每行一个 Key；保存后只存入 SecureStore，JSON 导出不会包含。'}
            inputProps={{
              value: credentialText,
              onChangeText: (value) => {
                setCredentialText(value)
                setNotice('')
              },
              secureTextEntry: true,
              autoCapitalize: 'none',
              autoCorrect: false,
              multiline: true,
              placeholder: 'sk-...\nsk-...\nsk-...',
              style: { minHeight: 92, maxHeight: 150 },
            }}
          />

          <IslandField
            label="模型列表"
            inputProps={{
              value: modelsText,
              onChangeText: setModelsText,
              autoCapitalize: 'none',
              autoCorrect: false,
              multiline: true,
              placeholder: getProviderModels(provider.type).map((model) => model.id).join('\n') || '每行一个模型 ID',
              style: { minHeight: 92, maxHeight: 164, paddingVertical: 12, lineHeight: 20 },
            }}
          />

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

function mergeGroups(existing: ProviderCredentialGroup[], incoming: ProviderCredentialGroup[]): ProviderCredentialGroup[] {
  return [...existing, ...incoming].map((group, index) => ({
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

function MiniAction({ label, children, active = false, disabled = false, onPress }: { label: string; children: React.ReactNode; active?: boolean; disabled?: boolean; onPress: () => void }) {
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
