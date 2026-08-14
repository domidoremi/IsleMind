export const PROVIDER_PROTOCOL_COMPATIBILITY_EVAL_SCHEMA = 'islemind.provider-protocol-compatibility-eval.v1'
export const PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS = [
  'openai-responses-http-sse-route',
  'openai-chat-completions-compat-route',
  'anthropic-messages-sse-route',
  'google-generate-content-sse-route',
  'openai-compatible-relay-declared-capabilities',
  'azure-openai-v1-hosted-route',
  'bedrock-runtime-signed-invoke-route',
  'local-runtime-openai-compatible-lan-route',
  'responses-websocket-contract-route',
  'responses-websocket-visible-http-fallback',
  'model-list-suppression-manual-fallback',
  'same-provider-state-continuation',
  'blocked-generic-openai-compatible-overclaim',
  'blocked-hosted-route-missing-region',
  'blocked-cross-provider-state-replay',
  'blocked-websocket-without-contract-or-runtime',
] as const

export type ProviderProtocolFixtureId = typeof PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS[number]
export type ProviderProtocolFamily =
  | 'openai-responses'
  | 'openai-chat-completions'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'openai-compatible'
  | 'hosted-openai-compatible'
  | 'hosted-native'
  | 'local-openai-compatible'
  | 'none'
export type ProviderHostingProfile = 'official' | 'relay' | 'cloud-hosted' | 'local-runtime' | 'blocked'
export type ProviderTransport = 'http_sse' | 'responses_websocket' | 'signed_http' | 'none'
export type ProviderModelListPolicy = 'allowed' | 'suppressed' | 'manual-fallback' | 'unsupported'
export type ProviderProtocolReadiness = 'ready' | 'degraded' | 'blocked'
export type ProviderProtocolFailureCode =
  | 'missing-docs'
  | 'missing-provider-identity'
  | 'missing-protocol'
  | 'missing-endpoint'
  | 'missing-auth'
  | 'missing-region-resource-scope'
  | 'missing-request-conformance'
  | 'missing-capability-evidence'
  | 'generic-capability-overclaim'
  | 'missing-transport-policy'
  | 'websocket-contract-missing'
  | 'websocket-runtime-missing'
  | 'missing-visible-fallback'
  | 'missing-model-list-policy'
  | 'missing-manual-model-fallback'
  | 'missing-local-network-opt-in'
  | 'missing-timeout-policy'
  | 'missing-error-mapping'
  | 'missing-redaction'
  | 'missing-signed-request'
  | 'cross-provider-state-replay'
  | 'control-plane-network-call'

export interface ProviderProtocolCompatibilityPolicy {
  docsMapped: boolean
  providerIdentity: boolean
  protocolMapped: boolean
  endpointResolved: boolean
  authMapped: boolean
  regionResourceScoped: boolean
  requestShapeConformed: boolean
  capabilityEvidence: boolean
  noGenericCapabilityFlattening: boolean
  responsesApiAllowed: boolean
  chatCompletionsAllowed: boolean
  modelListPolicy: ProviderModelListPolicy
  manualModelFallback: boolean
  transportDeclared: boolean
  selectedTransport: ProviderTransport
  websocketContract: boolean
  websocketRuntimeAvailable: boolean
  fallbackRequired: boolean
  transportFallbackVisible: boolean
  liveSmokePlan: boolean
  sameProviderState: boolean
  crossProviderStateReplay: boolean
  localNetworkOptIn: boolean
  timeoutPolicy: boolean
  errorMapping: boolean
  redaction: boolean
  signedRequestRequired: boolean
  signedRequest: boolean
  networkCallsAllowed: boolean
}

export interface ProviderProtocolCompatibilityFixture {
  id: ProviderProtocolFixtureId | string
  protocol: ProviderProtocolFamily
  hostingProfile: ProviderHostingProfile
  description: string
  expectedReadiness: ProviderProtocolReadiness
  endpointFamily: string
  policy: ProviderProtocolCompatibilityPolicy
}

export interface ProviderProtocolCompatibilityDiagnostic {
  fixtureId: string
  protocol: ProviderProtocolFamily
  hostingProfile: ProviderHostingProfile
  description: string
  endpointFamily: string
  readiness: ProviderProtocolReadiness
  policy: ProviderProtocolCompatibilityPolicy
  failureCodes: ProviderProtocolFailureCode[]
}

