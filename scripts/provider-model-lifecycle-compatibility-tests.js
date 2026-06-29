const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_EVAL_SCHEMA,
  PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS,
  runProviderModelLifecycleCompatibilityEvaluation,
} = require('../src/services/providerModelLifecycleCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderModelLifecycleCompatibilityHook) return

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
  hook.isProviderModelLifecycleCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertBaseline(item, options = {}) {
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.providerIdentity, true, `${item.fixtureId} has provider identity`)
  assert.equal(item.policy.modelMetadataFresh, true, `${item.fixtureId} has fresh model metadata`)
  assert.equal(item.policy.capabilityEvidence, true, `${item.fixtureId} has capability evidence`)
  assert.equal(item.policy.metadataCapabilityScoped, true, `${item.fixtureId} scopes metadata capabilities per model`)
  assert.equal(item.policy.regionDeploymentScoped, true, `${item.fixtureId} scopes region/deployment identity`)
  assert.equal(item.policy.sameProviderAliasState, true, `${item.fixtureId} keeps alias state same-provider`)
  assert.equal(item.policy.downgradeVisible, true, `${item.fixtureId} exposes downgrade behavior`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} records audit event`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} remains local/offline`)
  if (!options.allowManualOnly) {
    assert.equal(item.policy.remoteMetadataVerified, true, `${item.fixtureId} has verified remote metadata`)
  }
}

function assertReady(item, options = {}) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assertBaseline(item, options)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
  assert.deepEqual(item.missingCapabilities, [], `${item.fixtureId} has no missing capabilities`)
}

