export const PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA = 'islemind.provider-request-shaping-compatibility-eval.v1'
export const PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS = [
  'openai-responses-reasoning-text-format',
  'anthropic-thinking-tool-shape',
  'gemini-multimodal-tool-schema',
  'openai-chat-function-tool-shape',
  'structured-output-model-metadata-shape',
  'native-search-tool-shape',
  'provider-cache-remote-compact-shape',
  'local-runtime-token-parameter-shape',
  'token-max-output-normalization',
  'relay-manual-capability-declaration',
  'visible-downgrade-unsupported-search',
  'blocked-unsupported-reasoning-field',
  'blocked-unsupported-tool-field',
  'blocked-unsupported-multimodal-field',
  'blocked-unsupported-structured-output-field',
  'blocked-generic-compatible-overclaim',
  'blocked-private-data-cloud-route',
  'blocked-token-budget-overrun',
  'blocked-cross-provider-cache-state',
] as const

export type ProviderRequestShapingFixtureId = typeof PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS[number]
export type ProviderRequestShape =
  | 'openai-responses'
  | 'openai-chat-completions'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'openai-compatible'
  | 'hosted-native'
  | 'local-openai-compatible'
  | 'none'
export type ProviderRequestHostingProfile = 'official' | 'aggregator' | 'relay' | 'cloud-hosted' | 'local-runtime' | 'blocked'
export type ProviderRequestShapingReadiness = 'ready' | 'degraded' | 'blocked'
export type ProviderRequestCapability =
  | 'text'
  | 'reasoning'
  | 'tools'
  | 'structured-output'
  | 'multimodal-image'
  | 'multimodal-file'
  | 'multimodal-audio'
  | 'native-search'
  | 'token-budget'
  | 'cache'
  | 'remote-compact'
  | 'private-data'
  | 'local-only'
export type ProviderRequestField =
  | 'messages'
  | 'input'
  | 'contents'
  | 'reasoning'
  | 'reasoning.effort'
  | 'thinking'
  | 'thinking.budget_tokens'
  | 'output_config.effort'
  | 'tools'
  | 'tool_choice'
  | 'parallel_tool_calls'
  | 'function_declarations'
  | 'response_format'
  | 'text.format'
  | 'generationConfig.responseSchema'
  | 'input_image'
  | 'image_url'
  | 'inline_data'
  | 'input_file'
  | 'file_data'
  | 'file_url'
  | 'input_audio'
  | 'audio_url'
  | 'web_search_preview'
  | 'web_search'
  | 'google_search'
  | 'cache_control'
  | 'prompt_cache_key'
  | 'previous_response_id'
  | 'cache_state_id'
  | 'max_tokens'
  | 'max_output_tokens'
  | 'max_completion_tokens'
  | 'generationConfig.maxOutputTokens'
  | 'temperature'
  | 'top_p'
export type ProviderRequestShapingFailureCode =
  | 'missing-docs'
  | 'missing-protocol'
  | 'missing-endpoint'
  | 'missing-capability-evidence'
  | 'missing-model-metadata'
  | 'missing-manual-capability-declaration'
  | 'generic-compatible-overclaim'
  | 'unsupported-required-capability'
  | 'unsupported-reasoning-field'
  | 'unsupported-tool-field'
  | 'unsupported-structured-output-field'
  | 'unsupported-multimodal-field'
  | 'unsupported-search-field'
  | 'unsupported-cache-field'
  | 'missing-token-normalization'
  | 'token-budget-exceeded'
  | 'missing-visible-downgrade'
  | 'missing-fallback-shape'
  | 'private-data-cloud-route'
  | 'missing-redaction'
  | 'missing-cache-scope'
  | 'cross-provider-state'
  | 'malformed-tool-schema'
  | 'malformed-structured-output-schema'
  | 'missing-diagnostics-redaction'
  | 'missing-audit-event'
  | 'control-plane-network-call'

