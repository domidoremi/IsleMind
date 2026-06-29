const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_PROTOCOL_COMPATIBILITY_EVAL_SCHEMA,
  PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS,
  runProviderProtocolCompatibilityEvaluation,
} = require('../src/services/providerProtocolCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderProtocolCompatibilityHook) return

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
  hook.isProviderProtocolCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.providerIdentity, true, `${item.fixtureId} has provider identity`)
  assert.equal(item.policy.protocolMapped, true, `${item.fixtureId} maps protocol`)
  assert.equal(item.policy.endpointResolved, true, `${item.fixtureId} resolves endpoint`)
  assert.equal(item.policy.authMapped, true, `${item.fixtureId} maps auth`)
  assert.equal(item.policy.requestShapeConformed, true, `${item.fixtureId} conforms request shape`)
  assert.equal(item.policy.capabilityEvidence, true, `${item.fixtureId} has capability evidence`)
  assert.equal(item.policy.noGenericCapabilityFlattening, true, `${item.fixtureId} avoids generic capability flattening`)
  assert.equal(item.policy.transportDeclared, true, `${item.fixtureId} declares transport`)
  assert.equal(item.policy.transportFallbackVisible, true, `${item.fixtureId} has visible transport fallback policy`)
  assert.equal(item.policy.sameProviderState, true, `${item.fixtureId} keeps provider state scoped`)
  assert.equal(item.policy.crossProviderStateReplay, false, `${item.fixtureId} blocks cross-provider state replay`)
  assert.equal(item.policy.timeoutPolicy, true, `${item.fixtureId} has timeout policy`)
  assert.equal(item.policy.errorMapping, true, `${item.fixtureId} maps errors`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts diagnostics`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} is local/offline`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertDegraded(item) {
  assert.equal(item.readiness, 'degraded', `${item.fixtureId} is degraded`)
  assertReadyWithoutReadiness(item)
  assert.equal(item.policy.fallbackRequired || item.policy.liveSmokePlan, true, `${item.fixtureId} records degraded reason`)
}

function assertReadyWithoutReadiness(item) {
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.providerIdentity, true, `${item.fixtureId} has provider identity`)
  assert.equal(item.policy.protocolMapped, true, `${item.fixtureId} maps protocol`)
  assert.equal(item.policy.endpointResolved, true, `${item.fixtureId} resolves endpoint`)
  assert.equal(item.policy.authMapped, true, `${item.fixtureId} maps auth`)
  assert.equal(item.policy.requestShapeConformed, true, `${item.fixtureId} conforms request shape`)
  assert.equal(item.policy.capabilityEvidence, true, `${item.fixtureId} has capability evidence`)
  assert.equal(item.policy.noGenericCapabilityFlattening, true, `${item.fixtureId} avoids capability flattening`)
  assert.equal(item.policy.transportDeclared, true, `${item.fixtureId} declares transport`)
  assert.equal(item.policy.transportFallbackVisible, true, `${item.fixtureId} exposes fallback`)
  assert.equal(item.policy.timeoutPolicy, true, `${item.fixtureId} has timeout policy`)
  assert.equal(item.policy.errorMapping, true, `${item.fixtureId} maps errors`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts diagnostics`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(PROVIDER_PROTOCOL_COMPATIBILITY_EVAL_SCHEMA, 'islemind.provider-protocol-compatibility-eval.v1', 'provider protocol schema is versioned')
  assert.deepEqual(
    PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS,
    [
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
    ],
    'provider protocol fixtures cover official, relay, hosted, local, transport, model-list, state, and blocked paths'
  )

  const evaluation = runProviderProtocolCompatibilityEvaluation({ now: () => 2800000000000 })
  assert.equal(evaluation.schema, PROVIDER_PROTOCOL_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, PROVIDER_PROTOCOL_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `provider protocol gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const protocol of ['openai-responses', 'openai-chat-completions', 'anthropic-messages', 'google-generate-content', 'openai-compatible', 'hosted-openai-compatible', 'hosted-native', 'local-openai-compatible']) {
    assert.ok(evaluation.qualityGate.requiredProtocols.includes(protocol), `quality gate tracks ${protocol}`)
  }
  for (const hostingProfile of ['official', 'relay', 'cloud-hosted', 'local-runtime', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredHostingProfiles.includes(hostingProfile), `quality gate tracks ${hostingProfile}`)
  }
  for (const transport of ['http_sse', 'responses_websocket', 'signed_http']) {
    assert.ok(evaluation.qualityGate.requiredTransports.includes(transport), `quality gate tracks ${transport}`)
  }

  const responses = diagnostic(evaluation, 'openai-responses-http-sse-route')
  assertReady(responses)
  assert.equal(responses.policy.responsesApiAllowed, true, 'Responses route allows Responses API')
  assert.equal(responses.policy.selectedTransport, 'http_sse', 'Responses route uses HTTP/SSE by default')

  assertReady(diagnostic(evaluation, 'openai-chat-completions-compat-route'))

  const anthropic = diagnostic(evaluation, 'anthropic-messages-sse-route')
  assertReady(anthropic)
  assert.equal(anthropic.policy.chatCompletionsAllowed, false, 'Anthropic route is not Chat Completions')

  const google = diagnostic(evaluation, 'google-generate-content-sse-route')
  assertReady(google)
  assert.equal(google.policy.chatCompletionsAllowed, false, 'Google route is not Chat Completions')

  assertDegraded(diagnostic(evaluation, 'openai-compatible-relay-declared-capabilities'))
  assertDegraded(diagnostic(evaluation, 'azure-openai-v1-hosted-route'))

  const bedrock = diagnostic(evaluation, 'bedrock-runtime-signed-invoke-route')
  assertDegraded(bedrock)
  assert.equal(bedrock.policy.selectedTransport, 'signed_http', 'Bedrock Runtime uses signed HTTP')
  assert.equal(bedrock.policy.signedRequest, true, 'Bedrock Runtime records signed request')

  const local = diagnostic(evaluation, 'local-runtime-openai-compatible-lan-route')
  assertReady(local)
  assert.equal(local.policy.localNetworkOptIn, true, 'local runtime requires LAN opt-in')

  const websocket = diagnostic(evaluation, 'responses-websocket-contract-route')
  assertReady(websocket)
  assert.equal(websocket.policy.selectedTransport, 'responses_websocket', 'WebSocket fixture uses Responses WebSocket')
  assert.equal(websocket.policy.websocketContract, true, 'WebSocket fixture has provider contract')
  assert.equal(websocket.policy.websocketRuntimeAvailable, true, 'WebSocket fixture has runtime support')

  const websocketFallback = diagnostic(evaluation, 'responses-websocket-visible-http-fallback')
  assertDegraded(websocketFallback)
  assert.equal(websocketFallback.policy.selectedTransport, 'http_sse', 'WebSocket fallback uses HTTP/SSE')

  const modelList = diagnostic(evaluation, 'model-list-suppression-manual-fallback')
  assertReady(modelList)
  assert.equal(modelList.policy.modelListPolicy, 'suppressed', 'model-list fixture suppresses unsafe model listing')
  assert.equal(modelList.policy.manualModelFallback, true, 'model-list fixture has manual fallback')

  assertReady(diagnostic(evaluation, 'same-provider-state-continuation'))

  assertBlocked(diagnostic(evaluation, 'blocked-generic-openai-compatible-overclaim'), [
    'missing-provider-identity',
    'missing-capability-evidence',
    'generic-capability-overclaim',
    'missing-manual-model-fallback',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-hosted-route-missing-region'), [
    'missing-region-resource-scope',
    'missing-visible-fallback',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-provider-state-replay'), [
    'cross-provider-state-replay',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-websocket-without-contract-or-runtime'), [
    'websocket-contract-missing',
    'websocket-runtime-missing',
    'missing-visible-fallback',
  ])

  console.log('Provider protocol compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