function assertDegraded(item) {
  assert.equal(item.readiness, 'degraded', `${item.fixtureId} is degraded`)
  assertBaseline(item, { allowManualOnly: true })
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
    PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.provider-model-lifecycle-compatibility-eval.v1',
    'provider model lifecycle schema is versioned',
  )
  assert.deepEqual(
    PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS,
    [
      'official-model-list-sync-verified-metadata',
      'model-list-suppression-manual-fallback',
      'alias-resolution-canonical-model',
      'deprecation-replacement-mapping',
      'remote-metadata-capability-admission',
      'relay-manual-model-declaration',
      'local-runtime-manual-model-fallback',
      'hosted-deployment-scoped-model-identity',
      'blocked-universal-model-list-assumption',
      'blocked-stale-alias-mapping',
      'blocked-deprecated-model-without-replacement',
      'blocked-capability-flattening-from-metadata',
      'blocked-cross-provider-alias-state-replay',
      'blocked-private-custom-endpoint-import',
    ],
    'provider model lifecycle fixtures cover sync, suppression, alias, deprecation, hosted, local, and blocked paths',
  )

  const evaluation = runProviderModelLifecycleCompatibilityEvaluation({ now: () => 2910000000000 })
  assert.equal(evaluation.schema, PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `provider model lifecycle gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const profile of ['official', 'aggregator', 'relay', 'cloud-hosted', 'local-runtime', 'custom-private', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredHostingProfiles.includes(profile), `quality gate tracks ${profile}`)
  }
  for (const policy of ['allowed', 'suppressed', 'manual-fallback', 'unsupported']) {
    assert.ok(evaluation.qualityGate.requiredModelListPolicies.includes(policy), `quality gate tracks ${policy}`)
  }
  for (const capability of [
    'chat',
    'streaming',
    'tools',
    'vision',
    'files',
    'reasoning',
    'structured-output',
    'responses-api',
    'native-search',
    'token-budget',
    'local-only',
  ]) {
    assert.ok(evaluation.qualityGate.requiredCapabilities.includes(capability), `quality gate tracks ${capability}`)
  }

  const officialSync = diagnostic(evaluation, 'official-model-list-sync-verified-metadata')
  assertReady(officialSync)
  assert.equal(officialSync.policy.modelListPolicy, 'allowed', 'official sync allows scoped model list')
  assert.equal(officialSync.policy.modelListEndpointScoped, true, 'official sync scopes the model-list endpoint')
  assert.equal(officialSync.policy.remoteMetadataVerified, true, 'official sync verifies remote metadata')

  const suppressed = diagnostic(evaluation, 'model-list-suppression-manual-fallback')
  assertDegraded(suppressed)
  assert.equal(suppressed.policy.modelListPolicy, 'suppressed', 'suppressed provider records model-list suppression')
  assert.equal(suppressed.policy.manualModelFallback, true, 'suppressed provider uses manual fallback')
  assert.equal(suppressed.policy.manualModelDeclaration, true, 'suppressed provider has manual model declaration')

  const alias = diagnostic(evaluation, 'alias-resolution-canonical-model')
  assertDegraded(alias)
  assert.equal(alias.policy.aliasRequired, true, 'alias fixture requires alias resolution')
  assert.equal(alias.policy.aliasResolved, true, 'alias fixture resolves alias')
  assert.equal(alias.policy.aliasSourceFresh, true, 'alias fixture has fresh alias mapping')
  assert.equal(alias.policy.aliasCanonicalModelId, 'claude-sonnet-4-6', 'alias fixture records canonical model id')

  const deprecated = diagnostic(evaluation, 'deprecation-replacement-mapping')
  assertDegraded(deprecated)
  assert.equal(deprecated.policy.deprecated, true, 'deprecation fixture marks source model deprecated')
  assert.equal(deprecated.policy.deprecationMapped, true, 'deprecation fixture maps replacement')
  assert.equal(deprecated.policy.replacementModelId, 'deepseek-v4-flash', 'deprecation fixture records replacement model')

  const remoteMetadata = diagnostic(evaluation, 'remote-metadata-capability-admission')
  assertReady(remoteMetadata)
  assert.equal(remoteMetadata.hostingProfile, 'aggregator', 'remote metadata fixture covers aggregator profile')
  assert.ok(remoteMetadata.policy.requiredCapabilities.includes('native-search'), 'remote metadata fixture covers native search capability')
  assert.equal(remoteMetadata.policy.metadataCapabilityScoped, true, 'remote metadata fixture scopes capability admission')

  const relay = diagnostic(evaluation, 'relay-manual-model-declaration')
  assertDegraded(relay)
  assert.equal(relay.hostingProfile, 'relay', 'relay fixture covers relay profile')
  assert.equal(relay.policy.manualModelDeclaration, true, 'relay fixture requires manual declaration')

  const localRuntime = diagnostic(evaluation, 'local-runtime-manual-model-fallback')
  assertDegraded(localRuntime)
  assert.equal(localRuntime.hostingProfile, 'local-runtime', 'local fixture covers local runtime')
  assert.ok(localRuntime.policy.admittedCapabilities.includes('local-only'), 'local fixture admits local-only capability')

  const hosted = diagnostic(evaluation, 'hosted-deployment-scoped-model-identity')
  assertReady(hosted)
  assert.equal(hosted.hostingProfile, 'cloud-hosted', 'hosted fixture covers cloud-hosted profile')
  assert.equal(hosted.policy.regionDeploymentScoped, true, 'hosted fixture scopes region and deployment identity')

  assertBlocked(diagnostic(evaluation, 'blocked-universal-model-list-assumption'), [
    'universal-model-list-assumption',
    'missing-manual-model-fallback',
    'missing-model-metadata',
    'stale-model-metadata',
    'unsupported-capability-admission',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-stale-alias-mapping'), ['stale-model-metadata', 'stale-alias-mapping'])
  assertBlocked(diagnostic(evaluation, 'blocked-deprecated-model-without-replacement'), [
    'deprecated-model-without-replacement',
    'missing-deprecation-policy',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-capability-flattening-from-metadata'), ['capability-flattening'])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-provider-alias-state-replay'), ['cross-provider-alias-state-replay'])
  assertBlocked(diagnostic(evaluation, 'blocked-private-custom-endpoint-import'), [
    'universal-model-list-assumption',
    'missing-manual-model-fallback',
    'missing-model-metadata',
    'stale-model-metadata',
    'unsupported-capability-admission',
    'private-endpoint-import',
    'missing-user-declaration',
  ])

  console.log('Provider model lifecycle compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
