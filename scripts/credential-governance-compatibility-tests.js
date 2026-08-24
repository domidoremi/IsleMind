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
} = require('../src/modules/providers/testing/credentialGovernanceCompatibilityEvaluation.ts')
const {
  SecureKeyValueStorageError,
  createVerifiedSecureKeyValueStorage,
} = require('../src/core/index.ts')
const {
  ProviderCredentialStorageError,
  createProviderCredentialStorage,
  providerCredentialGroupStorageKey,
  providerCredentialStorageKey,
} = require('../src/modules/providers/index.ts')

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

function createMemorySecureStorage(initialEntries = []) {
  const values = new Map(initialEntries)
  const faults = {
    getItem: null,
    setItem: null,
    removeItem: null,
  }
  const calls = []

  function readFault(operation, key, value) {
    const fault = faults[operation]
    if (!fault) return null
    return typeof fault === 'function' ? fault({ key, value }) : fault
  }

  return {
    values,
    faults,
    calls,
    port: {
      async getItem(key) {
        calls.push({ operation: 'read', key })
        const fault = readFault('getItem', key)
        if (fault) throw fault
        return values.get(key) ?? null
      },
      async setItem(key, value) {
        calls.push({ operation: 'write', key })
        const fault = readFault('setItem', key, value)
        if (fault) throw fault
        values.set(key, value)
      },
      async removeItem(key) {
        calls.push({ operation: 'delete', key })
        const fault = readFault('removeItem', key)
        if (fault) throw fault
        values.delete(key)
      },
    },
  }
}

async function captureRejected(action, label) {
  try {
    await action()
  } catch (error) {
    return error
  }
  assert.fail(label)
}

function assertRedactedError(error, { code, scope, operation, secret, platformText }, label) {
  assert.ok(
    error instanceof SecureKeyValueStorageError || error instanceof ProviderCredentialStorageError,
    label + ' returns a typed storage error',
  )
  assert.equal(error.code, code, label + ' preserves the stable error code')
  if (scope !== undefined) assert.equal(error.scope, scope, label + ' preserves the credential scope')
  if (operation !== undefined) assert.equal(error.operation, operation, label + ' preserves the secure operation')
  const projected = String(error) + '\n' + JSON.stringify(error)
  if (secret) assert.equal(projected.includes(secret), false, label + ' does not return secret text')
  if (platformText) assert.equal(projected.includes(platformText), false, label + ' does not return platform error text')
}

async function assertVerifiedSecureStorageBehavior() {
  const fixture = createMemorySecureStorage()
  const storage = createVerifiedSecureKeyValueStorage(fixture.port)
  await storage.setItem('verified-key', 'verified-secret')
  assert.equal(await storage.getItem('verified-key'), 'verified-secret', 'verified secure storage rereads a successful write')
  await storage.removeItem('verified-key')
  assert.equal(await storage.getItem('verified-key'), null, 'verified secure storage rereads a successful delete')
  assert.deepEqual(
    fixture.calls.map((call) => call.operation),
    ['write', 'read', 'read', 'delete', 'read', 'read'],
    'verified secure storage serializes each mutation with an exact reread',
  )

  const platformText = 'native-secure-store-platform-detail'
  const secret = 'credential-that-must-stay-redacted'
  for (const testCase of [
    {
      operation: 'read',
      fault: 'getItem',
      expectedCode: 'read_failed',
      action: (candidate) => candidate.getItem('read-fault-key'),
    },
    {
      operation: 'write',
      fault: 'setItem',
      expectedCode: 'write_failed',
      action: (candidate) => candidate.setItem('write-fault-key', secret),
    },
    {
      operation: 'delete',
      fault: 'removeItem',
      expectedCode: 'delete_failed',
      action: (candidate) => candidate.removeItem('delete-fault-key'),
    },
  ]) {
    const failed = createMemorySecureStorage([['delete-fault-key', secret]])
    failed.faults[testCase.fault] = new Error(platformText)
    const error = await captureRejected(
      () => testCase.action(createVerifiedSecureKeyValueStorage(failed.port)),
      testCase.operation + ' fault must reject',
    )
    assertRedactedError(error, {
      code: testCase.expectedCode,
      operation: testCase.operation,
      secret,
      platformText,
    }, 'secure ' + testCase.operation + ' fault')
  }

  const writeVerificationPort = {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }
  const writeVerificationError = await captureRejected(
    () => createVerifiedSecureKeyValueStorage(writeVerificationPort).setItem('verification-key', secret),
    'unpersisted secure write must reject',
  )
  assertRedactedError(writeVerificationError, {
    code: 'verification_failed',
    operation: 'write',
    secret,
  }, 'secure write verification mismatch')

  const deleteVerificationPort = {
    getItem: async () => secret,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }
  const deleteVerificationError = await captureRejected(
    () => createVerifiedSecureKeyValueStorage(deleteVerificationPort).removeItem('verification-key'),
    'undeleted secure item must reject',
  )
  assertRedactedError(deleteVerificationError, {
    code: 'verification_failed',
    operation: 'delete',
    secret,
  }, 'secure delete verification mismatch')
}

