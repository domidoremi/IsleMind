const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  CREDENTIAL_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA,
  CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS,
  runCredentialGovernanceCompatibilityEvaluation,
} = require('../src/services/credentialGovernanceCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isCredentialGovernanceCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
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
  hook.isCredentialGovernanceCompatibilityHook = true
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
  assert.notEqual(item.policy.storageBackend, 'plaintext-storage', `${item.fixtureId} avoids plaintext storage`)
  assert.notEqual(item.policy.storageBackend, 'unknown', `${item.fixtureId} declares storage backend`)
  assert.equal(item.policy.plaintextPersisted, false, `${item.fixtureId} does not persist plaintext keys`)
  assert.equal(item.policy.providerScoped, true, `${item.fixtureId} scopes provider credentials`)
  assert.equal(item.policy.importedSecretsStoredSecurely, true, `${item.fixtureId} secures imported secrets`)
  assert.equal(item.policy.portableExportIncludesSecrets, false, `${item.fixtureId} omits secrets from portable export`)
  assert.equal(item.policy.runtimeLogRedaction, true, `${item.fixtureId} redacts runtime logs`)
  assert.equal(item.policy.runtimeEventRedaction, true, `${item.fixtureId} redacts runtime events`)
  assert.equal(item.policy.destructiveResetClearsKnownKeys, true, `${item.fixtureId} clears secure keys on reset`)
  assert.equal(item.policy.crossProviderCredentialReplayBlocked, true, `${item.fixtureId} blocks cross-provider credential replay`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} stays local/offline`)
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
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

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(source, marker, label) {
  assert.ok(source.includes(marker), label)
}

function assertSourceMatches(source, pattern, label) {
  assert.ok(pattern.test(source), label)
}

function run() {
  assert.equal(
    CREDENTIAL_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.credential-governance-compatibility-eval.v1',
    'credential governance schema is versioned',
  )
  assert.deepEqual(
    CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS,
    [
      'native-secure-provider-key-storage',
      'credential-group-secure-storage',
      'model-scoped-credential-selection',
      'credential-health-routing',
      'imported-credential-secure-restore',
      'hosted-auth-scope',
      'observability-sink-secure-opt-in',
      'proxy-url-credential-sanitization',
      'runtime-diagnostics-redaction',
      'portable-export-secret-elision',
      'destructive-reset-secret-cleanup',
      'blocked-plaintext-provider-key',
      'blocked-credential-in-url',
      'blocked-runtime-diagnostics-secret-leak',
      'blocked-cross-provider-credential-replay',
      'blocked-observability-export-without-consent',
    ],
    'credential governance fixtures cover storage, group scope, routing, import/restore, hosted auth, observability, proxy, diagnostics, export, reset, and blocked paths',
  )

  const evaluation = runCredentialGovernanceCompatibilityEvaluation({ now: () => 2930000000000 })
  assert.equal(evaluation.schema, CREDENTIAL_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `credential governance gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['provider-key', 'credential-group', 'provider-routing', 'hosted-auth', 'observability', 'proxy', 'runtime-diagnostics', 'export-restore', 'data-reset', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }

  const providerKey = diagnostic(evaluation, 'native-secure-provider-key-storage')
  assertReady(providerKey)
  assert.equal(providerKey.policy.storageBackend, 'native-secure-store', 'provider key fixture uses native secure store')

  const group = diagnostic(evaluation, 'credential-group-secure-storage')
  assertReady(group)
  assert.equal(group.policy.credentialGroupScoped, true, 'credential group fixture scopes group secrets')

  const modelScoped = diagnostic(evaluation, 'model-scoped-credential-selection')
  assertReady(modelScoped)
  assert.equal(modelScoped.policy.modelScopedSelection, true, 'model fixture requires model-scoped selection')

  const health = diagnostic(evaluation, 'credential-health-routing')
  assertReady(health)
  assert.equal(health.policy.healthScopedRouting, true, 'health fixture scopes credential routing')
  assert.equal(health.policy.cooldownOrCircuitBreaker, true, 'health fixture has cooldown or circuit breaker')

  const restore = diagnostic(evaluation, 'imported-credential-secure-restore')
  assertReady(restore)
  assert.equal(restore.policy.importedSecretsStoredSecurely, true, 'restore fixture stores imported secrets securely')

  const hosted = diagnostic(evaluation, 'hosted-auth-scope')
  assertDegraded(hosted)
  assert.equal(hosted.policy.hostedAuthScoped, true, 'hosted fixture scopes auth')
  assert.equal(hosted.policy.regionResourceDeploymentScoped, true, 'hosted fixture scopes region/resource/deployment')

  const observability = diagnostic(evaluation, 'observability-sink-secure-opt-in')
  assertReady(observability)
  assert.equal(observability.policy.observabilityApiKeySecure, true, 'observability fixture secures API key')
  assert.equal(observability.policy.observabilityOptIn, true, 'observability fixture requires opt-in')
  assert.equal(observability.policy.observabilityWorkspaceConsent, true, 'observability fixture requires workspace consent')

  const proxy = diagnostic(evaluation, 'proxy-url-credential-sanitization')
  assertReady(proxy)
  assert.equal(proxy.policy.proxyUrlSanitized, true, 'proxy fixture sanitizes proxy URL')
  assert.equal(proxy.policy.urlUserInfoBlocked, true, 'proxy fixture blocks URL userinfo')
  assert.equal(proxy.policy.queryCredentialBlocked, true, 'proxy fixture blocks credential query params')

  const diagnostics = diagnostic(evaluation, 'runtime-diagnostics-redaction')
  assertReady(diagnostics)
  assert.equal(diagnostics.policy.runtimeLogRedaction, true, 'diagnostics fixture redacts runtime log')
  assert.equal(diagnostics.policy.runtimeEventRedaction, true, 'diagnostics fixture redacts runtime event')

  const portable = diagnostic(evaluation, 'portable-export-secret-elision')
  assertReady(portable)
  assert.equal(portable.policy.portableExportIncludesSecrets, false, 'portable fixture omits secrets')

  const reset = diagnostic(evaluation, 'destructive-reset-secret-cleanup')
  assertReady(reset)
  assert.equal(reset.policy.destructiveResetClearsKnownKeys, true, 'reset fixture clears known secure keys')

  assertBlocked(diagnostic(evaluation, 'blocked-plaintext-provider-key'), [
    'insecure-storage',
    'plaintext-persisted-key',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-credential-in-url'), [
    'unsafe-proxy-url',
    'credential-in-url',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-runtime-diagnostics-secret-leak'), ['missing-runtime-redaction'])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-provider-credential-replay'), [
    'missing-provider-scope',
    'missing-credential-group-scope',
    'missing-hosted-auth-scope',
    'cross-provider-credential-replay',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-observability-export-without-consent'), [
    'missing-observability-secure-key',
    'missing-observability-opt-in',
    'missing-observability-consent',
  ])

  const secureStorageSource = readSource('src/services/secureStorage.ts')
  assertSourceIncludes(secureStorageSource, 'SecureStore.setItemAsync', 'native secure storage writes through SecureStore')
  assertSourceIncludes(secureStorageSource, "const WEB_PREFIX = '@islemind/secure/'", 'web fallback uses a namespaced secure key prefix')

  const secureKeySource = readSource('src/services/ai/secureKey.ts')
  assertSourceIncludes(secureKeySource, 'secureProviderKey(providerId: string)', 'provider secure-key helper exists')
  assertSourceIncludes(secureKeySource, 'secureProviderGroupKey(providerId: string, groupId: string)', 'credential group secure-key helper exists')
  assertSourceIncludes(secureKeySource, 'clearKnownSearchSecureKeys', 'search secure-key cleanup helper exists')
  assertSourceIncludes(secureKeySource, 'clearKnownObservabilitySecureKeys', 'observability secure-key cleanup helper exists')

  const credentialSource = readSource('src/services/ai/providerCredentials.ts')
  assertSourceIncludes(credentialSource, 'chooseCredentialForModel', 'model-scoped credential selection exists')
  assertSourceIncludes(credentialSource, 'availableModels.includes(upstreamModel)', 'credential selection checks upstream model availability')
  assertSourceIncludes(credentialSource, 'excludedCredentialGroupIds', 'credential selection supports excluded groups')
  assertSourceIncludes(credentialSource, 'updateCredentialGroupHealth', 'credential health updates exist')
  assertSourceIncludes(credentialSource, 'failureCount', 'credential health tracks failure count')

  const storageSource = readSource('src/services/storage.ts')
  assertSourceIncludes(storageSource, 'apiKey: \'\',', 'portable provider export strips provider API keys')
  assertSourceIncludes(storageSource, 'persistImportedProviderSecrets', 'full restore persists imported provider secrets through secure helpers')
  assertSourceIncludes(storageSource, 'setSecureCredentialGroupKey', 'restore moves credential group keys into secure storage')
  assertSourceIncludes(storageSource, 'clearKnownObservabilitySecureKeys', 'restore/reset cleanup clears observability secure keys')
  assertSourceIncludes(storageSource, 'clearKnownSearchSecureKeys', 'restore/reset cleanup clears search secure keys')

  const settingsSource = readSource('src/store/settingsStore.ts')
  assertSourceIncludes(settingsSource, 'setObservabilitySinkApiKey', 'observability sink key setter exists')
  assertSourceIncludes(settingsSource, 'observabilitySinkApiKeyConfigured', 'observability sink stores configured state instead of raw key state')
  assertSourceIncludes(settingsSource, 'observabilitySinkUserOptIn: false', 'observability sink defaults to no user opt-in')
  assertSourceIncludes(settingsSource, 'observabilitySinkWorkspaceConsent: false', 'observability sink defaults to no workspace consent')
  assertSourceIncludes(settingsSource, 'deleteSecureItem(OBSERVABILITY_SINK_API_KEY)', 'clear-all removes observability sink key')

  const proxyPolicySource = readSource('src/services/ai/policy/proxyPolicy.ts')
  const urlSafetySource = readSource('src/utils/networkUrlSafety.ts')
  assertSourceIncludes(proxyPolicySource, 'safeHttpUrl', 'proxy policy uses URL safety helper')
  assertSourceIncludes(urlSafetySource, 'parsed.username || parsed.password', 'URL safety helper rejects userinfo credentials')

  const runtimeLogSource = readSource('src/services/runtimeLog.ts')
  assertSourceMatches(runtimeLogSource, /authorization\|api\[-_\]\?key\|token\|secret\|password\|credential\|bearer/, 'runtime log treats credential field names as sensitive')
  assertSourceIncludes(runtimeLogSource, 'redactSensitiveQueryParams', 'runtime log redacts sensitive query parameters')
  assertSourceIncludes(runtimeLogSource, 'redactUrlUserInfo', 'runtime log redacts URL userinfo credentials')
  assertSourceIncludes(runtimeLogSource, 'redactSensitiveAssignments', 'runtime log redacts credential assignments')

  const runtimeEventsSource = readSource('src/services/runtimeEvents.ts')
  assertSourceIncludes(runtimeEventsSource, 'redactRuntimeLogValue', 'runtime event persistence reuses runtime-log redaction')

  console.log('Credential governance compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