export interface ProviderProtocolCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredProtocols: ProviderProtocolFamily[]
  requiredHostingProfiles: ProviderHostingProfile[]
  requiredTransports: ProviderTransport[]
}

export interface ProviderProtocolCompatibilityEvaluationRun {
  schema: typeof PROVIDER_PROTOCOL_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ProviderProtocolCompatibilityDiagnostic[]
  qualityGate: ProviderProtocolCompatibilityQualityGate
}

export interface ProviderProtocolCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ProviderProtocolCompatibilityFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_PROTOCOL_POLICY: ProviderProtocolCompatibilityPolicy = {
  docsMapped: true,
  providerIdentity: true,
  protocolMapped: true,
  endpointResolved: true,
  authMapped: true,
  regionResourceScoped: true,
  requestShapeConformed: true,
  capabilityEvidence: true,
  noGenericCapabilityFlattening: true,
  responsesApiAllowed: false,
  chatCompletionsAllowed: true,
  modelListPolicy: 'allowed',
  manualModelFallback: true,
  transportDeclared: true,
  selectedTransport: 'http_sse',
  websocketContract: false,
  websocketRuntimeAvailable: false,
  fallbackRequired: false,
  transportFallbackVisible: true,
  liveSmokePlan: false,
  sameProviderState: true,
  crossProviderStateReplay: false,
  localNetworkOptIn: true,
  timeoutPolicy: true,
  errorMapping: true,
  redaction: true,
  signedRequestRequired: false,
  signedRequest: false,
  networkCallsAllowed: false,
}

