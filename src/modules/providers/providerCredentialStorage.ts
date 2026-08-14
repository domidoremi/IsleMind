import type { SecureKeyValueStoragePort } from '@/core'

export type ProviderCredentialStorageErrorCode =
  | 'invalid_identity'
  | 'read_failed'
  | 'write_failed'
  | 'delete_failed'
  | 'verification_failed'
  | 'rollback_failed'

export type ProviderCredentialStorageScope = 'provider' | 'credential_group' | 'replacement'

export class ProviderCredentialStorageError extends Error {
  readonly code: ProviderCredentialStorageErrorCode
  readonly scope: ProviderCredentialStorageScope

  constructor(code: ProviderCredentialStorageErrorCode, scope: ProviderCredentialStorageScope) {
    super(`Provider credential storage ${scope} operation failed.`)
    this.name = 'ProviderCredentialStorageError'
    this.code = code
    this.scope = scope
  }
}

export interface ProviderCredentialInventory {
  readonly providerId: string
  readonly credentialGroupIds?: readonly string[]
}

export interface ProviderCredentialReplacement {
  readonly providerId: string
  readonly credential?: string | null
  readonly credentialGroups?: readonly Readonly<{
    groupId: string
    credential?: string | null
  }>[]
}

export interface ProviderCredentialReplacementInput {
  readonly current: readonly ProviderCredentialInventory[]
  readonly replacement: readonly ProviderCredentialReplacement[]
}

export interface ProviderCredentialMutation {
  readonly providerId: string
  readonly groupId?: string
  readonly credential: string | null
}

export interface ProviderCredentialStorage {
  getProviderCredential(providerId: string): Promise<string | null>
  setProviderCredential(providerId: string, credential: string): Promise<void>
  deleteProviderCredential(providerId: string): Promise<void>
  getCredentialGroupCredential(providerId: string, groupId: string): Promise<string | null>
  setCredentialGroupCredential(providerId: string, groupId: string, credential: string): Promise<void>
  deleteCredentialGroupCredential(providerId: string, groupId: string): Promise<void>
  applyMutations(mutations: readonly ProviderCredentialMutation[]): Promise<void>
  replaceCredentials(input: ProviderCredentialReplacementInput): Promise<void>
}

export function providerCredentialStorageKey(providerId: string): string {
  return `islemind.key.${credentialIdentitySegment(providerId, 'provider')}`
}

export function providerCredentialGroupStorageKey(providerId: string, groupId: string): string {
  return `${providerCredentialStorageKey(providerId)}.${credentialIdentitySegment(groupId, 'credential_group')}`
}

/**
 * Owns stable provider key identities, verified effects, and rollback of a
 * portable-import credential replacement. No error includes a key or secret.
 */
export function createProviderCredentialStorage(
  storage: SecureKeyValueStoragePort,
): ProviderCredentialStorage {
  let operationQueue: Promise<void> = Promise.resolve()

  function enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function readKey(key: string, scope: ProviderCredentialStorageScope): Promise<string | null> {
    try {
      return await storage.getItem(key)
    } catch (error) {
      throw projectStorageError(error, scope, 'read_failed')
    }
  }

  async function setKey(key: string, value: string, scope: ProviderCredentialStorageScope): Promise<void> {
    if (!value) throw new ProviderCredentialStorageError('write_failed', scope)
    try {
      await storage.setItem(key, value)
    } catch (error) {
      throw projectStorageError(error, scope, 'write_failed')
    }
  }

  async function deleteKey(key: string, scope: ProviderCredentialStorageScope): Promise<void> {
    try {
      await storage.removeItem(key)
    } catch (error) {
      throw projectStorageError(error, scope, 'delete_failed')
    }
  }

  async function applyTarget(target: ReadonlyMap<string, string | null>): Promise<void> {
    const keys = [...target.keys()].sort()
    const before = new Map<string, string | null>()
    for (const key of keys) before.set(key, await readKey(key, 'replacement'))

    try {
      for (const key of keys) {
        const value = target.get(key) ?? null
        if (value === null) await deleteKey(key, 'replacement')
        else await setKey(key, value, 'replacement')
      }
    } catch (error) {
      let rollbackFailed = false
      for (const key of [...keys].reverse()) {
        try {
          const value = before.get(key) ?? null
          if (value === null) await deleteKey(key, 'replacement')
          else await setKey(key, value, 'replacement')
        } catch {
          rollbackFailed = true
        }
      }
      if (rollbackFailed) {
        throw new ProviderCredentialStorageError('rollback_failed', 'replacement')
      }
      if (error instanceof ProviderCredentialStorageError) throw error
      throw new ProviderCredentialStorageError('write_failed', 'replacement')
    }
  }

  return Object.freeze({
    getProviderCredential(providerId: string) {
      const key = providerCredentialStorageKey(providerId)
      return enqueue(() => readKey(key, 'provider'))
    },
    setProviderCredential(providerId: string, credential: string) {
      const key = providerCredentialStorageKey(providerId)
      return enqueue(() => setKey(key, credential, 'provider'))
    },
    deleteProviderCredential(providerId: string) {
      const key = providerCredentialStorageKey(providerId)
      return enqueue(() => deleteKey(key, 'provider'))
    },
    getCredentialGroupCredential(providerId: string, groupId: string) {
      const key = providerCredentialGroupStorageKey(providerId, groupId)
      return enqueue(() => readKey(key, 'credential_group'))
    },
    setCredentialGroupCredential(providerId: string, groupId: string, credential: string) {
      const key = providerCredentialGroupStorageKey(providerId, groupId)
      return enqueue(() => setKey(key, credential, 'credential_group'))
    },
    deleteCredentialGroupCredential(providerId: string, groupId: string) {
      const key = providerCredentialGroupStorageKey(providerId, groupId)
      return enqueue(() => deleteKey(key, 'credential_group'))
    },
    applyMutations(mutations: readonly ProviderCredentialMutation[]) {
      return enqueue(() => applyTarget(buildMutationTarget(mutations)))
    },
    replaceCredentials(input: ProviderCredentialReplacementInput) {
      return enqueue(() => applyTarget(buildReplacementTarget(input)))
    },
  })
}

