export type SecureKeyValueStorageErrorCode =
  | 'read_failed'
  | 'write_failed'
  | 'delete_failed'
  | 'verification_failed'

export type SecureKeyValueStorageOperation = 'read' | 'write' | 'delete'

export class SecureKeyValueStorageError extends Error {
  readonly code: SecureKeyValueStorageErrorCode
  readonly operation: SecureKeyValueStorageOperation

  constructor(code: SecureKeyValueStorageErrorCode, operation: SecureKeyValueStorageOperation) {
    super(`Secure storage ${operation} failed.`)
    this.name = 'SecureKeyValueStorageError'
    this.code = code
    this.operation = operation
  }
}

export interface SecureKeyValueStoragePort {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/**
 * Serializes secure-storage effects and verifies every mutation by rereading the
 * exact key. Raw platform failures and verification failures are deliberately
 * projected without the key, value, or platform error text.
 */
export function createVerifiedSecureKeyValueStorage(
  port: SecureKeyValueStoragePort,
): SecureKeyValueStoragePort {
  let operationQueue: Promise<void> = Promise.resolve()

  function enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function readRaw(key: string, code: SecureKeyValueStorageErrorCode): Promise<string | null> {
    try {
      const value = await port.getItem(key)
      if (value !== null && typeof value !== 'string') {
        throw new SecureKeyValueStorageError(code, 'read')
      }
      return value
    } catch {
      throw new SecureKeyValueStorageError(code, 'read')
    }
  }

  return Object.freeze({
    getItem(key: string) {
      return enqueue(() => readRaw(key, 'read_failed'))
    },
    setItem(key: string, value: string) {
      return enqueue(async () => {
        try {
          await port.setItem(key, value)
        } catch {
          throw new SecureKeyValueStorageError('write_failed', 'write')
        }
        const persisted = await readRaw(key, 'verification_failed')
        if (persisted !== value) {
          throw new SecureKeyValueStorageError('verification_failed', 'write')
        }
      })
    },
    removeItem(key: string) {
      return enqueue(async () => {
        try {
          await port.removeItem(key)
        } catch {
          throw new SecureKeyValueStorageError('delete_failed', 'delete')
        }
        const persisted = await readRaw(key, 'verification_failed')
        if (persisted !== null) {
          throw new SecureKeyValueStorageError('verification_failed', 'delete')
        }
      })
    },
  })
}
