import type { AIProvider, ProviderCapabilities, ProviderPresetId, ProviderType } from '@/types'
import { getDefaultProviderModelIds } from '@/types'

export interface ProviderPreset {
  id: ProviderPresetId
  name: string
  type: ProviderType
  baseUrl?: string
  aliases: string[]
  hostPatterns: RegExp[]
  capabilities: ProviderCapabilities
  defaultModels: string[]
}

export interface ProviderDetectionInput {
  baseUrl?: string
  apiKey?: string
  name?: string
}

export interface ProviderDetectionResult {
  presetId: ProviderPresetId
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export interface ProviderProbeResult extends ProviderDetectionResult {
  ok: boolean
  endpoint?: string
  status?: number
}

export interface ProviderImportResult {
  providers: AIProvider[]
  warnings: string[]
}

interface ProviderProbeDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  streaming: true,
  modelList: true,
  vision: false,
  files: false,
  audioInput: false,
  audioTranscription: false,
  speech: false,
  nativeSearch: false,
  reasoningEffort: false,
  topP: true,
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  preset('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', ['openai'], [/api\.openai\.com/i], {
    vision: true,
    files: true,
    audioTranscription: true,
    speech: true,
    nativeSearch: true,
    reasoningEffort: true,
  }),
  preset('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com/v1', ['anthropic', 'claude'], [/api\.anthropic\.com/i], {
    vision: true,
    files: true,
    nativeSearch: true,
    reasoningEffort: true,
  }),
  preset('google', 'Google Gemini', 'google', 'https://generativelanguage.googleapis.com/v1beta', ['google', 'gemini'], [/generativelanguage\.googleapis\.com/i], {
    vision: true,
    files: true,
    audioInput: true,
    nativeSearch: true,
  }),
  preset('deepseek', 'DeepSeek', 'openai-compatible', 'https://api.deepseek.com', ['deepseek'], [/api\.deepseek\.com/i], {
    reasoningEffort: true,
  }, ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']),
  preset('dashscope', '阿里云百炼', 'openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1', ['dashscope', 'qwen', 'aliyun', '阿里', '百炼'], [/dashscope\.aliyuncs\.com/i], {
    vision: true,
    files: true,
    audioInput: true,
    audioTranscription: true,
    speech: true,
  }, ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-plus']),
  preset('bigmodel', '智谱 AI', 'openai-compatible', 'https://open.bigmodel.cn/api/paas/v4', ['bigmodel', 'zhipu', 'glm', '智谱'], [/bigmodel\.cn/i], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }, ['glm-4.6', 'glm-4.5', 'glm-4-plus', 'glm-4-air']),
  preset('xai', 'xAI', 'openai-compatible', 'https://api.x.ai/v1', ['xai', 'grok'], [/api\.x\.ai/i], {
    vision: true,
    reasoningEffort: true,
  }, ['grok-4', 'grok-3', 'grok-3-mini']),
  preset('xiaomi-mimo', 'Xiaomi MiMo', 'xiaomi-mimo', undefined, ['mimo', 'xiaomi', '小米'], [/xiaomimimo\.com/i], {
    vision: true,
    reasoningEffort: true,
  }),
  preset('openrouter', 'OpenRouter', 'openai-compatible', 'https://openrouter.ai/api/v1', ['openrouter'], [/openrouter\.ai/i], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }, ['openai/gpt-5.5', 'openai/gpt-5.4', 'google/gemini-3-pro-preview', 'anthropic/claude-sonnet-4.5']),
  preset('newapi', 'NewAPI / OneAPI', 'openai-compatible', undefined, ['newapi', 'new-api', 'oneapi', 'one-api'], [/(^|\.)new-api\./i, /newapi/i, /oneapi/i], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }),
  preset('sub2api', 'Sub2API', 'openai-compatible', undefined, ['sub2api'], [/sub2api/i], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }),
  preset('custom-anthropic-compatible', 'Anthropic Compatible', 'anthropic', undefined, ['anthropic-compatible'], [], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }),
  preset('custom-openai-compatible', 'OpenAI Compatible', 'openai-compatible', undefined, ['compatible', 'custom'], [], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }),
]

