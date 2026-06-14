import type { AIProvider, ProviderCapabilities, ProviderCredentialMode, ProviderPresetId, ProviderRegion, ProviderType, ProviderWireProtocol } from '@/types'
import { getXiaomiMimoOfficialBaseUrl } from '@/types'
import { st } from '@/i18n/service'
import { inferProviderCredentialModeFromKeyOrBaseUrl, inferProviderTokenPlanRegionFromBaseUrl, inferProviderWireProtocolFromBaseUrl } from '@/services/ai/providerProtocolPolicy'
import { resolveProviderModelAliasAccess, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'

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
  duplicates: string[]
  sourceType: 'text' | 'json' | 'csv'
}

export interface ProviderImportOptions {
  accessSettings?: ProviderModelAccessInput['settings']
}

interface ProviderProbeDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

const NEWAPI_CHANNEL_CONN_TYPE = 'newapi_channel_conn'

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
  nativeTools: false,
  topP: true,
  responsesApi: false,
  responsesWebSocket: false,
  remoteCompact: false,
  payloadPolicy: true,
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  preset('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', ['openai'], [/api\.openai\.com/i], {
    vision: true,
    files: true,
    audioTranscription: true,
    speech: true,
    nativeSearch: true,
    reasoningEffort: true,
    nativeTools: true,
    responsesApi: true,
    responsesWebSocket: true,
    remoteCompact: true,
  }),
  preset('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com/v1', ['anthropic', 'claude'], [/api\.anthropic\.com/i], {
    vision: true,
    files: true,
    nativeSearch: true,
    reasoningEffort: true,
    nativeTools: true,
  }),
  preset('google', 'Google Gemini', 'google', 'https://generativelanguage.googleapis.com/v1beta', ['google', 'gemini'], [/generativelanguage\.googleapis\.com/i], {
    vision: true,
    files: true,
    audioInput: true,
    nativeSearch: true,
    reasoningEffort: true,
    nativeTools: true,
  }),
  preset('deepseek', 'DeepSeek', 'openai-compatible', 'https://api.deepseek.com', ['deepseek'], [/api\.deepseek\.com/i], {
    reasoningEffort: true,
    nativeTools: true,
  }),
  preset('dashscope', '阿里云百炼', 'openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1', ['dashscope', 'qwen', 'aliyun', '阿里', '百炼'], [/dashscope\.aliyuncs\.com/i], {
    vision: true,
    files: true,
    audioInput: true,
    audioTranscription: true,
    speech: true,
    nativeTools: true,
  }),
  preset('moonshot', 'Moonshot AI', 'openai-compatible', 'https://api.moonshot.ai/v1', ['moonshot', 'kimi', '月之暗面'], [/moonshot\.(ai|cn)/i, /platform\.kimi\.ai/i], {
    reasoningEffort: true,
    nativeTools: true,
  }),
  preset('bigmodel', '智谱 AI', 'openai-compatible', 'https://open.bigmodel.cn/api/paas/v4', ['bigmodel', 'zhipu', 'glm', '智谱'], [/bigmodel\.cn/i], {
    vision: true,
    files: true,
    reasoningEffort: true,
    nativeTools: true,
  }),
  preset('minimax', 'MiniMax', 'openai-compatible', 'https://api.minimax.io/v1', ['minimax', 'mini-max', '海螺'], [/minimax\.(io|com)/i, /minimaxi\.com/i], {
    nativeTools: true,
  }),
  preset('xai', 'xAI', 'openai-compatible', 'https://api.x.ai/v1', ['xai', 'grok'], [/api\.x\.ai/i], {
    vision: true,
    reasoningEffort: true,
    nativeTools: true,
    responsesApi: true,
  }),
  preset('xiaomi-mimo', 'Xiaomi MiMo', 'xiaomi-mimo', undefined, ['mimo', 'xiaomi', '小米'], [/xiaomimimo\.com/i], {
    vision: true,
    reasoningEffort: true,
    nativeTools: true,
  }),
  preset('openrouter', 'OpenRouter', 'openai-compatible', 'https://openrouter.ai/api/v1', ['openrouter'], [/openrouter\.ai/i], {
    vision: true,
    files: true,
    reasoningEffort: true,
  }),
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
      return { presetId: item.id, confidence: 'high', reason: st('providerRegistry.detectedHost', { value: host || baseUrl }) }
    }
  }
  for (const item of PROVIDER_PRESETS) {
    if (item.aliases.some((alias) => normalizedName.includes(alias))) {
      return { presetId: item.id, confidence: 'medium', reason: st('providerRegistry.nameContains', { name: item.name }) }
    }
  }
  if (/^sk-[\w-]+/i.test(input.apiKey ?? '')) {
    return { presetId: 'custom-openai-compatible', confidence: 'low', reason: st('providerRegistry.skCompatible') }
  }
  return { presetId: 'custom-openai-compatible', confidence: 'low', reason: st('providerRegistry.unknownCompatible') }
}

