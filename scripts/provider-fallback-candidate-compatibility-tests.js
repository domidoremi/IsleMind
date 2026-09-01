const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA,
  createProviderFallbackCandidateBuilder,
} = require('../src/modules/providers/index.ts')
const { providerHealthKey } = require('../src/modules/providers/index.ts')

const buildProviderFallbackCandidates = createProviderFallbackCandidateBuilder({
  projectModel(provider, model) {
    const config = provider.modelConfigs?.find((item) => item.id === model) ?? { source: 'manual' }
    const declared = provider.modelCapabilityMap?.[model] ?? provider.defaultModelCapabilities ?? {}
    const capabilities = ['text']
    if (declared.image && allows(provider, 'vision', provider.capabilities?.vision === true)) capabilities.push('image')
    if (declared.file && allows(provider, 'files', provider.capabilities?.files === true)) capabilities.push('file')
    if (declared.audio && allows(provider, 'audio', provider.capabilities?.audioInput === true)) capabilities.push('audio')
    if (declared.video) capabilities.push('video')
    if (declared.reasoning && allows(provider, 'reasoning', provider.capabilities?.reasoningEffort === true)) capabilities.push('reasoning')
    if (declared.streaming !== false && allows(provider, 'streaming', provider.capabilities?.streaming === true)) capabilities.push('streaming')
    if (declared.tools && allows(provider, 'tools', provider.capabilities?.nativeTools === true)) capabilities.push('tools')
    if (declared.structured_output) capabilities.push('structured_output')
    if (allows(provider, 'nativeSearch', provider.capabilities?.nativeSearch === true)) capabilities.push('native_search')
    return {
      deprecated: config.deprecated === true,
      source: config.source,
      upstreamModel: provider.aliasMap?.[model] ?? model,
      family: provider.family ?? provider.type ?? 'openai-compatible',
      capabilities,
    }
  },
})

function allows(provider, behavior, explicitDeclaration) {
  return explicitDeclaration === true || provider.allowedBehaviors?.includes(behavior) === true
}

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderFallbackCandidateCompatibilityHook) return

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
  hook.isProviderFallbackCandidateCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function provider(overrides = {}) {
  return {
    id: 'candidate-primary',
    type: 'openai-compatible',
    name: 'Candidate Primary',
    enabled: true,
    apiKey: 'sk-primary-secret',
    models: ['fast-mini', 'strong-pro'],
    manualModels: [],
    modelConfigs: [],
    modelAvailability: [],
    modelAliases: [],
    tokenPlanRegion: 'us',
    capabilities: {
      streaming: true,
      nativeTools: true,
      reasoningEffort: true,
      files: true,
      vision: true,
      nativeSearch: true,
    },
    allowedBehaviors: ['streaming', 'tools', 'reasoning', 'files', 'vision', 'nativeSearch'],
    defaultModelCapabilities: {
      streaming: true,
      tools: true,
      reasoning: true,
      file: true,
      image: true,
      structured_output: true,
    },
    credentialGroups: [
      { id: 'group-primary', label: 'Primary', apiKey: 'sk-group-primary', enabled: true, availableModels: [] },
    ],
    ...overrides,
  }
}

function rejectionReasons(result) {
  return result.rejectedCandidates.map((item) => item.reason)
}

function assertNoSecret(value, label) {
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes('sk-primary-secret'), false, `${label} omits provider API key`)
  assert.equal(serialized.includes('sk-group-primary'), false, `${label} omits credential group API key`)
  assert.equal(serialized.includes('sk-disabled'), false, `${label} omits disabled credential key`)
}