export function getProviderPreset(id: ProviderPresetId | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((item) => item.id === id) ?? PROVIDER_PRESETS.find((item) => item.id === 'custom-openai-compatible')!
}

export function detectProviderPreset(input: ProviderDetectionInput): ProviderDetectionResult {
  const baseUrl = input.baseUrl?.trim() ?? ''
  const normalizedName = input.name?.toLowerCase() ?? ''
  const host = getHost(baseUrl)
  for (const item of PROVIDER_PRESETS) {
    if (item.hostPatterns.some((pattern) => pattern.test(host) || pattern.test(baseUrl))) {
      return { presetId: item.id, confidence: 'high', reason: `识别到 ${host || baseUrl}` }
    }
  }
  for (const item of PROVIDER_PRESETS) {
    if (item.aliases.some((alias) => normalizedName.includes(alias))) {
      return { presetId: item.id, confidence: 'medium', reason: `名称包含 ${item.name}` }
    }
  }
  if (/^sk-[\w-]+/i.test(input.apiKey ?? '')) {
    return { presetId: 'custom-openai-compatible', confidence: 'low', reason: 'sk- Key 通常兼容 OpenAI 协议' }
  }
  return { presetId: 'custom-openai-compatible', confidence: 'low', reason: '未知站点默认按 OpenAI-compatible 处理' }
}

