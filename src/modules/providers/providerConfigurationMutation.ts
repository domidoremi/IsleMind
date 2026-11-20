import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'

export interface ProviderConfigurationMutationOptions {
  signal?: AbortSignal
  expectedProvider?: Readonly<AIProvider> | null
  expectedProviders?: readonly Readonly<AIProvider>[]
}

export class ProviderConfigurationConflictError extends Error {
  constructor() {
    super('provider_configuration_conflict')
    this.name = 'ProviderConfigurationConflictError'
  }
}

export function snapshotProviderConfiguration<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshotProviderConfiguration) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotProviderConfiguration(item)])) as T
  }
  return value
}

export function assertProviderConfiguration(
  current: AIProvider | undefined,
  expected: Readonly<AIProvider> | null | undefined,
): void {
  if (expected === undefined) return
  if (expected === null ? current !== undefined : !current || !equalValues(current, expected)) {
    throw new ProviderConfigurationConflictError()
  }
}

function equalValues(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalValues(value, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => equalValues(a[key], b[key]))
}

/** Only execution health is excluded. Catalogs, keys and all configuration remain guarded. */
export function withoutProviderCredentialHealth(provider: Readonly<AIProvider>): AIProvider {
  return { ...provider, credentialGroups: provider.credentialGroups?.map(group => ({
    ...group, lastUsedAt: undefined, lastFailureAt: undefined, failureCount: undefined,
  })) }
}

/** Dispatch keeps configuration stable while accepting newer execution-only health. */
export function assertProviderSelectionConfiguration(
  current: AIProvider | undefined,
  expected: Readonly<AIProvider> | null | undefined,
): void {
  assertProviderConfiguration(current && withoutProviderCredentialHealth(current),
    expected == null ? expected : withoutProviderCredentialHealth(expected))
}

/** Rebase retained keys at metadata commit, including updates during secure-storage awaits. */
export function preserveProviderCredentialHealth(
  groups: readonly ProviderCredentialGroup[],
  currentGroups: readonly ProviderCredentialGroup[] | undefined,
  replacedGroupIds: ReadonlySet<string> = new Set(),
): ProviderCredentialGroup[] {
  const current = new Map(currentGroups?.map(group => [group.id, group]))
  return groups.map(group => {
    if (replacedGroupIds.has(group.id)) return { ...group,
      lastUsedAt: undefined, lastFailureAt: undefined, failureCount: 0 }
    const latest = current.get(group.id)
    return latest ? { ...group, lastUsedAt: latest.lastUsedAt,
      lastFailureAt: latest.lastFailureAt, failureCount: latest.failureCount } : group
  })
}
