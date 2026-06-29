import type { AIProvider, ProviderCredentialGroup } from '@/types'
import { normalizeProviderCredentialGroups } from '@/services/ai/providerCredentials'
import { resolveProviderModelAlias } from '@/utils/providerModels'

export const SESSION_AFFINITY_DEFAULT_TTL_MS = 30 * 60 * 1000
export const SESSION_AFFINITY_MAX_BINDINGS = 200

const sessionAffinityBindings = new Map<string, SessionAffinityBinding>()

export type SessionAffinityBindingReason =
  | 'initial_bind'
  | 'failover'
  | 'manual_reset'

export interface SessionAffinityBinding {
  sessionKey: string
  providerId: string
  model: string
  credentialGroupId: string
  boundAt: number
  expiresAt: number
  reason: SessionAffinityBindingReason
  failoverCount: number
}

export type SessionAffinityResolutionReason =
  | 'affinity_disabled'
  | 'missing_session_key'
  | 'binding_missing'
  | 'binding_expired'
  | 'provider_mismatch'
  | 'model_mismatch'
  | 'credential_group_missing'
  | 'credential_group_disabled'
  | 'model_unavailable'
  | 'credential_group_cooling_down'
  | 'binding_reused'

export interface SessionAffinityResolution {
  enabled: boolean
  reusable: boolean
  reason: SessionAffinityResolutionReason
  sessionKey?: string
  credentialGroupId?: string
  binding?: SessionAffinityBinding
}

export interface DeriveSessionAffinityKeyInput {
  conversationId?: string
  sessionId?: string
  providerId: string
  model: string
}

export interface BuildSessionAffinityBindingInput {
  sessionKey?: string
  providerId: string
  model: string
  credentialGroupId?: string
  nowMs?: number
  ttlMs?: number
  reason?: SessionAffinityBindingReason
  previousBinding?: SessionAffinityBinding
}

export interface ResolveSessionAffinityBindingInput {
  enabled?: boolean
  provider: AIProvider
  model: string
  upstreamModel?: string
  conversationId?: string
  sessionId?: string
  binding?: SessionAffinityBinding
  nowMs?: number
  coolingDownCredentialGroupIds?: readonly string[]
}

export interface StoreSessionAffinityBindingOptions {
  nowMs?: number
  maxBindings?: number
}

export interface SessionAffinityFailureInvalidationInput {
  status?: number
  trigger?: string
  responseText?: string
}

export interface InvalidateSessionAffinityBindingInput {
  enabled?: boolean
  providerId: string
  model: string
  conversationId?: string
  sessionId?: string
  credentialGroupId?: string
  nowMs?: number
}

export interface RotateSessionAffinityBindingInput extends InvalidateSessionAffinityBindingInput {
  ttlMs?: number
  reason?: SessionAffinityBindingReason
  previousBinding?: SessionAffinityBinding
}

export function deriveSessionAffinityKey(input: DeriveSessionAffinityKeyInput): string | undefined {
  const providerId = normalizeKeyPart(input.providerId)
  const model = normalizeKeyPart(input.model)
  const conversationId = normalizeOptionalKeyPart(input.conversationId)
  const sessionId = normalizeOptionalKeyPart(input.sessionId)
  if (!providerId || !model || (!conversationId && !sessionId)) return undefined
  return [
    providerId,
    model,
    conversationId ?? 'global',
    sessionId ?? 'default',
  ].map(encodeSessionAffinityKeyPart).join(':')
}

export function buildSessionAffinityBinding(input: BuildSessionAffinityBindingInput): SessionAffinityBinding | undefined {
  const credentialGroupId = normalizeOptionalKeyPart(input.credentialGroupId)
  const providerId = normalizeKeyPart(input.providerId)
  const model = normalizeKeyPart(input.model)
  const sessionKey = normalizeKeyPart(input.sessionKey)
  if (!credentialGroupId || !providerId || !model || !sessionKey) return undefined
  const nowMs = input.nowMs ?? Date.now()
  const ttlMs = normalizeTtlMs(input.ttlMs)
  const reason = input.reason ?? 'initial_bind'
  return {
    sessionKey,
    providerId,
    model,
    credentialGroupId,
    boundAt: nowMs,
    expiresAt: nowMs + ttlMs,
    reason,
    failoverCount: reason === 'failover' ? (input.previousBinding?.failoverCount ?? 0) + 1 : 0,
  }
}

