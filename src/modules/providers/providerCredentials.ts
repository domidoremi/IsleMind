import type { ProviderCredentialSource } from '@/types/providerContracts'
export type { ProviderCredentialSource } from '@/types/providerContracts'

export interface ProviderCredentialDescriptor {
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
    .filter((credential) => credential.enabled && !excluded.has(credential.id))
    .sort(compareProviderCredentials)
  const candidates = enabled
    .filter((credential) => credentialSupportsModel(credential, input.modelId, input.upstreamModelId))
  const preferred = input.preferredCredentialId
    ? candidates.find((credential) => credential.id === input.preferredCredentialId)
    : undefined
  const targeted = input.targetCredentialId === undefined ? undefined : enabled.find((credential) => credential.id === input.targetCredentialId)
  if (input.targetCredentialId !== undefined && (!targeted || !targeted.apiKey?.trim() || targeted.source?.kind === 'primary')) {
    throw new Error('Requested credential group is not available')
  }
  const selected = targeted ?? preferred ?? candidates[0] ?? enabled[0]
  const apiKey = selected?.apiKey ?? input.providerApiKey
  const selection = { credentialId: selected?.id, apiKey }
  if (!input.includeSource) return selection
  const source: ProviderCredentialSource = selected?.apiKey?.trim()
    ? selected.source ?? { kind: 'group', groupId: selected.id }
    : apiKey.trim() ? input.providerCredentialSource ?? { kind: 'primary' } : { kind: 'none' }
  return { ...selection, source }
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

function credentialSupportsModel(credential: ProviderCredentialDescriptor, modelId: string, upstreamModelId: string | undefined): boolean {
  if (!credential.availableModels?.length) return true
  return credential.availableModels.includes(modelId) ||
    (!!upstreamModelId && credential.availableModels.includes(upstreamModelId))
}

function compareProviderCredentials(left: ProviderCredentialDescriptor, right: ProviderCredentialDescriptor): number {
  return (left.failureCount ?? 0) - (right.failureCount ?? 0) ||
    (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0) ||
    left.id.localeCompare(right.id)
}
