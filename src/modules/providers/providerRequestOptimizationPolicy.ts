import type { ReasoningEffort } from '@/core'
import type { AIProvider } from '@/types/providerContracts'

import {
  normalizeAnthropicEffort,
  supportsAnthropicAdaptiveThinking,
  usesAnthropicOutputConfigOnlyThinking,
} from './providerAnthropicThinking'

export type ProviderRequestOptimizationProvider =
  Pick<
    AIProvider,
    | 'id'
    | 'name'
    | 'baseUrl'
    | 'presetId'
    | 'detectedPresetId'
    | 'type'
    | 'wireProtocol'
  > &
  Partial<
    Pick<
      AIProvider,
      'apiKey' | 'models' | 'enabled' | 'capabilities' | 'modelConfigs'
    >
  >

export interface ProviderRequestOptimizationSettings {
  bedrockRequestOptimizerEnabled?: boolean
  thinkingOptimizerEnabled?: boolean
  cacheInjectionEnabled?: boolean
  cacheTtl?: 'default' | '5m' | '1h'
}

export interface ProviderRequestOptimizationInput {
  provider: ProviderRequestOptimizationProvider
  model: string
  reasoningEffort?: ReasoningEffort
  fallbackMaxTokens?: number
  settings?: ProviderRequestOptimizationSettings
}

export interface ProviderRequestOptimizationPolicyDependencies {
  isAwsBedrockProvider(provider: ProviderRequestOptimizationProvider): boolean
  isBedrockRuntimeProvider(provider: ProviderRequestOptimizationProvider): boolean
  providerReasoningCanBeSent(input: {
    provider: ProviderRequestOptimizationProvider
    model: string
    reasoningEffort?: ReasoningEffort
  }): boolean
}

export interface ProviderRequestOptimizationPolicy {
  optimizeRequestBody(
    body: Record<string, unknown>,
    request: ProviderRequestOptimizationInput,
  ): Record<string, unknown>
  optimizeBedrockThinking(
    body: Record<string, unknown>,
    request: ProviderRequestOptimizationInput,
  ): Record<string, unknown>
  isBedrockProvider(provider: ProviderRequestOptimizationProvider): boolean
}

export function createProviderRequestOptimizationPolicy(
  dependencies: ProviderRequestOptimizationPolicyDependencies,
): ProviderRequestOptimizationPolicy {
  function isBedrockProvider(provider: ProviderRequestOptimizationProvider): boolean {
    return dependencies.isAwsBedrockProvider(provider)
  }

  function optimizeBedrockThinking(
    body: Record<string, unknown>,
    request: ProviderRequestOptimizationInput,
  ): Record<string, unknown> {
    if (!isAnthropicWireProvider(request.provider)) return body
    if (!dependencies.providerReasoningCanBeSent(request)) return body

    if (usesAnthropicOutputConfigOnlyThinking(request.model)) {
      return {
        ...body,
        output_config: {
          ...(body.output_config as Record<string, unknown> | undefined),
          effort: normalizeAnthropicEffort(
            request.model,
            request.reasoningEffort ?? 'medium',
          ),
        },
      }
    }

    if (supportsAnthropicAdaptiveThinking(request.model)) {
      return {
        ...body,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: {
          ...(body.output_config as Record<string, unknown> | undefined),
          effort: normalizeAnthropicEffort(
            request.model,
            request.reasoningEffort ?? 'medium',
          ),
        },
      }
    }

    if (body.thinking) return body
    const maxTokens = numberValue(body.max_tokens) ?? request.fallbackMaxTokens ?? 4096
    return {
      ...body,
      thinking: {
        type: 'enabled',
        budget_tokens: Math.min(32000, Math.max(1024, maxTokens - 1)),
      },
      max_tokens: Math.max(maxTokens, 4096),
    }
  }

  function optimizeRequestBody(
    body: Record<string, unknown>,
    request: ProviderRequestOptimizationInput,
  ): Record<string, unknown> {
    if (
      !isBedrockProvider(request.provider) ||
      !dependencies.isBedrockRuntimeProvider(request.provider) ||
      !isAnthropicWireProvider(request.provider) ||
      request.settings?.bedrockRequestOptimizerEnabled !== true
    ) {
      return body
    }

    let next = { ...body }
    if (request.settings.thinkingOptimizerEnabled === true) {
      next = optimizeBedrockThinking(next, request)
    }
    if (request.settings.cacheInjectionEnabled === true) {
      next = injectBedrockCache(next, request.settings.cacheTtl ?? 'default')
    }
    return next
  }

  return {
    isBedrockProvider,
    optimizeBedrockThinking,
    optimizeRequestBody,
  }
}

export function isAnthropicWireProvider(
  provider: Pick<AIProvider, 'type' | 'wireProtocol'>,
): boolean {
  return provider.wireProtocol === 'anthropic-compatible' || provider.type === 'anthropic'
}

export function injectBedrockCache(
  body: Record<string, unknown>,
  ttl: 'default' | '5m' | '1h',
): Record<string, unknown> {
  const cacheControl = ttl === 'default'
    ? { type: 'ephemeral' }
    : { type: 'ephemeral', ttl }
  const next = { ...body }

  if (typeof next.system === 'string' && next.system.trim()) {
    next.system = [{ type: 'text', text: next.system, cache_control: cacheControl }]
  }

  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message, index) => {
      if (!message || typeof message !== 'object') return message
      const record = message as Record<string, unknown>
      if (
        !Array.isArray(record.content) ||
        (index !== 0 && index !== (next.messages as unknown[]).length - 1)
      ) {
        return record
      }
      return {
        ...record,
        content: addCacheControlToLastTextPart(record.content, cacheControl),
      }
    })
  }

  return next
}

function addCacheControlToLastTextPart(
  content: unknown[],
  cacheControl: Record<string, unknown>,
): unknown[] {
  const next = [...content]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const part = next[index]
    if (
      part &&
      typeof part === 'object' &&
      (part as Record<string, unknown>).type === 'text'
    ) {
      next[index] = {
        ...(part as Record<string, unknown>),
        cache_control: cacheControl,
      }
      break
    }
  }
  return next
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
