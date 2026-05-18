const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
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
  getBingCompatibleEndpoint,
  legacySearchModeForProvider,
  resolveSearchProvider,
} = require('../src/services/searchPolicy.ts')

async function run() {
  assert.equal(
    detectProviderPreset({ baseUrl: 'https://new-api.abrdns.com/', apiKey: 'sk-live' }).presetId,
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
  assert.equal(maskSecret('sk-1234567890abcdef'), 'sk-1...cdef')

  const probeCalls = []
  const probed = await probeProviderPreset(
    { baseUrl: 'https://unknown.example/v1', apiKey: 'sk-probe' },
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
    { baseUrl: 'https://unknown.example/v1', apiKey: 'sk-probe' },
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
        apiKey: `sk-test-${index}`,
        availableModels: index === 0 ? ['gpt-4o-mini'] : ['claude-3-5-sonnet-20241022'],
      })),
    },
    'newapi'
  )
  const normalized = normalizeProviderCredentialGroups(provider)
  assert.equal(normalized.credentialGroups.length, 3)
  assert.equal(chooseCredentialForModel(normalized, 'claude-3-5-sonnet-20241022').credentialGroupId, groups[1].id)

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

  const calls = []
  const synced = await runCredentialGroupModelSync(
    {
      ...normalized,
      credentialGroups: normalized.credentialGroups.slice(0, 2).map((group) => ({ ...group, apiKey: `key-${group.id}` })),
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
  assert.ok(packed.contextPrompt.includes('历史摘要'), 'adds a deterministic summary for trimmed history')
  assert.ok(packed.estimatedInputTokens <= packed.budgetTokens, 'stays under the planned input budget')
}

run()
  .then(() => {
    console.log('provider-intelligence tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