export interface ProviderRequestShapingPolicy {
  docsMapped: boolean
  providerProtocolMapped: boolean
  endpointMapped: boolean
  capabilityEvidence: boolean
  modelMetadataDeclared: boolean
  manualCapabilityDeclaration: boolean
  noGenericCapabilityOverclaim: boolean
  requiredCapabilities: ProviderRequestCapability[]
  supportedCapabilities: ProviderRequestCapability[]
  requestedFields: ProviderRequestField[]
  emittedFields: ProviderRequestField[]
  removedFields: ProviderRequestField[]
  adjustedFields: ProviderRequestField[]
  maxOutputField: ProviderRequestField
  maxOutputRequestedTokens: number
  maxOutputLimitTokens: number
  tokenNormalized: boolean
  fallbackRequired: boolean
  fallbackShape?: ProviderRequestShape
  downgradeVisible: boolean
  containsPrivateData: boolean
  privacyMode: 'local-only' | 'redacted-cloud' | 'cloud-allowed'
  redactionApplied: boolean
  cacheScope: 'none' | 'same-provider' | 'cross-provider'
  sameProviderState: boolean
  toolSchemaValid: boolean
  structuredOutputSchemaValid: boolean
  multimodalPayloadBounded: boolean
  diagnosticsRedacted: boolean
  auditEvent: boolean
  networkCallsAllowed: boolean
}

export interface ProviderRequestShapingFixture {
  id: ProviderRequestShapingFixtureId | string
  requestShape: ProviderRequestShape
  hostingProfile: ProviderRequestHostingProfile
  expectedReadiness: ProviderRequestShapingReadiness
  description: string
  policy: ProviderRequestShapingPolicy
}

export interface ProviderRequestShapingDiagnostic {
  fixtureId: string
  requestShape: ProviderRequestShape
  hostingProfile: ProviderRequestHostingProfile
  description: string
  readiness: ProviderRequestShapingReadiness
  policy: ProviderRequestShapingPolicy
  missingCapabilities: ProviderRequestCapability[]
  unsupportedEmittedFields: ProviderRequestField[]
  failureCodes: ProviderRequestShapingFailureCode[]
}

export interface ProviderRequestShapingCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredRequestShapes: ProviderRequestShape[]
  requiredCapabilities: ProviderRequestCapability[]
}

export interface ProviderRequestShapingCompatibilityEvaluationRun {
  schema: typeof PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ProviderRequestShapingDiagnostic[]
  qualityGate: ProviderRequestShapingCompatibilityQualityGate
}

export interface ProviderRequestShapingCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ProviderRequestShapingFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_REQUEST_SHAPING_POLICY: ProviderRequestShapingPolicy = {
  docsMapped: true,
  providerProtocolMapped: true,
  endpointMapped: true,
  capabilityEvidence: true,
  modelMetadataDeclared: true,
  manualCapabilityDeclaration: false,
  noGenericCapabilityOverclaim: true,
  requiredCapabilities: ['text', 'token-budget'],
  supportedCapabilities: ['text', 'token-budget'],
  requestedFields: ['messages', 'max_tokens'],
  emittedFields: ['messages', 'max_tokens'],
  removedFields: [],
  adjustedFields: [],
  maxOutputField: 'max_tokens',
  maxOutputRequestedTokens: 1024,
  maxOutputLimitTokens: 4096,
  tokenNormalized: true,
  fallbackRequired: false,
  downgradeVisible: true,
  containsPrivateData: false,
  privacyMode: 'cloud-allowed',
  redactionApplied: true,
  cacheScope: 'none',
  sameProviderState: true,
  toolSchemaValid: true,
  structuredOutputSchemaValid: true,
  multimodalPayloadBounded: true,
  diagnosticsRedacted: true,
  auditEvent: true,
  networkCallsAllowed: false,
}

