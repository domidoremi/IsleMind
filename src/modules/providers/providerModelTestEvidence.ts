export const PROVIDER_MODEL_TEST_CAPABILITIES = [
  'chat',
  'streaming',
  'tools',
  'vision',
  'files',
  'reasoning',
  'responseFormat',
  'responsesApi',
  'nativeSearch',
] as const

export type ProviderModelTestCapability = typeof PROVIDER_MODEL_TEST_CAPABILITIES[number]

export interface ProviderModelTestCapabilityEvidence {
  status: 'verified' | 'inferred' | 'manual' | 'unsupported'
  source: string
  reason: string
}

export interface ProviderModelTestCapabilityResolution {
  canSend: boolean
  evidence?: ProviderModelTestCapabilityEvidence
}

export interface ProviderModelTestCapabilityCheck {
  capability: ProviderModelTestCapability
  status: 'sent' | 'available' | 'blocked'
  sent: boolean
  canSend: boolean
  evidence?: ProviderModelTestCapabilityEvidence
}

export interface ProviderModelTestEvidenceResult {
  requestedModel: string
  upstreamModel: string
  usesResponsesApi: boolean
  checkParameters: boolean
  capabilityChecks: ProviderModelTestCapabilityCheck[]
}

export interface ProviderModelTestEvidenceInput {
  payload: Record<string, unknown>
  requestedModel: string
  upstreamModel: string
  usesResponsesApi: boolean
  checkParameters: boolean
  resolveCapability(capability: ProviderModelTestCapability): ProviderModelTestCapabilityResolution
}

export interface ProviderModelProbeEvidenceInput {
  requestedModel: string
  upstreamModel: string
  usesResponsesApi: boolean
  checkParameters: boolean
  resolveCapability(capability: ProviderModelTestCapability): ProviderModelTestCapabilityResolution
}

/** Builds capability evidence from the final provider wire payload. */
export function buildProviderModelTestResult(input: ProviderModelTestEvidenceInput): ProviderModelTestEvidenceResult {
  return {
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    usesResponsesApi: input.usesResponsesApi,
    checkParameters: input.checkParameters,
    capabilityChecks: PROVIDER_MODEL_TEST_CAPABILITIES.map((capability) => {
      const sent = providerModelTestCapabilityWasSent(capability, input.payload, input.usesResponsesApi)
      const resolution = input.resolveCapability(capability)
      const canSend = resolution.canSend === true
      return {
        capability,
        status: sent ? 'sent' : canSend ? 'available' : 'blocked',
        sent,
        canSend,
        ...(resolution.evidence ? { evidence: resolution.evidence } : {}),
      }
    }),
  }
}

/** Adapts a model-discovery probe to the legacy model-test evidence contract. */
export function buildProviderModelProbeResult(input: ProviderModelProbeEvidenceInput): ProviderModelTestEvidenceResult {
  return {
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    usesResponsesApi: input.usesResponsesApi,
    checkParameters: input.checkParameters,
    capabilityChecks: PROVIDER_MODEL_TEST_CAPABILITIES.map((capability) => {
      const resolution = input.resolveCapability(capability)
      const canSend = resolution.canSend === true
      return {
        capability,
        status: canSend ? 'available' : 'blocked',
        sent: false,
        canSend,
        ...(resolution.evidence ? { evidence: resolution.evidence } : {}),
      }
    }),
  }
}

function providerModelTestCapabilityWasSent(
  capability: ProviderModelTestCapability,
  payload: Record<string, unknown>,
  usesResponsesApi: boolean,
): boolean {
  switch (capability) {
    case 'chat':
      return payloadHasAnyKey(payload, ['messages', 'input', 'contents'])
    case 'streaming':
      return payload.stream === true
    case 'tools':
      return payloadHasAnyKey(payload, ['tools', 'functions'])
    case 'vision':
      return payloadHasAnyKey(payload, ['image_url', 'input_image', 'inline_data'])
    case 'files':
      return payloadHasAnyKey(payload, ['file_data', 'input_file', 'file_id', 'document'])
    case 'reasoning':
      return payloadHasAnyKey(payload, [
        'reasoning',
        'reasoning_effort',
        'thinking',
        'thinkingConfig',
        'thinkingBudget',
        'thinkingLevel',
        'includeThoughts',
      ])
    case 'responseFormat':
      return payloadHasResponseFormat(payload)
    case 'responsesApi':
      return usesResponsesApi
    case 'nativeSearch':
      return payloadHasNativeSearchTool(payload)
  }
}

function payloadHasResponseFormat(payload: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(payload, 'response_format')) return true
  const text = payload.text
  return isPlainRecord(text) && Object.prototype.hasOwnProperty.call(text, 'format')
}

function payloadHasNativeSearchTool(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(payloadHasNativeSearchTool)
  if (!isPlainRecord(value)) return false
  if (Object.prototype.hasOwnProperty.call(value, 'google_search')) return true
  if (Object.prototype.hasOwnProperty.call(value, 'web_search_options')) return true
  const type = typeof value.type === 'string' ? value.type.toLowerCase() : ''
  if (type === 'web_search' || type === 'web_search_preview') return true
  return Object.values(value).some(payloadHasNativeSearchTool)
}

function payloadHasAnyKey(value: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(value)) return value.some((item) => payloadHasAnyKey(item, keys))
  if (!isPlainRecord(value)) return false
  if (keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return true
  return Object.values(value).some((item) => payloadHasAnyKey(item, keys))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