export const PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURES: ProviderProtocolCompatibilityFixture[] = [
  {
    id: 'openai-responses-http-sse-route',
    protocol: 'openai-responses',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/responses',
    description: 'OpenAI Responses requests use provider identity, Responses endpoint routing, SSE/HTTP transport, and same-provider state.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      chatCompletionsAllowed: true,
    },
  },
  {
    id: 'openai-chat-completions-compat-route',
    protocol: 'openai-chat-completions',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/chat/completions',
    description: 'OpenAI Chat Completions stays as an explicit compatibility path instead of silently replacing Responses.',
    policy: SAFE_PROTOCOL_POLICY,
  },
  {
    id: 'anthropic-messages-sse-route',
    protocol: 'anthropic-messages',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/messages',
    description: 'Anthropic Messages uses its native request shape, auth semantics, streaming behavior, and error mapping.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      chatCompletionsAllowed: false,
      modelListPolicy: 'manual-fallback',
    },
  },
  {
    id: 'google-generate-content-sse-route',
    protocol: 'google-generate-content',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    endpointFamily: '/v1beta/models/{model}:streamGenerateContent?alt=sse',
    description: 'Gemini generateContent uses model-path routing, API-key endpoint semantics, SSE mode, and provider-specific body shaping.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      chatCompletionsAllowed: false,
      modelListPolicy: 'manual-fallback',
    },
  },
  {
    id: 'openai-compatible-relay-declared-capabilities',
    protocol: 'openai-compatible',
    hostingProfile: 'relay',
    expectedReadiness: 'degraded',
    endpointFamily: '/v1/chat/completions',
    description: 'OpenAI-compatible relays require explicit endpoint/model capability evidence and must not flatten upstream provider capabilities.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      liveSmokePlan: true,
      modelListPolicy: 'manual-fallback',
      fallbackRequired: true,
      transportFallbackVisible: true,
    },
  },
  {
    id: 'azure-openai-v1-hosted-route',
    protocol: 'hosted-openai-compatible',
    hostingProfile: 'cloud-hosted',
    expectedReadiness: 'degraded',
    endpointFamily: '/openai/v1/chat/completions',
    description: 'Azure OpenAI v1 routing remains hosted-aware for resource, deployment, region, auth, and route diagnostics.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      liveSmokePlan: true,
      modelListPolicy: 'manual-fallback',
      fallbackRequired: true,
    },
  },
  {
    id: 'bedrock-runtime-signed-invoke-route',
    protocol: 'hosted-native',
    hostingProfile: 'cloud-hosted',
    expectedReadiness: 'degraded',
    endpointFamily: '/model/{modelId}/invoke',
    description: 'Bedrock Runtime uses signed provider-native InvokeModel preparation and remains degraded until streaming and Converse are proven.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      selectedTransport: 'signed_http',
      chatCompletionsAllowed: false,
      modelListPolicy: 'manual-fallback',
      fallbackRequired: true,
      liveSmokePlan: true,
      signedRequestRequired: true,
      signedRequest: true,
    },
  },
  {
    id: 'local-runtime-openai-compatible-lan-route',
    protocol: 'local-openai-compatible',
    hostingProfile: 'local-runtime',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/chat/completions',
    description: 'Local runtimes use OpenAI-compatible routes only after LAN opt-in, timeout policy, manual fallback, and mobile loopback awareness.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      modelListPolicy: 'manual-fallback',
      liveSmokePlan: true,
    },
  },
  {
    id: 'responses-websocket-contract-route',
    protocol: 'openai-responses',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/responses websocket',
    description: 'Responses WebSocket is selected only when provider contract, app capability, streaming request, and runtime support are all present.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      selectedTransport: 'responses_websocket',
      websocketContract: true,
      websocketRuntimeAvailable: true,
    },
  },
  {
    id: 'responses-websocket-visible-http-fallback',
    protocol: 'openai-responses',
    hostingProfile: 'official',
    expectedReadiness: 'degraded',
    endpointFamily: '/v1/responses via http_sse fallback',
    description: 'Responses WebSocket requests fall back visibly to HTTP/SSE when runtime support or transport policy is unavailable.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      selectedTransport: 'http_sse',
      websocketContract: true,
      websocketRuntimeAvailable: false,
      fallbackRequired: true,
      transportFallbackVisible: true,
    },
  },
  {
    id: 'model-list-suppression-manual-fallback',
    protocol: 'openai-compatible',
    hostingProfile: 'relay',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/models suppressed',
    description: 'Providers that cannot safely expose generic model-list behavior use manual or remote-metadata fallback instead.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      modelListPolicy: 'suppressed',
      manualModelFallback: true,
      liveSmokePlan: true,
    },
  },
  {
    id: 'same-provider-state-continuation',
    protocol: 'openai-responses',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    endpointFamily: '/v1/responses continuation',
    description: 'Response ids, cache ids, and tool replay state continue only within the same provider/model route.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      sameProviderState: true,
      crossProviderStateReplay: false,
    },
  },
  {
    id: 'blocked-generic-openai-compatible-overclaim',
    protocol: 'openai-compatible',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    endpointFamily: '/v1/*',
    description: 'Unknown OpenAI-compatible endpoints cannot receive tools, Responses, reasoning, multimodal, or structured-output claims without evidence.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      providerIdentity: false,
      capabilityEvidence: false,
      noGenericCapabilityFlattening: false,
      responsesApiAllowed: true,
      modelListPolicy: 'allowed',
      manualModelFallback: false,
    },
  },
  {
    id: 'blocked-hosted-route-missing-region',
    protocol: 'hosted-openai-compatible',
    hostingProfile: 'cloud-hosted',
    expectedReadiness: 'blocked',
    endpointFamily: '/openai/v1/chat/completions',
    description: 'Cloud-hosted providers are blocked when region, resource, deployment, or account-scope routing is missing.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      regionResourceScoped: false,
      liveSmokePlan: false,
      fallbackRequired: true,
      transportFallbackVisible: false,
    },
  },
  {
    id: 'blocked-cross-provider-state-replay',
    protocol: 'openai-responses',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    endpointFamily: '/v1/responses replay',
    description: 'Provider-native response ids, cache ids, and tool-call replay items cannot move across provider routes.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      sameProviderState: false,
      crossProviderStateReplay: true,
    },
  },
  {
    id: 'blocked-websocket-without-contract-or-runtime',
    protocol: 'openai-responses',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    endpointFamily: '/v1/responses websocket',
    description: 'Responses WebSocket transport is blocked when provider contract or runtime support is missing.',
    policy: {
      ...SAFE_PROTOCOL_POLICY,
      responsesApiAllowed: true,
      selectedTransport: 'responses_websocket',
      websocketContract: false,
      websocketRuntimeAvailable: false,
      fallbackRequired: true,
      transportFallbackVisible: false,
    },
  },
]

