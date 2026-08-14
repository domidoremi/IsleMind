export interface ProviderCredentialDescriptor {
  id: string
  apiKey?: string
  enabled: boolean
  availableModels?: readonly string[]
  lastUsedAt?: number
  lastFailureAt?: number
  failureCount?: number
}

export interface ProviderCredentialSelectionInput {
  providerApiKey: string
  credentials: readonly ProviderCredentialDescriptor[]
  modelId: string
  upstreamModelId?: string
  preferredCredentialId?: string
  excludedCredentialIds?: readonly string[]
}

export interface ProviderCredentialSelection {
  credentialId?: string
  apiKey: string
}

export function selectProviderCredential(input: ProviderCredentialSelectionInput): ProviderCredentialSelection {
  const excluded = new Set(input.excludedCredentialIds ?? [])
  const enabled = input.credentials
    .filter((credential) => credential.enabled && !excluded.has(credential.id))
    .sort(compareProviderCredentials)
  const candidates = enabled
    .filter((credential) => credentialSupportsModel(credential, input.modelId, input.upstreamModelId))
  const preferred = input.preferredCredentialId
    ? candidates.find((credential) => credential.id === input.preferredCredentialId)
    : undefined
  const selected = preferred ?? candidates[0] ?? enabled[0]
  return { credentialId: selected?.id, apiKey: selected?.apiKey ?? input.providerApiKey }
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
