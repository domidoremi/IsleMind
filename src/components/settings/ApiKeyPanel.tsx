import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Check, ChevronDown, KeyRound, Link2Off, ListFilter, Power, RotateCw, Sparkles, Star } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { AIProvider, ProviderCredentialMode, ProviderRegion, ProviderWireProtocol } from '@/types'
import { detectProviderCredentialMode, getModelConfig, getModelName, getProviderConfigIssue, getProviderEffectiveBaseUrl, getProviderModels, getXiaomiMimoOfficialBaseUrl } from '@/types'
import { fetchProviderModelConfigsDetailed, testProviderModelDetailed } from '@/services/ai/base'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandChip } from '@/components/ui/IslandChip'
import { IslandField } from '@/components/ui/IslandPrimitives'

interface ApiKeyPanelProps {
  provider: AIProvider
}

type PanelTask = 'idle' | 'saving' | 'testing-key' | 'fetching-models' | 'testing-model'

export function ApiKeyPanel({ provider }: ApiKeyPanelProps) {
  const { colors } = useAppTheme()
  const getKey = useSettingsStore((state) => state.getSecureApiKey)
  const setKey = useSettingsStore((state) => state.setProviderApiKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const defaultProvider = useSettingsStore((state) => state.settings.defaultProvider)
  const [expanded, setExpanded] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [credentialMode, setCredentialMode] = useState<ProviderCredentialMode>(provider.credentialMode ?? 'token-plan')
  const [tokenPlanRegion, setTokenPlanRegion] = useState<ProviderRegion>(provider.tokenPlanRegion ?? 'cn')
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(provider.wireProtocol ?? 'openai-compatible')
  const [modelsText, setModelsText] = useState(provider.models.join('\n'))
  const [task, setTask] = useState<PanelTask>('idle')
  const [notice, setNotice] = useState('')

  const draftProvider: AIProvider = {
    ...provider,
    baseUrl: resolveDraftBaseUrl(baseUrl, credentialMode, tokenPlanRegion, wireProtocol),
    credentialMode,
    tokenPlanRegion,
    wireProtocol,
    models: parseModels(modelsText).length ? parseModels(modelsText) : provider.models,
  }
  const primaryModel = provider.models[0] ?? getProviderModels(provider.type)[0]?.id ?? '未设置模型'
  const primaryModelConfig = getModelConfig(primaryModel, provider.type, provider.modelConfigs)
  const hasKey = !!apiKey.trim()
  const isDefault = defaultProvider === provider.id
  const isBusy = task !== 'idle'
  const providerKind = provider.type === 'xiaomi-mimo' ? 'MiMo' : provider.type === 'openai-compatible' ? '兼容接口' : provider.type
  const keyMode = detectProviderCredentialMode(apiKey)
  const configIssue = getProviderConfigIssue(draftProvider, apiKey)
  const noticeIsError = provider.lastTestStatus === 'bad' || !!configIssue
  const effectiveBaseUrl = getProviderEffectiveBaseUrl(draftProvider)
  const syncedLabel = useMemo(() => {
    if (!provider.lastModelSyncAt) return '未同步'
    const minutes = Math.max(1, Math.round((Date.now() - provider.lastModelSyncAt) / 60000))
    return minutes < 60 ? `${minutes} 分钟前同步` : `${Math.round(minutes / 60)} 小时前同步`
  }, [provider.lastModelSyncAt])
  const lastStatusLabel = provider.lastTestStatus === 'ok' ? '模型可用' : provider.lastTestStatus === 'bad' ? '需检查' : provider.lastModelSyncStatus === 'ok' ? '已同步' : provider.lastModelSyncStatus === 'bad' ? '同步失败' : '待验证'

  useEffect(() => {
    let mounted = true
    setBaseUrl(provider.baseUrl ?? '')
    setCredentialMode(provider.credentialMode ?? 'token-plan')
    setTokenPlanRegion(provider.tokenPlanRegion ?? 'cn')
    setWireProtocol(provider.wireProtocol ?? 'openai-compatible')
    setModelsText(provider.models.join('\n'))
    setNotice('')
    void getKey(provider.id).then((key) => {
      if (mounted) setApiKey(key ?? '')
    })
    return () => {
      mounted = false
    }
  }, [getKey, provider.baseUrl, provider.credentialMode, provider.id, provider.models, provider.tokenPlanRegion, provider.wireProtocol])

  async function save(showNotice = true) {
    const models = parseModels(modelsText)
    setTask('saving')
    await setKey(provider.id, apiKey.trim())
    await updateProvider(provider.id, {
      baseUrl: resolveDraftBaseUrl(baseUrl, credentialMode, tokenPlanRegion, wireProtocol),
      credentialMode,
      tokenPlanRegion,
      wireProtocol,
      models: models.length ? models : provider.models,
      enabled: apiKey.trim() ? provider.enabled : false,
      lastTestStatus: 'idle',
      lastTestModel: undefined,
      lastTestMessage: undefined,
      lastTestCode: undefined,
    })
    if (apiKey.trim()) {
      updateSettings({ onboardingCompleted: true })
    }
    setTask('idle')
    if (showNotice) {
      setNotice('已保存配置。')
    }
  }

  function resolveDraftBaseUrl(
    value: string,
    mode: ProviderCredentialMode,
    region: ProviderRegion,
    protocol: ProviderWireProtocol
  ): string | undefined {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (provider.type !== 'xiaomi-mimo') return trimmed
    if (trimmed === 'https://api.xiaomimimo.com/v1') {
      return getXiaomiMimoOfficialBaseUrl(mode, region, protocol)
    }
    return trimmed
  }

  async function verifyKey() {
    setTask('testing-key')
    await save(false)
    const models = parseModels(modelsText)
    const issue = getProviderConfigIssue(draftProvider, apiKey.trim())
    if (issue) {
      await updateProvider(provider.id, { lastTestStatus: 'bad', lastTestedAt: Date.now(), lastTestModel: models[0] ?? primaryModel, lastTestMessage: issue.message, lastTestCode: 'credential_mismatch' })
      setNotice(issue.message)
      setTask('idle')
      return
    }
    const result = await testProviderModelDetailed({ ...draftProvider, models: models.length ? models : provider.models }, models[0] ?? primaryModel, apiKey.trim())
    await updateProvider(provider.id, { lastTestStatus: result.ok ? 'ok' : 'bad', lastTestedAt: Date.now(), lastTestModel: models[0] ?? primaryModel, lastTestMessage: result.message, lastTestCode: result.code })
    setNotice(result.ok ? '密钥可用，当前首选模型响应正常。' : result.message)
    setTask('idle')
  }

  async function syncModels() {
    setTask('fetching-models')
    await save(false)
    const issue = getProviderConfigIssue(draftProvider, apiKey.trim())
    if (issue) {
      await updateProvider(provider.id, { lastModelSyncStatus: 'bad', lastModelSyncMessage: issue.message, lastModelSyncCode: 'credential_mismatch' })
      setNotice(issue.message)
      setTask('idle')
      return
    }
    const result = await fetchProviderModelConfigsDetailed(draftProvider, apiKey.trim())
    const modelConfigs = result.data ?? []
    const models = modelConfigs.map((model) => model.id)
    if (modelConfigs.length) {
      setModelsText(models.join('\n'))
      await updateProvider(provider.id, { models, modelConfigs, lastModelSyncAt: Date.now(), lastModelSyncStatus: 'ok', lastModelSyncMessage: result.message, lastModelSyncCode: result.code, lastTestStatus: 'idle', lastTestModel: undefined })
      setNotice(`已获取 ${modelConfigs.length} 个模型，首选模型为 ${modelConfigs[0]?.name ?? models[0]}。`)
    } else {
      await updateProvider(provider.id, { lastModelSyncStatus: result.ok ? 'ok' : 'bad', lastModelSyncMessage: result.message, lastModelSyncCode: result.code, lastTestStatus: result.ok ? 'idle' : 'bad', lastTestModel: result.ok ? undefined : provider.lastTestModel })
      setNotice(result.message || '没有获取到模型列表，已保留手动配置。')
    }
    setTask('idle')
  }

  async function verifyModel() {
    const model = parseModels(modelsText)[0] ?? primaryModel
    setTask('testing-model')
    await save(false)
    const issue = getProviderConfigIssue(draftProvider, apiKey.trim())
    if (issue) {
      await updateProvider(provider.id, { lastTestStatus: 'bad', lastTestedAt: Date.now(), lastTestModel: model, lastTestMessage: issue.message, lastTestCode: 'credential_mismatch' })
      setNotice(issue.message)
      setTask('idle')
      return
    }
    const result = await testProviderModelDetailed(draftProvider, model, apiKey.trim())
    await updateProvider(provider.id, { lastTestStatus: result.ok ? 'ok' : 'bad', lastTestedAt: Date.now(), lastTestModel: model, lastTestMessage: result.message, lastTestCode: result.code })
    setNotice(result.ok ? `${model} 可用。` : result.message)
    setTask('idle')
  }

  return (
    <MotiView
      animate={{
        scale: expanded ? 1 : 0.995,
        opacity: provider.enabled ? 1 : 0.78,
      }}
      transition={{ type: 'spring', damping: 22, stiffness: 180 }}
      style={{
        borderRadius: 28,
        padding: 14,
        backgroundColor: colors.material.paper,
        borderWidth: 1,
        borderColor: expanded ? colors.borderStrong : colors.border,
        marginBottom: 12,
        shadowColor: colors.shadowTint,
        shadowOpacity: expanded ? 0.14 : 0.08,
        shadowRadius: expanded ? 18 : 12,
        shadowOffset: { width: 0, height: expanded ? 10 : 6 },
        elevation: expanded ? 4 : 2,
      }}
    >
      <PressableScale
        haptic
        onPress={() => setExpanded((value) => !value)}
        accessibilityLabel={`${expanded ? '折叠' : '展开'} ${provider.name} 设置`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>
          {provider.type === 'xiaomi-mimo' ? <Sparkles color={colors.text} size={18} strokeWidth={1.8} /> : <KeyRound color={colors.text} size={18} strokeWidth={1.8} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{provider.name}</Text>
            {isDefault ? <Badge label="默认" tone="warning" /> : null}
            <Badge label={provider.enabled ? '启用' : '停用'} tone={provider.enabled ? 'success' : 'muted'} />
            <Badge label={hasKey ? 'Key 已存' : '缺 Key'} tone={hasKey ? 'success' : 'muted'} />
            {provider.type === 'xiaomi-mimo' ? <Badge label={credentialMode === 'token-plan' ? 'Token Plan' : '按量付费'} tone={configIssue ? 'danger' : 'muted'} /> : null}
            {provider.type === 'xiaomi-mimo' ? <Badge label={wireProtocol === 'anthropic-compatible' ? 'Anthropic 协议' : 'OpenAI 协议'} tone={configIssue ? 'danger' : 'muted'} /> : null}
            <Badge label={lastStatusLabel} tone={provider.lastTestStatus === 'ok' || provider.lastModelSyncStatus === 'ok' ? 'success' : provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad' ? 'danger' : 'muted'} />
          </View>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>
            {getModelName(primaryModel)} · {provider.models.length} 个模型 · {providerKind}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
            上下文 {formatTokenLimit(primaryModelConfig.contextWindow)} · 默认输出 {formatTokenLimit(primaryModelConfig.defaultMaxTokens)} · 上限 {formatTokenLimit(primaryModelConfig.maxOutputTokens)}
          </Text>
          {provider.type === 'xiaomi-mimo' ? (
            <Text numberOfLines={1} style={{ color: configIssue ? colors.error : colors.textTertiary, fontSize: 11, marginTop: 2 }}>
              {keyMode ? `检测到 ${keyMode === 'token-plan' ? 'tp- Token Plan' : 'sk- 按量付费'} Key` : 'MiMo Key: tp- 为 Token Plan，sk- 为按量付费'}
            </Text>
          ) : null}
        </View>
        {provider.lastTestStatus === 'ok' ? <Check color={colors.success} size={18} /> : null}
        {provider.lastTestStatus === 'bad' ? <RotateCw color={colors.error} size={18} /> : null}
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 180 }}>
          <ChevronDown color={colors.textTertiary} size={19} />
        </MotiView>
      </PressableScale>

      {expanded ? (
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180 }}
          style={{ marginTop: 14 }}
        >
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <MiniAction active={isDefault} label={isDefault ? '默认服务商' : '设为默认'} onPress={() => updateSettings({ defaultProvider: provider.id, onboardingCompleted: true })}>
              <Star color={isDefault ? colors.warning : colors.textTertiary} size={15} fill={isDefault ? colors.warning : 'transparent'} />
            </MiniAction>
            <MiniAction active={provider.enabled} label={provider.enabled ? '已启用' : '已停用'} onPress={() => {
              void updateProvider(provider.id, { enabled: !provider.enabled })
              if (!provider.enabled) updateSettings({ onboardingCompleted: true })
            }}>
              <Power color={provider.enabled ? colors.success : colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label={syncedLabel} onPress={() => void syncModels()} disabled={!hasKey || isBusy}>
              <ListFilter color={colors.textTertiary} size={15} />
            </MiniAction>
            <MiniAction label="使用官方地址" onPress={() => {
              setBaseUrl('')
              setNotice('已切回官方默认地址，保存后生效。')
            }} disabled={isBusy}>
              <Link2Off color={colors.textTertiary} size={15} />
            </MiniAction>
          </View>
          {provider.lastModelSyncMessage || provider.lastTestMessage ? (
            <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.islandRaised, marginBottom: 2 }}>
              {provider.lastModelSyncMessage ? (
                <Text style={{ color: provider.lastModelSyncStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 11, lineHeight: 16 }}>
                  模型同步：{provider.lastModelSyncMessage}
                </Text>
              ) : null}
              {provider.lastTestMessage ? (
                <Text style={{ color: provider.lastTestStatus === 'bad' ? colors.error : colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: provider.lastModelSyncMessage ? 3 : 0 }}>
                  模型测试：{provider.lastTestMessage}
                </Text>
              ) : null}
            </View>
          ) : null}

          <IslandField
            label="API Key"
            inputProps={{
              value: apiKey,
              onChangeText: (value) => {
                setApiKey(value)
                setNotice('')
              },
              secureTextEntry: true,
              autoCapitalize: 'none',
              autoCorrect: false,
              placeholder: '粘贴 API Key',
            }}
          />

          {provider.type === 'xiaomi-mimo' ? (
            <>
              <FieldLabel label="MiMo 调用方式" />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <ChoiceButton
                  active={credentialMode === 'payg'}
                  label="按量付费 sk-"
                  onPress={() => {
                    setCredentialMode('payg')
                    setNotice('')
                  }}
                />
                <ChoiceButton
                  active={credentialMode === 'token-plan'}
                  label="Token Plan tp-"
                  onPress={() => {
                    setCredentialMode('token-plan')
                    setNotice('')
                  }}
                />
              </View>
              <FieldLabel label="MiMo 兼容协议" />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <ChoiceButton
                  active={wireProtocol === 'openai-compatible'}
                  label="OpenAI 兼容"
                  onPress={() => {
                    setWireProtocol('openai-compatible')
                    setNotice('')
                  }}
                />
                <ChoiceButton
                  active={wireProtocol === 'anthropic-compatible'}
                  label="Anthropic 兼容"
                  onPress={() => {
                    setWireProtocol('anthropic-compatible')
                    setNotice('')
                  }}
                />
              </View>
              {credentialMode === 'token-plan' ? (
                <>
                  <FieldLabel label="Token Plan 区域" />
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <ChoiceButton active={tokenPlanRegion === 'cn'} label="中国" onPress={() => setTokenPlanRegion('cn')} />
                    <ChoiceButton active={tokenPlanRegion === 'sgp'} label="新加坡" onPress={() => setTokenPlanRegion('sgp')} />
                    <ChoiceButton active={tokenPlanRegion === 'ams'} label="欧洲" onPress={() => setTokenPlanRegion('ams')} />
                  </View>
                </>
              ) : null}
              <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.islandRaised, marginTop: 10 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16 }}>
                  官方默认地址：{getXiaomiMimoOfficialBaseUrl(credentialMode, tokenPlanRegion, wireProtocol)}
                </Text>
                <Text style={{ color: configIssue ? colors.error : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
                  {configIssue?.message ?? `当前实际地址：${effectiveBaseUrl}`}
                </Text>
              </View>
            </>
          ) : null}

          <IslandField
            label="Base URL"
            inputProps={{
              value: baseUrl,
              onChangeText: (value) => {
                setBaseUrl(value)
                setNotice('')
              },
              autoCapitalize: 'none',
              autoCorrect: false,
              placeholder: provider.type === 'xiaomi-mimo' ? 'https://api.xiaomimimo.com/v1' : '留空使用官方接口',
            }}
          />
          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
            {provider.type === 'xiaomi-mimo'
              ? 'MiMo 留空会按上方计费模式/兼容协议使用官方地址；只有代理或官方控制台显示了专属地址时才覆盖。'
              : provider.type === 'google'
                ? 'Gemini 留空时使用官方 Generative Language API。'
                : '代理地址请填写到版本路径，例如 /v1；请求会自动拼接对应接口。'}
          </Text>

          <IslandField
            label="模型列表"
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
              style: { minHeight: 92, maxHeight: 164, paddingVertical: 12, lineHeight: 20 },
            }}
          />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <ActionButton label={task === 'saving' ? '保存中' : '保存'} busy={task === 'saving'} onPress={() => void save()} />
            <ActionButton label="测试密钥" busy={task === 'testing-key'} disabled={!hasKey || isBusy} onPress={() => void verifyKey()} secondary />
            <ActionButton label="获取模型" busy={task === 'fetching-models'} disabled={!hasKey || isBusy} onPress={() => void syncModels()} secondary />
            <ActionButton label="测试模型" busy={task === 'testing-model'} disabled={!hasKey || isBusy} onPress={() => void verifyModel()} secondary />
          </View>

          {notice ? (
            <Text style={{ color: noticeIsError ? colors.error : colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 10 }}>
              {notice}
            </Text>
          ) : null}
        </MotiView>
      ) : null}
    </MotiView>
  )
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

function FieldLabel({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginTop: 12, marginBottom: 6 }}>{label}</Text>
}

function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  return (
    <IslandChip tone={tone === 'warning' ? 'amber' : tone === 'danger' ? 'danger' : tone === 'success' ? 'mint' : 'default'}>
      {label}
    </IslandChip>
  )
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      style={{
        minHeight: 36,
        borderRadius: 18,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? colors.text : colors.islandRaised,
      }}
    >
      <Text style={{ color: active ? colors.surface : colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </PressableScale>
  )
}

function formatTokenLimit(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function MiniAction({ label, children, active = false, disabled = false, onPress }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 34,
        borderRadius: 17,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: active ? colors.amberSoft : colors.islandRaised,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
      <Text style={{ color: active ? colors.text : colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </PressableScale>
  )
}

function ActionButton({ label, busy = false, secondary = false, disabled = false, onPress }: { label: string; busy?: boolean; secondary?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: secondary ? colors.islandRaised : colors.text,
        opacity: disabled ? 0.5 : 1,
        flexGrow: 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={secondary ? colors.text : colors.surface} /> : <Text style={{ color: secondary ? colors.text : colors.surface, fontSize: 14, fontWeight: '800' }}>{label}</Text>}
    </PressableScale>
  )
}