export function runProviderProtocolCompatibilityEvaluation(
  options: ProviderProtocolCompatibilityEvaluationOptions = {},
): ProviderProtocolCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateProviderProtocolFixture)
  return {
    schema: PROVIDER_PROTOCOL_COMPATIBILITY_EVAL_SCHEMA,
    id: `provider-protocol-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateProviderProtocolCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateProviderProtocolFixture(
  fixture: ProviderProtocolCompatibilityFixture,
): ProviderProtocolCompatibilityDiagnostic {
  const failureCodes = collectProviderProtocolFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    protocol: fixture.protocol,
    hostingProfile: fixture.hostingProfile,
    description: fixture.description,
    endpointFamily: fixture.endpointFamily,
    readiness: resolveProviderProtocolReadiness(fixture, failureCodes),
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateProviderProtocolCompatibilityQualityGate(
  diagnostics: ProviderProtocolCompatibilityDiagnostic[],
  requiredFixtureIds: string[] = [...PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS],
): ProviderProtocolCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredProtocols: ProviderProtocolFamily[] = [
    'openai-responses',
    'openai-chat-completions',
    'anthropic-messages',
    'google-generate-content',
    'openai-compatible',
    'hosted-openai-compatible',
    'hosted-native',
    'local-openai-compatible',
    'none',
  ]
  const requiredHostingProfiles: ProviderHostingProfile[] = ['official', 'relay', 'cloud-hosted', 'local-runtime', 'blocked']
  const requiredTransports: ProviderTransport[] = ['http_sse', 'responses_websocket', 'signed_http', 'none']

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const protocol of requiredProtocols) {
    if (protocol !== 'none' && !diagnostics.some((item) => item.protocol === protocol)) failures.push(`${protocol}:missing-protocol`)
  }
  for (const hostingProfile of requiredHostingProfiles) {
    if (!diagnostics.some((item) => item.hostingProfile === hostingProfile)) failures.push(`${hostingProfile}:missing-hosting-profile`)
  }
  for (const transport of requiredTransports) {
    if (transport !== 'none' && !diagnostics.some((item) => item.policy.selectedTransport === transport)) failures.push(`${transport}:missing-transport`)
  }

  requireReady(byId.get('openai-responses-http-sse-route'), failures, { requireResponses: true })
  requireReady(byId.get('openai-chat-completions-compat-route'), failures)
  requireReady(byId.get('anthropic-messages-sse-route'), failures, { requireChatCompletions: false })
  requireReady(byId.get('google-generate-content-sse-route'), failures, { requireChatCompletions: false })
  requireDegraded(byId.get('openai-compatible-relay-declared-capabilities'), failures, 'openai-compatible-relay-declared-capabilities')
  requireDegraded(byId.get('azure-openai-v1-hosted-route'), failures, 'azure-openai-v1-hosted-route', { requireResponses: true })
  requireDegraded(byId.get('bedrock-runtime-signed-invoke-route'), failures, 'bedrock-runtime-signed-invoke-route', { requireSignedRequest: true, requireChatCompletions: false })
  requireReady(byId.get('local-runtime-openai-compatible-lan-route'), failures, { requireLiveSmokePlan: true })
  requireReady(byId.get('responses-websocket-contract-route'), failures, { requireResponses: true, requireWebSocket: true })
  requireDegraded(byId.get('responses-websocket-visible-http-fallback'), failures, 'responses-websocket-visible-http-fallback', { requireResponses: true })
  requireReady(byId.get('model-list-suppression-manual-fallback'), failures, { requireManualModelFallback: true })
  requireReady(byId.get('same-provider-state-continuation'), failures, { requireResponses: true })

  requireBlocked(byId.get('blocked-generic-openai-compatible-overclaim'), failures, 'blocked-generic-openai-compatible-overclaim', [
    'missing-provider-identity',
    'missing-capability-evidence',
    'generic-capability-overclaim',
    'missing-manual-model-fallback',
  ])
  requireBlocked(byId.get('blocked-hosted-route-missing-region'), failures, 'blocked-hosted-route-missing-region', [
    'missing-region-resource-scope',
    'missing-visible-fallback',
  ])
  requireBlocked(byId.get('blocked-cross-provider-state-replay'), failures, 'blocked-cross-provider-state-replay', [
    'cross-provider-state-replay',
  ])
  requireBlocked(byId.get('blocked-websocket-without-contract-or-runtime'), failures, 'blocked-websocket-without-contract-or-runtime', [
    'websocket-contract-missing',
    'websocket-runtime-missing',
    'missing-visible-fallback',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredProtocols,
    requiredHostingProfiles,
    requiredTransports,
  }
}

function requireReady(
  item: ProviderProtocolCompatibilityDiagnostic | undefined,
  failures: string[],
  options: {
    requireResponses?: boolean
    requireChatCompletions?: boolean
    requireWebSocket?: boolean
    requireLiveSmokePlan?: boolean
    requireManualModelFallback?: boolean
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselinePolicy(item, failures, options)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: ProviderProtocolCompatibilityDiagnostic | undefined,
  failures: string[],
  id: string,
  options: {
    requireResponses?: boolean
    requireChatCompletions?: boolean
    requireSignedRequest?: boolean
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselinePolicy(item, failures, {
    requireResponses: options.requireResponses,
    requireChatCompletions: options.requireChatCompletions,
    requireSignedRequest: options.requireSignedRequest,
  })
  if (!item.policy.fallbackRequired && !item.policy.liveSmokePlan) failures.push(`${id}:missing-degraded-reason`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselinePolicy(
  item: ProviderProtocolCompatibilityDiagnostic,
  failures: string[],
  options: {
    requireResponses?: boolean
    requireChatCompletions?: boolean
    requireWebSocket?: boolean
    requireLiveSmokePlan?: boolean
    requireManualModelFallback?: boolean
    requireSignedRequest?: boolean
  } = {},
): void {
  const requireChatCompletions = options.requireChatCompletions ?? true
  if (!item.policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (!item.policy.providerIdentity) failures.push(`${item.fixtureId}:missing-provider-identity`)
  if (!item.policy.protocolMapped) failures.push(`${item.fixtureId}:missing-protocol`)
  if (!item.policy.endpointResolved) failures.push(`${item.fixtureId}:missing-endpoint`)
  if (!item.policy.authMapped) failures.push(`${item.fixtureId}:missing-auth`)
  if (item.hostingProfile === 'cloud-hosted' && !item.policy.regionResourceScoped) failures.push(`${item.fixtureId}:missing-region`)
  if (!item.policy.requestShapeConformed) failures.push(`${item.fixtureId}:missing-conformance`)
  if (!item.policy.capabilityEvidence) failures.push(`${item.fixtureId}:missing-capability-evidence`)
  if (!item.policy.noGenericCapabilityFlattening) failures.push(`${item.fixtureId}:generic-overclaim`)
  if (options.requireResponses && !item.policy.responsesApiAllowed) failures.push(`${item.fixtureId}:responses-disabled`)
  if (requireChatCompletions && !item.policy.chatCompletionsAllowed) failures.push(`${item.fixtureId}:chat-disabled`)
  if (!item.policy.transportDeclared) failures.push(`${item.fixtureId}:missing-transport-policy`)
  if (options.requireWebSocket && item.policy.selectedTransport !== 'responses_websocket') failures.push(`${item.fixtureId}:not-websocket`)
  if (item.policy.selectedTransport === 'responses_websocket' && !item.policy.websocketContract) failures.push(`${item.fixtureId}:missing-websocket-contract`)
  if (item.policy.selectedTransport === 'responses_websocket' && !item.policy.websocketRuntimeAvailable) failures.push(`${item.fixtureId}:missing-websocket-runtime`)
  if (item.policy.fallbackRequired && !item.policy.transportFallbackVisible) failures.push(`${item.fixtureId}:missing-visible-fallback`)
  if (options.requireLiveSmokePlan && !item.policy.liveSmokePlan) failures.push(`${item.fixtureId}:missing-live-smoke-plan`)
  if ((options.requireManualModelFallback || item.policy.modelListPolicy !== 'allowed') && !item.policy.manualModelFallback) failures.push(`${item.fixtureId}:missing-manual-model-fallback`)
  if (item.hostingProfile === 'local-runtime' && !item.policy.localNetworkOptIn) failures.push(`${item.fixtureId}:missing-lan-opt-in`)
  if (!item.policy.timeoutPolicy) failures.push(`${item.fixtureId}:missing-timeout-policy`)
  if (!item.policy.errorMapping) failures.push(`${item.fixtureId}:missing-error-mapping`)
  if (!item.policy.redaction) failures.push(`${item.fixtureId}:missing-redaction`)
  if (options.requireSignedRequest && !item.policy.signedRequest) failures.push(`${item.fixtureId}:missing-signed-request`)
  if (!item.policy.sameProviderState || item.policy.crossProviderStateReplay) failures.push(`${item.fixtureId}:cross-provider-replay`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
}

function requireBlocked(
  item: ProviderProtocolCompatibilityDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ProviderProtocolFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectProviderProtocolFailureCodes(
  fixture: ProviderProtocolCompatibilityFixture,
): ProviderProtocolFailureCode[] {
  const policy = fixture.policy
  const failures: ProviderProtocolFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (!policy.providerIdentity) failures.push('missing-provider-identity')
  if (!policy.protocolMapped) failures.push('missing-protocol')
  if (!policy.endpointResolved) failures.push('missing-endpoint')
  if (!policy.authMapped) failures.push('missing-auth')
  if (fixture.hostingProfile === 'cloud-hosted' && !policy.regionResourceScoped) failures.push('missing-region-resource-scope')
  if (!policy.requestShapeConformed) failures.push('missing-request-conformance')
  if (!policy.capabilityEvidence) failures.push('missing-capability-evidence')
  if (!policy.noGenericCapabilityFlattening) failures.push('generic-capability-overclaim')
  if (!policy.transportDeclared) failures.push('missing-transport-policy')
  if (policy.selectedTransport === 'responses_websocket' && !policy.websocketContract) failures.push('websocket-contract-missing')
  if (policy.selectedTransport === 'responses_websocket' && !policy.websocketRuntimeAvailable) failures.push('websocket-runtime-missing')
  if (policy.fallbackRequired && !policy.transportFallbackVisible) failures.push('missing-visible-fallback')
  if (policy.modelListPolicy === 'unsupported') failures.push('missing-model-list-policy')
  if (requiresManualModelFallback(fixture) && !policy.manualModelFallback) failures.push('missing-manual-model-fallback')
  if (fixture.hostingProfile === 'local-runtime' && !policy.localNetworkOptIn) failures.push('missing-local-network-opt-in')
  if (!policy.timeoutPolicy) failures.push('missing-timeout-policy')
  if (!policy.errorMapping) failures.push('missing-error-mapping')
  if (!policy.redaction) failures.push('missing-redaction')
  if (policy.signedRequestRequired && !policy.signedRequest) failures.push('missing-signed-request')
  if (!policy.sameProviderState || policy.crossProviderStateReplay) failures.push('cross-provider-state-replay')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveProviderProtocolReadiness(
  fixture: ProviderProtocolCompatibilityFixture,
  failureCodes: ProviderProtocolFailureCode[],
): ProviderProtocolReadiness {
  if (failureCodes.some((code) => BLOCKING_PROVIDER_PROTOCOL_FAILURES.has(code))) return 'blocked'
  if (fixture.expectedReadiness === 'blocked') return 'blocked'
  if (fixture.expectedReadiness === 'degraded') return 'degraded'
  return 'ready'
}

function requiresManualModelFallback(fixture: ProviderProtocolCompatibilityFixture): boolean {
  return fixture.policy.modelListPolicy !== 'allowed' ||
    fixture.hostingProfile === 'relay' ||
    fixture.hostingProfile === 'local-runtime' ||
    fixture.hostingProfile === 'blocked'
}

const BLOCKING_PROVIDER_PROTOCOL_FAILURES = new Set<ProviderProtocolFailureCode>([
  'missing-docs',
  'missing-provider-identity',
  'missing-protocol',
  'missing-endpoint',
  'missing-auth',
  'missing-region-resource-scope',
  'missing-request-conformance',
  'missing-capability-evidence',
  'generic-capability-overclaim',
  'missing-transport-policy',
  'websocket-contract-missing',
  'websocket-runtime-missing',
  'missing-visible-fallback',
  'missing-model-list-policy',
  'missing-manual-model-fallback',
  'missing-local-network-opt-in',
  'missing-timeout-policy',
  'missing-error-mapping',
  'missing-redaction',
  'missing-signed-request',
  'cross-provider-state-replay',
  'control-plane-network-call',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