async function assertProviderCredentialStorageBehavior() {
  assert.equal(
    providerCredentialStorageKey('provider-main'),
    'islemind.key.provider-main',
    'provider credential storage preserves the historical provider key name',
  )
  assert.equal(
    providerCredentialGroupStorageKey('provider-main', 'group-primary'),
    'islemind.key.provider-main.group-primary',
    'provider credential storage preserves the historical group key name',
  )
  assert.equal(
    providerCredentialStorageKey('provider/compatible'),
    'islemind.key.provider_compatible',
    'provider credential storage preserves historical sanitized-key behavior',
  )

  const fixture = createMemorySecureStorage()
  const credentials = createProviderCredentialStorage(createVerifiedSecureKeyValueStorage(fixture.port))
  await credentials.setProviderCredential('provider-main', 'provider-secret')
  await credentials.setCredentialGroupCredential('provider-main', 'group-primary', 'group-secret')
  assert.equal(await credentials.getProviderCredential('provider-main'), 'provider-secret', 'provider credential write is verified and readable')
  assert.equal(await credentials.getCredentialGroupCredential('provider-main', 'group-primary'), 'group-secret', 'group credential write is verified and readable')
  await credentials.deleteProviderCredential('provider-main')
  await credentials.deleteCredentialGroupCredential('provider-main', 'group-primary')
  assert.equal(await credentials.getProviderCredential('provider-main'), null, 'provider credential delete is verified')
  assert.equal(await credentials.getCredentialGroupCredential('provider-main', 'group-primary'), null, 'group credential delete is verified')

  const collision = await captureRejected(
    () => credentials.applyMutations([
      { providerId: 'provider/a', credential: 'first-secret' },
      { providerId: 'provider?a', credential: 'second-secret' },
    ]),
    'sanitized provider-key collision must reject',
  )
  assertRedactedError(collision, {
    code: 'invalid_identity',
    scope: 'replacement',
    secret: 'second-secret',
  }, 'sanitized provider-key collision')

  const providerKey = providerCredentialStorageKey('rollback-provider')
  const groupKey = providerCredentialGroupStorageKey('rollback-provider', 'late-group')
  const rollbackFixture = createMemorySecureStorage([
    [providerKey, 'old-provider-secret'],
    [groupKey, 'old-group-secret'],
  ])
  const platformText = 'provider-platform-write-detail'
  rollbackFixture.faults.setItem = ({ key, value }) => {
    if (key === groupKey && value === 'new-group-secret') {
      rollbackFixture.faults.setItem = null
      return new Error(platformText)
    }
    return null
  }
  const rollbackCredentials = createProviderCredentialStorage(
    createVerifiedSecureKeyValueStorage(rollbackFixture.port),
  )
  const rollbackError = await captureRejected(
    () => rollbackCredentials.applyMutations([
      { providerId: 'rollback-provider', credential: 'new-provider-secret' },
      { providerId: 'rollback-provider', groupId: 'late-group', credential: 'new-group-secret' },
    ]),
    'later provider credential failure must reject',
  )
  assertRedactedError(rollbackError, {
    code: 'write_failed',
    scope: 'replacement',
    secret: 'new-group-secret',
    platformText,
  }, 'provider credential rollback')
  assert.equal(rollbackFixture.values.get(providerKey), 'old-provider-secret', 'provider credential rollback restores the earlier mutation')
  assert.equal(rollbackFixture.values.get(groupKey), 'old-group-secret', 'provider credential rollback restores the failed key snapshot')

  const rollbackFailureFixture = createMemorySecureStorage([
    [providerKey, 'old-provider-secret'],
    [groupKey, 'old-group-secret'],
  ])
  rollbackFailureFixture.faults.setItem = ({ key }) => key === groupKey ? new Error(platformText) : null
  const rollbackFailureCredentials = createProviderCredentialStorage(
    createVerifiedSecureKeyValueStorage(rollbackFailureFixture.port),
  )
  const rollbackFailure = await captureRejected(
    () => rollbackFailureCredentials.applyMutations([
      { providerId: 'rollback-provider', credential: 'new-provider-secret' },
      { providerId: 'rollback-provider', groupId: 'late-group', credential: 'new-group-secret' },
    ]),
    'provider credential rollback failure must reject',
  )
  assertRedactedError(rollbackFailure, {
    code: 'rollback_failed',
    scope: 'replacement',
    secret: 'new-group-secret',
    platformText,
  }, 'provider credential rollback failure')
}

