import type { ReasoningEffort } from '@/core'
import type {
  AIProvider,
  ProviderOperationCode,
} from '@/types/providerContracts'
import {
  buildProviderModelProbeResult,
  type ProviderModelTestCapability,
  type ProviderModelTestCapabilityResolution,
  type ProviderModelTestEvidenceResult,
} from './providerModelTestEvidence'
import { failure, success, type ProviderOperationResult } from './providerOperationResult'
import {
  isCredentiallessLocalProvider,
  type ProviderProbePort,
  type ProviderProbeEvidence,
} from './providerProbe'

export interface ProviderModelTestOptions {
  checkParameters?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ProviderModelTestRequest {
  provider: AIProvider
  model: string
  requestedModel: string
  messages: readonly [{ role: 'user'; content: string }]
  reasoningEffort?: ReasoningEffort
  maxTokens: number
  stream: false
}

export interface ProviderModelTestIssue {
  code: ProviderOperationCode
  message: string
}

export interface PreparedProviderModelTestRequest {
  url: string
  headers: Record<string, string>
  body: BodyInit
}

export interface ProviderModelTestMessages {
  saveApiKeyFirst: string
  chooseModelFirst: string
  emptyModelResponse: string
  modelTestPassed: string
}

export interface ProviderModelTestDependencies {
  defaultTimeoutMs: number
  messages: ProviderModelTestMessages
  resolveUpstreamModel(provider: AIProvider, model: string): string
  selectCredential(provider: AIProvider, model: string): { apiKey: string; credentialGroupId?: string }
  credentialGroupId(provider: AIProvider, apiKey: string): string | undefined
  configurationIssue(provider: AIProvider, apiKey: string): ProviderModelTestIssue | undefined
  hostedIssue(provider: AIProvider): ProviderModelTestIssue | undefined
  reasoningEffortOptions(provider: AIProvider, model: string): readonly ReasoningEffort[]
  maxOutputTokens(provider: AIProvider, model: string): number
  normalizeModelId(model: string): string
  usesResponsesApi(request: ProviderModelTestRequest): boolean
  resolveEndpoint(request: ProviderModelTestRequest, usesResponsesApi: boolean): string
  buildPayload(request: ProviderModelTestRequest, endpoint: string): Record<string, unknown>
  resolveCapability(
    provider: AIProvider,
    model: string,
    capability: ProviderModelTestCapability,
  ): ProviderModelTestCapabilityResolution
  prepareRequest(
    provider: AIProvider,
    model: string,
    url: string,
    payload: Record<string, unknown>,
  ): PreparedProviderModelTestRequest
  request(
    request: PreparedProviderModelTestRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response>
  readErrorText(response: Response): Promise<string>
  classifyHttpStatus(status: number, responseText: string, model: string, provider: AIProvider): ProviderOperationCode
  formatHttpError(status: number, responseText: string, provider: AIProvider, model: string): string
  parseResponseText(response: Response, provider: AIProvider): Promise<string>
  fetchFailure(error: unknown, credentialGroupId?: string): ProviderOperationResult<ProviderModelTestEvidenceResult>
  /** New no-generation implementation. Omission is a fail-closed transitional state. */
  probe?: ProviderProbePort
  usesResponsesApiForModel?(provider: AIProvider, model: string): boolean
}

export interface ProviderModelTest {
  testDetailed(
    provider: AIProvider,
    model: string,
    apiKey: string,
    options?: ProviderModelTestOptions,
  ): Promise<ProviderOperationResult<ProviderModelTestEvidenceResult>>
}

/** Owns model-test admission, wire execution, evidence, and normalized results. */
export function createProviderModelTest(dependencies: ProviderModelTestDependencies): ProviderModelTest {
  return {
    async testDetailed(provider, model, apiKey, options = {}) {
      throwIfProviderModelTestAborted(options.signal)
      const upstreamModel = dependencies.resolveUpstreamModel(provider, model)
      if (!apiKey.trim() && !isCredentiallessLocalProvider(provider)) {
        return failure('missing_key', dependencies.messages.saveApiKeyFirst)
      }

      const selected = dependencies.selectCredential(provider, model)
      const selectedGroupId = selected.apiKey === apiKey
        ? selected.credentialGroupId
        : dependencies.credentialGroupId(provider, apiKey)
      const configuredProvider = { ...provider, apiKey: apiKey.trim() }
      const configurationIssue = dependencies.configurationIssue(configuredProvider, apiKey)
      if (configurationIssue) {
        return failure(configurationIssue.code, configurationIssue.message)
      }
      const hostedIssue = dependencies.hostedIssue(configuredProvider)
      if (hostedIssue) {
        return withCredentialGroup(
          failure(hostedIssue.code, hostedIssue.message),
          selectedGroupId,
        )
      }
      if (!upstreamModel.trim()) {
        return failure('model_unavailable', dependencies.messages.chooseModelFirst)
      }
      if (!dependencies.probe) {
        return withCredentialGroup(
          failure('models_endpoint_unavailable', 'Provider model discovery probe is unavailable'),
          selectedGroupId,
        )
      }

      try {
        throwIfProviderModelTestAborted(options.signal)
        const probeResult = await dependencies.probe.probe({
          provider: configuredProvider,
          model: upstreamModel,
          requestedModel: model,
          apiKey,
          timeoutMs: options.timeoutMs ?? dependencies.defaultTimeoutMs,
          signal: options.signal,
        })
        if (probeResult.evidence.classification === 'cancelled') {
          throw createProviderModelTestAbortError(options.signal?.reason)
        }
        const evidence = buildProviderModelProbeResult({
          requestedModel: model,
          upstreamModel,
          usesResponsesApi: dependencies.usesResponsesApiForModel?.(
            configuredProvider,
            upstreamModel,
          ) === true,
          checkParameters: options.checkParameters !== false,
          resolveCapability: (capability) => dependencies.resolveCapability(
            configuredProvider,
            upstreamModel,
            capability,
          ),
        })
        if (!probeResult.ok) return providerProbeFailureResult(
          probeResult.evidence,
          evidence,
          configuredProvider,
          model,
          selectedGroupId,
          dependencies,
        )
        return success(dependencies.messages.modelTestPassed, evidence, selectedGroupId)
      } catch (error) {
        if (options.signal?.aborted) {
          throw createProviderModelTestAbortError(options.signal.reason)
        }
        return dependencies.fetchFailure(error, selectedGroupId)
      }
    },
  }
}

function throwIfProviderModelTestAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createProviderModelTestAbortError(signal.reason)
}

function createProviderModelTestAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const message = reason instanceof Error && reason.message
    ? reason.message
    : 'Provider model test was cancelled'
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function providerProbeFailureResult(
  probe: ProviderProbeEvidence,
  evidence: ProviderModelTestEvidenceResult,
  provider: AIProvider,
  model: string,
  credentialGroupId: string | undefined,
  dependencies: ProviderModelTestDependencies,
): ProviderOperationResult<ProviderModelTestEvidenceResult> {
  const detail = probe.redactedReason ?? ''
  switch (probe.classification) {
    case 'credential_required':
      return failure('missing_key', dependencies.messages.saveApiKeyFirst, evidence, credentialGroupId)
    case 'authentication_failed':
      return failure(
        'bad_auth',
        dependencies.formatHttpError(probe.httpStatus ?? 401, detail, provider, model),
        evidence,
        credentialGroupId,
      )
    case 'model_unavailable':
      return failure(
        'model_unavailable',
        dependencies.formatHttpError(404, detail || `model ${probe.upstreamModel} not found`, provider, model),
        evidence,
        credentialGroupId,
      )
    case 'quota_exhausted':
    case 'rate_limited':
      return failure(
        'rate_limited',
        dependencies.formatHttpError(probe.httpStatus ?? 429, detail, provider, model),
        evidence,
        credentialGroupId,
      )
    case 'unsupported_route':
    case 'malformed_response':
      return failure(
        'models_endpoint_unavailable',
        detail || 'Provider model discovery did not return a usable catalog',
        evidence,
        credentialGroupId,
      )
    case 'invalid_configuration':
      return failure('bad_base_url', detail || 'Invalid provider configuration', evidence, credentialGroupId)
    case 'http_error': {
      const status = probe.httpStatus ?? 500
      return failure(
        dependencies.classifyHttpStatus(status, detail, probe.upstreamModel, provider),
        dependencies.formatHttpError(status, detail, provider, model),
        evidence,
        credentialGroupId,
      )
    }
    case 'timed_out': {
      const error = new Error(detail || 'Provider model discovery timed out')
      error.name = 'AbortError'
      const result = dependencies.fetchFailure(error, credentialGroupId)
      return { ...result, data: evidence }
    }
    case 'network_error': {
      const result = dependencies.fetchFailure(new Error(detail || 'network error'), credentialGroupId)
      return { ...result, data: evidence }
    }
    case 'cancelled':
      throw createProviderModelTestAbortError(detail)
    case 'reachable':
      return success(dependencies.messages.modelTestPassed, evidence, credentialGroupId)
  }
}

function withCredentialGroup<T>(
  result: ProviderOperationResult<T>,
  credentialGroupId: string | undefined,
): ProviderOperationResult<T> {
  return credentialGroupId ? { ...result, credentialGroupId } : result
}
