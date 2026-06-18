import type { AIProvider } from '@/types'
import { getProviderEffectiveBaseUrl } from '@/types'
import { signAwsRequestV4, type AwsCredentials } from '@/services/ai/providerAwsSigV4'

const BEDROCK_MANTLE_HOST_PATTERN = /^bedrock-mantle\.[a-z0-9-]+\.api\.aws$/i
const BEDROCK_RUNTIME_HOST_PATTERN = /(^|\.)bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/i
const BEDROCK_RUNTIME_HOST_REGION_PATTERN = /(?:^|\.)bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com$/i
const BEDROCK_RUNTIME_TEXT_PATTERN = /\bbedrock-runtime\b/i
const BEDROCK_RUNTIME_PRESET_TEXT_PATTERN = /\b(runtime|invokemodel|converse|sigv4)\b/i
const BEDROCK_TEXT_PATTERN = /\bbedrock\b|amazon bedrock/i

export interface BedrockRuntimeCredentials extends AwsCredentials {
  region?: string
}

export interface BedrockRuntimeRequestInput {
  provider: AIProvider
  model: string
  body: Record<string, unknown>
  now?: Date
}

export interface PreparedBedrockRuntimeRequest {
  url: string
  headers: Record<string, string>
  body: string
  region: string
}

export function isBedrockMantleProvider(provider: AIProvider): boolean {
  return isBedrockMantleBaseUrl(getProviderEffectiveBaseUrl(provider))
}

export function isBedrockRuntimeProvider(provider: Pick<AIProvider, 'id' | 'name' | 'baseUrl' | 'presetId' | 'detectedPresetId'>): boolean {
  const baseUrl = provider.baseUrl?.trim() ?? ''
  try {
    const parsed = new URL(baseUrl)
    if (BEDROCK_RUNTIME_HOST_PATTERN.test(parsed.hostname)) return true
  } catch {
    if (BEDROCK_RUNTIME_HOST_PATTERN.test(baseUrl)) return true
  }
  const text = providerIdentityText(provider)
  if (BEDROCK_RUNTIME_TEXT_PATTERN.test(text)) return true
  if ((provider.presetId === 'aws-bedrock' || provider.detectedPresetId === 'aws-bedrock') && BEDROCK_RUNTIME_PRESET_TEXT_PATTERN.test(text)) return true
  return false
}

export function isAwsBedrockProvider(provider: Pick<AIProvider, 'id' | 'name' | 'baseUrl' | 'presetId' | 'detectedPresetId'>): boolean {
  if (provider.presetId === 'aws-bedrock' || provider.detectedPresetId === 'aws-bedrock') return true
  const baseUrl = provider.baseUrl?.trim() ?? ''
  if (isBedrockMantleBaseUrl(baseUrl)) return true
  if (isBedrockRuntimeProvider(provider)) return true
  return BEDROCK_TEXT_PATTERN.test(providerIdentityText(provider))
}

export function getBedrockRuntimeSupportIssue(provider: AIProvider): string | null {
  if (!isBedrockRuntimeProvider(provider)) return null
  const credentials = parseBedrockRuntimeCredentials(provider.apiKey)
  if (!credentials) return 'missing_aws_credentials'
  const region = credentials.region ?? inferBedrockRuntimeRegion(provider.baseUrl)
  if (!region) return 'missing_region'
  return null
}

export function prepareBedrockRuntimeInvokeModelRequest(input: BedrockRuntimeRequestInput): PreparedBedrockRuntimeRequest {
  const credentials = parseBedrockRuntimeCredentials(input.provider.apiKey)
  if (!credentials) throw new Error('bedrock_runtime_missing_aws_credentials')
  const region = credentials.region ?? inferBedrockRuntimeRegion(input.provider.baseUrl)
  if (!region) throw new Error('bedrock_runtime_missing_region')
  const url = bedrockRuntimeInvokeModelUrl(input.provider, input.model, region)
  const body = JSON.stringify(toBedrockAnthropicInvokeBody(input.body))
  const headers = signAwsRequestV4({
    method: 'POST',
    url,
    region,
    service: 'bedrock',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
    credentials,
    now: input.now,
  })
  return { url, headers, body, region }
}

export function parseBedrockRuntimeCredentials(input: string | undefined): BedrockRuntimeCredentials | null {
  const text = input?.trim()
  if (!text) return null
  const json = parseCredentialsJson(text)
  if (json) return json
  const env = parseCredentialsEnvText(text)
  if (env) return env
  return null
}