export async function probeProviderPreset(input: ProviderDetectionInput, deps: ProviderProbeDeps = {}): Promise<ProviderProbeResult> {
  const heuristic = detectProviderPreset(input)
  const baseUrl = input.baseUrl?.trim()
  const apiKey = input.apiKey?.trim()
  if (!baseUrl || !apiKey) {
    return { ...heuristic, ok: false, reason: st('providerRegistry.probeSkippedMissing', { reason: heuristic.reason }) }
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
        reason: st('providerRegistry.probeSuccess', { name: getProviderPreset(matched).name }),
        ok: true,
        endpoint: candidate.endpoint,
        status: result.status,
      }
    }
  }

  return { ...heuristic, ok: false, reason: st('providerRegistry.probeMiss', { reason: heuristic.reason }) }
}

export function applyProviderPreset<T extends Partial<AIProvider>>(provider: T, presetId: ProviderPresetId): T & Pick<AIProvider, 'type' | 'name' | 'models'> {
  const target = getProviderPreset(presetId)
  const currentModels = Array.isArray(provider.models) ? provider.models : []
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
  return extractCredentialEntries(input)
    .filter((item) => {
      const apiKey = item.apiKey.trim()
      if (!apiKey || seen.has(apiKey)) return false
      seen.add(apiKey)
      return true
    })
    .map((item, index) => {
      const apiKey = item.apiKey.trim()
      return {
        id: `group-${Date.now().toString(36)}-${index + 1}-${hashKey(apiKey)}`,
        label: item.label?.trim() || st('apiKeyPanel.groupName', { index: index + 1 }),
        apiKey,
        enabled: item.enabled ?? true,
      }
    })
}

function extractCredentialEntries(input: string): Array<{ apiKey: string; label?: string; enabled?: boolean }> {
  const trimmed = input.trim()
  if (!trimmed) return []
  const parsed = parseCredentialJson(trimmed)
  if (parsed !== null) return collectCredentialEntries(parsed)
  return splitCredentialText(trimmed).map((apiKey) => ({ apiKey }))
}

