import { st } from '@/i18n/service'
import type { ChatErrorCode } from '@/types'

export interface CredentialScopedResult {
  credentialGroupId?: string
}

export interface ProviderRuntimeError extends Error {
  credentialGroupId?: string
  chatErrorCode?: ChatErrorCode
}

export type RuntimeErrorCallback = (error: Error) => void

export function withCredentialGroup<T>(result: T, credentialGroupId: string | undefined): T & CredentialScopedResult {
  return credentialGroupId ? { ...result, credentialGroupId } : result as T & CredentialScopedResult
}

export function providerRuntimeError(message: string, credentialGroupId?: string, chatErrorCode?: ChatErrorCode): ProviderRuntimeError {
  const error = new Error(message) as ProviderRuntimeError
  error.credentialGroupId = credentialGroupId
  error.chatErrorCode = chatErrorCode
  return error
}

export function runStreamTask(task: () => Promise<void>, onError: RuntimeErrorCallback, credentialGroupId?: string): Promise<void> {
  return task().catch((error: unknown) => {
    const err = error instanceof Error ? error as ProviderRuntimeError : providerRuntimeError(st('providerOperation.requestFailed'))
    err.credentialGroupId = err.credentialGroupId ?? credentialGroupId
    if (err.name !== 'AbortError') {
      onError(err)
    }
  })
}