async function run() {
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

  const secureStorageSource = readSource('src/platform/secureStorage/expoSecureKeyValueStorage.ts')
  assertSourceIncludes(secureStorageSource, 'createExpoSecureKeyValueStoragePort', 'Platform owns the concrete secure-storage adapter')
  assertSourceIncludes(secureStorageSource, 'SecureStore.setItemAsync', 'native secure storage writes through SecureStore')
  assertSourceIncludes(secureStorageSource, "'@islemind/secure/'", 'web fallback preserves the namespaced secure key prefix')

  const providerCredentialStorageSource = readSource('src/modules/providers/providerCredentialStorage.ts')
  assertSourceIncludes(providerCredentialStorageSource, 'providerCredentialStorageKey', 'Providers owns stable provider secure-key derivation')
  assertSourceIncludes(providerCredentialStorageSource, 'providerCredentialGroupStorageKey', 'Providers owns stable credential-group key derivation')
  assertSourceIncludes(providerCredentialStorageSource, 'replaceCredentials', 'Providers owns replacement semantics for imported credentials')
  assertSourceIncludes(providerCredentialStorageSource, "'rollback_failed'", 'Providers reports failed rollback without raw platform errors')

  const credentialCompositionSource = readSource('src/bootstrap/secureCredentialStorage.ts')
  assertSourceIncludes(credentialCompositionSource, 'createExpoSecureKeyValueStoragePort', 'bootstrap composes the platform secure-storage adapter')
  assertSourceIncludes(credentialCompositionSource, 'clearKnownSearchSecureKeys', 'bootstrap owns search secure-key cleanup')
  assertSourceIncludes(credentialCompositionSource, 'clearKnownObservabilitySecureKeys', 'bootstrap owns observability secure-key cleanup')

  const credentialSource = readSource('src/modules/providers/providerCredentials.ts')
  assertSourceIncludes(credentialSource, 'selectProviderCredential', 'target model-scoped credential selection exists')
  assertSourceIncludes(credentialSource, 'availableModels.includes(upstreamModelId)', 'target credential selection checks upstream model availability')
  assertSourceIncludes(credentialSource, 'excludedCredentialIds', 'target credential selection supports excluded groups')
  assertSourceIncludes(credentialSource, 'updateProviderCredentialHealth', 'target credential health updates exist')
  assertSourceIncludes(credentialSource, 'failureCount', 'target credential health tracks failure count')

  const portableResetSource = readSource('src/bootstrap/portableDataReset.ts')
  const portablePayloadSource = readSource('src/modules/data-management/application/portableDataPayload.ts')
  const portableImportRecoverySource = readSource('src/bootstrap/portableImportRecovery.ts')
  assertSourceIncludes(portablePayloadSource, 'apiKey: \'\',', 'portable provider export strips provider API keys')
  assertSourceIncludes(portableImportRecoverySource, 'createSecureSidecar(item.sourceRef, item.sourceRaw)', 'full restore durably prepares provider credential before-images')
  assertSourceIncludes(portableImportRecoverySource, 'createSecureSidecar(item.targetRef, item.targetRaw)', 'full restore durably prepares imported provider credentials')
  assertSourceIncludes(portableImportRecoverySource, 'providerCredentialStorage.applyMutations(providerMutations)', 'restore replaces provider and group credentials through the Providers API')
  assertSourceIncludes(portableImportRecoverySource, '[...KNOWN_SEARCH_SECURE_KEYS, OBSERVABILITY_SINK_API_KEY]', 'restore includes search and observability keys in verified secure-state recovery')
  assertSourceIncludes(portableResetSource, 'clearKnownObservabilitySecureKeys', 'reset cleanup clears observability secure keys')
  assertSourceIncludes(portableResetSource, 'clearKnownSearchSecureKeys', 'reset cleanup clears search secure keys')
  const settingsSource = readSource('src/store/settingsStore.ts')
  assertSourceIncludes(settingsSource, 'setObservabilitySinkApiKey', 'observability sink key setter exists')
  assertSourceIncludes(settingsSource, 'observabilitySinkApiKeyConfigured', 'observability sink stores configured state instead of raw key state')
  assertSourceIncludes(settingsSource, 'observabilitySinkUserOptIn: false', 'observability sink defaults to no user opt-in')
  assertSourceIncludes(settingsSource, 'observabilitySinkWorkspaceConsent: false', 'observability sink defaults to no workspace consent')
  assertSourceIncludes(settingsSource, 'providerCredentialStorage.applyMutations', 'provider settings mutations use the rollback-capable Providers API')
  assertSourceIncludes(settingsSource, 'secureKeyValueStorage.removeItem(OBSERVABILITY_SINK_API_KEY)', 'clear-all removes the observability sink key through verified storage')

  await assertVerifiedSecureStorageBehavior()
  await assertProviderCredentialStorageBehavior()

  const proxyPolicySource = readSource('src/modules/providers/providerProxyPolicy.ts')
  const proxyPolicyBindingSource = readSource('src/bootstrap/providerProxyPolicy.ts')
  const urlSafetySource = readSource('src/utils/networkUrlSafety.ts')
  assertSourceIncludes(proxyPolicySource, 'dependencies.safeHttpUrl', 'target proxy policy uses an injected URL safety port')
  assertSourceIncludes(proxyPolicyBindingSource, 'createProviderProxyPolicy({ safeHttpUrl })', 'bootstrap binds the concrete URL safety helper to the target proxy policy')
  assertSourceIncludes(urlSafetySource, 'parsed.username || parsed.password', 'URL safety helper rejects userinfo credentials')

  const runtimeLogSource = readSource('src/platform/native/runtimeLog.ts')
  assertSourceMatches(runtimeLogSource, /authorization\|api\[-_\]\?key\|token\|secret\|password\|credential\|bearer/, 'runtime log treats credential field names as sensitive')
  assertSourceIncludes(runtimeLogSource, 'redactSensitiveQueryParams', 'runtime log redacts sensitive query parameters')
  assertSourceIncludes(runtimeLogSource, 'redactUrlUserInfo', 'runtime log redacts URL userinfo credentials')
  assertSourceIncludes(runtimeLogSource, 'redactSensitiveAssignments', 'runtime log redacts credential assignments')

  const runtimeEventsSource = readSource('src/services/runtimeEvents.ts')
  assertSourceIncludes(runtimeEventsSource, 'redactRuntimeLogValue', 'runtime event persistence reuses runtime-log redaction')

  console.log('Credential governance compatibility tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