export function resolveSessionAffinityBinding(input: ResolveSessionAffinityBindingInput): SessionAffinityResolution {
  const sessionKey = deriveSessionAffinityKey({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    providerId: input.provider.id,
    model: input.model,
  })
  if (input.enabled !== true) {
    return { enabled: false, reusable: false, reason: 'affinity_disabled', sessionKey }
  }
  if (!sessionKey) {
    return { enabled: true, reusable: false, reason: 'missing_session_key' }
  }
  if (!input.binding) {
    return { enabled: true, reusable: false, reason: 'binding_missing', sessionKey }
  }
  if (input.binding.sessionKey !== sessionKey) {
    return { enabled: true, reusable: false, reason: 'binding_missing', sessionKey, binding: input.binding }
  }
  if (input.binding.expiresAt <= (input.nowMs ?? Date.now())) {
    return { enabled: true, reusable: false, reason: 'binding_expired', sessionKey, binding: input.binding }
  }
  if (input.binding.providerId !== input.provider.id) {
    return { enabled: true, reusable: false, reason: 'provider_mismatch', sessionKey, binding: input.binding }
  }
  if (input.binding.model !== input.model) {
    return { enabled: true, reusable: false, reason: 'model_mismatch', sessionKey, binding: input.binding }
  }

  const normalized = normalizeProviderCredentialGroups(input.provider)
  const group = normalized.credentialGroups?.find((item) => item.id === input.binding?.credentialGroupId)
  if (!group) {
    return { enabled: true, reusable: false, reason: 'credential_group_missing', sessionKey, binding: input.binding }
  }
  if (!group.enabled) {
    return { enabled: true, reusable: false, reason: 'credential_group_disabled', sessionKey, binding: input.binding }
  }
  if (!credentialGroupCanUseModel(normalized, group, input.model, input.upstreamModel)) {
    return { enabled: true, reusable: false, reason: 'model_unavailable', sessionKey, binding: input.binding }
  }
  if (input.coolingDownCredentialGroupIds?.includes(group.id)) {
    return { enabled: true, reusable: false, reason: 'credential_group_cooling_down', sessionKey, binding: input.binding }
  }

  return {
    enabled: true,
    reusable: true,
    reason: 'binding_reused',
    sessionKey,
    credentialGroupId: group.id,
    binding: input.binding,
  }
}

export function readSessionAffinityBinding(sessionKey: string | undefined, nowMs = Date.now()): SessionAffinityBinding | undefined {
  const key = normalizeOptionalKeyPart(sessionKey)
  if (!key) return undefined
  const binding = sessionAffinityBindings.get(key)
  if (!binding) return undefined
  if (binding.expiresAt <= nowMs) {
    sessionAffinityBindings.delete(key)
    return undefined
  }
  return binding
}

export function storeSessionAffinityBinding(
  binding: SessionAffinityBinding | undefined,
  options: StoreSessionAffinityBindingOptions = {}
): SessionAffinityBinding | undefined {
  if (!binding) return undefined
  sessionAffinityBindings.set(binding.sessionKey, binding)
  pruneSessionAffinityBindings(options.nowMs ?? Date.now(), normalizeMaxBindings(options.maxBindings))
  return binding
}

export function clearSessionAffinityBinding(sessionKey: string | undefined): boolean {
  const key = normalizeOptionalKeyPart(sessionKey)
  return key ? sessionAffinityBindings.delete(key) : false
}

export function resetSessionAffinityBindingsForTest(): void {
  sessionAffinityBindings.clear()
}