function parseCredentialJson(input: string): unknown | null {
  if (!/^[\[{"]/.test(input)) return null
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

function collectCredentialEntries(value: unknown, context: { label?: string; enabled?: boolean } = {}): Array<{ apiKey: string; label?: string; enabled?: boolean }> {
  if (typeof value === 'string') {
    return splitCredentialText(value).map((apiKey) => ({ ...context, apiKey }))
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCredentialEntries(item, context))
  }
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const label = stringField(record, ['label', 'name', 'title']) ?? context.label
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : context.enabled
  const nextContext: { label?: string; enabled?: boolean } = {}
  if (label) nextContext.label = label
  if (enabled !== undefined) nextContext.enabled = enabled
  const direct = stringField(record, ['apiKey', 'api_key', 'key', 'token', 'secret', 'accessToken', 'access_token'])
  const directEntries = direct ? splitCredentialText(direct).map((apiKey) => ({ ...nextContext, apiKey })) : []
  const nestedKeys = ['keys', 'apiKeys', 'api_keys', 'tokens', 'credentialGroups', 'credential_groups', 'groups', 'credentials']
  return [
    ...directEntries,
    ...nestedKeys.flatMap((key) => collectCredentialEntries(record[key], nextContext)),
  ]
}

function splitCredentialText(input: string): string[] {
  return input
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function parseProviderImportText(input: string, options: ProviderImportOptions = {}): ProviderImportResult {
  const warnings: string[] = []
  const duplicates: string[] = []
  const normalizedInput = normalizeProviderImportInput(input, warnings)
  const chunks = splitProviderImportChunks(normalizedInput.text).flatMap(expandProviderImportChunk)
  const providers = chunks
    .map((chunk, index) => parseProviderImportChunk(chunk, index, warnings))
    .filter((provider): provider is AIProvider => !!provider)
  const dedupedProviders = dedupeImportedProviders(providers, warnings, duplicates)
  return { providers: applyImportedProviderAccessPolicy(dedupedProviders, warnings, options.accessSettings), warnings, duplicates, sourceType: normalizedInput.sourceType }
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
): ProviderPreset {
  return {
    id,
    name,
    type,
    baseUrl,
    aliases,
    hostPatterns,
    defaultModels: [],
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

function normalizeProviderImportInput(input: string, warnings: string[]): { text: string; sourceType: ProviderImportResult['sourceType'] } {
  const trimmed = input.trim()
  if (!trimmed) return { text: '', sourceType: 'text' }
  const jsonText = tryNormalizeJsonProviderImport(trimmed, warnings)
  if (jsonText) return { text: jsonText, sourceType: 'json' }
  if (looksLikeCsvImport(trimmed)) {
    return { text: normalizeCsvProviderImport(trimmed), sourceType: 'csv' }
  }
  return { text: trimmed, sourceType: 'text' }
}

function tryNormalizeJsonProviderImport(input: string, warnings: string[]): string | null {
  if (!/^[\[{]/.test(input)) return null
  try {
    const parsed = JSON.parse(input)
    const blocks = jsonImportBlocks(parsed)
    if (!blocks.length) {
      warnings.push(st('providerRegistry.jsonNoProviders'))
      return ''
    }
    return blocks.join('\n\n')
  } catch {
    warnings.push(st('providerRegistry.jsonParseFallback'))
    return null
  }
}

function jsonImportBlocks(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(jsonImportBlocks)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const providersValue = record.providers ?? record.items ?? record.data
  if (Array.isArray(providersValue)) return providersValue.flatMap(jsonImportBlocks)
  const directBlock = jsonProviderObjectToBlock(record)
  if (directBlock) return [directBlock]
  return Object.entries(record)
    .flatMap(([name, item]) => {
      if (item && typeof item === 'object') {
        const block = jsonProviderObjectToBlock({ name, ...(item as Record<string, unknown>) })
        return block ? [block] : []
      }
      return []
    })
}

function jsonProviderObjectToBlock(record: Record<string, unknown>): string | null {
  const type = firstString(record._type, record.type)
  const isNewApiChannelConnection = type === NEWAPI_CHANNEL_CONN_TYPE
  const baseUrl = firstString(record.baseUrl, record.base_url, record.url, record.endpoint, record.apiBase, record.api_base, record['站点'], record['地址'], record['接口'])
  const name = firstString(record.provider, record.name, record.title, record.channel, record.channelName, record.channel_name, record['供应商'], record['服务商'], record['名称'])
  const models = stringArray(record.models, record.model, record['模型'], record['模型列表'])
  const keys = stringArray(record.apiKey, record.api_key, record.apiKeys, record.api_keys, record.key, record.keys, record.token, record.tokens, record['秘钥'], record['密钥'], record['令牌'])
  if (isNewApiChannelConnection && (!baseUrl || !keys.length)) return null
  if (!baseUrl && !name && !keys.length) return null
  const resolvedName = name ?? (isNewApiChannelConnection ? getProviderPreset('newapi').name : undefined)
  const parts = [
    resolvedName ? `供应商: ${resolvedName}` : '',
    baseUrl ? `Base URL: ${baseUrl}` : '',
    ...keys.map((key, index) => `Key${index + 1}: ${key}`),
    models.length ? `Models: ${models.join('|')}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function stringArray(...values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (typeof value === 'string') return value.split(/[\n,，;；|]+/)
    if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? item.split(/[\n,，;；|]+/) : [])
    return []
  }).map((item) => item.trim()).filter(Boolean)
}

function looksLikeCsvImport(input: string): boolean {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return false
  const header = lines[0].toLowerCase()
  return header.includes(',') && /(provider|name|base.?url|api.?key|keys|models|供应商|服务商|地址|密钥|秘钥|令牌|模型)/i.test(header)
}

function normalizeCsvProviderImport(input: string): string {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const headers = parseCsvLine(lines[0]).map(normalizeImportFieldKey)
  return lines.slice(1)
    .map((line) => {
      const cells = parseCsvLine(line)
      return cells
        .map((cell, index) => {
          const key = headers[index] || `field${index + 1}`
          const value = key === 'models' || key === 'model' || key === '模型' || key === '模型列表'
            ? cell.trim().replace(/[,，]+/g, '|')
            : cell.trim()
          return value ? `${key}: ${value}` : ''
        })
        .filter(Boolean)
        .join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      result.push(current)
      current = ''
      continue
    }
    current += char
  }
  result.push(current)
  return result
}

function splitProviderImportChunks(input: string): string[] {
  return input
    .split(/(?:\r?\n\s*\r?\n|;|；)+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function expandProviderImportChunk(chunk: string): string[] {
  const endpoints = extractLabeledProtocolBaseUrls(chunk)
  if (!endpoints.length) return [chunk]

  const fields = readImportFields(chunk)
  const name = pickField(fields, ['provider', 'name', '供应商', '服务商', '名称'])
  const modelsText = pickField(fields, ['models', 'model', '模型', '模型列表'])
  const keys = [
    ...pickFields(fields, ['apikey', 'api key', 'key', 'keys', 'token', 'tokens', '秘钥', '密钥', '令牌']),
    ...extractLooseKeys(chunk),
  ]
  const seenKeys = new Set<string>()
  const uniqueKeys = keys
    .map((key) => key.trim())
    .filter((key) => {
      if (!key || seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

  return endpoints.map((endpoint) => [
    name ? `Provider: ${name}` : '',
    `Base URL: ${endpoint.baseUrl}`,
    `Protocol: ${endpoint.wireProtocol}`,
    ...uniqueKeys.map((key, index) => `Key${index + 1}: ${key}`),
    modelsText ? `Models: ${modelsText}` : '',
  ].filter(Boolean).join('\n'))
}

function parseProviderImportChunk(chunk: string, index: number, warnings: string[]): AIProvider | null {
  const fields = readImportFields(chunk)
  const looseBaseUrl = extractLooseBaseUrl(chunk)
  const baseUrl = pickField(fields, ['baseurl', 'base url', 'url', 'endpoint', '站点', '地址', '接口']) ?? looseBaseUrl
  const explicitName = pickField(fields, ['provider', 'name', '供应商', '服务商', '名称'])
  const name = explicitName ?? inferProviderName(chunk, index, baseUrl)
  const wireProtocolHint = parseProviderWireProtocolText(pickField(fields, ['protocol', 'wireprotocol', 'wire protocol', '协议', '接口协议']))
    ?? inferExplicitProviderWireProtocolFromBaseUrl(baseUrl)
  const modelsText = pickField(fields, ['models', 'model', '模型', '模型列表'])
  const keysText = [
    ...pickFields(fields, ['apikey', 'api key', 'key', 'keys', 'token', 'tokens', '秘钥', '密钥', '令牌']),
    ...extractLooseKeys(chunk),
  ].join('\n')
  const detection = detectProviderPreset({ baseUrl, name, apiKey: keysText })
  const presetId = resolveImportPresetId(detection, wireProtocolHint)
  const preset = getProviderPreset(presetId)
  const isMimo = presetId === 'xiaomi-mimo'
  const credentialMode = isMimo ? inferProviderCredentialModeFromKeyOrBaseUrl(keysText, baseUrl) : undefined
  const tokenPlanRegion = isMimo ? inferProviderTokenPlanRegionFromBaseUrl(baseUrl) : undefined
  const wireProtocol = isMimo ? wireProtocolHint ?? inferProviderWireProtocolFromBaseUrl(baseUrl) : wireProtocolHint
  const models = parseModelList(modelsText)
  const credentialGroups = parseCredentialGroups(keysText)
  const providerName = explicitName ?? (isMimo ? preset.name : name)

  if (!name && !baseUrl && !credentialGroups.length) {
    warnings.push(st('providerRegistry.chunkUnrecognized', { index: index + 1 }))
    return null
  }

  const provider = applyProviderPreset({
    id: importProviderId(providerName || preset.name, index),
    presetId,
    detectedPresetId: presetId,
    detectionStatus: 'detected',
    type: preset.type,
    name: providerName || preset.name,
    baseUrl: baseUrl?.trim() || (isMimo ? getXiaomiMimoOfficialBaseUrl(credentialMode, tokenPlanRegion, wireProtocol) : preset.baseUrl),
    credentialMode,
    tokenPlanRegion,
    wireProtocol,
    apiKey: '',
    credentialGroups,
    models,
    enabled: false,
  } satisfies AIProvider, presetId)

  if (!credentialGroups.length) warnings.push(st('providerRegistry.noTokens', { name: provider.name }))
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
    if (/^https?$/i.test(key) || /^https?:\/\//i.test(match[0].trim())) continue
    if (!key || !value) continue
    const current = fields.get(key) ?? []
    current.push(value)
    fields.set(key, current)
  }
  const csvParts = normalized.split(',').map((part) => part.trim()).filter(Boolean)
  const url = extractLooseBaseUrl(normalized)
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

function inferProviderName(chunk: string, index: number, baseUrl?: string): string {
  const first = chunk.split(/[,，\n\r]/)[0]?.trim()
  const prefix = first?.split(/[:：=]/)[0]?.trim()
  const host = baseUrl ? getHost(baseUrl) : ''
  if (first && /^https?:\/\//i.test(first) && host) return host
  if (prefix && isImportMetadataField(prefix)) return host || st('providerRegistry.importedProviderName', { index: index + 1 })
  if (prefix && !/^https?$/i.test(prefix) && !looksLikeApiKey(prefix) && !/^https?:\/\//i.test(prefix)) return prefix
  if (host) return host
  return st('providerRegistry.importedProviderName', { index: index + 1 })
}

function resolveImportPresetId(detection: ProviderDetectionResult, wireProtocolHint?: ProviderWireProtocol): ProviderPresetId {
  if (!wireProtocolHint || detection.confidence !== 'low') return detection.presetId
  return providerPresetIdForWireProtocol(wireProtocolHint)
}

function providerPresetIdForWireProtocol(wireProtocol: ProviderWireProtocol): ProviderPresetId {
  return wireProtocol === 'anthropic-compatible' ? 'custom-anthropic-compatible' : 'custom-openai-compatible'
}

function parseProviderWireProtocolText(value?: string): ProviderWireProtocol | undefined {
  if (!value?.trim()) return undefined
  if (/anthropic|claude/i.test(value)) return 'anthropic-compatible'
  if (/openai|gpt/i.test(value)) return 'openai-compatible'
  return undefined
}

function inferExplicitProviderWireProtocolFromBaseUrl(value?: string): ProviderWireProtocol | undefined {
  return /\/anthropic(?:\/v1)?(?:\/|$)/i.test(value ?? '') ? 'anthropic-compatible' : undefined
}

function isImportMetadataField(value: string): boolean {
  return [
    'baseurl',
    'url',
    'endpoint',
    'protocol',
    'wireprotocol',
    '站点',
    '地址',
    '接口',
    '协议',
    '接口协议',
  ].includes(normalizeImportFieldKey(value))
}

function extractLabeledProtocolBaseUrls(chunk: string): Array<{ baseUrl: string; wireProtocol: ProviderWireProtocol }> {
  const endpoints: Array<{ baseUrl: string; wireProtocol: ProviderWireProtocol }> = []
  const seen = new Set<string>()
  const pattern = /([^\n\r:：=]{0,80}(?:openai|anthropic|claude)[^\n\r:：=]{0,80})\s*[:：=]\s*(https?:\/\/[^\s,，;；]+)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(chunk))) {
    const wireProtocol = protocolLabelWireProtocol(match[1] ?? '')
    const baseUrl = match[2]?.trim()
    if (!wireProtocol || !baseUrl) continue
    const key = `${wireProtocol}|${baseUrl.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    endpoints.push({ baseUrl, wireProtocol })
  }
  return endpoints
}

function protocolLabelWireProtocol(label: string): ProviderWireProtocol | undefined {
  if (!/(compatible|compat|protocol|endpoint|api|base\s*url|接口|协议|兼容|入口|地址)/i.test(label)) return undefined
  if (/anthropic|claude/i.test(label)) return 'anthropic-compatible'
  if (/openai|gpt/i.test(label)) return 'openai-compatible'
  return undefined
}

function extractLooseBaseUrl(chunk: string): string | undefined {
  return chunk.match(/https?:\/\/[^\s,，;；]+/i)?.[0]?.trim()
}

function extractLooseKeys(chunk: string): string[] {
  const textWithoutUrls = chunk.replace(/https?:\/\/[^\s,，;；]+/gi, ' ')
  const matches = textWithoutUrls.match(/(?:sk|tp|ak|rk|pk|key|token)-[A-Za-z0-9._:-]+|[A-Za-z0-9_-]{24,}/g) ?? []
  return matches.filter(looksLikeApiKey)
}

function looksLikeApiKey(value: string): boolean {
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) return false
  return /^(sk|tp|ak|rk|pk|key|token)-/i.test(trimmed) || /^[A-Za-z0-9_-]{24,}$/.test(trimmed)
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

function dedupeImportedProviders(providers: AIProvider[], warnings: string[], duplicates: string[]): AIProvider[] {
  const seen = new Set<string>()
  return providers.filter((provider) => {
    const key = `${provider.name.toLowerCase()}|${provider.baseUrl ?? ''}`
    if (seen.has(key)) {
      const message = st('providerRegistry.duplicateSkipped', { name: provider.name })
      duplicates.push(provider.name)
      warnings.push(message)
      return false
    }
    seen.add(key)
    return true
  })
}

function applyImportedProviderAccessPolicy(providers: AIProvider[], warnings: string[], settings?: ProviderModelAccessInput['settings']): AIProvider[] {
  if (!settings) return providers
  return providers
    .filter((provider) => {
      if (importedProviderAllowedByPolicy(provider, settings)) return true
      warnings.push(st('providerRegistry.providerSkippedByPolicy', { name: provider.name }))
      return false
    })
    .map((provider) => filterImportedProviderModelsByPolicy(provider, warnings, settings))
}

function importedProviderAllowedByPolicy(provider: AIProvider, settings: ProviderModelAccessInput['settings']): boolean {
  const probe = resolveProviderModelAliasAccess({ provider, model: '__provider_import_policy_probe__', settings })
  return probe.allowed || probe.reason === 'model_blocked' || probe.reason === 'model_not_allowed'
}

function filterImportedProviderModelsByPolicy(provider: AIProvider, warnings: string[], settings: ProviderModelAccessInput['settings']): AIProvider {
  const models = filterImportedModelsByPolicy(provider, provider.models, settings)
  const manualModels = Array.isArray(provider.manualModels)
    ? filterImportedModelsByPolicy(provider, provider.manualModels, settings)
    : provider.manualModels
  const skipped = provider.models.length - models.length + (Array.isArray(provider.manualModels) ? provider.manualModels.length - (manualModels?.length ?? 0) : 0)
  if (skipped > 0) warnings.push(st('providerRegistry.modelsSkippedByPolicy', { name: provider.name, count: skipped }))
  return {
    ...provider,
    models,
    ...(Array.isArray(provider.manualModels) ? { manualModels } : {}),
  }
}

function filterImportedModelsByPolicy(provider: AIProvider, models: string[], settings: ProviderModelAccessInput['settings']): string[] {
  return models.filter((model) => resolveProviderModelAliasAccess({ provider, model, settings }).allowed)
}
