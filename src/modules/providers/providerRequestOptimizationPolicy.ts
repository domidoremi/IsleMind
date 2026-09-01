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
    if (!isAnthropicWireProvider(request.provider)) return body

    const bedrock = isBedrockProvider(request.provider) &&
      dependencies.isBedrockRuntimeProvider(request.provider)
    const nativeAnthropic = request.provider.type === 'anthropic' && !bedrock
    if (!bedrock && !nativeAnthropic) return body

    let next = { ...body }
    if (
      bedrock &&
      request.settings?.bedrockRequestOptimizerEnabled === true &&
      request.settings.thinkingOptimizerEnabled === true
    ) {
      next = optimizeBedrockThinking(next, request)
    }
    const cacheEnabled = request.settings?.cacheInjectionEnabled === true &&
      (nativeAnthropic || request.settings.bedrockRequestOptimizerEnabled === true)
    if (cacheEnabled) {
      next = injectBedrockCache(next, request.settings?.cacheTtl ?? 'default')
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
  let breakpointCount = countAnthropicCacheBreakpoints(body)

  if (typeof next.system === 'string' && next.system.trim()) {
    if (breakpointCount < MAX_ANTHROPIC_CACHE_BREAKPOINTS) {
      next.system = [{ type: 'text', text: next.system, cache_control: { ...cacheControl } }]
      breakpointCount += 1
    }
  } else if (Array.isArray(next.system) && breakpointCount < MAX_ANTHROPIC_CACHE_BREAKPOINTS) {
    const updated = addCacheControlToLastTextPart(next.system, cacheControl)
    next.system = updated.content
    if (updated.added) breakpointCount += 1
  }

  if (Array.isArray(next.messages)) {
    const messageIndexes = next.messages.length === 1
      ? [0]
      : [0, next.messages.length - 1]
    next.messages = next.messages.map((message, index) => {
      if (!message || typeof message !== 'object') return message
      const record = message as Record<string, unknown>
      if (!messageIndexes.includes(index) || !Array.isArray(record.content)) {
        return record
      }
      if (breakpointCount >= MAX_ANTHROPIC_CACHE_BREAKPOINTS) return record
      const updated = addCacheControlToLastTextPart(record.content, cacheControl)
      if (updated.added) breakpointCount += 1
      return {
        ...record,
        content: updated.content,
      }
    })
  }

  return next
}

function addCacheControlToLastTextPart(
  content: unknown[],
  cacheControl: Record<string, unknown>,
): { content: unknown[]; added: boolean } {
  const next = [...content]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const part = next[index]
    if (
      part &&
      typeof part === 'object' &&
      (part as Record<string, unknown>).type === 'text'
    ) {
      const record = part as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(record, 'cache_control')) {
        return { content: next, added: false }
      }
      next[index] = {
        ...record,
        cache_control: { ...cacheControl },
      }
      return { content: next, added: true }
    }
  }
  return { content: next, added: false }
}

const MAX_ANTHROPIC_CACHE_BREAKPOINTS = 4

function countAnthropicCacheBreakpoints(body: Record<string, unknown>): number {
  let count = 0
  const countParts = (parts: unknown): void => {
    if (!Array.isArray(parts)) return
    for (const part of parts) {
      if (
        part &&
        typeof part === 'object' &&
        Object.prototype.hasOwnProperty.call(part, 'cache_control')
      ) count += 1
    }
  }
  if (Array.isArray(body.system)) countParts(body.system)
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object') continue
      countParts((message as Record<string, unknown>).content)
    }
  }
  return count
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
