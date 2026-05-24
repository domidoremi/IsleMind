const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const memoryStorage = new Map()
const secureStorage = new Map()

global.__DEV__ = false

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return {
      __esModule: true,
      default: {
        getItem: async (key) => memoryStorage.get(key) ?? null,
        setItem: async (key, value) => memoryStorage.set(key, value),
        removeItem: async (key) => memoryStorage.delete(key),
        multiRemove: async (keys) => keys.forEach((key) => memoryStorage.delete(key)),
      },
    }
  }
  if (request === 'expo-secure-store') {
    return {
      setItemAsync: async (key, value) => secureStorage.set(key, value),
      getItemAsync: async (key) => secureStorage.get(key) ?? null,
      deleteItemAsync: async (key) => secureStorage.delete(key),
    }
  }
  if (request === 'expo-sqlite') {
    return {
      openDatabaseAsync: async () => ({
        execAsync: async () => undefined,
        runAsync: async () => undefined,
        getAllAsync: async () => [],
        getFirstAsync: async () => null,
      }),
    }
  }
  if (request === 'expo-document-picker') {
    return { getDocumentAsync: async () => ({ canceled: true, assets: [] }) }
  }
  if (request === 'expo-file-system/legacy' || request === 'expo-file-system') {
    return {
      EncodingType: { UTF8: 'utf8', Base64: 'base64' },
      getInfoAsync: async () => ({ exists: false, uri: 'file:///tmp/', isDirectory: false }),
      makeDirectoryAsync: async () => undefined,
      deleteAsync: async () => undefined,
      downloadAsync: async (_url, uri) => ({ status: 200, uri, headers: {}, mimeType: null }),
      readAsStringAsync: async () => '',
      writeAsStringAsync: async () => undefined,
      documentDirectory: 'file:///tmp/',
      cacheDirectory: 'file:///tmp/',
    }
  }
  if (request === 'expo-crypto') {
    return {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      digest: async () => new Uint8Array(32).buffer,
    }
  }
  if (request === 'react-native') {
    return {
      Platform: { OS: 'test', select: (choices) => choices?.default },
      NativeModules: {},
      StyleSheet: { create: (styles) => styles },
    }
  }
  if (request === 'expo-clipboard') {
    return {
      setStringAsync: async () => undefined,
      getStringAsync: async () => '',
    }
  }
  if (request === 'expo/fetch') {
    return { fetch: global.fetch }
  }
  return originalLoad.call(this, request, parent, isMain)
}

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2021,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

const {
  applyProviderPreset,
  detectProviderPreset,
  maskSecret,
  parseCredentialGroups,
  parseProviderImportText,
  probeProviderPreset,
} = require('../src/services/ai/providerRegistry.ts')
const {
  chooseCredentialForModel,
  mergeCredentialModelAvailability,
  normalizeProviderCredentialGroups,
  runCredentialGroupModelSync,
  updateCredentialGroupHealth,
} = require('../src/services/ai/providerCredentials.ts')
const { packChatMessages } = require('../src/services/contextPacker.ts')
const {
  DEFAULT_MODELS,
  getModelConfig,
  mergeModelConfig,
} = require('../src/types/index.ts')
const { buildOpenAIBodyForTest, formatProviderHttpErrorForTest } = require('../src/services/ai/base.ts')
const {
  getBingCompatibleEndpoint,
  legacySearchModeForProvider,
  resolveSearchProvider,
} = require('../src/services/searchPolicy.ts')
const {
  applySkillStack,
  createBaseSkill,
  exportSkill,
  importSkill,
  renderSkillTemplate,
} = require('../src/services/skills.ts')
const {
  builtinMcpServer,
  callMcpTool,
  truncateToolBlocks,
} = require('../src/services/mcp.ts')
const { summarizeProviderActivation } = require('../src/services/providerActivation.ts')
const {
  clearHistoricalInjectedProviderModels,
  clearHistoricalInjectedGroupModels,
  getProviderAvailableModels,
  getProviderPreferredModel,
  isProviderConversationReady,
} = require('../src/utils/providerModels.ts')
const { setServiceLanguage, st } = require('../src/i18n/service.ts')
const {
  buildCompressedContextPrompt,
  createRagQueryPlan,
  createOnnxEmbeddingProvider,
  createOnnxPlaceholderProvider,
  packRagContext,
  rerankRetrievalSources,
  runAgenticRag,
  splitTextIntoSentenceChunks,
  verifyRagGeneration,
} = require('../src/services/rag.ts')
const { runRagGoldEvaluation } = require('../src/services/ragEvaluation.ts')
const {
  LOCAL_EMBEDDING_MODELS,
  formatModelBytes,
  localModelCacheKey,
} = require('../src/services/localEmbeddingModels.ts')
const { deriveHomePetState } = require('../src/components/mascot/petState.ts')
const modelCatalog = require('../assets/models/catalog.json')
const { importAllData, loadData } = require('../src/services/storage.ts')

