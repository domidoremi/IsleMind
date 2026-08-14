import type { AIProvider } from '@/types/providerContracts'
import type { ProviderModelTestEvidenceResult } from './providerModelTestEvidence'
import { projectProviderModelTestHealth } from './providerModelTestHealthProjection'
import type { ProviderOperationResult } from './providerOperationResult'

export interface ProviderModelHealthOptions {
  checkParameters?: boolean
  recordLastTestModel?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ProviderModelHealthOperationOptions {
  signal?: AbortSignal
}

export interface ProviderModelHealthPorts {
  updateProvider(
    id: string,
    updates: Partial<AIProvider>,
    options?: ProviderModelHealthOperationOptions,
  ): Promise<void>
  updateProviderCredentialGroupHealth(
    providerId: string,
    groupId: string | undefined,
    ok: boolean,
    options?: ProviderModelHealthOperationOptions,
  ): Promise<void>
}

export interface ProviderModelHealthDependencies {
  testProviderModel(
    provider: AIProvider,
    model: string,
    apiKey: string,
    options?: { checkParameters?: boolean; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ProviderOperationResult<ProviderModelTestEvidenceResult>>
  now?: () => number
}

export interface ProviderModelHealth {
  test(
    provider: AIProvider,
    model: string,
    apiKey: string,
    ports: ProviderModelHealthPorts,
    options?: ProviderModelHealthOptions,
  ): Promise<ProviderOperationResult<ProviderModelTestEvidenceResult>>
}

/** Owns model-health execution and the persisted provider/group health projection. */
export function createProviderModelHealth(
  dependencies: ProviderModelHealthDependencies,
): ProviderModelHealth {
  return {
    async test(provider, model, apiKey, ports, options = {}) {
      throwIfProviderModelHealthAborted(options.signal)
      try {
        const result = await dependencies.testProviderModel(provider, model, apiKey, {
          checkParameters: options.checkParameters,
          timeoutMs: options.timeoutMs,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        throwIfProviderModelHealthAborted(options.signal)

        const health = projectProviderModelTestHealth(result)
        const operation = options.signal ? { signal: options.signal } : {}
        if (health.credentialGroupHealth !== undefined) {
          await ports.updateProviderCredentialGroupHealth(
            provider.id,
            result.credentialGroupId,
            health.credentialGroupHealth,
            operation,
          )
          throwIfProviderModelHealthAborted(options.signal)
        }
        await ports.updateProvider(provider.id, {
          lastTestStatus: health.lastTestStatus,
          lastTestedAt: (dependencies.now ?? Date.now)(),
          ...(options.recordLastTestModel ? { lastTestModel: model } : {}),
          lastTestMessage: result.message,
          lastTestCode: result.code,
          lastModelTestCapabilityChecks: result.data?.capabilityChecks,
        }, operation)
        throwIfProviderModelHealthAborted(options.signal)
        return result
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) {
          throw createProviderModelHealthAbortError(options.signal?.reason ?? error)
        }
        throw error
      }
    },
  }
}

function throwIfProviderModelHealthAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createProviderModelHealthAbortError(signal.reason)
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
}

function createProviderModelHealthAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const message = reason instanceof Error && reason.message
    ? reason.message
    : 'Provider model health check was cancelled'
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