function buildMutationTarget(mutations: readonly ProviderCredentialMutation[]): Map<string, string | null> {
  if (!Array.isArray(mutations)) {
    throw new ProviderCredentialStorageError('invalid_identity', 'replacement')
  }
  const target = new Map<string, string | null>()
  const identities = new Map<string, string>()
  for (const mutation of mutations) {
    if (
      !isPlainRecord(mutation) ||
      typeof mutation.providerId !== 'string' ||
      (mutation.groupId !== undefined && typeof mutation.groupId !== 'string') ||
      (mutation.credential !== null && typeof mutation.credential !== 'string')
    ) {
      throw new ProviderCredentialStorageError('invalid_identity', 'replacement')
    }
    const providerId = mutation.providerId as string
    const groupId = mutation.groupId as string | undefined
    const credential = mutation.credential as string | null
    const hasGroup = groupId !== undefined
    const key = hasGroup
      ? providerCredentialGroupStorageKey(providerId, groupId)
      : providerCredentialStorageKey(providerId)
    const identity = hasGroup
      ? `group:${providerId}:${groupId}`
      : `provider:${providerId}`
    registerTarget(target, identities, key, identity, normalizeReplacementCredential(credential))
  }
  return target
}

function buildReplacementTarget(input: ProviderCredentialReplacementInput): Map<string, string | null> {
  if (!isPlainRecord(input) || !Array.isArray(input.current) || !Array.isArray(input.replacement)) {
    throw new ProviderCredentialStorageError('invalid_identity', 'replacement')
  }
  const target = new Map<string, string | null>()
  const identities = new Map<string, string>()
  for (const provider of input.current) {
    const providerKey = providerCredentialStorageKey(provider.providerId)
    registerTarget(target, identities, providerKey, `provider:${provider.providerId}`, null)
    for (const groupId of provider.credentialGroupIds ?? []) {
      registerTarget(
        target,
        identities,
        providerCredentialGroupStorageKey(provider.providerId, groupId),
        `group:${provider.providerId}:${groupId}`,
        null,
      )
    }
  }

  for (const provider of input.replacement) {
    const providerKey = providerCredentialStorageKey(provider.providerId)
    registerTarget(
      target,
      identities,
      providerKey,
      `provider:${provider.providerId}`,
      normalizeReplacementCredential(provider.credential),
    )
    for (const group of provider.credentialGroups ?? []) {
      registerTarget(
        target,
        identities,
        providerCredentialGroupStorageKey(provider.providerId, group.groupId),
        `group:${provider.providerId}:${group.groupId}`,
        normalizeReplacementCredential(group.credential),
      )
    }
  }
  return target
}

function registerTarget(
  target: Map<string, string | null>,
  identities: Map<string, string>,
  key: string,
  identity: string,
  value: string | null,
): void {
  const previous = identities.get(key)
  if (previous && previous !== identity) {
    throw new ProviderCredentialStorageError('invalid_identity', 'replacement')
  }
  identities.set(key, identity)
  target.set(key, value)
}

function normalizeReplacementCredential(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') {
    throw new ProviderCredentialStorageError('invalid_identity', 'replacement')
  }
  return value
}

function credentialIdentitySegment(value: string, scope: ProviderCredentialStorageScope): string {
  if (typeof value !== 'string' || !value || value.length > 256) {
    throw new ProviderCredentialStorageError('invalid_identity', scope)
  }
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function projectStorageError(
  error: unknown,
  scope: ProviderCredentialStorageScope,
  fallback: ProviderCredentialStorageErrorCode,
): ProviderCredentialStorageError {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (code === 'read_failed' || code === 'write_failed' || code === 'delete_failed' || code === 'verification_failed') {
      return new ProviderCredentialStorageError(code, scope)
    }
  }
  return new ProviderCredentialStorageError(fallback, scope)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