export function listSessionAffinityBindingsForTest(): SessionAffinityBinding[] {
  return Array.from(sessionAffinityBindings.values())
}

export function sessionAffinityFailureShouldInvalidate(input: SessionAffinityFailureInvalidationInput): boolean {
  const status = input.status
  if (status === 401 || status === 403 || status === 429) return true
  if (typeof status === 'number' && status >= 500 && status <= 599) return true
  if (input.trigger && ['credential_unhealthy', 'rate_limited', 'overloaded', 'server_error'].includes(input.trigger)) return true
  return quotaLikeFailureText(input.responseText)
}

export function invalidateSessionAffinityBinding(input: InvalidateSessionAffinityBindingInput): SessionAffinityBinding | undefined {
  if (input.enabled !== true) return undefined
  const sessionKey = deriveSessionAffinityKey({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    providerId: input.providerId,
    model: input.model,
  })
  const binding = readSessionAffinityBinding(sessionKey, input.nowMs)
  if (!binding) return undefined
  const credentialGroupId = normalizeOptionalKeyPart(input.credentialGroupId)
  if (credentialGroupId && binding.credentialGroupId !== credentialGroupId) return undefined
  clearSessionAffinityBinding(sessionKey)
  return binding
}

export function rotateSessionAffinityBinding(input: RotateSessionAffinityBindingInput): SessionAffinityBinding | undefined {
  if (input.enabled !== true) return undefined
  const sessionKey = deriveSessionAffinityKey({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    providerId: input.providerId,
    model: input.model,
  })
  const previousBinding = input.previousBinding ?? readSessionAffinityBinding(sessionKey, input.nowMs)
  return storeSessionAffinityBinding(buildSessionAffinityBinding({
    sessionKey,
    providerId: input.providerId,
    model: input.model,
    credentialGroupId: input.credentialGroupId,
    nowMs: input.nowMs,
    ttlMs: input.ttlMs,
    reason: input.reason ?? 'failover',
    previousBinding,
  }), { nowMs: input.nowMs })
}

function credentialGroupCanUseModel(
  provider: AIProvider,
  group: ProviderCredentialGroup,
  requestedModel: string,
  upstreamModel = resolveProviderModelAlias(provider, requestedModel)
): boolean {
  const availableModels = group.availableModels ?? []
  return !availableModels.length || availableModels.includes(requestedModel) || availableModels.includes(upstreamModel)
}

function normalizeTtlMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return SESSION_AFFINITY_DEFAULT_TTL_MS
  return Math.max(1, Math.floor(value!))
}

function normalizeMaxBindings(value: number | undefined): number {
  if (!Number.isFinite(value)) return SESSION_AFFINITY_MAX_BINDINGS
  return Math.max(1, Math.floor(value!))
}

function normalizeKeyPart(value: string | undefined): string {
  return value?.trim() ?? ''
}

function normalizeOptionalKeyPart(value: string | undefined): string | undefined {
  const normalized = normalizeKeyPart(value)
  return normalized || undefined
}

function encodeSessionAffinityKeyPart(value: string): string {
  return encodeURIComponent(value)
}

function pruneSessionAffinityBindings(nowMs: number, maxBindings: number): void {
  for (const [key, binding] of sessionAffinityBindings) {
    if (binding.expiresAt <= nowMs) sessionAffinityBindings.delete(key)
  }
  if (sessionAffinityBindings.size <= maxBindings) return
  const oldest = Array.from(sessionAffinityBindings.values())
    .sort((a, b) => a.boundAt - b.boundAt || a.sessionKey.localeCompare(b.sessionKey))
  for (const binding of oldest.slice(0, sessionAffinityBindings.size - maxBindings)) {
    sessionAffinityBindings.delete(binding.sessionKey)
  }
}

function quotaLikeFailureText(value: string | undefined): boolean {
  return /quota|rate[-_ ]?limit|too many requests|insufficient[-_ ]quota|credit|balance|额度|限额|配额|余额不足/i.test(value ?? '')
}
