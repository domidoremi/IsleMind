import type { ProviderCredentialSelectionPolicy, ProviderCredentialSource } from '@/types/providerContracts'
import { credentialListsModel, hasCredentialModelCatalog, type CredentialModelCatalog } from './providerModelCatalog'
export type { ProviderCredentialSource } from '@/types/providerContracts'

export const PROVIDER_CREDENTIAL_SELECTION_STRATEGIES = ['balanced', 'least-recently-used'] as const

export function parseProviderCredentialSelection(value: unknown): ProviderCredentialSelectionPolicy | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid credential selection policy')
  const policy = value as Record<string, unknown>
  const preferred = policy.preferredGroupId
  if (!PROVIDER_CREDENTIAL_SELECTION_STRATEGIES.some(strategy => strategy === policy.strategy)
    || Object.keys(policy).some(key => key !== 'strategy' && key !== 'preferredGroupId')
    || (preferred !== undefined && (typeof preferred !== 'string' || !preferred.length || preferred.length > 240
      || preferred.trim() !== preferred || /[\u0000-\u001f\u007f]/u.test(preferred)))) {
    throw new TypeError('Invalid credential selection policy')
  }
  return { strategy: policy.strategy as ProviderCredentialSelectionPolicy['strategy'],
    ...(preferred !== undefined ? { preferredGroupId: preferred as string } : {}) }
}

export interface ProviderCredentialDescriptor extends CredentialModelCatalog {
  id: string
  apiKey?: string
  enabled: boolean
  availableModels?: readonly string[]
  lastUsedAt?: number
  lastFailureAt?: number
  failureCount?: number
  /** Set by normalization for a synthetic primary group; real groups default to group identity. */
  source?: ProviderCredentialSource
}

export interface ProviderCredentialSelectionInput {
  providerApiKey: string
  credentials: readonly ProviderCredentialDescriptor[]
  modelId: string
  upstreamModelId?: string
  preferredCredentialId?: string
  /** Strict targeting is separate from soft session affinity. */
  targetCredentialId?: string
  excludedCredentialIds?: readonly string[]
  providerCredentialSource?: ProviderCredentialSource
  includeSource?: boolean
  selectionPolicy?: ProviderCredentialSelectionPolicy
  /** Explicit manual model or alias, usable when no key lists the model. */
  allowUnlistedModel?: boolean
}

export interface ProviderCredentialSelection {
  credentialId?: string
  apiKey: string
}

export interface ProviderCredentialSelectionWithSource extends ProviderCredentialSelection {
  source: ProviderCredentialSource
}

export function selectProviderCredential(input: ProviderCredentialSelectionInput & { includeSource: true }): ProviderCredentialSelectionWithSource
export function selectProviderCredential(input: ProviderCredentialSelectionInput): ProviderCredentialSelection
export function selectProviderCredential(input: ProviderCredentialSelectionInput): ProviderCredentialSelection | ProviderCredentialSelectionWithSource {
  const excluded = new Set(input.excludedCredentialIds ?? [])
  const enabled = input.credentials
    .filter((credential) => credential.enabled && !!credential.apiKey?.trim() && !excluded.has(credential.id))
    .sort((left, right) => input.selectionPolicy?.strategy === 'least-recently-used'
      ? (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0) || left.id.localeCompare(right.id)
      : compareProviderCredentials(left, right))
  const listed = enabled.filter(item => credentialListsModel(item, input.modelId, input.upstreamModelId))
  const hasListedOwner = input.credentials.some(item => credentialListsModel(item, input.modelId, input.upstreamModelId))
  const candidates = hasListedOwner ? listed : enabled.filter(item => input.allowUnlistedModel || !hasCredentialModelCatalog(item))
  const preferred = input.preferredCredentialId
    ? candidates.find((credential) => credential.id === input.preferredCredentialId)
    : undefined
  const targeted = input.targetCredentialId === undefined ? undefined : candidates.find((credential) => credential.id === input.targetCredentialId)
  if (input.targetCredentialId !== undefined && (!targeted || !targeted.apiKey?.trim() || targeted.source?.kind === 'primary')) {
    throw new Error('Requested credential group is not available')
  }
  const savedPreference = candidates.find(item => item.id === input.selectionPolicy?.preferredGroupId)
  const selected = targeted ?? preferred ?? savedPreference ?? candidates[0]
  const apiKey = selected?.apiKey ?? (input.credentials.length ? '' : input.providerApiKey)
  const selection = { credentialId: selected?.id, apiKey }
  if (!input.includeSource) return selection
  const source: ProviderCredentialSource = selected?.apiKey?.trim()
    ? selected.source ?? { kind: 'group', groupId: selected.id }
    : apiKey.trim() ? input.providerCredentialSource ?? { kind: 'primary' } : { kind: 'none' }
  return { ...selection, source }
}

/** Interface detection is connection-scoped and does not require a model catalog. */
export function selectProviderProbeCredential(input: Pick<ProviderCredentialSelectionInput,
  'providerApiKey' | 'credentials' | 'selectionPolicy'>): ProviderCredentialSelection {
  const candidates = input.credentials.filter(group => group.enabled && !!group.apiKey?.trim())
    .sort((left, right) => input.selectionPolicy?.strategy === 'least-recently-used'
      ? (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0) || left.id.localeCompare(right.id)
      : compareProviderCredentials(left, right))
  const selected = candidates.find(group => group.id === input.selectionPolicy?.preferredGroupId) ?? candidates[0]
  return { credentialId: selected?.id, apiKey: selected?.apiKey ?? (input.credentials.length ? '' : input.providerApiKey) }
}

export function updateProviderCredentialHealth<TCredential extends ProviderCredentialDescriptor>(
  credentials: readonly TCredential[],
  credentialId: string | undefined,
  ok: boolean,
  nowMs: number,
): TCredential[] {
  if (!credentialId) return [...credentials]
  return credentials.map((credential) => credential.id !== credentialId ? credential : {
    ...credential,
    lastUsedAt: nowMs,
    lastFailureAt: ok ? credential.lastFailureAt : nowMs,
    failureCount: ok ? 0 : (credential.failureCount ?? 0) + 1,
  })
}

function compareProviderCredentials(left: ProviderCredentialDescriptor, right: ProviderCredentialDescriptor): number {
  return (left.failureCount ?? 0) - (right.failureCount ?? 0) ||
    (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0) ||
    left.id.localeCompare(right.id)
}
