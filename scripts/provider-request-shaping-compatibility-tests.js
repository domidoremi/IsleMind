const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_REQUEST_SHAPING_COMPATIBILITY_EVAL_SCHEMA,
  PROVIDER_REQUEST_SHAPING_COMPATIBILITY_FIXTURE_IDS,
  runProviderRequestShapingCompatibilityEvaluation,
} = require('../src/services/providerRequestShapingCompatibilityEvaluation.ts')

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

if (require.main === module) run()

module.exports = { run }
