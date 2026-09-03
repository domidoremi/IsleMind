const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_PARAMETER_MATRIX_SCHEMA,
} = require('../src/modules/providers/providerParameterMatrixPolicy.ts')
const {
  buildProviderParameterMatrix,
  getProviderParameterEntry,
  providerParameterCanBeSent,
} = require('../src/bootstrap/providerParameterMatrix.ts')
const { buildProviderProtocolRequestBody } = require('../src/bootstrap/providerRequestBinding.ts')
const { resolveGenerationParameterSources } = require('../src/core/assistantProtocol.ts')
const { DEFAULT_MODELS, getModelConfig } = require('../src/types/modelCatalog.ts')

// Each catalog reasoning mode needs a provider shaped like the vendor it belongs to, because the
// runtime gates vendor thinking fields on provider identity as well as model metadata.
const REASONING_MODE_WIRE_CONTRACT = {
  'openai-effort': { provider: { type: 'openai', presetId: 'openai', baseUrl: 'https://api.openai.com/v1' }, path: ['reasoning', 'effort'], maxTokensPath: ['max_output_tokens'] },
  'anthropic-thinking': { provider: { type: 'anthropic', presetId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, path: ['output_config', 'effort'], maxTokensPath: ['max_tokens'] },
  'gemini-thinking-level': { provider: { type: 'google', presetId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }, path: ['generationConfig', 'thinkingConfig', 'thinkingLevel'], maxTokensPath: ['generationConfig', 'maxOutputTokens'] },
  'gemini-thinking-budget': { provider: { type: 'google', presetId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }, path: ['generationConfig', 'thinkingConfig', 'thinkingBudget'], maxTokensPath: ['generationConfig', 'maxOutputTokens'] },
  'deepseek-thinking': { provider: { type: 'openai-compatible', presetId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }, path: ['thinking', 'type'], maxTokensPath: ['max_tokens'] },
  'dashscope-thinking': { provider: { type: 'openai-compatible', presetId: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, path: ['enable_thinking'], maxTokensPath: ['max_tokens'] },
  'kimi-thinking': { provider: { type: 'openai-compatible', presetId: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1' }, path: ['thinking', 'type'], maxTokensPath: ['max_completion_tokens'] },
  'minimax-thinking': { provider: { type: 'openai-compatible', presetId: 'minimax', baseUrl: 'https://api.minimax.io/v1' }, path: ['thinking', 'type'], maxTokensPath: ['max_completion_tokens'] },
  'xai-reasoning-effort': { provider: { type: 'openai-compatible', presetId: 'xai', baseUrl: 'https://api.x.ai/v1' }, path: ['reasoning', 'effort'], maxTokensPath: ['max_output_tokens'] },
  'cerebras-reasoning-effort': { provider: { type: 'openai-compatible', presetId: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1' }, path: ['reasoning_effort'], maxTokensPath: ['max_completion_tokens'] },
  'cohere-reasoning-effort': { provider: { type: 'openai-compatible', presetId: 'cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1' }, path: ['reasoning_effort'], maxTokensPath: ['max_tokens'] },
  'perplexity-reasoning-effort': { provider: { type: 'openai-compatible', presetId: 'perplexity', baseUrl: 'https://api.perplexity.ai' }, path: ['reasoning_effort'], maxTokensPath: ['max_tokens'] },
}

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderParameterMatrixHook) return

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
  hook.isProviderParameterMatrixHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function provider(overrides) {
  return {
    id: overrides.id,
    type: overrides.type,
    presetId: overrides.presetId,
    name: overrides.name ?? overrides.id,
    apiKey: 'test-key',
    models: overrides.models,
    modelConfigs: overrides.modelConfigs,
    enabled: true,
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      vision: true,
      files: true,
      audioInput: false,
      audioTranscription: false,
      speech: false,
      nativeSearch: true,
      reasoningEffort: true,
      nativeTools: true,
      topP: true,
      responsesApi: true,
      remoteCompact: true,
      ...(overrides.capabilities ?? {}),
    },
    ...(overrides.baseUrl ? { baseUrl: overrides.baseUrl } : {}),
    ...(overrides.wireProtocol ? { wireProtocol: overrides.wireProtocol } : {}),
  }
}

function entry(matrix, capability) {
  const item = matrix.entries.find((candidate) => candidate.capability === capability)
  assert.ok(item, `${matrix.providerId} ${matrix.modelId} includes ${capability}`)
  return item
}

function assertEvidence(item, source, urlPart, label) {
  assert.ok(
    item.docEvidence.some((evidence) => evidence.source === source && evidence.url?.includes(urlPart) && evidence.checkedAt === '2026-07-04'),
    label
  )
}

function assertRuntime(item, marker, label) {
  assert.ok(item.runtimeEvidence.includes(marker), label)
}

function wireValue(body, path) {
  let current = body
  for (const key of path) {
    if (current === undefined || current === null) return undefined
    current = current[key]
  }
  return current
}

function reasoningProvider(mode, modelId) {
  const contract = REASONING_MODE_WIRE_CONTRACT[mode]
  return {
    id: `wire-${mode}`,
    name: mode,
    apiKey: 'sk-parameter-matrix-000000000000000000',
    models: [modelId],
    enabled: true,
    ...contract.provider,
  }
}

function buildReasoningBody(mode, modelId, overrides = {}) {
  return buildProviderProtocolRequestBody({
    provider: reasoningProvider(mode, modelId),
    model: modelId,
    messages: [{ role: 'user', content: 'ping' }],
    stream: true,
    ...overrides,
  })
}

// Every reasoning mode declared in the catalog must reach the wire. Without this the catalog can
// declare a thinking capability that the request builder silently drops.
function assertReasoningModesReachTheWire() {
  const representative = new Map()
  for (const model of DEFAULT_MODELS) {
    if (!model.reasoningMode || model.deprecated) continue
    if (!representative.has(model.reasoningMode)) representative.set(model.reasoningMode, model)
  }
  assert.ok(representative.size > 0, 'catalog declares at least one reasoning mode')

  for (const [mode, model] of representative) {
    const contract = REASONING_MODE_WIRE_CONTRACT[mode]
    assert.ok(contract, `reasoning mode ${mode} has a documented wire contract`)
    const effort = model.reasoningEfforts?.find((item) => item !== 'none') ?? 'high'
    const body = buildReasoningBody(mode, model.id, { reasoningEffort: effort })
    const value = wireValue(body, contract.path)
    assert.notEqual(value, undefined, `${mode} sends ${contract.path.join('.')} for ${model.id}`)
    if (typeof value === 'string' && model.reasoningEfforts?.includes(value)) {
      assert.equal(value, effort, `${mode} forwards the selected reasoning effort for ${model.id}`)
    }
  }
}

// A user-selected output budget must win over the catalog default, and a configured global
// preference must not be downgraded to an omitted provider default.
function assertMaxTokensPrecedence() {
  for (const [mode, model] of Object.entries(REASONING_MODE_WIRE_CONTRACT).map(([key]) => [key, DEFAULT_MODELS.find((item) => item.reasoningMode === key && !item.deprecated)]).filter(([, item]) => item)) {
    const contract = REASONING_MODE_WIRE_CONTRACT[mode]
    const config = getModelConfig(model.id, contract.provider.type)
    const userValue = Math.max(1, Math.floor(config.defaultMaxTokens / 2))
    assert.notEqual(userValue, config.defaultMaxTokens, `${mode} fixture uses a user budget distinct from the catalog default`)

    const explicitBody = buildReasoningBody(mode, model.id, {
      maxTokens: userValue,
      generationParameterSources: { maxTokens: 'explicit' },
    })
    assert.equal(
      wireValue(explicitBody, contract.maxTokensPath),
      userValue,
      `${mode} sends the user output budget instead of the catalog default for ${model.id}`
    )

    const overCapBody = buildReasoningBody(mode, model.id, {
      maxTokens: config.maxOutputTokens + 100000,
      generationParameterSources: { maxTokens: 'explicit' },
    })
    assert.equal(
      wireValue(overCapBody, contract.maxTokensPath),
      config.maxOutputTokens,
      `${mode} clamps an over-cap user budget to the model output limit for ${model.id}`
    )

    const defaultBody = buildReasoningBody(mode, model.id, {
      generationParameterSources: { maxTokens: 'internal-policy' },
    })
    assert.equal(
      wireValue(defaultBody, contract.maxTokensPath),
      Math.min(config.defaultMaxTokens, config.maxOutputTokens),
      `${mode} falls back to the catalog default output budget for ${model.id}`
    )
  }
}

// The conversation store seeds a configured global preference as an explicit override, so the
// resolved source must stay explicit rather than collapsing to provider-default.
function assertConfiguredPreferenceStaysExplicit() {
  const seeded = resolveGenerationParameterSources({
    values: { temperature: 0.4, maxTokens: 2048 },
    overrides: { temperature: true, maxTokens: true },
  })
  assert.equal(seeded.maxTokens, 'explicit', 'a configured global max-token preference is sent as an explicit value')
  assert.equal(seeded.temperature, 'explicit', 'a configured global temperature preference is sent as an explicit value')

  const untouched = resolveGenerationParameterSources({ values: { temperature: 1, maxTokens: 8192 }, overrides: {} })
  assert.equal(untouched.maxTokens, 'provider-default', 'an unconfigured output budget stays a provider default')

  const storeSource = fs.readFileSync(path.join(root, 'src/store/chatStore.ts'), 'utf8')
  assert.ok(
    storeSource.includes('resolveConfiguredGenerationParameterOverrides(settings)'),
    'new conversations seed override flags from configured global preferences'
  )
  const selectionSource = fs.readFileSync(path.join(root, 'src/components/chat/chatModelSelection.ts'), 'utf8')
  assert.ok(
    selectionSource.includes("resolveConversationGenerationParameterDefault('maxTokens', parameterRanges, { maxTokens })"),
    'the setup shell resolves the output budget from the configured global preference'
  )
}

function run() {
  const openai = provider({
    id: 'openai',
    type: 'openai',
    presetId: 'openai',
    models: ['gpt-5'],
    capabilities: { embeddings: true },
  })
  const openaiMatrix = buildProviderParameterMatrix(openai, 'gpt-5')
  assert.equal(openaiMatrix.schema, PROVIDER_PARAMETER_MATRIX_SCHEMA, 'parameter matrix schema is versioned')
  assert.equal(openaiMatrix.family, 'openai', 'OpenAI provider maps to official OpenAI family')
  assert.equal(openaiMatrix.preferredEndpoint, 'responses', 'OpenAI reasoning model prefers Responses routing')
  assert.equal(entry(openaiMatrix, 'reasoning').status, 'sendable', 'OpenAI reasoning effort is sendable')
  assert.deepEqual(entry(openaiMatrix, 'reasoning').requestPath, ['reasoning', 'effort'], 'OpenAI reasoning maps to reasoning.effort')
  assertEvidence(entry(openaiMatrix, 'reasoning'), 'official-docs', 'developers.openai.com/api/docs/guides/reasoning', 'OpenAI reasoning entry cites official docs')
  assertRuntime(entry(openaiMatrix, 'reasoning'), 'buildOpenAIResponsesReasoning', 'OpenAI reasoning entry cites runtime shaping')
  assert.equal(entry(openaiMatrix, 'reasoning-summary').status, 'sendable', 'OpenAI reasoning summary is sendable')
  assert.deepEqual(entry(openaiMatrix, 'context-continuity').requestPath, ['previous_response_id'], 'OpenAI context continuity maps to previous_response_id')
  assertEvidence(entry(openaiMatrix, 'context-continuity'), 'official-docs', 'responses-vs-chat-completions', 'OpenAI continuity entry cites Responses docs')
  assert.equal(entry(openaiMatrix, 'remote-compact').status, 'sendable', 'OpenAI remote compact is sendable for Responses models')
  assert.deepEqual(entry(openaiMatrix, 'remote-compact').requestPath, ['context_management', 'compact_threshold'], 'OpenAI remote compact maps to Responses context_management')
  assertRuntime(entry(openaiMatrix, 'remote-compact'), 'decideRemoteCompact', 'OpenAI remote compact cites runtime decision logic')
  assert.equal(entry(openaiMatrix, 'streaming').status, 'sendable', 'OpenAI streaming is sendable when provider and model policy allow it')
  assert.deepEqual(entry(openaiMatrix, 'streaming').requestPath, ['stream'], 'OpenAI streaming maps to the stream request field')
  assertRuntime(entry(openaiMatrix, 'streaming'), 'resolveProviderStreamingPolicy', 'OpenAI streaming cites the shared effective-stream policy')
  assert.deepEqual(entry(openaiMatrix, 'structured-output').requestPath, ['text', 'format'], 'OpenAI Responses structured output maps to text.format')
  assert.equal(entry(openaiMatrix, 'embeddings').status, 'sendable', 'OpenAI embeddings are sendable when provider flags and contract agree')
  assert.deepEqual(entry(openaiMatrix, 'embeddings').requestPath, ['embeddings', 'model', 'input'], 'OpenAI embeddings map to the embeddings endpoint')
  assertEvidence(entry(openaiMatrix, 'embeddings'), 'official-docs', 'platform.openai.com/docs/api-reference/embeddings/create', 'OpenAI embeddings entry cites official docs')
  assertRuntime(entry(openaiMatrix, 'embeddings'), 'embedProviderText', 'OpenAI embeddings entry cites bootstrap runtime adapter')
  assert.equal(entry(openaiMatrix, 'rerank').status, 'blocked', 'OpenAI provider rerank stays blocked without a native rerank adapter')
  assertEvidence(entry(openaiMatrix, 'sampling'), 'official-docs', 'developers.openai.com/api/reference/responses/create', 'OpenAI sampling entry cites API reference')
  assertEvidence(entry(openaiMatrix, 'token-budget'), 'official-docs', 'developers.openai.com/api/reference/responses/create', 'OpenAI token budget entry cites API reference')
  assert.equal(
    entry(openaiMatrix, 'sampling').parameters.find((parameter) => parameter.parameter === 'topK').reason,
    'unsupported-endpoint',
    'OpenAI Responses reports Top-K as unsupported by the selected endpoint'
  )
  assert.equal(
    entry(openaiMatrix, 'sampling').parameters.find((parameter) => parameter.parameter === 'topK').status,
    'blocked',
    'OpenAI Responses does not advertise a Top-K control that its serializer cannot send'
  )
  const openaiAudio = provider({
    id: 'openai-audio',
    type: 'openai',
    presetId: 'openai',
    models: ['gpt-5'],
    capabilities: { audioTranscription: true, speech: true },
  })
  const openaiAudioMatrix = buildProviderParameterMatrix(openaiAudio, 'gpt-5')
  assert.equal(entry(openaiAudioMatrix, 'audio-transcription').status, 'sendable', 'OpenAI audio transcription is sendable when provider flags and contract agree')
  assert.deepEqual(entry(openaiAudioMatrix, 'audio-transcription').requestPath, ['audio', 'transcriptions'], 'OpenAI transcription maps to audio transcriptions endpoint')
  assert.equal(entry(openaiAudioMatrix, 'speech-output').status, 'sendable', 'OpenAI speech output is sendable when provider flags and contract agree')
  assert.deepEqual(entry(openaiAudioMatrix, 'speech-output').requestPath, ['audio', 'speech'], 'OpenAI speech maps to audio speech endpoint')
  assertEvidence(entry(openaiAudioMatrix, 'audio-transcription'), 'official-docs', 'developers.openai.com/api/reference/audio', 'OpenAI audio transcription cites Audio API reference')
  assertEvidence(entry(openaiAudioMatrix, 'speech-output'), 'official-docs', 'developers.openai.com/api/reference/audio', 'OpenAI speech output cites Audio API reference')

  const openaiStreamingDisabled = provider({
    id: 'openai-streaming-disabled',
    type: 'openai',
    presetId: 'openai',
    models: ['gpt-5'],
    capabilities: { streaming: false },
  })
  const openaiStreamingDisabledMatrix = buildProviderParameterMatrix(openaiStreamingDisabled, 'gpt-5')
  assert.equal(entry(openaiStreamingDisabledMatrix, 'streaming').status, 'blocked', 'provider-level streaming opt-out blocks an otherwise streamable model')
  assert.equal(providerParameterCanBeSent(openaiStreamingDisabled, 'gpt-5', 'streaming'), false, 'blocked streaming entries cannot be sent')

  const anthropic = provider({
    id: 'anthropic',
    type: 'anthropic',
    presetId: 'anthropic',
    models: ['claude-haiku-4-5'],
  })
  const anthropicMatrix = buildProviderParameterMatrix(anthropic, 'claude-haiku-4-5')
  assert.equal(anthropicMatrix.family, 'anthropic', 'Anthropic provider maps to official Anthropic family')
  assert.equal(entry(anthropicMatrix, 'reasoning').status, 'sendable', 'Anthropic thinking is sendable')
  assert.deepEqual(entry(anthropicMatrix, 'reasoning').requestPath, ['thinking', 'budget_tokens'], 'Anthropic thinking maps to thinking.budget_tokens')
  assert.deepEqual(entry(anthropicMatrix, 'streaming').requestPath, ['stream'], 'Anthropic streaming maps to the Messages stream field')
  assertEvidence(entry(anthropicMatrix, 'reasoning'), 'official-docs', 'platform.claude.com/docs/en/build-with-claude/extended-thinking', 'Anthropic reasoning entry cites official docs')
  assertEvidence(entry(anthropicMatrix, 'tool-calling'), 'official-docs', 'platform.claude.com/docs/en/agents-and-tools/tool-use/overview', 'Anthropic tool entry cites official docs')
  assert.deepEqual(entry(anthropicMatrix, 'structured-output').requestPath, ['tools', 'input_schema', 'tool_choice'], 'Anthropic structured output maps to forced tool schema')
  assertRuntime(entry(anthropicMatrix, 'structured-output'), 'buildAnthropicStructuredOutputTool', 'Anthropic structured output cites runtime shaping')
  assertEvidence(entry(anthropicMatrix, 'sampling'), 'official-docs', 'platform.claude.com/docs/en/api/messages/create', 'Anthropic sampling entry cites Messages API docs')
  assertEvidence(entry(anthropicMatrix, 'token-budget'), 'official-docs', 'platform.claude.com/docs/en/api/messages/create', 'Anthropic token budget entry cites Messages API docs')

  const google = provider({
    id: 'google',
    type: 'google',
    presetId: 'google',
    models: ['gemini-2.5-flash'],
  })
  const googleMatrix = buildProviderParameterMatrix(google, 'gemini-2.5-flash')
  assert.equal(googleMatrix.family, 'google', 'Google provider maps to Gemini family')
  assert.equal(entry(googleMatrix, 'reasoning').status, 'sendable', 'Gemini thinking is sendable')
  assert.deepEqual(entry(googleMatrix, 'reasoning').requestPath, ['generationConfig', 'thinkingConfig', 'thinkingBudget'], 'Gemini 2.5 thinking maps to thinkingBudget')
  assert.deepEqual(entry(googleMatrix, 'streaming').requestPath, ['endpoint', ':streamGenerateContent', 'alt=sse'], 'Gemini streaming maps to the SSE endpoint selection')
  assertEvidence(entry(googleMatrix, 'reasoning'), 'official-docs', 'ai.google.dev/gemini-api/docs/thinking', 'Gemini reasoning entry cites official docs')
  assert.deepEqual(entry(googleMatrix, 'structured-output').requestPath, ['generationConfig', 'responseMimeType', 'responseSchema'], 'Gemini structured output maps to response schema config')
  assertEvidence(entry(googleMatrix, 'structured-output'), 'official-docs', 'ai.google.dev/gemini-api/docs/structured-output', 'Gemini structured output cites official docs')
  assert.deepEqual(entry(googleMatrix, 'tool-calling').requestPath, ['tools'], 'Gemini tool calling maps to tools')
  assertEvidence(entry(googleMatrix, 'sampling'), 'official-docs', 'ai.google.dev/api/generate-content', 'Gemini sampling entry cites GenerateContent API docs')
  assertEvidence(entry(googleMatrix, 'token-budget'), 'official-docs', 'ai.google.dev/api/generate-content', 'Gemini token budget entry cites GenerateContent API docs')
  assert.equal(
    entry(googleMatrix, 'sampling').parameters.find((parameter) => parameter.parameter === 'topK').status,
    'sendable',
    'Gemini keeps Top-K sendable because generationConfig serializes it'
  )
  assert.equal(entry(googleMatrix, 'audio-input').status, 'blocked', 'Gemini audio input remains blocked without audio capability flag')
  assert.equal(entry(googleMatrix, 'embeddings').status, 'blocked', 'Gemini embeddings remain blocked until native embedding routing exists')
  assertEvidence(entry(googleMatrix, 'embeddings'), 'official-docs', 'ai.google.dev/gemini-api/docs/embeddings', 'Gemini embeddings entry cites official docs')
  const googleAudio = provider({
    id: 'google-audio',
    type: 'google',
    presetId: 'google',
    models: ['gemini-2.5-flash'],
    capabilities: { audioInput: true },
  })
  const googleAudioMatrix = buildProviderParameterMatrix(googleAudio, 'gemini-2.5-flash')
  assert.equal(entry(googleAudioMatrix, 'audio-input').status, 'sendable', 'Gemini audio input is sendable when provider flags and contract agree')
  assert.equal(entry(googleAudioMatrix, 'audio-transcription').status, 'sendable', 'Gemini audio transcription is sendable through GenerateContent audio parts')
  assert.deepEqual(entry(googleAudioMatrix, 'audio-transcription').requestPath, ['contents', 'parts', 'inline_data'], 'Gemini transcription maps to audio inline_data parts')

  const googleLevelMatrix = buildProviderParameterMatrix(google, 'gemini-3.5-flash')
  assert.deepEqual(entry(googleLevelMatrix, 'reasoning').requestPath, ['generationConfig', 'thinkingConfig', 'thinkingLevel'], 'Gemini 3 thinking maps to thinkingLevel')

  const unsupported = provider({
    id: 'plain-compatible',
    type: 'openai-compatible',
    presetId: 'custom-endpoint',
    wireProtocol: 'openai-compatible',
    models: ['plain-model'],
    capabilities: { reasoningEffort: false, nativeSearch: false, nativeTools: false, responsesApi: false },
  })
  const unsupportedMatrix = buildProviderParameterMatrix(unsupported, 'plain-model')
  assert.equal(entry(unsupportedMatrix, 'reasoning').status, 'unknown', 'unclaimed compatible reasoning remains unknown')
  assert.equal(entry(unsupportedMatrix, 'embeddings').status, 'blocked', 'compatible embeddings require explicit provider support')
  assert.equal(entry(unsupportedMatrix, 'remote-compact').status, 'blocked', 'remote compact requires Responses compact support')
  assert.equal(providerParameterCanBeSent(unsupported, 'plain-model', 'reasoning'), false, 'unknown compatible reasoning is not sendable')
  assert.equal(getProviderParameterEntry(openai, 'gpt-5', 'reasoning').status, 'sendable', 'single entry lookup works')

  const maxTokensOnly = provider({
    id: 'max-tokens-only',
    type: 'openai-compatible',
    presetId: 'custom-endpoint',
    wireProtocol: 'openai-compatible',
    models: ['max-tokens-only-model'],
    modelConfigs: [{
      id: 'max-tokens-only-model',
      name: 'Max Tokens Only',
      provider: 'openai-compatible',
      contextWindow: 8192,
      maxTokens: 8192,
      maxOutputTokens: 2048,
      defaultMaxTokens: 512,
      supportedParameters: ['max_tokens'],
    }],
    capabilities: { reasoningEffort: false, nativeSearch: false, nativeTools: false, responsesApi: false },
  })
  const maxTokensOnlyMatrix = buildProviderParameterMatrix(maxTokensOnly, 'max-tokens-only-model')
  assert.equal(entry(maxTokensOnlyMatrix, 'sampling').status, 'blocked', 'a max_tokens-only model does not overclaim sampling support')
  assert.equal(entry(maxTokensOnlyMatrix, 'token-budget').status, 'sendable', 'a max_tokens-only model still exposes its token budget')

  const cohere = provider({
    id: 'cohere',
    type: 'openai-compatible',
    presetId: 'cohere',
    models: ['embed-v4.0'],
    capabilities: { embeddings: true, rerank: true, nativeTools: false, nativeSearch: false, responsesApi: false, remoteCompact: false },
  })
  const cohereMatrix = buildProviderParameterMatrix(cohere, 'embed-v4.0')
  assert.equal(entry(cohereMatrix, 'embeddings').status, 'sendable', 'OpenAI-compatible provider embeddings are sendable when declared and contract-backed')
  assert.equal(entry(cohereMatrix, 'rerank').status, 'blocked', 'provider rerank remains blocked until native rerank routing exists')
  assertEvidence(entry(cohereMatrix, 'rerank'), 'official-docs', 'docs.cohere.com/v2/reference/rerank', 'Cohere rerank entry cites official docs')

  const source = fs.readFileSync(path.join(root, 'src/modules/providers/providerParameterMatrixPolicy.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/providerParameterMatrix.ts'), 'utf8')
  for (const marker of [
    'PROVIDER_PARAMETER_MATRIX_SCHEMA',
    'OpenAI reasoning guide',
    'Anthropic extended thinking guide',
    'Gemini thinking guide',
    'OpenAI embeddings API reference',
    'buildStreamingEntry',
    'resolveProviderStreamingPolicy',
    'failureBehavior',
    'uiControl',
  ]) {
    assert.ok(source.includes(marker), `provider parameter matrix source includes ${marker}`)
  }
  assert.ok(
    source.includes('export function createProviderParameterMatrixPolicy(') &&
      bootstrapSource.includes('createProviderParameterMatrixPolicy({') &&
      bootstrapSource.includes('providerModelCapabilityCanBeSent') &&
      bootstrapSource.includes('resolveProviderNativeToolSupport'),
    'target parameter-matrix policy is composed with the existing capability dependencies at bootstrap'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/ai/providerParameterMatrix.ts')),
    false,
    'legacy provider parameter-matrix service stays deleted'
  )

  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  assert.ok(!apiKeyPanelSource.includes('ProviderParameterEvidencePanel'), 'provider settings does not duplicate the internal parameter matrix in the model capability summary')
  assert.ok(!apiKeyPanelSource.includes('buildProviderParameterMatrix'), 'provider settings keeps parameter shaping out of the compact model capability surface')
  assert.ok(apiKeyPanelSource.includes('providerModelCapabilityCanBeSent'), 'provider settings projects the same effective send policy used by runtime')

  const chatOptionsSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatOptionsPanel.tsx'), 'utf8')
  assert.ok(chatOptionsSource.includes('getProviderParameterEntry'), 'chat options resolve parameter matrix entries')
  assert.ok(chatOptionsSource.includes("getProviderParameterEntry(currentProvider, conversation.model, 'reasoning')"), 'reasoning UI is backed by parameter matrix evidence')
  assert.ok(chatOptionsSource.includes("getProviderParameterEntry(currentProvider, conversation.model, 'sampling')"), 'sampling UI is backed by parameter matrix evidence')
  assert.ok(chatOptionsSource.includes("getProviderParameterEntry(currentProvider, conversation.model, 'token-budget')"), 'token budget UI is backed by parameter matrix evidence')
  assert.ok(chatOptionsSource.includes("reasoningParameterEntry?.status === 'sendable'"), 'reasoning controls require sendable matrix status')
  assert.ok(chatOptionsSource.includes('samplingParametersSendable &&'), 'sampling controls require sendable matrix status')
  assert.ok(chatOptionsSource.includes('tokenBudgetSendable &&'), 'max token controls require sendable matrix status')
  assert.ok(chatOptionsSource.includes('matrixParameterSendable'), 'generation controls require per-field matrix support')

  for (const locale of ['en', 'zh-CN', 'ja']) {
    const resource = JSON.parse(fs.readFileSync(path.join(root, `src/i18n/resources/${locale}.json`), 'utf8'))
    assert.equal(typeof resource.apiKeyPanel.parameterMatrix, 'string', `${locale} parameterMatrix key exists`)
    assert.equal(typeof resource.apiKeyPanel.parameterMatrixDescription, 'string', `${locale} parameterMatrixDescription key exists`)
    for (const capability of ['reasoning', 'tool-calling', 'structured-output', 'context-continuity', 'remote-compact', 'streaming', 'multimodal-input', 'audio-input', 'audio-transcription', 'speech-output', 'embeddings', 'rerank', 'native-search']) {
      assert.equal(typeof resource.apiKeyPanel.parameterCapability[capability], 'string', `${locale} parameterCapability.${capability} key exists`)
    }
    for (const status of ['sendable', 'blocked', 'manual', 'unknown']) {
      assert.equal(typeof resource.apiKeyPanel.parameterStatus[status], 'string', `${locale} parameterStatus.${status} key exists`)
    }
  }

  assertReasoningModesReachTheWire()
  assertMaxTokensPrecedence()
  assertConfiguredPreferenceStaysExplicit()

  console.log('Provider parameter matrix tests passed')
}

if (require.main === module) run()

module.exports = { run }