const FAKE_KEY_A = 'token-fake-alpha-1234567890'
const FAKE_KEY_B = 'token-fake-beta-1234567890'
const FAKE_KEY_C = 'token-fake-gamma-1234567890'
const FAKE_KEY_D = 'token-fake-delta-1234567890'
const FAKE_KEY_E = 'token-fake-epsilon-1234567890'
const FAKE_KEY_F = 'token-fake-zeta-1234567890'
const API_KEY_FIELD = 'api' + 'Key'

async function run() {
  assert.equal(
    detectProviderPreset({ baseUrl: 'https://new-api.abrdns.com/', [API_KEY_FIELD]: 'token-live-fake' }).presetId,
    'newapi',
    'detects NewAPI-style aggregators from host'
  )
  assert.equal(
    detectProviderPreset({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }).presetId,
    'dashscope',
    'detects DashScope compatible mode'
  )

  const groups = parseCredentialGroups('sk-a\n\nsk-b, sk-c')
  assert.deepEqual(groups.map((group) => group.label), ['令牌分组 1', '令牌分组 2', '令牌分组 3'])
  assert.ok(groups.every((group) => group.enabled), 'parsed groups are enabled by default')
  assert.equal(maskSecret('token-fake-1234567890'), 'toke...7890')
  setServiceLanguage('en')
  assert.equal(st('apiKeyPanel.groupName', { index: 1 }), 'Token group 1', 'service i18n follows language changes')
  setServiceLanguage('ja')
  assert.equal(st('search.disabled'), 'Web 検索は無効です。', 'service i18n supports Japanese resources')
  setServiceLanguage('zh-CN')

  const imported = parseProviderImportText(`供应商A: https://a.example/v1, 秘钥: ${FAKE_KEY_A}, 秘钥2: ${FAKE_KEY_B}, 模型: model-a; Provider B, Base URL=https://b.example/v1, API Key=${FAKE_KEY_C}, Models=model-b`)
  assert.equal(imported.providers.length, 2, 'imports semicolon separated provider blocks')
  assert.equal(imported.providers[0].enabled, false, 'imported providers are disabled by default')
  assert.equal(imported.providers[0].credentialGroups.length, 2, 'imports repeated Chinese key fields')
  assert.deepEqual(imported.providers[1].models, ['model-b'], 'imports English model field')

  const csvImported = parseProviderImportText(`Provider C, https://c.example/v1, ${FAKE_KEY_D}`)
  assert.equal(csvImported.providers.length, 1, 'imports CSV-ish provider lines')
  assert.equal(csvImported.providers[0].baseUrl, 'https://c.example/v1')

  const urlKeyImported = parseProviderImportText(`
https://new-api.example.com/
${FAKE_KEY_A}
${FAKE_KEY_B}

https://newapi.example.net/
${FAKE_KEY_C}
${FAKE_KEY_D}
`)
  assert.equal(urlKeyImported.providers.length, 2, 'imports URL followed by key lines separated by blank lines')
  assert.equal(urlKeyImported.providers[0].baseUrl, 'https://new-api.example.com/')
  assert.equal(urlKeyImported.providers[0].name, 'new-api.example.com')
  assert.equal(urlKeyImported.providers[0].credentialGroups.length, 2)
  assert.equal(urlKeyImported.providers[1].baseUrl, 'https://newapi.example.net/')
  assert.equal(urlKeyImported.providers[1].credentialGroups.length, 2)

  const jsonImported = parseProviderImportText(JSON.stringify({
    providers: [
      {
        name: 'JSON Provider',
        baseUrl: 'https://json.example/v1',
        apiKeys: [FAKE_KEY_A, FAKE_KEY_B],
        models: ['json-model-a', 'json-model-b'],
      },
    ],
  }))
  assert.equal(jsonImported.sourceType, 'json')
  assert.equal(jsonImported.providers.length, 1, 'imports JSON provider arrays')
  assert.equal(jsonImported.providers[0].credentialGroups.length, 2)
  assert.deepEqual(jsonImported.providers[0].models, ['json-model-a', 'json-model-b'])

  const tableImported = parseProviderImportText(`name,base_url,api_key,models\nCSV Provider,https://csv.example/v1,${FAKE_KEY_E},csv-model`)
  assert.equal(tableImported.sourceType, 'csv')
  assert.equal(tableImported.providers.length, 1, 'imports CSV header rows')
  assert.equal(tableImported.providers[0].baseUrl, 'https://csv.example/v1')
  assert.deepEqual(tableImported.providers[0].models, ['csv-model'])

  const probeCalls = []
  const probed = await probeProviderPreset(
    { baseUrl: 'https://unknown.example/v1', [API_KEY_FIELD]: 'token-probe-fake' },
    {
      fetch: async (url, init) => {
        probeCalls.push({ url, auth: init.headers.Authorization })
        return {
          ok: probeCalls.length === 1,
          status: probeCalls.length === 1 ? 200 : 404,
          json: async () => ({ data: [{ id: 'gpt-4o-mini' }] }),
        }
      },
    }
  )
  assert.equal(probed.ok, true, 'network probe detects OpenAI-compatible /models')
  assert.equal(probed.presetId, 'custom-openai-compatible')
  assert.equal(probeCalls.length, 1, 'network probe stops after first successful protocol')

  const failedProbe = await probeProviderPreset(
    { baseUrl: 'https://unknown.example/v1', [API_KEY_FIELD]: 'token-probe-fake' },
    {
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    }
  )
  assert.equal(failedProbe.ok, false, 'failed network probe keeps a manual-friendly fallback')
  assert.equal(failedProbe.presetId, 'custom-openai-compatible')

  assert.equal(resolveSearchProvider({ webSearchEnabled: true, searchProvider: 'google' }), 'google')
  assert.equal(resolveSearchProvider({ webSearchEnabled: true, webSearchMode: 'tavily' }), 'tavily')
  assert.equal(resolveSearchProvider({ webSearchEnabled: false, searchProvider: 'google' }), 'off')
  assert.equal(legacySearchModeForProvider('bing'), 'tavily')
  assert.equal(getBingCompatibleEndpoint({ customSearchEndpoint: '' }), null, 'Bing requires an explicit compatible endpoint')
  assert.equal(getBingCompatibleEndpoint({ customSearchEndpoint: ' https://search.example?q={query} ' }), 'https://search.example?q={query}')

  const provider = applyProviderPreset(
    {
      id: 'newapi-main',
      type: 'openai-compatible',
      name: 'NewAPI',
      apiKey: '',
      baseUrl: 'https://new-api.abrdns.com',
      enabled: true,
      models: [],
      credentialGroups: groups.map((group, index) => ({
        ...group,
        [API_KEY_FIELD]: `token-test-${index}`,
        availableModels: index === 0 ? ['gpt-4o-mini'] : ['claude-3-5-sonnet-20241022'],
      })),
    },
    'newapi'
  )
  assert.deepEqual(provider.models, [], 'preset application does not inject default models')
  const deepseekPreset = applyProviderPreset(
    {
      id: 'deepseek-empty',
      type: 'openai-compatible',
      name: '',
      models: [],
    },
    'deepseek'
  )
  assert.deepEqual(deepseekPreset.models, [], 'quick presets expose no saved default models')
  const importWithoutModels = parseProviderImportText(`Provider Empty, https://empty.example/v1, ${FAKE_KEY_F}`)
  assert.deepEqual(importWithoutModels.providers[0].models, [], 'provider import keeps models empty when no model field is provided')
  assert.deepEqual(
    clearHistoricalInjectedProviderModels({
      id: 'legacy-defaults',
      type: 'openai-compatible',
      name: 'Legacy defaults',
      apiKey: '',
      models: ['deepseek-v4-pro', 'custom-manual-model', 'deepseek-v4-flash'],
      enabled: false,
    }),
    ['custom-manual-model'],
    'legacy injected DeepSeek defaults are removed from mixed unsynced model lists'
  )
  assert.deepEqual(
    clearHistoricalInjectedGroupModels({
      id: 'group-defaults',
      label: 'group',
      enabled: true,
      availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }),
    [],
    'legacy injected DeepSeek defaults are removed from unsynced credential groups'
  )
  assert.deepEqual(
    clearHistoricalInjectedGroupModels({
      id: 'group-synced',
      label: 'group',
      enabled: true,
      lastModelSyncStatus: 'ok',
      availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }),
    [],
    'synced credential group DeepSeek placeholders are removed for non-DeepSeek providers'
  )
  assert.deepEqual(
    clearHistoricalInjectedGroupModels({
      id: 'group-deepseek',
      label: 'group',
      enabled: true,
      lastModelSyncStatus: 'ok',
      availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }, {
      id: 'deepseek-real',
      type: 'openai-compatible',
      name: 'DeepSeek',
      apiKey: '',
      presetId: 'deepseek',
      models: [],
      enabled: false,
    }),
    ['deepseek-v4-pro', 'deepseek-v4-flash'],
    'real DeepSeek credential group model lists are preserved'
  )

  const normalized = normalizeProviderCredentialGroups(provider)
  assert.equal(normalized.credentialGroups.length, 3)
  assert.equal(chooseCredentialForModel(normalized, 'claude-3-5-sonnet-20241022').credentialGroupId, groups[1].id)
  const blankGroupProvider = normalizeProviderCredentialGroups({
    ...provider,
    models: ['legacy-provider-model'],
    credentialGroups: [{ ...groups[0], availableModels: undefined }],
  })
  assert.deepEqual(blankGroupProvider.credentialGroups[0].availableModels, [], 'credential groups do not inherit provider models without a sync result')

  const failedHealth = updateCredentialGroupHealth(normalized, groups[1].id, false, 2000)
  assert.equal(failedHealth.credentialGroups[1].failureCount, 1)
  assert.equal(failedHealth.credentialGroups[1].lastFailureAt, 2000)
  const healthyAgain = updateCredentialGroupHealth(failedHealth, groups[1].id, true, 3000)
  assert.equal(healthyAgain.credentialGroups[1].failureCount, 0)
  assert.equal(healthyAgain.credentialGroups[1].lastUsedAt, 3000)

  const availability = mergeCredentialModelAvailability(normalized.credentialGroups)
  assert.deepEqual(
    availability.find((item) => item.modelId === 'claude-3-5-sonnet-20241022')?.credentialGroupIds,
    [groups[1].id, groups[2].id]
  )
  const testedReadyProvider = {
    ...normalized,
    enabled: true,
    lastTestStatus: 'ok',
    lastTestModel: 'claude-3-5-sonnet-20241022',
  }
  assert.equal(getProviderPreferredModel(testedReadyProvider), 'claude-3-5-sonnet-20241022', 'last tested model is preferred for conversation defaults')
  assert.equal(isProviderConversationReady(testedReadyProvider), true, 'provider is chat-ready only after a successful model test')
  assert.deepEqual(getProviderAvailableModels(testedReadyProvider), ['gpt-4o-mini', 'claude-3-5-sonnet-20241022'], 'provider available models merge provider and synced group models')
  assert.equal(
    isProviderConversationReady({ ...testedReadyProvider, lastTestStatus: 'bad', lastTestModel: 'gpt-4o-mini' }),
    false,
    'synced models without a passing test are not treated as chat-ready'
  )

  const calls = []
  const synced = await runCredentialGroupModelSync(
    {
      ...normalized,
      credentialGroups: normalized.credentialGroups.slice(0, 2).map((group) => ({ ...group, [API_KEY_FIELD]: `key-${group.id}` })),
    },
    {
      delay: async (ms) => calls.push(`delay:${ms}`),
      jitter: () => 0,
      fetchModels: async (_provider, group) => {
        calls.push(`fetch:${group.id}`)
        return [{ id: `model-${group.id}`, name: `Model ${group.id}`, provider: 'openai-compatible' }]
      },
      now: () => 1000,
    }
  )
  assert.deepEqual(calls, [`fetch:${groups[0].id}`, 'delay:1200', `fetch:${groups[1].id}`])
  assert.equal(synced.models.length, 2)
  assert.equal(synced.credentialGroups[0].lastModelSyncStatus, 'ok')

  const failedSynced = await runCredentialGroupModelSync(
    {
      ...normalized,
      models: ['stale-default-model'],
      credentialGroups: normalized.credentialGroups.slice(0, 1).map((group) => ({ ...group, [API_KEY_FIELD]: `key-${group.id}` })),
    },
    {
      delay: async () => undefined,
      fetchModels: async () => {
        throw new Error('model endpoint failed')
      },
      now: () => 2000,
    }
  )
  assert.deepEqual(failedSynced.models, [], 'failed credential sync clears stale model lists')
  assert.equal(failedSynced.credentialGroups[0].lastModelSyncStatus, 'bad')
  const formatted500 = formatProviderHttpErrorForTest(
    500,
    JSON.stringify({ error: { type: 'upstream_error', message: 'No auth credentials found', request_id: 'req_123' } }),
    { id: 'p', type: 'openai-compatible', name: 'Example API', [API_KEY_FIELD]: 'token-test-fake', models: ['model-a'], enabled: true },
    'model-a'
  )
  assert.ok(formatted500.includes('HTTP 500') || formatted500.includes('500'), 'formatted provider errors keep HTTP status')
  assert.ok(formatted500.includes('upstream_error'), 'formatted provider errors keep error type')
  assert.ok(formatted500.includes('req_123'), 'formatted provider errors keep request id')
  assert.equal(formatted500.includes('{\"error\"'), false, 'formatted provider errors do not expose raw JSON')
  const activationSummary = summarizeProviderActivation([
    { providerId: 'ok', providerName: 'OK', enabled: true, hadCredential: true, synced: true, syncAttempted: true, modelCount: 2, syncedGroups: 1, missingToken: false, tested: true, testOk: true, messages: [], failures: [] },
    { providerId: 'models-only', providerName: 'Models Only', enabled: true, hadCredential: true, synced: true, syncAttempted: true, modelCount: 2, syncedGroups: 1, missingToken: false, tested: true, testOk: false, messages: ['test failed'], failures: [{ providerName: 'Models Only', message: 'test failed' }] },
    { providerId: 'none', providerName: 'No Models', enabled: true, hadCredential: true, synced: false, syncAttempted: true, modelCount: 0, syncedGroups: 0, missingToken: false, tested: false, testOk: false, messages: ['no models'], failures: [{ providerName: 'No Models', message: 'no models' }] },
  ])
  assert.ok(activationSummary.message.includes('目标 3') || activationSummary.message.includes('3 targeted'), 'activation summary includes target count')
  assert.ok(activationSummary.message.includes('测试通过 1') || activationSummary.message.includes('1 tests passed'), 'activation summary separates tested-ok count')
  assert.ok(activationSummary.message.includes('无模型 1') || activationSummary.message.includes('1 no models'), 'activation summary includes no-model count')
  assert.ok(
    st('providerSettings.activationProgressMessage', { completed: 2, total: 3, synced: 1, tested: 1, failed: 1 }).includes('2') &&
      st('providerSettings.activationCurrent', { name: 'Example' }).includes('Example'),
    'activation progress copy is structured for live batch status'
  )

  const importedDataOk = await importAllData(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [
      {
        id: 'legacy-deepseek',
        type: 'openai-compatible',
        name: 'Legacy DeepSeek',
        enabled: false,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      },
      {
        id: 'remote-placeholder',
        type: 'openai-compatible',
        name: 'Remote Placeholder',
        enabled: false,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        lastModelSyncStatus: 'ok',
      },
      {
        id: 'real-deepseek',
        type: 'openai-compatible',
        presetId: 'deepseek',
        name: 'DeepSeek',
        enabled: false,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        lastModelSyncStatus: 'ok',
      },
    ],
    exportedAt: Date.now(),
  }))
  assert.equal(importedDataOk, true, 'imports portable data for model normalization')
  const storedProviders = await loadData('PROVIDERS')
  assert.deepEqual(storedProviders[0].models, [], 'historical injected DeepSeek models are cleared without sync evidence')
  assert.deepEqual(storedProviders[1].models, [], 'synced placeholders are cleared for non-DeepSeek providers')
  assert.deepEqual(storedProviders[2].models, ['deepseek-v4-pro', 'deepseek-v4-flash'], 'real DeepSeek model lists are preserved')

  const packed = packChatMessages({
    messages: Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index} ${'long text '.repeat(120)}`,
    })),
    contextPrompt: 'retrieved context',
    modelContextWindow: 1200,
    maxOutputTokens: 256,
  })
  assert.ok(packed.messages.length < 18, 'packs long histories into a sliding window')
  assert.ok(packed.trimmedCount > 0, 'reports the number of trimmed messages')
  assert.ok(packed.contextPrompt.includes('历史摘要'), 'adds a deterministic summary for trimmed history')
  assert.ok(packed.estimatedInputTokens <= packed.budgetTokens, 'stays under the planned input budget')
  assert.ok(packed.budgetTokens < 1200, 'reserves output tokens from the input context budget')

  const singleLongPacked = packChatMessages({
    messages: [{ role: 'user', content: 'oversized '.repeat(1200) }],
    contextPrompt: 'retrieved context',
    modelContextWindow: 900,
    maxOutputTokens: 256,
  })
  assert.equal(singleLongPacked.messages.length, 1, 'keeps one recent oversized message after compression')
  assert.ok(singleLongPacked.messages[0].content.includes('前文过长'), 'truncates a single oversized message deterministically')
  assert.ok(singleLongPacked.estimatedInputTokens <= singleLongPacked.budgetTokens, 'single-message truncation stays within budget')

  const remoteConfig = mergeModelConfig('remote-large', 'openai-compatible', {
    contextWindow: 65536,
    maxOutputTokens: 4096,
    defaultMaxTokens: 12000,
    source: 'remote',
  })
  assert.equal(remoteConfig.contextWindow, 65536, 'remote context window is stored as context')
  assert.equal(remoteConfig.maxTokens, remoteConfig.contextWindow, 'maxTokens remains a legacy alias for context window')
  assert.equal(remoteConfig.maxOutputTokens, 4096, 'remote output limit is not replaced by context window')
  assert.equal(remoteConfig.defaultMaxTokens, 4096, 'default output tokens are clamped to maxOutputTokens')
  const inferredConfig = getModelConfig('unknown-compatible-model', 'openai-compatible')
  assert.ok(inferredConfig.defaultMaxTokens <= inferredConfig.maxOutputTokens, 'inferred model defaults fit output limit')
  assert.ok(DEFAULT_MODELS.every((model) => model.defaultMaxTokens <= model.maxOutputTokens && model.maxOutputTokens <= model.contextWindow), 'built-in model token limits are internally consistent')
  const reasoningBody = buildOpenAIBodyForTest({
    provider: {
      id: 'reasoning',
      type: 'openai-compatible',
      name: 'Reasoning Provider',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['reasoner-model'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'reasoner-model',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 999999,
  })
  assert.equal(reasoningBody.reasoning_effort, 'high', 'reasoning effort is sent only for supported providers or models')
  assert.ok(reasoningBody.max_tokens <= getModelConfig('reasoner-model', 'openai-compatible').maxOutputTokens, 'request max tokens are clamped to output limit')
  const nonReasoningBody = buildOpenAIBodyForTest({
    provider: {
      id: 'plain',
      type: 'openai-compatible',
      name: 'Plain Provider',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['plain-chat-model'],
      enabled: true,
      capabilities: { reasoningEffort: false },
    },
    model: 'plain-chat-model',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 512,
  })
  assert.equal(nonReasoningBody.reasoning_effort, undefined, 'unsupported providers do not receive reasoning effort fields')

  const baseSkill = createBaseSkill({
    id: 'skill-review',
    name: 'Code Review',
    systemPrompt: 'Review {{target}}. Output in {{language}}.',
    variables: [
      { name: 'target', type: 'text', defaultValue: 'diff' },
      { name: 'language', type: 'text', defaultValue: 'Chinese' },
    ],
    priority: 10,
  })
  const advancedSkill = createBaseSkill({
    id: 'skill-json',
    name: 'JSON Output',
    layer: 'advanced',
    systemPrompt: 'Return concise JSON.',
    temperature: 0.2,
    enabledTools: ['app_info'],
    knowledgeSources: ['doc-1'],
    priority: 20,
  })
  const exportedSkill = exportSkill(baseSkill)
  const importedSkill = importSkill(exportedSkill)
  assert.equal(importedSkill.ok, true, 'imports .isleskill JSON')
  assert.equal(renderSkillTemplate('Hello {{name}}', { name: 'IsleMind' }), 'Hello IsleMind')
  const skillApplied = applySkillStack({
    skills: [advancedSkill, baseSkill],
    variables: { target: 'provider sync', language: 'Japanese' },
  })
  assert.ok(skillApplied.snapshot.systemPrompt.includes('Review provider sync'), 'renders skill variables')
  assert.ok(skillApplied.snapshot.systemPrompt.includes('Return concise JSON'), 'stacks multiple prompts')
  assert.deepEqual(skillApplied.conversationUpdates.enabledTools, ['app_info'])
  assert.deepEqual(skillApplied.conversationUpdates.knowledgeSources, ['doc-1'])
  assert.equal(skillApplied.conversationUpdates.temperature, 0.2)

  const chunks = splitTextIntoSentenceChunks('第一句。第二句很短。第三句继续说明。Fourth sentence. Fifth sentence.', 18)
  assert.ok(chunks.length >= 2, 'sentence chunker splits long text')
  assert.ok(chunks.every((chunk) => /[。.!?]$/.test(chunk.content.trim())), 'chunks retain sentence endings')
  assert.ok(chunks.some((chunk) => chunk.sentenceStart > 0 && chunk.content.includes('第二句很短。')), 'chunks use sentence overlap windows')
  const reranked = rerankRetrievalSources('alpha beta', [
    { id: 'old', type: 'knowledge', title: 'Old', content: 'gamma delta', score: 0.9, chunkIndex: 10 },
    { id: 'match', type: 'knowledge', title: 'Alpha', content: 'alpha beta beta', score: 0.2, chunkIndex: 0 },
  ], 2)
  assert.equal(reranked[0].id, 'match', 'local rerank promotes token overlap and early chunks')
  assert.ok(buildCompressedContextPrompt(reranked).includes('[1]'), 'compressed context includes citation labels')
  const ragPlan = createRagQueryPlan({
    query: '比较 Alpha 和 Beta 的配置差异，并分析迁移风险？',
    settings: {
      language: 'zh-CN',
      ragMode: 'hybrid',
      ragProfile: 'balanced',
      ragQueryRewriteEnabled: true,
      ragHydeEnabled: true,
      ragRaptorEnabled: true,
      ragGraphEnabled: true,
      ragCrossEncoderEnabled: true,
    },
    now: 1234,
  })
  assert.equal(ragPlan.complexity, 'complex', 'agentic planner detects multi-hop queries')
  assert.ok(ragPlan.enabledTechniques.includes('query-rewriting'), 'balanced complex queries enable rewriting')
  assert.ok(ragPlan.enabledTechniques.includes('hyde'), 'balanced complex queries enable HyDE')
  assert.ok(ragPlan.enabledTechniques.includes('graphrag'), 'complex queries enable GraphRAG planning')
  const packedRag = packRagContext(ragPlan, [
    { id: 'rag-a', candidateId: 'a', origin: 'knowledge', type: 'knowledge', title: 'Alpha', content: 'Alpha uses local indexes. Beta uses remote reranking. Migration risk is token budget pressure.', score: 0.91, rerankScore: 0.91, chunkIndex: 0 },
    { id: 'rag-b', candidateId: 'b', origin: 'hyde', type: 'knowledge', title: 'Beta', content: 'Beta requires fallback when cross encoder models are missing. Citation coverage should stay explicit.', score: 0.83, rerankScore: 0.83, chunkIndex: 1 },
  ], 400)
  assert.ok(packedRag.contextPrompt.includes('[1]'), 'agentic pack injects numbered citations')
  assert.equal(packedRag.citations.length, 2, 'agentic pack returns citation metadata')
  assert.ok(packedRag.quality.confidence > 0, 'agentic pack evaluates quality')
  assert.ok(packedRag.trace.some((step) => step.stage === 'verify'), 'agentic pack emits a verification trace')
  assert.ok(packedRag.citations.every((citation) => citation.label && citation.rerankScore !== undefined), 'citations carry labels and rerank details')
  const agentic = await runAgenticRag({
    query: 'Why does Alpha migration fail and what evidence supports the fix?',
    settings: {
      language: 'en',
      ragMode: 'hybrid',
      ragProfile: 'deep',
      ragQueryRewriteEnabled: true,
      ragHydeEnabled: true,
      ragFlareEnabled: true,
      ragCrossEncoderEnabled: true,
      ragColbertEnabled: true,
      ragLlmlinguaEnabled: true,
    },
    memorySources: [{ id: 'mem-a', type: 'memory', title: 'Memory', content: 'Alpha migration failed because indexes were stale.', excerpt: 'Alpha migration failed because indexes were stale.' }],
    retrieveKnowledge: async (query, limit) => [
      { id: `k-${query.length}-${limit}`, type: 'knowledge', title: 'Migration note', content: `Evidence for ${query}: rebuild indexes and verify citations.`, score: 0.7, chunkIndex: 0 },
    ],
    retrieveAgentic: async (_query, plan, limit) => plan.enabledTechniques.includes('colbert')
      ? [
          { id: `colbert-${limit}`, type: 'knowledge', title: 'ColBERT-lite note', content: 'Token max-sim evidence remains available without a downloaded ColBERT model.', score: 0.68, sourceReason: 'colbert-token-maxsim' },
        ]
      : [],
    now: () => 1234,
  })
  assert.ok(agentic.trace.some((step) => step.stage === 'retrieve'), 'agentic RAG records retrieval trace')
  assert.ok(agentic.trace.some((step) => step.stage === 'pack'), 'agentic RAG records pack trace')
  assert.ok(agentic.quality.sourceCount >= 1, 'agentic RAG returns usable sources')
  assert.ok(agentic.contextPrompt.includes('[1]'), 'agentic RAG context prompt preserves citation injection')
  assert.ok(agentic.trace.find((step) => step.stage === 'retrieve').metadata.advancedCandidates >= 1, 'agentic RAG merges advanced index candidates')
  assert.ok(agentic.sources.some((source) => source.origin === 'colbert'), 'advanced retrieval origin is preserved')
  const flareCheck = verifyRagGeneration({
    answer: 'Alpha migration failed because a hidden cache invalidated production traffic. Beta recovery requires a server restart.',
    query: 'Why does Alpha migration fail and what evidence supports the fix?',
    citations: agentic.citations,
    quality: { ...agentic.quality, confidence: 0.2, citationCoverage: 0.1 },
  })
  assert.equal(flareCheck.needsFlare, true, 'FLARE is requested for low-confidence unsupported generations')
  assert.ok(flareCheck.followupQuery.includes('补充证据'), 'FLARE follow-up query asks for additional evidence')
  const goldRun = await runRagGoldEvaluation({
    language: 'en',
    ragMode: 'hybrid',
    ragProfile: 'deep',
    ragQueryRewriteEnabled: true,
    ragHydeEnabled: true,
    ragRaptorEnabled: true,
    ragGraphEnabled: true,
    ragColbertEnabled: true,
    ragCrossEncoderEnabled: true,
    ragLlmlinguaEnabled: true,
  })
  assert.equal(goldRun.cases.length, 3, 'built-in RAG gold evaluation covers the bundled cases')
  assert.ok(goldRun.averageConfidence > 0, 'built-in RAG gold evaluation reports confidence')
  assert.ok(goldRun.fallbackReasons.includes('cross-encoder-model-unavailable'), 'gold evaluation records model fallback reasons')
  assert.equal(await createOnnxPlaceholderProvider().available(), false, 'ONNX placeholder stays disabled')
  assert.ok(LOCAL_EMBEDDING_MODELS.some((model) => model.id === 'all-MiniLM-L6-v2'), 'local embedding catalog exposes MiniLM')
  assert.ok(modelCatalog.models.every((model) => model.sourceUrl && model.publisher && model.upstreamModel && model.license), 'model catalog includes source and attribution metadata')
  assert.ok(modelCatalog.models.some((model) => model.capability === 'reranker' && model.files.length === 0), 'reranker capability placeholder is cataloged without bundling files')
  assert.ok(modelCatalog.models.some((model) => model.capability === 'colbert' && model.files.length === 0), 'ColBERT capability placeholder is cataloged without bundling files')
  assert.ok(modelCatalog.models.some((model) => model.capability === 'compressor' && model.files.length === 0), 'compressor capability placeholder is cataloged without bundling files')
  assert.deepEqual(modelCatalog.variants['no-model'].bundledModels, [], 'no-model variant does not bundle embeddings')
  assert.deepEqual(modelCatalog.variants['with-model-small'].bundledModels, ['all-MiniLM-L6-v2'], 'with-model-small bundles only MiniLM')
  assert.equal(
    modelCatalog.models.find((model) => model.id === 'all-MiniLM-L6-v2').files.reduce((sum, file) => sum + file.bytes, 0),
    modelCatalog.models.find((model) => model.id === 'all-MiniLM-L6-v2').sizeBytes,
    'catalog model size matches file sum'
  )
  assert.equal(formatModelBytes(1024 * 1024), '1.0 MB')
  assert.ok(localModelCacheKey({ localEmbeddingModelId: 'all-MiniLM-L6-v2', localEmbeddingModelSource: 'downloaded' }).includes('downloaded'))
  assert.equal(await createOnnxEmbeddingProvider({ localEmbeddingModelSource: 'none' }), null, 'ONNX provider is absent without bundled or downloaded model')

  const petIdle = deriveHomePetState({ reasoningEffort: 'medium' })
  assert.equal(petIdle.animation, 'idle', 'pet is idle without chat activity')
  const petStreaming = deriveHomePetState({
    reasoningEffort: 'low',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming' }] },
  })
  assert.equal(petStreaming.animation, 'running', 'pet works while a reply streams')
  assert.ok(petStreaming.speed < 1, 'low reasoning slows the working pet loop')
  const petHighReasoning = deriveHomePetState({
    reasoningEffort: 'high',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming' }] },
  })
  assert.equal(petHighReasoning.animation, 'review', 'high reasoning switches pet into focused review')
  const petTool = deriveHomePetState({
    reasoningEffort: 'medium',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming', toolCalls: [{ type: 'tool', status: 'running' }] }] },
  })
  assert.equal(petTool.reason, 'tool', 'running tool traces switch pet to tool mood')
  const petRetrieval = deriveHomePetState({
    reasoningEffort: 'medium',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming', retrievalTrace: [{ type: 'retrieval', status: 'running' }] }] },
  })
  assert.equal(petRetrieval.animation, 'review', 'running retrieval traces switch pet to review')
  const petError = deriveHomePetState({
    conversation: { messages: [{ role: 'assistant', status: 'error' }] },
  })
  assert.equal(petError.animation, 'failed', 'failed messages switch pet to failed animation')

  const builtin = builtinMcpServer()
  assert.equal(builtin.transport, 'sse')
  assert.equal(builtin.tools.find((tool) => tool.name === 'app_info').permission, 'read-only')
  const appInfo = await callMcpTool(builtin, 'app_info', {})
  assert.equal(appInfo.ok, true, 'built-in MCP app_info works without network')
  assert.ok(appInfo.content[0].text.includes('stdio is disabled'), 'MCP app_info states mobile transport boundary')
  const truncated = truncateToolBlocks([{ type: 'text', text: 'x'.repeat(2000) }], 50)
  assert.ok(truncated[0].text.length < 1000, 'MCP tool output is truncated to budget')
}

run()
  .then(() => {
    console.log('provider-intelligence tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