export const PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURES: ProviderRequestShapingFixture[] = [
  {
    id: 'openai-responses-reasoning-text-format',
    requestShape: 'openai-responses',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    description: 'OpenAI Responses request shaping can emit native reasoning, strict text format, and max_output_tokens only when model metadata proves support.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'reasoning', 'structured-output', 'token-budget'],
      supportedCapabilities: ['text', 'reasoning', 'structured-output', 'token-budget'],
      requestedFields: ['input', 'reasoning', 'text.format', 'max_output_tokens'],
      emittedFields: ['input', 'reasoning', 'text.format', 'max_output_tokens'],
      maxOutputField: 'max_output_tokens',
    },
  },
  {
    id: 'anthropic-thinking-tool-shape',
    requestShape: 'anthropic-messages',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    description: 'Anthropic Messages shaping maps thinking budget, tool schema, and max_tokens without leaking OpenAI-only fields.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'reasoning', 'tools', 'token-budget'],
      supportedCapabilities: ['text', 'reasoning', 'tools', 'token-budget'],
      requestedFields: ['messages', 'thinking', 'thinking.budget_tokens', 'tools', 'max_tokens'],
      emittedFields: ['messages', 'thinking', 'thinking.budget_tokens', 'tools', 'max_tokens'],
      adjustedFields: ['thinking.budget_tokens'],
      maxOutputField: 'max_tokens',
    },
  },
  {
    id: 'gemini-multimodal-tool-schema',
    requestShape: 'google-generate-content',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    description: 'Gemini generateContent shaping maps content parts, function declarations, response schema, and generationConfig token limits.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'tools', 'structured-output', 'multimodal-image', 'multimodal-file', 'multimodal-audio', 'token-budget'],
      supportedCapabilities: ['text', 'tools', 'structured-output', 'multimodal-image', 'multimodal-file', 'multimodal-audio', 'token-budget'],
      requestedFields: ['contents', 'function_declarations', 'generationConfig.responseSchema', 'inline_data', 'file_data', 'input_audio', 'generationConfig.maxOutputTokens'],
      emittedFields: ['contents', 'function_declarations', 'generationConfig.responseSchema', 'inline_data', 'file_data', 'input_audio', 'generationConfig.maxOutputTokens'],
      maxOutputField: 'generationConfig.maxOutputTokens',
    },
  },
  {
    id: 'openai-chat-function-tool-shape',
    requestShape: 'openai-chat-completions',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    description: 'Chat Completions tool shaping keeps OpenAI tools, tool_choice, and max_completion_tokens explicit.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'tools', 'token-budget'],
      supportedCapabilities: ['text', 'tools', 'token-budget'],
      requestedFields: ['messages', 'tools', 'tool_choice', 'max_completion_tokens'],
      emittedFields: ['messages', 'tools', 'tool_choice', 'max_completion_tokens'],
      maxOutputField: 'max_completion_tokens',
    },
  },
  {
    id: 'structured-output-model-metadata-shape',
    requestShape: 'openai-compatible',
    hostingProfile: 'aggregator',
    expectedReadiness: 'ready',
    description: 'Aggregator structured-output shaping emits response_format only when remote model metadata declares the supported parameter.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'structured-output', 'token-budget'],
      supportedCapabilities: ['text', 'structured-output', 'token-budget'],
      requestedFields: ['messages', 'response_format', 'max_tokens'],
      emittedFields: ['messages', 'response_format', 'max_tokens'],
      manualCapabilityDeclaration: false,
      modelMetadataDeclared: true,
    },
  },
  {
    id: 'native-search-tool-shape',
    requestShape: 'openai-responses',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    description: 'Native search shaping emits the provider-specific web_search tool only when native search is documented for the selected route.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'native-search', 'token-budget'],
      supportedCapabilities: ['text', 'native-search', 'token-budget'],
      requestedFields: ['input', 'web_search_preview', 'max_output_tokens'],
      emittedFields: ['input', 'web_search_preview', 'max_output_tokens'],
      maxOutputField: 'max_output_tokens',
    },
  },
  {
    id: 'provider-cache-remote-compact-shape',
    requestShape: 'hosted-native',
    hostingProfile: 'cloud-hosted',
    expectedReadiness: 'ready',
    description: 'Provider-specific cache and remote compact fields require same-provider scope, diagnostics redaction, and explicit hosted routing.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'cache', 'remote-compact', 'token-budget'],
      supportedCapabilities: ['text', 'cache', 'remote-compact', 'token-budget'],
      requestedFields: ['messages', 'cache_control', 'previous_response_id', 'max_tokens'],
      emittedFields: ['messages', 'cache_control', 'previous_response_id', 'max_tokens'],
      cacheScope: 'same-provider',
      sameProviderState: true,
    },
  },
  {
    id: 'local-runtime-token-parameter-shape',
    requestShape: 'local-openai-compatible',
    hostingProfile: 'local-runtime',
    expectedReadiness: 'ready',
    description: 'Local runtimes receive conservative OpenAI-compatible token parameters without cloud-only optional fields.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'token-budget', 'local-only'],
      supportedCapabilities: ['text', 'token-budget', 'local-only'],
      requestedFields: ['messages', 'max_tokens'],
      emittedFields: ['messages', 'max_tokens'],
      manualCapabilityDeclaration: true,
      privacyMode: 'local-only',
    },
  },
  {
    id: 'token-max-output-normalization',
    requestShape: 'openai-compatible',
    hostingProfile: 'relay',
    expectedReadiness: 'degraded',
    description: 'Oversized max-output requests are clamped to provider/model limits and surfaced as a visible adjustment.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'max_tokens'],
      emittedFields: ['messages', 'max_tokens'],
      adjustedFields: ['max_tokens'],
      maxOutputRequestedTokens: 200000,
      maxOutputLimitTokens: 4096,
      tokenNormalized: true,
      manualCapabilityDeclaration: true,
      modelMetadataDeclared: true,
    },
  },
  {
    id: 'relay-manual-capability-declaration',
    requestShape: 'openai-compatible',
    hostingProfile: 'relay',
    expectedReadiness: 'degraded',
    description: 'Relay providers can receive optional tool fields only after manual capability declaration or model metadata proves support.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'tools', 'token-budget'],
      supportedCapabilities: ['text', 'tools', 'token-budget'],
      requestedFields: ['messages', 'tools', 'tool_choice', 'max_tokens'],
      emittedFields: ['messages', 'tools', 'tool_choice', 'max_tokens'],
      manualCapabilityDeclaration: true,
      modelMetadataDeclared: false,
    },
  },
  {
    id: 'visible-downgrade-unsupported-search',
    requestShape: 'openai-compatible',
    hostingProfile: 'relay',
    expectedReadiness: 'degraded',
    description: 'Unsupported native search is removed and downgraded visibly to plain chat instead of sending an unverified search tool.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'native-search', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'web_search_preview', 'max_tokens'],
      emittedFields: ['messages', 'max_tokens'],
      removedFields: ['web_search_preview'],
      fallbackRequired: true,
      fallbackShape: 'openai-chat-completions',
      downgradeVisible: true,
      manualCapabilityDeclaration: true,
      modelMetadataDeclared: false,
    },
  },
  {
    id: 'blocked-unsupported-reasoning-field',
    requestShape: 'openai-compatible',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Reasoning fields are blocked when the selected compatible endpoint lacks reasoning evidence.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'reasoning', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'reasoning.effort', 'max_tokens'],
      emittedFields: ['messages', 'reasoning.effort', 'max_tokens'],
      manualCapabilityDeclaration: true,
    },
  },
  {
    id: 'blocked-unsupported-tool-field',
    requestShape: 'openai-compatible',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Tool fields are blocked when capability evidence or schema validity is missing.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'tools', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'tools', 'tool_choice', 'max_tokens'],
      emittedFields: ['messages', 'tools', 'tool_choice', 'max_tokens'],
      toolSchemaValid: false,
      manualCapabilityDeclaration: true,
    },
  },
  {
    id: 'blocked-unsupported-multimodal-field',
    requestShape: 'openai-compatible',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Image, file, and audio fields are blocked when provider/model metadata does not support the modality.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'multimodal-image', 'multimodal-file', 'multimodal-audio', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'image_url', 'file_data', 'audio_url', 'max_tokens'],
      emittedFields: ['messages', 'image_url', 'file_data', 'audio_url', 'max_tokens'],
      manualCapabilityDeclaration: true,
      multimodalPayloadBounded: false,
    },
  },
  {
    id: 'blocked-unsupported-structured-output-field',
    requestShape: 'openai-compatible',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Structured-output fields are blocked when schema request controls or schema validation are missing.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'structured-output', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'response_format', 'max_tokens'],
      emittedFields: ['messages', 'response_format', 'max_tokens'],
      structuredOutputSchemaValid: false,
      manualCapabilityDeclaration: true,
    },
  },
  {
    id: 'blocked-generic-compatible-overclaim',
    requestShape: 'openai-compatible',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Unknown OpenAI-compatible endpoints cannot receive optional OpenAI fields without capability evidence.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      capabilityEvidence: false,
      modelMetadataDeclared: false,
      manualCapabilityDeclaration: false,
      noGenericCapabilityOverclaim: false,
      requiredCapabilities: ['text', 'reasoning', 'tools', 'structured-output', 'native-search', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'reasoning', 'tools', 'response_format', 'web_search_preview', 'max_tokens'],
      emittedFields: ['messages', 'reasoning', 'tools', 'response_format', 'web_search_preview', 'max_tokens'],
    },
  },
  {
    id: 'blocked-private-data-cloud-route',
    requestShape: 'openai-compatible',
    hostingProfile: 'cloud-hosted',
    expectedReadiness: 'blocked',
    description: 'Private local-only payloads cannot be shaped for a cloud route without redaction and policy.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'private-data', 'local-only', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'max_tokens'],
      emittedFields: ['messages', 'max_tokens'],
      containsPrivateData: true,
      privacyMode: 'local-only',
      redactionApplied: false,
    },
  },
  {
    id: 'blocked-token-budget-overrun',
    requestShape: 'openai-chat-completions',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Oversized token parameters are blocked when the request shaper fails to clamp them to provider/model limits.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'token-budget'],
      supportedCapabilities: ['text', 'token-budget'],
      requestedFields: ['messages', 'max_completion_tokens'],
      emittedFields: ['messages', 'max_completion_tokens'],
      maxOutputField: 'max_completion_tokens',
      maxOutputRequestedTokens: 128000,
      maxOutputLimitTokens: 8192,
      tokenNormalized: false,
    },
  },
  {
    id: 'blocked-cross-provider-cache-state',
    requestShape: 'openai-responses',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Cache ids, previous response ids, and compact state cannot be shaped across provider routes.',
    policy: {
      ...SAFE_REQUEST_SHAPING_POLICY,
      requiredCapabilities: ['text', 'cache', 'remote-compact', 'token-budget'],
      supportedCapabilities: ['text', 'cache', 'remote-compact', 'token-budget'],
      requestedFields: ['input', 'previous_response_id', 'cache_state_id', 'max_output_tokens'],
      emittedFields: ['input', 'previous_response_id', 'cache_state_id', 'max_output_tokens'],
      maxOutputField: 'max_output_tokens',
      cacheScope: 'cross-provider',
      sameProviderState: false,
    },
  },
]

