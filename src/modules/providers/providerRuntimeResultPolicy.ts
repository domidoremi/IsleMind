import type { ChatErrorCode } from '@/types/providerContracts'

export interface CredentialScopedResult {
  credentialGroupId?: string
}

export interface ProviderRuntimeError extends Error {
  credentialGroupId?: string
  chatErrorCode?: ChatErrorCode
}

export type RuntimeErrorCallback = (error: Error) => void

export interface ProviderRuntimeResultPolicyDependencies {
  nonErrorFallbackMessage(): string
}

export interface ProviderRuntimeResultPolicy {
  withCredentialGroup: typeof withCredentialGroup
  providerRuntimeError: typeof providerRuntimeError
  runStreamTask(
    task: () => Promise<void>,
    onError: RuntimeErrorCallback,
    credentialGroupId?: string,
    signal?: AbortSignal,
  ): Promise<void>
}

export function withCredentialGroup<T>(result: T, credentialGroupId: string | undefined): T & CredentialScopedResult {
  return credentialGroupId ? { ...result, credentialGroupId } : result as T & CredentialScopedResult
}

export function providerRuntimeError(
  message: string,
  credentialGroupId?: string,
  chatErrorCode?: ChatErrorCode,
): ProviderRuntimeError {
  const error = new Error(message) as ProviderRuntimeError
  error.credentialGroupId = credentialGroupId
  error.chatErrorCode = chatErrorCode
  return error
}

export function createProviderRuntimeResultPolicy(
  dependencies: ProviderRuntimeResultPolicyDependencies,
): ProviderRuntimeResultPolicy {
  function runStreamTask(
    task: () => Promise<void>,
    onError: RuntimeErrorCallback,
    credentialGroupId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return task().catch((error: unknown) => {
      if (signal?.aborted && error === signal.reason) return
      const runtimeError = error instanceof Error
        ? error as ProviderRuntimeError
        : providerRuntimeError(dependencies.nonErrorFallbackMessage())
      runtimeError.credentialGroupId = runtimeError.credentialGroupId ?? credentialGroupId
      if (runtimeError.name !== 'AbortError') {
        onError(runtimeError)
      }
    })
  }

  return {
    withCredentialGroup,
    providerRuntimeError,
    runStreamTask,
  }
}
