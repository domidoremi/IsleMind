const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA,
  PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS,
  runProviderRequestShapingCompatibilityEvaluation,
} = require('../src/modules/providers/testing/providerRequestShapingCompatibilityEvaluation.ts')
const {
  createProviderConversationNativeSearchAdmission,
  resolveOpenAIResponsesWebSearchToolPolicy,
} = require('../src/modules/providers/index.ts')
const {
  conversationProviderNativeSearchAdmission,
  providerSupportsNativeSearch,
} = require('../src/bootstrap/conversationProviderNativeSearchAdmission.ts')
const {
  getProviderModelCapabilityStatus,
  providerModelCapabilityCanBeSent,
} = require('../src/bootstrap/providerCapabilityMatrix.ts')
const {
  openAIResponsesNativeWebSearchTool,
} = require('../src/bootstrap/providerRequestPolicies.ts')
function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderRequestShapingCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isProviderRequestShapingCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertBaseline(item) {
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.providerProtocolMapped, true, `${item.fixtureId} maps provider protocol`)
  assert.equal(item.policy.endpointMapped, true, `${item.fixtureId} maps endpoint`)
  assert.equal(item.policy.capabilityEvidence, true, `${item.fixtureId} has capability evidence`)
  assert.equal(item.policy.noGenericCapabilityOverclaim, true, `${item.fixtureId} avoids generic compatible overclaim`)
  assert.equal(item.policy.tokenNormalized, true, `${item.fixtureId} normalizes token parameters`)
  assert.equal(item.policy.diagnosticsRedacted, true, `${item.fixtureId} redacts diagnostics`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} records audit event`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} remains local/offline`)
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
  assert.deepEqual(item.unsupportedEmittedFields, [], `${item.fixtureId} has no unsupported emitted fields`)
}

