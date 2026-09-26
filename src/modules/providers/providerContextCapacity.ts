import { estimateTextTokens } from '@/core'
import { providerImageTokenUpperBound } from './providerMediaTokenBudget'

export const FINAL_CONTEXT_WINDOW_RATIO = 0.85

export class ProviderContextCapacityError extends Error {
  constructor(readonly code: 'context_capacity' | 'request_too_large' | 'invalid_capacity' | 'media_estimate_unavailable') {
    super(code)
    this.name = 'ProviderContextCapacityError'
  }
}

/** Recognize explicit input/context overflow, not generic output parameter errors. */
export function providerContextOverflowMessage(text: string): boolean {
  return /context[_ -]?(?:length|window|limit)[_ -]?(?:exceeded|overflow)|maximum context|(?:context[_ -]?(?:length|window|limit)).{0,40}(?:exceeds?|exceeded|too (?:large|long))|prompt (?:is )?too long|input (?:is )?too long|(?:input|prompt).{0,40}tokens?.{0,40}(?:exceeds?|exceeded)|too many (?:input )?tokens/i.test(text.slice(0, 8192))
}

/** HTTP 200 JSON/SSE errors must not masquerade as an empty or successful turn. */
export function assertProviderResponseContextCapacity(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const value = payload as Record<string, unknown>
  const response = value.response as Record<string, unknown> | undefined
  const error = value.error ?? response?.error ?? (value.type === 'error' ? value : undefined)
  const text = typeof error === 'string' ? error : error && typeof error === 'object'
    ? ['code', 'type', 'message'].map((key) => (error as Record<string, unknown>)[key]).filter((item) => typeof item === 'string').join(' ')
    : ''
  if (providerContextOverflowMessage(text)) throw new ProviderContextCapacityError('context_capacity')
}

/** Inspect the assembled wire envelope, without stringifying/copying media. */
export function checkProviderContextCapacity(input: {
  body: Readonly<Record<string, unknown>>
  contextWindow: number
  /** Reliable model maximum when the wire envelope has no output cap. Not an app default. */
  modelMaxOutputTokens?: number
  providerType?: string
  model?: string
  /** Provider-specific media estimate supplied by an adapter when available. */
  mediaInputTokens?: number
  inputCalibrationFactor?: number
}) {
  if (!Number.isSafeInteger(input.contextWindow) || input.contextWindow <= 0) {
    throw new ProviderContextCapacityError('invalid_capacity')
  }
  let tokens = 0
  let textBytes = 0
  let visited = 0
  let mediaCount = 0
  let measuredMediaTokens = 0
  const walk = (value: unknown, path: string, depth: number): void => {
    if (++visited > 100_000 || depth > 32) throw new ProviderContextCapacityError('request_too_large')
    if (typeof value === 'string') {
      textBytes += value.length * 2
      if (textBytes > 8 * 1024 * 1024) throw new ProviderContextCapacityError('request_too_large')
      tokens += estimateTextTokens(value) + 2
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) walk(value[index], `${path}.${index}`, depth + 1)
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const source = record.source as Record<string, unknown> | undefined
      // Only typed media envelopes are opaque. An arbitrary tool argument
      // named "data" (or a user pasting base64) is still ordinary input.
      const mediaPosition = /^(?:messages|input)\.\d+\.content\.\d+$|^contents\.\d+\.parts\.\d+$/.test(path)
      const inline = (record.inlineData ?? record.fileData) as Record<string, unknown> | undefined
      const image = record.type === 'image_url' || record.type === 'input_image' || record.type === 'image'
        || typeof inline?.mimeType === 'string' && inline.mimeType.startsWith('image/')
      if (mediaPosition && (image || inline || record.type === 'input_audio' || record.type === 'input_file' || record.type === 'document')) {
        mediaCount += 1
        if (input.mediaInputTokens === undefined) {
          const nested = record.image_url as Record<string, unknown> | undefined
          const config = input.body.generationConfig as Record<string, unknown> | undefined
          const bound = image ? providerImageTokenUpperBound({ providerType: input.providerType, model: input.model,
            detail: record.detail ?? nested?.detail, resolution: record.mediaResolution ?? config?.mediaResolution }) : undefined
          if (bound === undefined) throw new ProviderContextCapacityError('media_estimate_unavailable')
          measuredMediaTokens += bound
        }
        return
      }
      for (const [name, item] of Object.entries(record)) {
        tokens += estimateTextTokens(name) + 1
        walk(item, path ? `${path}.${name}` : name, depth + 1)
      }
    } else if (value !== undefined) tokens += 2
  }
  walk(input.body, '', 0)
  const generation = input.body.generationConfig as Record<string, unknown> | undefined
  const outputConfig = input.body.inferenceConfig as Record<string, unknown> | undefined
  const requestedOutput = input.body.max_completion_tokens ?? input.body.max_output_tokens ?? input.body.max_tokens
    ?? generation?.maxOutputTokens ?? outputConfig?.maxTokens ?? input.modelMaxOutputTokens
  if (typeof requestedOutput !== 'number' || !Number.isSafeInteger(requestedOutput) || requestedOutput <= 0) {
    throw new ProviderContextCapacityError('invalid_capacity')
  }
  // Thinking tokens are included in these wire output caps. They must not be
  // added again. Media remains explicitly estimated, not exact accounting.
  const mediaTokens = input.mediaInputTokens ?? measuredMediaTokens
  if (!Number.isSafeInteger(mediaTokens) || mediaTokens < 0) throw new ProviderContextCapacityError('invalid_capacity')
  const factor = input.inputCalibrationFactor ?? 1
  if (!Number.isFinite(factor) || factor < 1 || factor > 8) throw new ProviderContextCapacityError('invalid_capacity')
  const rawInputTokens = tokens + mediaTokens
  const estimatedInputTokens = Math.ceil(rawInputTokens * factor)
  const limit = Math.floor(input.contextWindow * FINAL_CONTEXT_WINDOW_RATIO)
  if (estimatedInputTokens + requestedOutput > limit) throw new ProviderContextCapacityError('context_capacity')
  return { estimatedInputTokens, rawInputTokens, managedTextBytes: textBytes,
    reservedOutputTokens: requestedOutput, limit, mediaEstimated: mediaCount > 0 }
}