export function runProviderRequestShapingCompatibilityEvaluation(
  options: ProviderRequestShapingCompatibilityEvaluationOptions = {},
): ProviderRequestShapingCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateProviderRequestShapingFixture)
  return {
    schema: PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA,
    id: `provider-request-shaping-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateProviderRequestShapingCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateProviderRequestShapingFixture(
  fixture: ProviderRequestShapingFixture,
): ProviderRequestShapingDiagnostic {
  const missingCapabilities = fixture.policy.requiredCapabilities
    .filter((capability) => !fixture.policy.supportedCapabilities.includes(capability))
  const unsupportedEmittedFields = fixture.policy.emittedFields
    .filter((field) => requestFieldCapabilities(field).some((capability) => !fixture.policy.supportedCapabilities.includes(capability)))
  const failureCodes = collectProviderRequestShapingFailureCodes(fixture, missingCapabilities, unsupportedEmittedFields)
  return {
    fixtureId: fixture.id,
    requestShape: fixture.requestShape,
    hostingProfile: fixture.hostingProfile,
    description: fixture.description,
    readiness: resolveProviderRequestShapingReadiness(fixture, failureCodes),
    policy: {
      ...fixture.policy,
      requiredCapabilities: [...fixture.policy.requiredCapabilities].sort(),
      supportedCapabilities: [...fixture.policy.supportedCapabilities].sort(),
      requestedFields: [...fixture.policy.requestedFields].sort(),
      emittedFields: [...fixture.policy.emittedFields].sort(),
      removedFields: [...fixture.policy.removedFields].sort(),
      adjustedFields: [...fixture.policy.adjustedFields].sort(),
    },
    missingCapabilities: [...missingCapabilities].sort(),
    unsupportedEmittedFields: [...unsupportedEmittedFields].sort(),
    failureCodes,
  }
}

export function evaluateProviderRequestShapingCompatibilityQualityGate(
  diagnostics: ProviderRequestShapingDiagnostic[],
  requiredFixtureIds: string[] = [...PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS],
): ProviderRequestShapingCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRequestShapes: ProviderRequestShape[] = [
    'openai-responses',
    'openai-chat-completions',
    'anthropic-messages',
    'google-generate-content',
    'openai-compatible',
    'hosted-native',
    'local-openai-compatible',
  ]
  const requiredCapabilities: ProviderRequestCapability[] = [
    'text',
    'reasoning',
    'tools',
    'structured-output',
    'multimodal-image',
    'multimodal-file',
    'multimodal-audio',
    'native-search',
    'token-budget',
    'cache',
    'remote-compact',
    'private-data',
    'local-only',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const shape of requiredRequestShapes) {
    if (!diagnostics.some((item) => item.requestShape === shape || item.policy.fallbackShape === shape)) failures.push(`${shape}:missing-request-shape`)
  }
  for (const capability of requiredCapabilities) {
    if (!diagnostics.some((item) => item.policy.requiredCapabilities.includes(capability))) failures.push(`${capability}:missing-capability`)
  }

  requireReady(byId.get('openai-responses-reasoning-text-format'), failures)
  requireReady(byId.get('anthropic-thinking-tool-shape'), failures)
  requireReady(byId.get('gemini-multimodal-tool-schema'), failures)
  requireReady(byId.get('openai-chat-function-tool-shape'), failures)
  requireReady(byId.get('structured-output-model-metadata-shape'), failures)
  requireReady(byId.get('native-search-tool-shape'), failures)
  requireReady(byId.get('provider-cache-remote-compact-shape'), failures, { requireSameProviderCache: true })
  requireReady(byId.get('local-runtime-token-parameter-shape'), failures, { requireLocalOnly: true })

  requireDegraded(byId.get('token-max-output-normalization'), failures, 'token-max-output-normalization', { requireAdjustedMaxTokens: true })
  requireDegraded(byId.get('relay-manual-capability-declaration'), failures, 'relay-manual-capability-declaration', { requireManualDeclaration: true })
  requireDegraded(byId.get('visible-downgrade-unsupported-search'), failures, 'visible-downgrade-unsupported-search', { requireFallback: true, requireRemovedField: 'web_search_preview' })

  requireBlocked(byId.get('blocked-unsupported-reasoning-field'), failures, 'blocked-unsupported-reasoning-field', ['unsupported-reasoning-field'])
  requireBlocked(byId.get('blocked-unsupported-tool-field'), failures, 'blocked-unsupported-tool-field', ['unsupported-tool-field', 'malformed-tool-schema'])
  requireBlocked(byId.get('blocked-unsupported-multimodal-field'), failures, 'blocked-unsupported-multimodal-field', ['unsupported-multimodal-field'])
  requireBlocked(byId.get('blocked-unsupported-structured-output-field'), failures, 'blocked-unsupported-structured-output-field', ['unsupported-structured-output-field', 'malformed-structured-output-schema'])
  requireBlocked(byId.get('blocked-generic-compatible-overclaim'), failures, 'blocked-generic-compatible-overclaim', [
    'missing-capability-evidence',
    'missing-manual-capability-declaration',
    'generic-compatible-overclaim',
    'unsupported-reasoning-field',
    'unsupported-tool-field',
    'unsupported-structured-output-field',
    'unsupported-search-field',
  ])
  requireBlocked(byId.get('blocked-private-data-cloud-route'), failures, 'blocked-private-data-cloud-route', [
    'private-data-cloud-route',
    'missing-redaction',
  ])
  requireBlocked(byId.get('blocked-token-budget-overrun'), failures, 'blocked-token-budget-overrun', [
    'missing-token-normalization',
    'token-budget-exceeded',
  ])
  requireBlocked(byId.get('blocked-cross-provider-cache-state'), failures, 'blocked-cross-provider-cache-state', [
    'missing-cache-scope',
    'cross-provider-state',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredRequestShapes,
    requiredCapabilities,
  }
}

function requireReady(
  item: ProviderRequestShapingDiagnostic | undefined,
  failures: string[],
  options: { requireSameProviderCache?: boolean; requireLocalOnly?: boolean } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselineRequestShapingPolicy(item, failures)
  if (options.requireSameProviderCache) {
    if (item.policy.cacheScope !== 'same-provider') failures.push(`${item.fixtureId}:cache-not-same-provider`)
    if (!item.policy.sameProviderState) failures.push(`${item.fixtureId}:missing-same-provider-state`)
  }
  if (options.requireLocalOnly && !item.policy.supportedCapabilities.includes('local-only')) failures.push(`${item.fixtureId}:missing-local-only`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: ProviderRequestShapingDiagnostic | undefined,
  failures: string[],
  id: string,
  options: {
    requireAdjustedMaxTokens?: boolean
    requireManualDeclaration?: boolean
    requireFallback?: boolean
    requireRemovedField?: ProviderRequestField
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselineRequestShapingPolicy(item, failures, { allowMissingRequiredCapability: true })
  if (options.requireAdjustedMaxTokens && !item.policy.adjustedFields.includes(item.policy.maxOutputField)) failures.push(`${id}:missing-token-adjustment`)
  if (options.requireManualDeclaration && !item.policy.manualCapabilityDeclaration) failures.push(`${id}:missing-manual-declaration`)
  if (options.requireFallback && !item.policy.fallbackShape) failures.push(`${id}:missing-fallback-shape`)
  if (options.requireRemovedField && !item.policy.removedFields.includes(options.requireRemovedField)) failures.push(`${id}:missing-removed-${options.requireRemovedField}`)
  if (item.policy.fallbackRequired && !item.policy.downgradeVisible) failures.push(`${id}:fallback-not-visible`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselineRequestShapingPolicy(
  item: ProviderRequestShapingDiagnostic,
  failures: string[],
  options: { allowMissingRequiredCapability?: boolean } = {},
): void {
  if (!item.policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (!item.policy.providerProtocolMapped) failures.push(`${item.fixtureId}:missing-protocol`)
  if (!item.policy.endpointMapped) failures.push(`${item.fixtureId}:missing-endpoint`)
  if (!item.policy.capabilityEvidence) failures.push(`${item.fixtureId}:missing-capability-evidence`)
  if (!item.policy.noGenericCapabilityOverclaim) failures.push(`${item.fixtureId}:generic-overclaim`)
  if (!item.policy.tokenNormalized) failures.push(`${item.fixtureId}:missing-token-normalization`)
  if (item.policy.maxOutputRequestedTokens > item.policy.maxOutputLimitTokens && !item.policy.adjustedFields.includes(item.policy.maxOutputField)) failures.push(`${item.fixtureId}:missing-token-adjustment`)
  if (!options.allowMissingRequiredCapability && item.missingCapabilities.length > 0) failures.push(`${item.fixtureId}:missing-required-capability`)
  if (item.unsupportedEmittedFields.length > 0) failures.push(`${item.fixtureId}:unsupported-emitted-fields`)
  if (!item.policy.multimodalPayloadBounded) failures.push(`${item.fixtureId}:unbounded-multimodal-payload`)
  if (!item.policy.diagnosticsRedacted) failures.push(`${item.fixtureId}:missing-diagnostics-redaction`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
}

function requireBlocked(
  item: ProviderRequestShapingDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ProviderRequestShapingFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectProviderRequestShapingFailureCodes(
  fixture: ProviderRequestShapingFixture,
  missingCapabilities: ProviderRequestCapability[],
  unsupportedEmittedFields: ProviderRequestField[],
): ProviderRequestShapingFailureCode[] {
  const policy = fixture.policy
  const failures: ProviderRequestShapingFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (!policy.providerProtocolMapped) failures.push('missing-protocol')
  if (!policy.endpointMapped) failures.push('missing-endpoint')
  if (!policy.capabilityEvidence) failures.push('missing-capability-evidence')
  if (requiresModelMetadata(fixture) && !policy.modelMetadataDeclared && !policy.manualCapabilityDeclaration) failures.push('missing-model-metadata')
  if (requiresManualDeclaration(fixture) && !policy.manualCapabilityDeclaration && !policy.modelMetadataDeclared) failures.push('missing-manual-capability-declaration')
  if ((fixture.requestShape === 'openai-compatible' || fixture.hostingProfile === 'relay' || fixture.hostingProfile === 'aggregator') && !policy.noGenericCapabilityOverclaim) failures.push('generic-compatible-overclaim')
  if (missingCapabilities.length > 0 && !policy.fallbackRequired && policy.removedFields.length === 0) failures.push('unsupported-required-capability')

  for (const field of unsupportedEmittedFields) {
    for (const capability of requestFieldCapabilities(field)) {
      if (!policy.supportedCapabilities.includes(capability)) failures.push(failureCodeForUnsupportedCapability(capability))
    }
  }

  if (usesToolFields(policy.emittedFields) && !policy.toolSchemaValid) failures.push('malformed-tool-schema')
  if (usesStructuredOutputFields(policy.emittedFields) && !policy.structuredOutputSchemaValid) failures.push('malformed-structured-output-schema')
  if (usesMultimodalFields(policy.emittedFields) && !policy.multimodalPayloadBounded) failures.push('unsupported-multimodal-field')
  if (usesTokenFields(policy.emittedFields) && !policy.tokenNormalized) failures.push('missing-token-normalization')
  if (policy.maxOutputRequestedTokens > policy.maxOutputLimitTokens && !policy.tokenNormalized) failures.push('token-budget-exceeded')
  if ((policy.removedFields.length > 0 || policy.fallbackRequired) && !policy.downgradeVisible) failures.push('missing-visible-downgrade')
  if (policy.fallbackRequired && !policy.fallbackShape) failures.push('missing-fallback-shape')
  if (policy.containsPrivateData && policy.privacyMode === 'local-only' && fixture.hostingProfile !== 'local-runtime') failures.push('private-data-cloud-route')
  if (policy.containsPrivateData && !policy.redactionApplied) failures.push('missing-redaction')
  if ((usesCacheFields(policy.emittedFields) || usesRemoteCompactFields(policy.emittedFields)) && policy.cacheScope !== 'same-provider') failures.push('missing-cache-scope')
  if ((usesCacheFields(policy.emittedFields) || usesRemoteCompactFields(policy.emittedFields)) && !policy.sameProviderState) failures.push('cross-provider-state')
  if (!policy.diagnosticsRedacted) failures.push('missing-diagnostics-redaction')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveProviderRequestShapingReadiness(
  fixture: ProviderRequestShapingFixture,
  failureCodes: ProviderRequestShapingFailureCode[],
): ProviderRequestShapingReadiness {
  if (failureCodes.length > 0 || fixture.expectedReadiness === 'blocked') return 'blocked'
  if (
    fixture.expectedReadiness === 'degraded' ||
    fixture.policy.removedFields.length > 0 ||
    fixture.policy.fallbackRequired ||
    fixture.policy.maxOutputRequestedTokens > fixture.policy.maxOutputLimitTokens
  ) return 'degraded'
  return 'ready'
}

function requiresModelMetadata(fixture: ProviderRequestShapingFixture): boolean {
  if (fixture.hostingProfile === 'official' || fixture.hostingProfile === 'cloud-hosted') return false
  return fixture.policy.emittedFields.some((field) => requestFieldCapabilities(field).some((capability) => OPTIONAL_FIELD_CAPABILITIES.has(capability)))
}

function requiresManualDeclaration(fixture: ProviderRequestShapingFixture): boolean {
  if (!['relay', 'aggregator', 'local-runtime', 'blocked'].includes(fixture.hostingProfile)) return false
  return fixture.policy.emittedFields.some((field) => requestFieldCapabilities(field).some((capability) => OPTIONAL_FIELD_CAPABILITIES.has(capability)))
}

function requestFieldCapabilities(field: ProviderRequestField): ProviderRequestCapability[] {
  if (field === 'reasoning' || field === 'reasoning.effort' || field === 'thinking' || field === 'thinking.budget_tokens' || field === 'output_config.effort') return ['reasoning']
  if (field === 'tools' || field === 'tool_choice' || field === 'parallel_tool_calls' || field === 'function_declarations') return ['tools']
  if (field === 'response_format' || field === 'text.format' || field === 'generationConfig.responseSchema') return ['structured-output']
  if (field === 'input_image' || field === 'image_url' || field === 'inline_data') return ['multimodal-image']
  if (field === 'input_file' || field === 'file_data' || field === 'file_url') return ['multimodal-file']
  if (field === 'input_audio' || field === 'audio_url') return ['multimodal-audio']
  if (field === 'web_search_preview' || field === 'web_search' || field === 'google_search') return ['native-search']
  if (field === 'cache_control' || field === 'prompt_cache_key') return ['cache']
  if (field === 'previous_response_id' || field === 'cache_state_id') return ['remote-compact']
  if (field === 'max_tokens' || field === 'max_output_tokens' || field === 'max_completion_tokens' || field === 'generationConfig.maxOutputTokens') return ['token-budget']
  return []
}

function failureCodeForUnsupportedCapability(capability: ProviderRequestCapability): ProviderRequestShapingFailureCode {
  if (capability === 'reasoning') return 'unsupported-reasoning-field'
  if (capability === 'tools') return 'unsupported-tool-field'
  if (capability === 'structured-output') return 'unsupported-structured-output-field'
  if (capability === 'native-search') return 'unsupported-search-field'
  if (capability === 'cache' || capability === 'remote-compact') return 'unsupported-cache-field'
  if (capability === 'multimodal-image' || capability === 'multimodal-file' || capability === 'multimodal-audio') return 'unsupported-multimodal-field'
  return 'unsupported-required-capability'
}

function usesToolFields(fields: ProviderRequestField[]): boolean {
  return fields.some((field) => requestFieldCapabilities(field).includes('tools'))
}

function usesStructuredOutputFields(fields: ProviderRequestField[]): boolean {
  return fields.some((field) => requestFieldCapabilities(field).includes('structured-output'))
}

function usesMultimodalFields(fields: ProviderRequestField[]): boolean {
  return fields.some((field) => requestFieldCapabilities(field).some((capability) => capability === 'multimodal-image' || capability === 'multimodal-file' || capability === 'multimodal-audio'))
}

function usesTokenFields(fields: ProviderRequestField[]): boolean {
  return fields.some((field) => requestFieldCapabilities(field).includes('token-budget'))
}

function usesCacheFields(fields: ProviderRequestField[]): boolean {
  return fields.some((field) => requestFieldCapabilities(field).includes('cache'))
}

function usesRemoteCompactFields(fields: ProviderRequestField[]): boolean {
  return fields.some((field) => requestFieldCapabilities(field).includes('remote-compact'))
}

const OPTIONAL_FIELD_CAPABILITIES = new Set<ProviderRequestCapability>([
  'reasoning',
  'tools',
  'structured-output',
  'multimodal-image',
  'multimodal-file',
  'multimodal-audio',
  'native-search',
  'cache',
  'remote-compact',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