function run() {
  assert.equal(PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA, 'islemind.provider-fallback-candidate-build.v1', 'fallback candidate build schema is versioned')

  const result = buildProviderFallbackCandidates({
    providers: [
      provider(),
      provider({ id: 'disabled-provider', enabled: false }),
      provider({ id: 'empty-provider', models: [], manualModels: [], modelConfigs: [], modelAvailability: [], modelAliases: [] }),
      provider({ id: 'deprecated-provider', models: ['old-model'], modelConfigs: [{ id: 'old-model', deprecated: true }] }),
      provider({ id: 'disabled-creds', credentialGroups: [
        { id: 'disabled-group', label: 'Disabled', apiKey: 'sk-disabled', enabled: false, availableModels: [] },
        { id: 'enabled-group', label: 'Enabled', apiKey: 'sk-enabled', enabled: true, availableModels: [] },
      ] }),
      provider({ id: 'no-enabled-creds', credentialGroups: [{ id: 'disabled-only', label: 'Disabled only', apiKey: 'sk-disabled', enabled: false, availableModels: [] }] }),
      provider({ id: 'missing-creds', apiKey: '', credentialGroups: [{ id: 'missing-group', label: 'Missing', apiKey: '', enabled: true, availableModels: [] }] }),
      provider({ id: 'model-limited-creds', models: ['strong-pro'], credentialGroups: [{ id: 'limited-group', label: 'Limited', apiKey: 'sk-limited', enabled: true, availableModels: ['other-model'] }] }),
      provider({
        id: 'alias-provider',
        models: [],
        manualModels: ['friendly-model'],
        modelAliases: [{ model: 'friendly-model' }],
        aliasMap: { 'friendly-model': 'upstream-model' },
        credentialGroups: [{ id: 'alias-group', label: 'Alias', apiKey: 'sk-alias', enabled: true, availableModels: ['upstream-model'] }],
      }),
      provider({
        id: 'capability-mismatch',
        models: ['text-only'],
        defaultModelCapabilities: { streaming: true },
        capabilities: { streaming: true },
        allowedBehaviors: ['streaming'],
      }),
    ],
    original: { providerId: 'candidate-primary', model: 'fast-mini' },
    requiredCapabilities: ['text', 'tools', 'reasoning', 'file'],
    healthRecords: {
      [providerHealthKey({ providerId: 'candidate-primary', model: 'strong-pro', credentialGroupId: 'group-primary', region: 'us' })]: {
        providerId: 'candidate-primary',
        model: 'strong-pro',
        credentialGroupId: 'group-primary',
        region: 'us',
        status: 'cooldown',
        successes: 1,
        failures: 1,
        consecutiveFailures: 1,
        cooldownUntilMs: 20_000,
        lastFailureAtMs: 10_000,
      },
    },
    nowMs: 10_001,
  })

  assert.equal(result.schema, PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA, 'fallback candidate results carry the versioned schema')
  assert.equal(result.evidence.providerCount, 10, 'fallback candidate evidence records provider count')
  assert.deepEqual(result.evidence.requiredCapabilities, ['text', 'tools', 'reasoning', 'file'], 'fallback candidate evidence records required capabilities')
  assert.ok(result.evidence.modelCount >= 8, 'fallback candidate evidence records discovered model count')
  assert.ok(result.evidence.credentialGroupCount >= 7, 'fallback candidate evidence records discovered credential group count')
  assert.ok(result.candidates.some((item) => item.providerId === 'candidate-primary' && item.model === 'fast-mini' && item.costTier === 'low'), 'fallback candidates infer low cost for mini models')
  assert.ok(result.candidates.some((item) => item.providerId === 'candidate-primary' && item.model === 'strong-pro' && item.costTier === 'high' && item.cooldownActive === true && item.healthScore === 0), 'fallback candidates carry health annotations')
  assert.ok(result.candidates.some((item) => item.providerId === 'alias-provider' && item.model === 'friendly-model' && item.credentialGroupId === 'alias-group'), 'fallback candidates allow credential model availability through aliases')
  assert.deepEqual(
    Array.from(new Set(rejectionReasons(result))).sort(),
    [
      'capability_mismatch',
      'credential_disabled',
      'credential_missing',
      'model_deprecated',
      'model_not_available_for_credential',
      'no_candidate_models',
      'no_enabled_credentials',
      'provider_disabled',
    ].sort(),
    'fallback candidates expose expected rejection reasons',
  )
  assertNoSecret(result, 'fallback candidate result')

  const maxModelResult = buildProviderFallbackCandidates({
    providers: [provider({
      id: 'max-model-provider',
      models: ['a-mini', 'b-mini', 'c-mini'],
      manualModels: ['d-mini'],
      modelConfigs: [{ id: 'e-mini' }],
      modelAvailability: [{ modelId: 'f-mini' }],
      modelAliases: [{ model: 'g-mini' }],
    })],
    original: { providerId: 'max-model-provider', model: 'a-mini' },
    requiredCapabilities: ['text'],
    maxModelsPerProvider: 2,
  })
  assert.equal(maxModelResult.evidence.modelCount, 2, 'fallback candidate model discovery is capped by maxModelsPerProvider')
  assert.equal(maxModelResult.candidates.length, 2, 'fallback candidate output honors maxModelsPerProvider')

  const defaultCredentialResult = buildProviderFallbackCandidates({
    providers: [provider({ id: 'default-credential-provider', credentialGroups: undefined, apiKey: 'sk-provider-only' })],
    original: { providerId: 'default-credential-provider', model: 'fast-mini' },
    requiredCapabilities: ['text'],
  })
  assert.ok(defaultCredentialResult.candidates.every((item) => item.credentialGroupId === 'default'), 'fallback candidates synthesize a default credential group when only provider apiKey exists')
  assertNoSecret(defaultCredentialResult, 'default credential fallback candidate result')

  const includeDisabledResult = buildProviderFallbackCandidates({
    providers: [provider({ id: 'include-disabled', enabled: false, credentialGroups: [{ id: 'disabled-group', label: 'Disabled', apiKey: 'sk-disabled', enabled: false, availableModels: [] }] })],
    original: { providerId: 'include-disabled', model: 'fast-mini' },
    requiredCapabilities: ['text'],
    includeDisabledProviders: true,
    includeDisabledCredentials: true,
  })
  assert.equal(includeDisabledResult.candidates.length, 2, 'fallback candidate builder can include disabled providers and credentials when explicitly requested')

  const fallbackCandidateSource = readSource('src/modules/providers/providerFallbackCandidates.ts')
  assert.ok(fallbackCandidateSource.includes('PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA'), 'fallback candidate source declares the build schema')
  assert.ok(fallbackCandidateSource.includes('maxModelsPerProvider ?? 20'), 'fallback candidate source caps per-provider model expansion')
  assert.ok(fallbackCandidateSource.includes('projection.deprecated'), 'fallback candidate source rejects models marked deprecated by its projection port')
  assert.ok(fallbackCandidateSource.includes('dependencies.projectModel'), 'fallback candidate source receives model compatibility projection through an explicit port')
  assert.ok(fallbackCandidateSource.includes('credentialCanUseModel'), 'fallback candidate source scopes credentials to available models')
  assert.ok(fallbackCandidateSource.includes('annotateFailoverCandidatesWithHealth'), 'fallback candidate source carries provider health annotations')
  assert.ok(fallbackCandidateSource.includes('dedupeCandidates'), 'fallback candidate source deduplicates routes')
  assert.equal(fs.existsSync(path.join(root, 'src/services/ai/providerFallbackCandidates.ts')), false, 'legacy fallback candidate facade is deleted after target factory migration')

  console.log('Provider fallback candidate compatibility tests passed')
}

if (require.main === module) {
  try {
    run()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

module.exports = { run }