function assertDegraded(item) {
  assert.equal(item.readiness, 'degraded', `${item.fixtureId} is degraded`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no blocking failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(
    PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.provider-request-shaping-compatibility-eval.v1',
    'provider request shaping schema is versioned',
  )
  assert.deepEqual(
    PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS,
    [
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
      'visible-downgrade-compatible-builtin-search-overclaim',
      'blocked-unsupported-reasoning-field',
      'blocked-unsupported-tool-field',
      'blocked-unsupported-multimodal-field',
      'blocked-unsupported-structured-output-field',
      'blocked-generic-compatible-overclaim',
      'blocked-private-data-cloud-route',
      'blocked-token-budget-overrun',
      'blocked-cross-provider-cache-state',
    ],
    'provider request shaping fixtures cover native, relay, local, degraded, and blocked paths',
  )

  const evaluation = runProviderRequestShapingCompatibilityEvaluation({ now: () => 2900000000000 })
  assert.equal(evaluation.schema, PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `provider request shaping gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const shape of [
    'openai-responses',
    'openai-chat-completions',
    'anthropic-messages',
    'google-generate-content',
    'openai-compatible',
    'hosted-native',
    'local-openai-compatible',
  ]) {
    assert.ok(evaluation.qualityGate.requiredRequestShapes.includes(shape), `quality gate tracks ${shape}`)
  }
  for (const capability of [
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
  ]) {
    assert.ok(evaluation.qualityGate.requiredCapabilities.includes(capability), `quality gate tracks ${capability}`)
  }

  const openaiResponses = diagnostic(evaluation, 'openai-responses-reasoning-text-format')
  assertReady(openaiResponses)
  assert.equal(openaiResponses.requestShape, 'openai-responses', 'OpenAI fixture uses Responses shape')
  assert.ok(openaiResponses.policy.emittedFields.includes('reasoning'), 'OpenAI fixture emits reasoning')
  assert.ok(openaiResponses.policy.emittedFields.includes('text.format'), 'OpenAI fixture emits text.format')
  assert.equal(openaiResponses.policy.maxOutputField, 'max_output_tokens', 'OpenAI fixture uses max_output_tokens')

  const anthropic = diagnostic(evaluation, 'anthropic-thinking-tool-shape')
  assertReady(anthropic)
  assert.ok(anthropic.policy.emittedFields.includes('thinking'), 'Anthropic fixture emits thinking')
  assert.ok(anthropic.policy.emittedFields.includes('tools'), 'Anthropic fixture emits tools')
  assert.ok(anthropic.policy.adjustedFields.includes('thinking.budget_tokens'), 'Anthropic fixture records budget adjustment')

  const gemini = diagnostic(evaluation, 'gemini-multimodal-tool-schema')
  assertReady(gemini)
  assert.equal(gemini.requestShape, 'google-generate-content', 'Gemini fixture uses generateContent shape')
  assert.ok(gemini.policy.emittedFields.includes('function_declarations'), 'Gemini fixture emits function declarations')
  assert.ok(gemini.policy.emittedFields.includes('generationConfig.responseSchema'), 'Gemini fixture emits response schema')
  assert.ok(gemini.policy.emittedFields.includes('input_audio'), 'Gemini fixture covers audio input shaping')

  assertReady(diagnostic(evaluation, 'openai-chat-function-tool-shape'))
  assertReady(diagnostic(evaluation, 'structured-output-model-metadata-shape'))
  assertReady(diagnostic(evaluation, 'native-search-tool-shape'))

  const cache = diagnostic(evaluation, 'provider-cache-remote-compact-shape')
  assertReady(cache)
  assert.equal(cache.policy.cacheScope, 'same-provider', 'cache fixture scopes state to same provider')
  assert.equal(cache.policy.sameProviderState, true, 'cache fixture preserves same-provider state')

  const localRuntime = diagnostic(evaluation, 'local-runtime-token-parameter-shape')
  assertReady(localRuntime)
  assert.equal(localRuntime.requestShape, 'local-openai-compatible', 'local runtime uses local OpenAI-compatible shape')
  assert.ok(localRuntime.policy.supportedCapabilities.includes('local-only'), 'local runtime supports local-only capability')

  const tokenClamp = diagnostic(evaluation, 'token-max-output-normalization')
  assertDegraded(tokenClamp)
  assert.equal(tokenClamp.policy.maxOutputRequestedTokens > tokenClamp.policy.maxOutputLimitTokens, true, 'token clamp fixture starts oversized')
  assert.ok(tokenClamp.policy.adjustedFields.includes('max_tokens'), 'token clamp fixture records adjusted max_tokens')

  const relayManual = diagnostic(evaluation, 'relay-manual-capability-declaration')
  assertDegraded(relayManual)
  assert.equal(relayManual.policy.manualCapabilityDeclaration, true, 'relay fixture requires manual capability declaration')
  assert.ok(relayManual.policy.emittedFields.includes('tools'), 'relay fixture emits tools after declaration')

  const searchFallback = diagnostic(evaluation, 'visible-downgrade-unsupported-search')
  assertDegraded(searchFallback)
  assert.equal(searchFallback.policy.fallbackShape, 'openai-chat-completions', 'unsupported search falls back to chat')
  assert.ok(searchFallback.policy.removedFields.includes('web_search_preview'), 'unsupported search field is removed')
  assert.equal(searchFallback.policy.downgradeVisible, true, 'unsupported search downgrade is visible')

  const builtinSearchOverclaim = diagnostic(evaluation, 'visible-downgrade-compatible-builtin-search-overclaim')
  assertDegraded(builtinSearchOverclaim)
  assert.equal(builtinSearchOverclaim.policy.modelMetadataDeclared, true, 'compatible builtin-search overclaim starts from optimistic model metadata')
  assert.equal(builtinSearchOverclaim.policy.fallbackShape, 'openai-chat-completions', 'compatible builtin-search overclaim falls back to chat')
  assert.ok(builtinSearchOverclaim.policy.removedFields.includes('web_search_preview'), 'compatible builtin-search overclaim removes OpenAI builtin search')
  assert.equal(builtinSearchOverclaim.policy.downgradeVisible, true, 'compatible builtin-search overclaim downgrade is visible')

  assertConversationNativeSearchAdmissionPolicy()
  assertOpenAIResponsesBuiltinSearchPolicy()

  assertBlocked(diagnostic(evaluation, 'blocked-unsupported-reasoning-field'), ['unsupported-reasoning-field'])
  assertBlocked(diagnostic(evaluation, 'blocked-unsupported-tool-field'), ['unsupported-tool-field', 'malformed-tool-schema'])
  assertBlocked(diagnostic(evaluation, 'blocked-unsupported-multimodal-field'), ['unsupported-multimodal-field'])
  assertBlocked(diagnostic(evaluation, 'blocked-unsupported-structured-output-field'), ['unsupported-structured-output-field', 'malformed-structured-output-schema'])
  assertBlocked(diagnostic(evaluation, 'blocked-generic-compatible-overclaim'), [
    'missing-capability-evidence',
    'missing-manual-capability-declaration',
    'generic-compatible-overclaim',
    'unsupported-reasoning-field',
    'unsupported-tool-field',
    'unsupported-structured-output-field',
    'unsupported-search-field',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-private-data-cloud-route'), ['private-data-cloud-route', 'missing-redaction'])
  assertBlocked(diagnostic(evaluation, 'blocked-token-budget-overrun'), ['missing-token-normalization', 'token-budget-exceeded'])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-provider-cache-state'), ['missing-cache-scope', 'cross-provider-state'])

  console.log('Provider request shaping compatibility tests passed')
}

function assertConversationNativeSearchAdmissionPolicy() {
  const calls = []
  let providerClaimed = true
  let modelSupported = true
  const admission = createProviderConversationNativeSearchAdmission({
    providerSupportsNativeSearch(providerInput, modelInput) {
      calls.push([providerInput, modelInput])
      return modelInput ? modelSupported : providerClaimed
    },
  })
  const providerInput = Object.freeze({
    id: 'conversation-native-search',
    type: 'openai',
    name: 'Conversation native search',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    models: Object.freeze(['search-model']),
    modelConfigs: Object.freeze([]),
    capabilities: Object.freeze({ nativeSearch: true }),
    enabled: true,
  })
  const modelInput = Object.freeze({ id: 'search-model', chatCompatible: true, preferredEndpoint: 'responses' })
  const before = JSON.stringify({ providerInput, modelInput })

  calls.length = 0
  assert.deepEqual(admission.admit({
    provider: providerInput,
    modelConfig: modelInput,
    requestedMode: 'native',
    hasAttachments: false,
  }), {
    kind: 'admitted',
    webSearchMode: 'native',
    requestedMode: 'native',
    nativeSearchSupported: true,
    displayState: 'requested',
  }, 'supported native search is admitted for an attachment-free conversation')
  assert.deepEqual(calls, [[providerInput, undefined], [providerInput, modelInput]], 'conversation admission evaluates provider support before exact model support')

  calls.length = 0
  assert.deepEqual(admission.admit({
    provider: providerInput,
    modelConfig: modelInput,
    requestedMode: 'native',
    hasAttachments: true,
  }), {
    kind: 'skipped',
    webSearchMode: 'off',
    requestedMode: 'native',
    nativeSearchSupported: true,
    displayState: 'attachments_blocked',
  }, 'attachments suppress otherwise-supported native search')

  providerClaimed = false
  calls.length = 0
  assert.deepEqual(admission.admit({
    provider: providerInput,
    modelConfig: modelInput,
    requestedMode: 'native',
    hasAttachments: false,
  }), {
    kind: 'skipped',
    webSearchMode: 'off',
    requestedMode: 'native',
    nativeSearchSupported: false,
    displayState: 'disabled',
    reason: 'provider_native_search_unclaimed',
  }, 'unclaimed provider search preserves its exact compatibility reason')
  assert.deepEqual(calls, [[providerInput, undefined]], 'unclaimed provider support short-circuits model evaluation')

  providerClaimed = true
  modelSupported = false
  calls.length = 0
  assert.deepEqual(admission.admit({
    provider: providerInput,
    modelConfig: modelInput,
    requestedMode: 'native',
    hasAttachments: false,
  }), {
    kind: 'skipped',
    webSearchMode: 'off',
    requestedMode: 'native',
    nativeSearchSupported: false,
    displayState: 'disabled',
    reason: 'provider_native_search_model_unsupported',
  }, 'model-rejected native search preserves its exact compatibility reason')
  assert.deepEqual(admission.admit({
    provider: providerInput,
    modelConfig: modelInput,
    requestedMode: 'native',
    hasAttachments: true,
  }), {
    kind: 'skipped',
    webSearchMode: 'off',
    requestedMode: 'native',
    nativeSearchSupported: false,
    displayState: 'attachments_blocked',
    reason: 'provider_native_search_model_unsupported',
  }, 'attachment display suppression and model compatibility evidence remain separate')

  modelSupported = true
  for (const requestedMode of ['off', 'tavily', 'google', 'bing', 'custom']) {
    assert.deepEqual(admission.admit({
      provider: providerInput,
      modelConfig: modelInput,
      requestedMode,
      hasAttachments: false,
    }), {
      kind: 'skipped',
      webSearchMode: 'off',
      requestedMode,
      nativeSearchSupported: true,
      displayState: 'disabled',
    }, `${requestedMode} preserves exact requested identity without enabling provider-native search`)
  }
  assert.equal(JSON.stringify({ providerInput, modelInput }), before, 'conversation native-search admission does not mutate frozen provider or model inputs')
}

function assertOpenAIResponsesBuiltinSearchPolicy() {
  const geminiRelay = provider({
    id: 'gemini-compatible-relay',
    name: 'Gemini compatible relay',
    baseUrl: 'https://relay.example/google-gemini',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('google/gemini-2.5-pro', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(geminiRelay, 'google/gemini-2.5-pro').reason,
    'gemini_compatible_route_rejects_openai_builtin_search',
    'Gemini-compatible routes do not inherit OpenAI Responses builtin search',
  )
  assert.equal(openAIResponsesNativeWebSearchTool(geminiRelay, 'google/gemini-2.5-pro'), undefined, 'Gemini-compatible builtin search is omitted before send')
  assert.equal(providerSupportsNativeSearch(geminiRelay), true, 'Gemini-compatible relay can still claim provider-level native search')
  assert.equal(providerSupportsNativeSearch(geminiRelay, geminiRelay.modelConfigs[0]), false, 'Gemini-compatible relay native search is blocked for the incompatible model route')
  assert.deepEqual(conversationProviderNativeSearchAdmission.admit({
    provider: geminiRelay,
    modelConfig: geminiRelay.modelConfigs[0],
    requestedMode: 'native',
    hasAttachments: false,
  }), {
    kind: 'skipped',
    webSearchMode: 'off',
    requestedMode: 'native',
    nativeSearchSupported: false,
    displayState: 'disabled',
    reason: 'provider_native_search_model_unsupported',
  }, 'bootstrap-composed conversation admission applies the target provider/model support policy')
  assert.equal(providerModelCapabilityCanBeSent(geminiRelay, 'google/gemini-2.5-pro', 'nativeSearch'), false, 'Gemini-compatible nativeSearch send policy blocks builtin search overclaim')
  assert.equal(
    getProviderModelCapabilityStatus(geminiRelay, 'google/gemini-2.5-pro', 'nativeSearch')?.status,
    'unsupported',
    'Gemini-compatible nativeSearch matrix exposes unsupported status for builtin-search overclaim',
  )

  const qwenCoderRelay = provider({
    id: 'qwen3-coder-relay',
    name: 'Qwen3 Coder Relay',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('qwen3-coder-plus', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(qwenCoderRelay, 'qwen3-coder-plus').reason,
    'qwen3_coder_route_rejects_openai_builtin_search',
    'Qwen3-Coder routes block OpenAI Responses builtin search',
  )
  assert.equal(openAIResponsesNativeWebSearchTool(qwenCoderRelay, 'qwen3-coder-plus'), undefined, 'Qwen3-Coder builtin search is omitted before send')

  const dashScopeQwen = provider({
    id: 'dashscope-compatible',
    name: 'DashScope compatible',
    presetId: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('qwen-plus', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(dashScopeQwen, 'qwen-plus').allowed,
    true,
    'Generic Qwen routes are not blocked by the Qwen3-Coder-specific search policy',
  )

  const qwenCoderLegacy = provider({
    id: 'dashscope-legacy-coder',
    name: 'DashScope legacy coder',
    presetId: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('qwen-coder-plus', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(qwenCoderLegacy, 'qwen-coder-plus').allowed,
    true,
    'Qwen coder names without the Qwen3-Coder route identity keep the default search policy',
  )

  const mimoRelay = provider({
    id: 'mimo-vendor-relay',
    name: 'Vendor relay',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('xiaomi/mimo-v2.5-pro', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(mimoRelay, 'xiaomi/mimo-v2.5-pro').reason,
    'mimo_compatible_route_requires_provider_native_search_shape',
    'MiMo vendor-prefixed model routes use provider-native search shape instead of OpenAI builtin search',
  )
  assert.equal(openAIResponsesNativeWebSearchTool(mimoRelay, 'xiaomi/mimo-v2.5-pro'), undefined, 'MiMo-compatible builtin search is omitted before send')

  const longCatRelay = provider({
    id: 'longcat-vendor-relay',
    name: 'Vendor relay',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('longcat/longcat-flash-chat', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(longCatRelay, 'longcat/longcat-flash-chat').reason,
    'longcat_compatible_route_rejects_openai_builtin_search',
    'LongCat vendor-prefixed model routes block OpenAI Responses builtin search',
  )

  const namedRelay = provider({
    id: 'xiaomi-labeled-relay',
    name: 'Xiaomi labeled relay',
    baseUrl: 'https://relay.example/v1',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('gpt-4o-search', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(namedRelay, 'gpt-4o-search').allowed,
    true,
    'Provider labels alone do not disable OpenAI Responses builtin search without host, preset, or selected-model route evidence',
  )
  assert.deepEqual(openAIResponsesNativeWebSearchTool(namedRelay, 'gpt-4o-search'), { type: 'web_search_preview' }, 'label-only relays can still opt into Responses builtin search')

  const miniMaxRelay = provider({
    id: 'minimax-relay',
    name: 'MiniMax',
    presetId: 'minimax',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('MiniMax-M3', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(
    resolveOpenAIResponsesWebSearchToolPolicy(miniMaxRelay, 'MiniMax-M3').reason,
    'known_family_rejects_openai_builtin_search',
    'MiniMax routes block OpenAI Responses builtin search',
  )
  assert.equal(openAIResponsesNativeWebSearchTool(miniMaxRelay, 'MiniMax-M3'), undefined, 'MiniMax builtin search is omitted before send')

  const xaiProvider = provider({
    id: 'xai',
    name: 'xAI',
    presetId: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('grok-4', { supportedParameters: ['web_search'], preferredEndpoint: 'responses' }),
  })
  assert.equal(resolveOpenAIResponsesWebSearchToolPolicy(xaiProvider, 'grok-4').allowed, true, 'xAI keeps documented OpenAI Responses search')
  assert.deepEqual(openAIResponsesNativeWebSearchTool(xaiProvider, 'grok-4'), { type: 'web_search' }, 'xAI emits provider-specific web_search')
  assert.equal(providerSupportsNativeSearch(xaiProvider, xaiProvider.modelConfigs[0]), true, 'xAI model-aware native search remains supported')
  assert.equal(providerModelCapabilityCanBeSent(xaiProvider, 'grok-4', 'nativeSearch'), true, 'xAI nativeSearch remains sendable')

  const manualRelay = provider({
    id: 'manual-relay',
    name: 'Manual relay',
    presetId: 'custom-endpoint',
    wireProtocol: 'openai-compatible',
    capabilities: { responsesApi: true, nativeSearch: true },
    model: modelConfig('manual-search-model', { supportedParameters: ['web_search_preview'], preferredEndpoint: 'responses' }),
  })
  assert.equal(resolveOpenAIResponsesWebSearchToolPolicy(manualRelay, 'manual-search-model').allowed, true, 'manual relay is not blocked without a known incompatible family')
  assert.deepEqual(openAIResponsesNativeWebSearchTool(manualRelay, 'manual-search-model'), { type: 'web_search_preview' }, 'manual relay can still opt into Responses builtin search')
}

function provider(input) {
  return {
    id: input.id,
    type: 'openai-compatible',
    presetId: input.presetId,
    name: input.name,
    apiKey: 'test-key',
    baseUrl: input.baseUrl,
    models: [input.model.id],
    modelConfigs: [input.model],
    capabilities: input.capabilities,
    enabled: true,
  }
}

function modelConfig(id, overrides = {}) {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    contextWindow: 128000,
    maxTokens: 128000,
    maxOutputTokens: 8192,
    defaultMaxTokens: 1024,
    supportsVision: false,
    supportsFiles: false,
    supportsTools: true,
    supportsStreaming: true,
    source: 'remote',
    ...overrides,
  }
}

if (require.main === module) run()

module.exports = { run }