export async function probeProviderPreset(input: ProviderDetectionInput, deps: ProviderProbeDeps = {}): Promise<ProviderProbeResult> {
  const heuristic = detectProviderPreset(input)
  const baseUrl = input.baseUrl?.trim()
  const apiKey = input.apiKey?.trim()
  if (!baseUrl || !apiKey) {
    return { ...heuristic, ok: false, reason: `${heuristic.reason}；缺少站点或 Key，未发起网络探测。` }
  }
  const fetcher = deps.fetch ?? fetch
  const timeoutMs = deps.timeoutMs ?? 6000
  const candidates: Array<{ presetId: ProviderPresetId; endpoint: string; headers: Record<string, string> }> = [
    {
      presetId: 'custom-openai-compatible',
      endpoint: `${normalizeProbeBaseUrl(baseUrl)}/models`,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    {
      presetId: 'custom-anthropic-compatible',
      endpoint: `${normalizeProbeBaseUrl(baseUrl)}/models`,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    },
    {
      presetId: 'google',
      endpoint: `${normalizeProbeBaseUrl(baseUrl)}/models?key=${encodeURIComponent(apiKey)}`,
      headers: {},
    },
  ]

  for (const candidate of candidates) {
    const result = await probeModelsEndpoint(fetcher, candidate.endpoint, candidate.headers, timeoutMs)
    if (result.ok) {
      const matched = mapProbePreset(candidate.presetId, baseUrl)
      return {
        presetId: matched,
        confidence: candidate.presetId === 'custom-openai-compatible' && heuristic.confidence === 'high' ? 'high' : 'medium',
        reason: `网络探测成功：${getProviderPreset(matched).name} /models 可访问。`,
        ok: true,
        endpoint: candidate.endpoint,
        status: result.status,
      }
    }
  }

  return { ...heuristic, ok: false, reason: `${heuristic.reason}；网络探测未命中，仍可手动选择协议。` }
}

export function applyProviderPreset<T extends Partial<AIProvider>>(provider: T, presetId: ProviderPresetId): T & Pick<AIProvider, 'type' | 'name' | 'models'> {
  const target = getProviderPreset(presetId)
  const currentModels = Array.isArray(provider.models) && provider.models.length ? provider.models : target.defaultModels
  return {
    ...provider,
    presetId,
    detectedPresetId: provider.detectedPresetId ?? presetId,
    detectionStatus: provider.detectionStatus ?? 'detected',
    type: target.type,
    name: provider.name?.trim() || target.name,
    baseUrl: provider.baseUrl ?? target.baseUrl,
    capabilities: { ...target.capabilities, ...provider.capabilities },
    syncPolicy: provider.syncPolicy ?? defaultProviderSyncPolicy(),
    models: currentModels,
  }
}

export function parseCredentialGroups(input: string): NonNullable<AIProvider['credentialGroups']> {
  const seen = new Set<string>()
  return input
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
    .map((apiKey, index) => ({
      id: `group-${Date.now().toString(36)}-${index + 1}-${hashKey(apiKey)}`,
      label: `令牌分组 ${index + 1}`,
      apiKey,
      enabled: true,
    }))
}

export function parseProviderImportText(input: string): ProviderImportResult {
  const warnings: string[] = []
  const chunks = splitProviderImportChunks(input)
  const providers = chunks
    .map((chunk, index) => parseProviderImportChunk(chunk, index, warnings))
    .filter((provider): provider is AIProvider => !!provider)
  return { providers: dedupeImportedProviders(providers, warnings), warnings }
}

export function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}...`
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

export function defaultProviderSyncPolicy() {
  return {
    minDelayMs: 1200,
    maxDelayMs: 1800,
    timeoutMs: 18000,
    strategy: 'sequential-low-rate' as const,
  }
}

function preset(
  id: ProviderPresetId,
  name: string,
  type: ProviderType,
  baseUrl: string | undefined,
  aliases: string[],
  hostPatterns: RegExp[],
  capabilities: Partial<ProviderCapabilities>,
  defaultModels = getDefaultProviderModelIds(type)
): ProviderPreset {
  return {
    id,
    name,
    type,
    baseUrl,
    aliases,
    hostPatterns,
    defaultModels,
    capabilities: { ...DEFAULT_PROVIDER_CAPABILITIES, ...capabilities },
  }
}

function getHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return value.replace(/^https?:\/\//i, '').split('/')[0] ?? ''
  }
}

function normalizeProbeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function mapProbePreset(presetId: ProviderPresetId, baseUrl: string): ProviderPresetId {
  const hostMatch = PROVIDER_PRESETS.find((item) => item.hostPatterns.some((pattern) => pattern.test(baseUrl)))
  if (hostMatch && hostMatch.type === getProviderPreset(presetId).type) return hostMatch.id
  return presetId
}

async function probeModelsEndpoint(
  fetcher: typeof fetch,
  endpoint: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, status: response.status }
    const data = await response.json().catch(() => null)
    return { ok: Array.isArray((data as { data?: unknown[] } | null)?.data) || Array.isArray((data as { models?: unknown[] } | null)?.models), status: response.status }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

function hashKey(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function splitProviderImportChunks(input: string): string[] {
  return input
    .split(/(?:\r?\n\s*\r?\n|;|；)+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseProviderImportChunk(chunk: string, index: number, warnings: string[]): AIProvider | null {
  const fields = readImportFields(chunk)
  const name = pickField(fields, ['provider', 'name', '供应商', '服务商', '名称']) ?? inferProviderName(chunk, index)
  const baseUrl = pickField(fields, ['baseurl', 'base url', 'url', 'endpoint', '站点', '地址', '接口'])
  const modelsText = pickField(fields, ['models', 'model', '模型', '模型列表'])
  const keysText = [
    ...pickFields(fields, ['apikey', 'api key', 'key', 'keys', 'token', 'tokens', '秘钥', '密钥', '令牌']),
    ...extractLooseKeys(chunk),
  ].join('\n')
  const presetId = detectProviderPreset({ baseUrl, name, apiKey: keysText }).presetId
  const preset = getProviderPreset(presetId)
  const models = parseModelList(modelsText).length ? parseModelList(modelsText) : preset.defaultModels
  const credentialGroups = parseCredentialGroups(keysText)

  if (!name && !baseUrl && !credentialGroups.length) {
    warnings.push(`第 ${index + 1} 段没有可识别的供应商信息。`)
    return null
  }

  const provider = applyProviderPreset({
    id: importProviderId(name || preset.name, index),
    presetId,
    detectedPresetId: presetId,
    detectionStatus: 'detected',
    type: preset.type,
    name: name || preset.name,
    baseUrl: baseUrl?.trim() || preset.baseUrl,
    apiKey: '',
    credentialGroups,
    models,
    enabled: false,
  } satisfies AIProvider, presetId)

  if (!credentialGroups.length) warnings.push(`${provider.name} 未识别到令牌。`)
  return provider
}

function readImportFields(chunk: string): Map<string, string[]> {
  const fields = new Map<string, string[]>()
  const normalized = chunk.replace(/[，]/g, ',')
  const pattern = /(?:^|[,;\n\r])\s*([^:：=,\n\r]{1,28})\s*[:：=]\s*([^,;\n\r]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(normalized))) {
    const key = normalizeImportFieldKey(match[1])
    const value = match[2]?.trim()
    if (!key || !value) continue
    const current = fields.get(key) ?? []
    current.push(value)
    fields.set(key, current)
  }
  const csvParts = normalized.split(',').map((part) => part.trim()).filter(Boolean)
  const url = csvParts.find((part) => /^https?:\/\//i.test(part))
  if (url && !fields.has('baseurl')) fields.set('baseurl', [url])
  const looseKeys = csvParts.filter((part) => looksLikeApiKey(part))
  if (looseKeys.length && !fields.has('key')) fields.set('key', looseKeys)
  if (!fields.size && csvParts.length >= 2) {
    fields.set('provider', [csvParts[0]])
  }
  return fields
}

function pickField(fields: Map<string, string[]>, keys: string[]): string | undefined {
  return pickFields(fields, keys)[0]
}

function pickFields(fields: Map<string, string[]>, keys: string[]): string[] {
  const normalized = keys.map(normalizeImportFieldKey)
  return normalized.flatMap((key) => fields.get(key) ?? []).filter(Boolean)
}

function normalizeImportFieldKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '').trim()
}

function inferProviderName(chunk: string, index: number): string {
  const first = chunk.split(/[,，\n\r]/)[0]?.trim()
  const prefix = first?.split(/[:：=]/)[0]?.trim()
  if (prefix && !looksLikeApiKey(prefix) && !/^https?:\/\//i.test(prefix)) return prefix
  return `导入供应商 ${index + 1}`
}

function extractLooseKeys(chunk: string): string[] {
  const matches = chunk.match(/(?:sk|ak|rk|pk|key|token)-[A-Za-z0-9._:-]+|[A-Za-z0-9_-]{24,}/g) ?? []
  return matches.filter(looksLikeApiKey)
}

function looksLikeApiKey(value: string): boolean {
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) return false
  return /^(sk|ak|rk|pk|key|token)-/i.test(trimmed) || /^[A-Za-z0-9_-]{24,}$/.test(trimmed)
}

function parseModelList(value: string | undefined): string[] {
  const seen = new Set<string>()
  return (value ?? '')
    .split(/[\n,，|/]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function importProviderId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || `provider-${index + 1}`
  return `import-${Date.now().toString(36)}-${index + 1}-${slug}`
}

function dedupeImportedProviders(providers: AIProvider[], warnings: string[]): AIProvider[] {
  const seen = new Set<string>()
  return providers.filter((provider) => {
    const key = `${provider.name.toLowerCase()}|${provider.baseUrl ?? ''}`
    if (seen.has(key)) {
      warnings.push(`${provider.name} 重复，已跳过。`)
      return false
    }
    seen.add(key)
    return true
  })
}
