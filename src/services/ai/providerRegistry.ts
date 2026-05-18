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
