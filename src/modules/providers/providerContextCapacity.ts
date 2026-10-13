import { estimateTextTokens, measureJsonCharacters } from '@/core'
import { providerImageTokenUpperBound, providerWaveTokenUpperBound } from './providerMediaTokenBudget'

export const FINAL_CONTEXT_WINDOW_RATIO = 0.85
// String bodies are bounded before parsing; object bodies use the existing
// conservative JSON measurement, including opaque media and escaped characters.
export const MAX_PROVIDER_REQUEST_CODE_UNITS = 16 * 1024 * 1024

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
  try {
    measureJsonCharacters(input.body, MAX_PROVIDER_REQUEST_CODE_UNITS)
  } catch {
    throw new ProviderContextCapacityError('request_too_large')
  }
  let tokens = 0
  let textBytes = 0
  let mediaCount = 0
  let measuredMediaTokens = 0
  const countText = (value: string): void => {
    textBytes += value.length * 2
    if (textBytes > 8 * 1024 * 1024) throw new ProviderContextCapacityError('request_too_large')
  }
  const walk = (value: unknown, path: readonly (string | number)[], opaquePaths: readonly (readonly string[])[] = []): void => {
    if (typeof value === 'string') {
      const opaque = opaquePaths.some(parts => parts.length === 0)
      if (!opaque) {
        countText(value)
        tokens += estimateTextTokens(value) + 2
      }
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) walk(value[index], [...path, index])
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      // Match structural segments, not a dotted string that a tool/object key
      // could forge. Only known payload strings are opaque, never all metadata.
      const mediaPosition = path.length === 4 && typeof path[1] === 'number' && typeof path[3] === 'number'
        && ((path[0] === 'messages' || path[0] === 'input') && path[2] === 'content' || path[0] === 'contents' && path[2] === 'parts')
      const media = mediaPosition ? mediaEnvelope(record) : undefined
      if (media) {
        mediaCount += 1
        if (input.mediaInputTokens === undefined) {
          const nested = record.image_url as Record<string, unknown> | undefined
          const config = input.body.generationConfig as Record<string, unknown> | undefined
          const bound = media.image ? providerImageTokenUpperBound({ providerType: input.providerType, model: input.model,
            detail: record.detail ?? nested?.detail, resolution: record.mediaResolution ?? config?.mediaResolution })
            : media.waveBase64 === undefined ? undefined
              : providerWaveTokenUpperBound({ providerType: input.providerType, model: input.model, base64: media.waveBase64 })
          if (bound === undefined) throw new ProviderContextCapacityError('media_estimate_unavailable')
          measuredMediaTokens += bound
        }
        opaquePaths = media.payloads
      }
      for (const [name, item] of Object.entries(record)) {
        countText(name)
        tokens += estimateTextTokens(name) + 1
        walk(item, [...path, name], opaquePaths.filter(parts => parts[0] === name).map(parts => parts.slice(1)))
      }
    } else if (value !== undefined) tokens += 2
  }
  walk(input.body, [])
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

/** Both SDK/camelCase and REST/snake_case spellings occur in assembled bodies. */
function mediaEnvelope(record: Record<string, unknown>): { image: boolean; payloads: string[][]; waveBase64?: string } | undefined {
  const envelopes: { image: boolean; payloads: string[][]; waveBase64?: string }[] = []
  for (const key of ['inlineData', 'inline_data', 'fileData', 'file_data']) {
    const value = record[key]
    if (value == null || typeof value !== 'object') continue
    const data = value as Record<string, unknown>
    const mime = data.mimeType ?? data.mime_type
    // A server may prefer either spelling. Conflicting descriptors must not
    // let a PDF/audio payload inherit the cheaper image allowance.
    const consistentMime = data.mimeType === undefined || data.mime_type === undefined || data.mimeType === data.mime_type
    const wave = (key === 'inlineData' || key === 'inline_data') && mime === 'audio/wav'
      && typeof data.data === 'string'
      && consistentMime
      && Object.keys(data).every(name => ['data', 'mimeType', 'mime_type'].includes(name))
    envelopes.push({ image: consistentMime && typeof mime === 'string' && mime.startsWith('image/'),
      payloads: [[key, 'data'], [key, 'fileUri'], [key, 'file_uri']],
      ...(wave ? { waveBase64: data.data as string } : {}) })
  }
  switch (record.type) {
    case 'image_url': envelopes.push({ image: true, payloads: [['image_url', 'url']] }); break
    case 'input_image': envelopes.push({ image: true, payloads: [['image_url'], ['file_id']] }); break
    case 'image': envelopes.push({ image: true, payloads: [['source', 'data'], ['source', 'url']] }); break
    case 'input_audio': envelopes.push({ image: false, payloads: [['input_audio', 'data']] }); break
    case 'file': envelopes.push({ image: false, payloads: [['file', 'file_data'], ['file', 'file_id']] }); break
    case 'file_url': envelopes.push({ image: false, payloads: [['file_url', 'url']] }); break
    case 'input_file': envelopes.push({ image: false, payloads: [['file_data'], ['file_url'], ['file_id']] }); break
    case 'document': envelopes.push({ image: false, payloads: [['source', 'data'], ['source', 'url']] }); break
  }
  if (!envelopes.length) return undefined
  // Conflicting/multiple payloads cannot be admitted for one image's allowance.
  return { image: envelopes.length === 1 && envelopes[0].image, payloads: envelopes.flatMap(item => item.payloads),
    ...(envelopes.length === 1 && envelopes[0].waveBase64 !== undefined ? { waveBase64: envelopes[0].waveBase64 } : {}) }
}
