import type { AIProvider, RemoteCompactMode, Settings } from '@/types'
import { estimateTextTokens } from '@/services/tokenUsage'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'

export interface RemoteCompactDecisionInput {
  provider: AIProvider
  model: string
  contextPrompt?: string
  messages: { role: string; content: unknown }[]
  budgetTokens?: number
  estimatedInputTokens?: number
  settings?: Pick<Settings, 'remoteCompactMode' | 'remoteCompactThreshold'>
}

export interface RemoteCompactDecision {
  mode: RemoteCompactMode
  enabled: boolean
  required: boolean
  supported: boolean
  reason: 'disabled' | 'supported' | 'below_threshold' | 'provider_capability_missing'
  pressureRatio: number
}

export function decideRemoteCompact(input: RemoteCompactDecisionInput): RemoteCompactDecision {
  const mode = input.settings?.remoteCompactMode ?? 'off'
  const required = mode === 'required'
  const supported =
    input.provider.capabilities?.responsesApi === true &&
    input.provider.capabilities?.remoteCompact === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(input.provider, 'responsesApi', true) &&
    providerCompatibilityCapabilityCanBeSentForProvider(input.provider, 'remoteCompact', true)
  const pressureRatio = estimatePressureRatio(input)
  if (mode === 'off') return { mode, enabled: false, required, supported, reason: 'disabled', pressureRatio }
  if (!supported) return { mode, enabled: false, required, supported, reason: 'provider_capability_missing', pressureRatio }
  if (required) return { mode, enabled: true, required, supported, reason: 'supported', pressureRatio }
  const threshold = normalizeThreshold(input.settings?.remoteCompactThreshold)
  return pressureRatio >= threshold
    ? { mode, enabled: true, required, supported, reason: 'supported', pressureRatio }
    : { mode, enabled: false, required, supported, reason: 'below_threshold', pressureRatio }
}

export function estimateRemoteCompactSavedTokens(inputTokens: number | undefined, outputTokens: number | undefined): number | undefined {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return undefined
  return Math.max(0, Math.floor(inputTokens! * 0.55 - outputTokens!))
}

function estimatePressureRatio(input: RemoteCompactDecisionInput): number {
  const budget = Math.max(1, input.budgetTokens ?? 1)
  const estimatedInput = input.estimatedInputTokens ?? estimateMessages(input.messages, input.contextPrompt)
  return Math.max(0, Math.min(2, estimatedInput / budget))
}

function estimateMessages(messages: { content: unknown }[], contextPrompt?: string): number {
  const messageText = messages
    .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
    .join('\n')
  return estimateTextTokens([contextPrompt, messageText].filter(Boolean).join('\n\n'))
}

function normalizeThreshold(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0.1, Math.min(2, value!)) : 0.8
}
