import { MODEL_PARAMETER_BASELINE_SCHEMA, type GenerationParameterKey } from '@/core'
import type { ProviderModelParameterConfiguration } from '@/types/providerContracts'
import type { ProviderModelParameterBaseline, ProviderRuntimeChatRequest } from './providerRuntimeContracts'

export const PROVIDER_MODEL_PARAMETERS_SCHEMA = 'islemind.provider-model-parameters.v1' as const
const keys: readonly GenerationParameterKey[] = ['temperature', 'topP', 'topK', 'maxTokens']

export function parseProviderModelParameterConfiguration(value: unknown): ProviderModelParameterConfiguration | undefined {
  if (value === undefined) return undefined
  if (!record(value) || value.schema !== PROVIDER_MODEL_PARAMETERS_SCHEMA || !record(value.models)
    || Object.keys(value).some(key => key !== 'schema' && key !== 'models')
    || Object.keys(value.models).length > 256) throw new Error('Invalid saved model parameters.')
  const models: ProviderModelParameterConfiguration['models'] = {}
  for (const [model, fields] of Object.entries(value.models)) {
    if (!model || model.length > 240 || model.trim() !== model || /[\u0000-\u001f\u007f]/u.test(model)
      || ['__proto__', 'constructor', 'prototype'].includes(model) || !record(fields)
      || Object.keys(fields).some(key => !keys.includes(key as GenerationParameterKey))) throw new Error('Invalid saved model parameters.')
    const parameters: ProviderModelParameterConfiguration['models'][string] = {}
    for (const key of keys) {
      const field = fields[key]
      if (field === undefined) continue
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0
        || (key === 'temperature' && field > 2) || (key === 'topP' && field > 1)
        || ((key === 'topK' || key === 'maxTokens') && (!Number.isSafeInteger(field) || field < 1))) {
        throw new Error('Invalid saved model parameters.')
      }
      parameters[key] = field
    }
    if (Object.keys(parameters).length) models[model] = parameters
  }
  return Object.keys(models).length ? { schema: PROVIDER_MODEL_PARAMETERS_SCHEMA, models } : undefined
}

/** Resolve after choosing the connection/model, while retaining the caller's baseline for fallback. */
export type ProviderModelParameterRequest = Pick<ProviderRuntimeChatRequest,
  'provider' | 'model' | 'requestedModel' | 'temperature' | 'topP' | 'topK' | 'maxTokens' | 'generationParameterSources' | 'modelParameterBaseline'>

export function applyProviderModelParameterOverrides<T extends ProviderModelParameterRequest>(request: T): T {
  const configuration = parseProviderModelParameterConfiguration(request.provider.modelParameterOverrides)
  const previous = request.modelParameterBaseline
  const baseline: ProviderModelParameterBaseline = previous ?? {
    schema: MODEL_PARAMETER_BASELINE_SCHEMA,
    values: { temperature: request.temperature, topP: request.topP, topK: request.topK, maxTokens: request.maxTokens },
    sources: { ...request.generationParameterSources },
  }
  const overrides = configuration?.models[request.requestedModel ?? request.model]
  const values = { ...baseline.values }
  const sources = { ...baseline.sources }
  let applied = false
  for (const key of keys) {
    if (sources[key] !== 'provider-default' || overrides?.[key] === undefined) continue
    values[key] = overrides[key]
    sources[key] = 'explicit'
    applied = true
  }
  return applied || previous ? {
    ...request, ...values, generationParameterSources: sources, modelParameterBaseline: baseline,
  } : request
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
