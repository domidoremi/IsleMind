import type { TFunction } from 'i18next'
import { isProviderModelAvailabilityBlocked, type ProviderModelCurrent } from '@/modules/providers'
import type { AIProvider, ProviderCredentialSource } from '@/types/providerContracts'

/** Presentation of scoped evidence. Runtime admission still rechecks every policy. */
export function projectModelAvailability(input: {
  current?: ProviderModelCurrent
  offline?: boolean
  credentialBlocked?: boolean
  policyBlocked?: boolean
  providerDisabled?: boolean
  incompatible?: boolean
  activeReply?: boolean
}) {
  const current = input.current?.invalidated ? undefined : input.current
  const blockedReason = input.activeReply ? 'activeReply' : input.policyBlocked ? 'policyBlocked'
    : input.providerDisabled ? 'providerDisabled' : input.incompatible ? 'incompatible'
    : current && isProviderModelAvailabilityBlocked(current.availability) ? current.availability : undefined
  return {
    availability: current?.availability ?? 'unknown',
    advertisement: current?.advertisement ?? 'unknown',
    labels: [...(input.offline ? ['offline'] : []), ...(input.credentialBlocked ? ['credentialBlocked'] : [])],
    blockedReason,
  }
}

/** An automatic model choice is not a credential pin. A missing alternative
 * scope remains unknown, and one group's retirement cannot hide another's access.
 * The primary fallback is possible even when credential groups are configured. */
export function selectModelAvailabilityEvidence(input: {
  provider: Pick<AIProvider, 'id' | 'credentialGroups'>
  modelId: string
  protocolAdapterId: ProviderModelCurrent['protocolAdapterId']
  endpointVariant: string
  rows: readonly ProviderModelCurrent[]
}): ProviderModelCurrent | undefined {
  const sourceKey = (source: ProviderCredentialSource) => source.kind === 'group' ? `group:${source.groupId}` : source.kind
  const expected = new Set(['primary', ...(input.provider.credentialGroups ?? []).filter((group) => group.enabled)
    .map((group) => sourceKey(group.source ?? { kind: 'group', groupId: group.id }))])
  const current = input.rows.filter((row) => !row.invalidated && row.providerId === input.provider.id
    && row.modelId === input.modelId && row.protocolAdapterId === input.protocolAdapterId
    && row.endpointVariant === input.endpointVariant && expected.has(sourceKey(row.credentialSource)))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const available = current.find((row) => row.availability === 'available')
  if (available) return available
  if ([...expected].some((source) => !current.some((row) => sourceKey(row.credentialSource) === source))
    || current.some((row) => !isProviderModelAvailabilityBlocked(row.availability))) return undefined
  return current.find((row) => row.availability === 'unavailable') ?? current[0]
}

export function credentialSourceLabel(source: ProviderCredentialSource, provider: AIProvider | undefined, t: TFunction): string {
  if (source.kind === 'primary') return t('modelAvailability.primaryCredential')
  if (source.kind === 'none') return t('modelAvailability.noCredential')
  const group = provider?.credentialGroups?.find((item) => item.id === source.groupId && item.source?.kind !== 'primary')
  return t('modelAvailability.credentialGroup', { group: group?.label || source.groupId })
}

/** No key values are present in provider metadata; only explicit authentication evidence is shown. */
export function hasCredentialBlockEvidence(provider: AIProvider | undefined): boolean {
  return provider?.lastTestStatus === 'bad' && ['missing_key', 'bad_auth', 'credential_mismatch'].includes(provider.lastTestCode ?? '')
}
