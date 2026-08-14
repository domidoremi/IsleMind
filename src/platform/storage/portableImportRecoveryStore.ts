import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'

import {
  parsePortableImportRecoveryEnvelope,
  type PortableImportRecoveryEnvelopeV1,
} from '@/core'

export const PORTABLE_IMPORT_RECOVERY_ENVELOPE_STORAGE_KEY =
  '@islemind/vnext/portable-import-recovery/envelope-v1'
export const PORTABLE_IMPORT_RECOVERY_BLOB_STORAGE_KEY_PREFIX =
  '@islemind/vnext/portable-import-recovery/blob-v1/'

const PORTABLE_IMPORT_RECOVERY_LOCK_NAME = 'islemind:portable-import-recovery:v1'
const MAX_ENVELOPE_CHARACTERS = 64 * 1024
const MAX_BLOB_CHARACTERS = 64 * 1024 * 1024
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const fallbackLockTails = new Map<string, Promise<void>>()
const defaultAsyncStorageAdapter: PortableImportRecoveryStorageAdapter = {
  async getItem(key) {
    return AsyncStorage.getItem(key)
  },
  async setItem(key, value) {
    await AsyncStorage.setItem(key, value)
  },
  async removeItem(key) {
    await AsyncStorage.removeItem(key)
  },
}

export type PortableImportRecoveryStoreErrorCode =
  | 'read_failed'
  | 'write_failed'
  | 'delete_failed'
  | 'verification_failed'
  | 'conflict'
  | 'invalid_envelope'
  | 'invalid_blob_identity'
  | 'oversized'
  | 'digest_failed'

export class PortableImportRecoveryStoreError extends Error {
  readonly code: PortableImportRecoveryStoreErrorCode

  constructor(code: PortableImportRecoveryStoreErrorCode) {
    super(`Portable import recovery storage ${code.replaceAll('_', ' ')}.`)
    this.name = 'PortableImportRecoveryStoreError'
    this.code = code
  }
}

export interface PortableImportRecoveryStorageAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export type PortableImportRecoveryBlobStorageAdapter =
  PortableImportRecoveryStorageAdapter

export interface PortableImportRecoveryStore {
  readonly lockScope: 'cross-context' | 'runtime-only'
  runExclusive<Value>(work: () => Promise<Value>): Promise<Value>
  readEnvelope(): Promise<PortableImportRecoveryEnvelopeV1 | undefined>
  writeEnvelope(
    envelope: PortableImportRecoveryEnvelopeV1,
    expectedRevision: number | null,
  ): Promise<void>
  removeEnvelope(expectedRevision: number): Promise<void>
  readBlob(operationId: string, participantId: string): Promise<string | undefined>
  createBlob(operationId: string, participantId: string, value: string): Promise<void>
  removeBlob(operationId: string, participantId: string): Promise<void>
  readRaw(key: string): Promise<string | null>
  writeRaw(key: string, value: string | null): Promise<void>
  digest(value: string): Promise<string>
}

export interface CreatePortableImportRecoveryStoreOptions {
  readonly storage?: PortableImportRecoveryStorageAdapter
  /**
   * Durable storage for participant before-images. Native callers must bind a
   * large-value adapter because Android AsyncStorage is intentionally bounded.
   */
  readonly blobStorage?: PortableImportRecoveryBlobStorageAdapter
  readonly digest?: (value: string) => Promise<string>
}

