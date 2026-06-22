import type { AIProvider, ReasoningEffort, Settings } from '@/types'
import { isAwsBedrockProvider, isBedrockRuntimeProvider } from '@/services/ai/providerAwsBedrockRouting'
import { normalizeAnthropicEffort, supportsAnthropicAdaptiveThinking, usesAnthropicOutputConfigOnlyThinking } from '@/services/ai/providerAnthropicThinking'
import { resolveProviderCapabilityManifest } from '@/services/ai/providerConformance'
import { numberValue } from '@/services/ai/providerUsage'

type ProviderRequestOptimizationProvider =
  Pick<AIProvider, 'id' | 'name' | 'baseUrl' | 'presetId' | 'detectedPresetId' | 'type' | 'wireProtocol'> &
  Partial<Pick<AIProvider, 'apiKey' | 'models' | 'enabled' | 'capabilities' | 'modelConfigs'>>

export interface ProviderRequestOptimizationInput {
  provider: ProviderRequestOptimizationProvider
  model: string
  reasoningEffort?: ReasoningEffort
  fallbackMaxTokens?: number
  settings?: Pick<Settings, 'bedrockRequestOptimizerEnabled' | 'thinkingOptimizerEnabled' | 'cacheInjectionEnabled' | 'cacheTtl'>
}

export function optimizeRequestBody(body: Record<string, unknown>, req: ProviderRequestOptimizationInput): Record<string, unknown> {
  if (!isBedrockProvider(req.provider) || !isBedrockRuntimeProvider(req.provider) || !isAnthropicWireProvider(req.provider) || req.settings?.bedrockRequestOptimizerEnabled !== true) return body
  let next = { ...body }
  if (req.settings.thinkingOptimizerEnabled === true) {
    next = optimizeBedrockThinking(next, req)
  }
  if (req.settings.cacheInjectionEnabled === true) {
    next = injectBedrockCache(next, req.settings.cacheTtl ?? 'default')
  }
  return next
}

export function isBedrockProvider(provider: ProviderRequestOptimizationProvider): boolean {
  return isAwsBedrockProvider(provider)
}

export function isAnthropicWireProvider(provider: Pick<AIProvider, 'type' | 'wireProtocol'>): boolean {
  return provider.wireProtocol === 'anthropic-compatible' || provider.type === 'anthropic'
}

export function optimizeBedrockThinking(body: Record<string, unknown>, req: ProviderRequestOptimizationInput): Record<string, unknown> {
  if (!isAnthropicWireProvider(req.provider)) return body
  if (!bedrockOptimizerCanSendReasoning(req)) return body
  if (usesAnthropicOutputConfigOnlyThinking(req.model)) {
    return {
      ...body,
      output_config: { ...(body.output_config as Record<string, unknown> | undefined), effort: normalizeAnthropicEffort(req.model, req.reasoningEffort ?? 'medium') },
    }
  }
  if (supportsAnthropicAdaptiveThinking(req.model)) {
    return {
      ...body,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { ...(body.output_config as Record<string, unknown> | undefined), effort: normalizeAnthropicEffort(req.model, req.reasoningEffort ?? 'medium') },
    }
  }
  if (body.thinking) return body
  const maxTokens = numberValue(body.max_tokens) ?? req.fallbackMaxTokens ?? 4096
  return {
    ...body,
    thinking: { type: 'enabled', budget_tokens: Math.min(32000, Math.max(1024, maxTokens - 1)) },
    max_tokens: Math.max(maxTokens, 4096),
  }
}

function bedrockOptimizerCanSendReasoning(req: ProviderRequestOptimizationInput): boolean {
  const provider: AIProvider = {
    apiKey: '',
    models: [req.model],
    enabled: true,
    ...req.provider,
  }
  return resolveProviderCapabilityManifest({
    provider,
    model: req.model,
    reasoningEffort: req.reasoningEffort,
  }).reasoning.supported
}

export function injectBedrockCache(body: Record<string, unknown>, ttl: 'default' | '5m' | '1h'): Record<string, unknown> {
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
      if (!Array.isArray(record.content) || index !== 0 && index !== (next.messages as unknown[]).length - 1) return record
      return { ...record, content: addCacheControlToLastTextPart(record.content, cacheControl) }
    })
  }
  return next
}

function addCacheControlToLastTextPart(content: unknown[], cacheControl: Record<string, unknown>): unknown[] {
  const next = [...content]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const part = next[index]
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
      next[index] = { ...(part as Record<string, unknown>), cache_control: cacheControl }
      break
    }
  }
  return next
}