export function inferBedrockRuntimeRegion(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined
  try {
    return new URL(baseUrl.trim()).hostname.match(BEDROCK_RUNTIME_HOST_REGION_PATTERN)?.[1]
  } catch {
    return baseUrl.match(BEDROCK_RUNTIME_HOST_REGION_PATTERN)?.[1]
  }
}

export function bedrockRuntimeInvokeModelUrl(provider: Pick<AIProvider, 'baseUrl'>, model: string, region?: string): string {
  const baseUrl = normalizeBedrockRuntimeBaseUrl(provider.baseUrl, region)
  return `${baseUrl}/model/${encodeBedrockModelPath(model)}/invoke`
}

export function normalizeBedrockMantleBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl.trim())
    if (!BEDROCK_MANTLE_HOST_PATTERN.test(parsed.hostname)) return baseUrl
    parsed.search = ''
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path || path === '/') {
      parsed.pathname = '/v1'
    } else if (/\/v1(?:\/.*)?$/i.test(path)) {
      parsed.pathname = path.replace(/(\/v1)(?:\/.*)?$/i, '$1')
    }
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return baseUrl
  }
}

export function normalizeBedrockRuntimeBaseUrl(baseUrl: string | undefined, region = 'us-east-1'): string {
  const fallback = `https://bedrock-runtime.${region}.amazonaws.com`
  if (!baseUrl?.trim()) return fallback
  try {
    const parsed = new URL(baseUrl.trim())
    parsed.search = ''
    parsed.hash = ''
    parsed.pathname = ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return fallback
  }
}

export function isBedrockMantleBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return false
  try {
    const parsed = new URL(baseUrl.trim())
    return BEDROCK_MANTLE_HOST_PATTERN.test(parsed.hostname)
  } catch {
    return /bedrock-mantle\.[a-z0-9-]+\.api\.aws/i.test(baseUrl)
  }
}

export function inferBedrockMantleRegion(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined
  try {
    const parsed = new URL(baseUrl.trim())
    return parsed.hostname.match(/^bedrock-mantle\.([a-z0-9-]+)\.api\.aws$/i)?.[1]
  } catch {
    return baseUrl.match(/bedrock-mantle\.([a-z0-9-]+)\.api\.aws/i)?.[1]
  }
}

function toBedrockAnthropicInvokeBody(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body, anthropic_version: body.anthropic_version ?? 'bedrock-2023-05-31' }
  delete next.stream
  return next
}

function encodeBedrockModelPath(model: string): string {
  return model.trim().split('/').map((part) => encodeURIComponent(part)).join('/')
}

function parseCredentialsJson(text: string): BedrockRuntimeCredentials | null {
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return normalizeCredentialRecord(parsed)
  } catch {
    return null
  }
}

function parseCredentialsEnvText(text: string): BedrockRuntimeCredentials | null {
  const record: Record<string, string> = {}
  for (const line of text.split(/\r?\n|;/)) {
    const match = line.trim().match(/^([A-Z0-9_]+)\s*=\s*(.+)$/i)
    if (!match) continue
    record[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return normalizeCredentialRecord(record)
}

function normalizeCredentialRecord(record: Record<string, unknown>): BedrockRuntimeCredentials | null {
  const accessKeyId = stringValue(record.accessKeyId) ?? stringValue(record.AccessKeyId) ?? stringValue(record.AWS_ACCESS_KEY_ID) ?? stringValue(record.aws_access_key_id)
  const secretAccessKey = stringValue(record.secretAccessKey) ?? stringValue(record.SecretAccessKey) ?? stringValue(record.AWS_SECRET_ACCESS_KEY) ?? stringValue(record.aws_secret_access_key)
  if (!accessKeyId || !secretAccessKey) return null
  const sessionToken = stringValue(record.sessionToken) ?? stringValue(record.SessionToken) ?? stringValue(record.AWS_SESSION_TOKEN) ?? stringValue(record.aws_session_token)
  const region = stringValue(record.region) ?? stringValue(record.Region) ?? stringValue(record.AWS_REGION) ?? stringValue(record.AWS_DEFAULT_REGION) ?? stringValue(record.aws_region)
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
    ...(region ? { region } : {}),
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function providerIdentityText(provider: Pick<AIProvider, 'id' | 'name' | 'baseUrl' | 'presetId' | 'detectedPresetId'>): string {
  return [
    provider.id,
    provider.name,
    provider.baseUrl,
    provider.presetId,
    provider.detectedPresetId,
  ].filter(Boolean).join(' ')
}