export function createAsyncStoragePortableImportRecoveryStore(
  options: CreatePortableImportRecoveryStoreOptions = {},
): PortableImportRecoveryStore {
  const storage = options.storage ?? defaultAsyncStorageAdapter
  const blobStorage = options.blobStorage ?? storage
  const digest = options.digest ?? digestPortableImportRecoveryValue
  const webLocks = resolveWebLockManager()

  async function readStorageKey(key: string): Promise<string | null> {
    try {
      const value = await storage.getItem(key)
      if (value !== null && typeof value !== 'string') {
        throw new PortableImportRecoveryStoreError('read_failed')
      }
      return value
    } catch (error) {
      if (error instanceof PortableImportRecoveryStoreError) throw error
      throw new PortableImportRecoveryStoreError('read_failed')
    }
  }

  async function writeStorageKey(key: string, value: string | null): Promise<void> {
    try {
      if (value === null) await storage.removeItem(key)
      else await storage.setItem(key, value)
    } catch {
      throw new PortableImportRecoveryStoreError(value === null ? 'delete_failed' : 'write_failed')
    }
    const persisted = await readStorageKey(key)
    if (persisted !== value) throw new PortableImportRecoveryStoreError('verification_failed')
  }

  async function readBlobStorageKey(key: string): Promise<string | null> {
    try {
      return await blobStorage.getItem(key)
    } catch {
      throw new PortableImportRecoveryStoreError('read_failed')
    }
  }

  async function writeBlobStorageKey(key: string, value: string): Promise<void> {
    try {
      await blobStorage.setItem(key, value)
    } catch {
      throw new PortableImportRecoveryStoreError('write_failed')
    }
    if (await readBlobStorageKey(key) !== value) {
      throw new PortableImportRecoveryStoreError('verification_failed')
    }
  }

  async function removeBlobStorageKey(key: string): Promise<void> {
    try {
      await blobStorage.removeItem(key)
    } catch {
      throw new PortableImportRecoveryStoreError('delete_failed')
    }
    if (await readBlobStorageKey(key) !== null) {
      throw new PortableImportRecoveryStoreError('verification_failed')
    }
  }

  async function readEnvelope(): Promise<PortableImportRecoveryEnvelopeV1 | undefined> {
    const raw = await readStorageKey(PORTABLE_IMPORT_RECOVERY_ENVELOPE_STORAGE_KEY)
    if (raw === null) return undefined
    if (raw.length > MAX_ENVELOPE_CHARACTERS) {
      throw new PortableImportRecoveryStoreError('oversized')
    }
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throw new PortableImportRecoveryStoreError('invalid_envelope')
    }
    const parsed = parsePortableImportRecoveryEnvelope(parsedJson)
    if (!parsed.ok) throw new PortableImportRecoveryStoreError('invalid_envelope')
    return parsed.value
  }

  return Object.freeze({
    lockScope: webLocks ? 'cross-context' : 'runtime-only',
    runExclusive<Value>(work: () => Promise<Value>): Promise<Value> {
      return runWithWebOrRuntimeLock(PORTABLE_IMPORT_RECOVERY_LOCK_NAME, work, webLocks)
    },
    readEnvelope,
    async writeEnvelope(
      envelope: PortableImportRecoveryEnvelopeV1,
      expectedRevision: number | null,
    ) {
      const parsed = parsePortableImportRecoveryEnvelope(envelope)
      if (!parsed.ok) throw new PortableImportRecoveryStoreError('invalid_envelope')
      const current = await readEnvelope()
      if (
        (expectedRevision === null && current !== undefined) ||
        (expectedRevision !== null && current?.revision !== expectedRevision)
      ) {
        throw new PortableImportRecoveryStoreError('conflict')
      }
      const raw = JSON.stringify(parsed.value)
      if (raw.length > MAX_ENVELOPE_CHARACTERS) {
        throw new PortableImportRecoveryStoreError('oversized')
      }
      await writeStorageKey(PORTABLE_IMPORT_RECOVERY_ENVELOPE_STORAGE_KEY, raw)
      const verified = await readEnvelope()
      if (!verified || JSON.stringify(verified) !== raw) {
        throw new PortableImportRecoveryStoreError('verification_failed')
      }
    },
    async removeEnvelope(expectedRevision: number) {
      const current = await readEnvelope()
      if (!current || current.revision !== expectedRevision) {
        throw new PortableImportRecoveryStoreError('conflict')
      }
      await writeStorageKey(PORTABLE_IMPORT_RECOVERY_ENVELOPE_STORAGE_KEY, null)
    },
    async readBlob(operationId: string, participantId: string) {
      const key = recoveryBlobKey(operationId, participantId)
      const raw = await readBlobStorageKey(key)
      if (raw !== null && raw.length > MAX_BLOB_CHARACTERS) {
        throw new PortableImportRecoveryStoreError('oversized')
      }
      return raw ?? undefined
    },
    async createBlob(operationId: string, participantId: string, value: string) {
      const key = recoveryBlobKey(operationId, participantId)
      if (typeof value !== 'string' || value.length > MAX_BLOB_CHARACTERS) {
        throw new PortableImportRecoveryStoreError('oversized')
      }
      const current = await readBlobStorageKey(key)
      if (current !== null) {
        if (current === value) return
        throw new PortableImportRecoveryStoreError('conflict')
      }
      await writeBlobStorageKey(key, value)
    },
    async removeBlob(operationId: string, participantId: string) {
      const key = recoveryBlobKey(operationId, participantId)
      if (await readBlobStorageKey(key) === null) return
      await removeBlobStorageKey(key)
    },
    readRaw(key: string) {
      return readStorageKey(key)
    },
    writeRaw(key: string, value: string | null) {
      return writeStorageKey(key, value)
    },
    async digest(value: string) {
      try {
        const result = await digest(value)
        if (!/^sha256:[0-9a-f]{64}$/.test(result)) {
          throw new PortableImportRecoveryStoreError('digest_failed')
        }
        return result
      } catch (error) {
        if (error instanceof PortableImportRecoveryStoreError) throw error
        throw new PortableImportRecoveryStoreError('digest_failed')
      }
    },
  })
}

export async function digestPortableImportRecoveryValue(value: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.HEX },
  )
  return `sha256:${digest.toLowerCase()}`
}

function recoveryBlobKey(operationId: string, participantId: string): string {
  if (!IDENTIFIER_PATTERN.test(operationId) || !IDENTIFIER_PATTERN.test(participantId)) {
    throw new PortableImportRecoveryStoreError('invalid_blob_identity')
  }
  return `${PORTABLE_IMPORT_RECOVERY_BLOB_STORAGE_KEY_PREFIX}${operationId}/${participantId}`
}

interface PortableImportRecoveryWebLockManager {
  request<Value>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<Value>,
  ): Promise<Value>
}

function resolveWebLockManager(): PortableImportRecoveryWebLockManager | undefined {
  return (globalThis as {
    navigator?: { locks?: PortableImportRecoveryWebLockManager }
  }).navigator?.locks
}

function runWithWebOrRuntimeLock<Value>(
  name: string,
  work: () => Promise<Value>,
  webLocks: PortableImportRecoveryWebLockManager | undefined,
): Promise<Value> {
  if (webLocks) return webLocks.request(name, { mode: 'exclusive' }, work)

  const previous = fallbackLockTails.get(name) ?? Promise.resolve()
  const scheduled = previous.then(work, work)
  const tail = scheduled.then(() => undefined, () => undefined)
  fallbackLockTails.set(name, tail)
  void tail.finally(() => {
    if (fallbackLockTails.get(name) === tail) fallbackLockTails.delete(name)
  })
  return scheduled
}
