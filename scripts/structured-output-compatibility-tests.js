const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  STRUCTURED_OUTPUT_COMPATIBILITY_EVAL_SCHEMA,
  STRUCTURED_OUTPUT_FIXTURE_IDS,
  runStructuredOutputCompatibilityEvaluation,
} = require('../src/services/structuredOutputCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isStructuredOutputCompatibilityHook) return

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
  hook.isStructuredOutputCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item, shape) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.requestShape, shape, `${item.fixtureId} uses ${shape}`)
  assert.equal(item.appRequestControl, true, `${item.fixtureId} has app request control`)
  assert.equal(item.parsed, true, `${item.fixtureId} sample parses`)
  assert.equal(item.requiredFieldCoverage, 1, `${item.fixtureId} covers all required fields`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function run() {
  assert.equal(STRUCTURED_OUTPUT_COMPATIBILITY_EVAL_SCHEMA, 'islemind.structured-output-compatibility-eval.v1', 'structured output schema is versioned')
  assert.deepEqual(
    STRUCTURED_OUTPUT_FIXTURE_IDS,
    [
      'openai-responses-text-format',
      'openai-chat-response-format',
      'anthropic-tool-schema',
      'google-response-schema',
      'openrouter-model-gated-schema',
      'localai-grammar-adapter-required',
      'generic-compatible-no-metadata',
      'malformed-schema-refusal',
      'tool-and-structured-output-coexistence',
      'json-object-fallback-repair',
    ],
    'structured output fixtures cover provider-native, blocked, coexistence, and fallback paths'
  )

  const evaluation = runStructuredOutputCompatibilityEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, STRUCTURED_OUTPUT_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, STRUCTURED_OUTPUT_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `structured output gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  for (const shape of [
    'openai-responses-text-format',
    'openai-response-format',
    'anthropic-tool-schema',
    'google-response-schema',
    'openrouter-response-format',
    'localai-grammar',
    'json-object-fallback',
    'none',
  ]) {
    assert.ok(evaluation.qualityGate.requiredRequestShapes.includes(shape), `quality gate tracks ${shape}`)
  }

  assertReady(diagnostic(evaluation, 'openai-responses-text-format'), 'openai-responses-text-format')
  assertReady(diagnostic(evaluation, 'openai-chat-response-format'), 'openai-response-format')
  assertReady(diagnostic(evaluation, 'anthropic-tool-schema'), 'anthropic-tool-schema')
  assertReady(diagnostic(evaluation, 'google-response-schema'), 'google-response-schema')
  assertReady(diagnostic(evaluation, 'openrouter-model-gated-schema'), 'openrouter-response-format')

  const openaiResponses = diagnostic(evaluation, 'openai-responses-text-format')
  assert.equal(openaiResponses.strictJsonSchema, true, 'OpenAI Responses text format is strict schema capable')
  assert.ok(openaiResponses.modelMetadataSupportsSchema, 'OpenAI Responses fixture records text.format support')

  const anthropic = diagnostic(evaluation, 'anthropic-tool-schema')
  assert.equal(anthropic.toolDeclarationCount, 1, 'Anthropic fixture uses synthetic tool schema')
  assert.equal(anthropic.toolSchemaValid, true, 'Anthropic tool schema is valid')

  const localai = diagnostic(evaluation, 'localai-grammar-adapter-required')
  assert.equal(localai.readiness, 'blocked', 'LocalAI grammar stays blocked until adapter exists')
  assert.equal(localai.requestShape, 'localai-grammar', 'LocalAI records grammar request shape')
  assert.ok(localai.failureCodes.includes('adapter-required'), 'LocalAI reports adapter requirement')

  const generic = diagnostic(evaluation, 'generic-compatible-no-metadata')
  assert.equal(generic.readiness, 'blocked', 'generic OpenAI-compatible provider is blocked without metadata')
  assert.equal(generic.requestShape, 'none', 'generic OpenAI-compatible provider emits no schema control')
  assert.ok(generic.failureCodes.includes('model-metadata-required'), 'generic provider reports metadata requirement')
  assert.ok(generic.failureCodes.includes('unsupported-request-control'), 'generic provider reports unsupported request control')

  const malformed = diagnostic(evaluation, 'malformed-schema-refusal')
  assert.equal(malformed.readiness, 'blocked', 'malformed schema is blocked')
  assert.equal(malformed.requestShape, 'none', 'malformed schema emits no request shape')
  assert.ok(malformed.failureCodes.includes('missing-schema-name'), 'malformed schema reports missing name')
  assert.ok(malformed.failureCodes.includes('schema-missing-required'), 'malformed schema reports missing required fields')

  const coexistence = diagnostic(evaluation, 'tool-and-structured-output-coexistence')
  assertReady(coexistence, 'openai-responses-text-format')
  assert.equal(coexistence.toolDeclarationCount, 1, 'tool coexistence fixture records provider tool')
  assert.equal(coexistence.toolSchemaValid, true, 'tool coexistence fixture validates tool schema')
  assert.equal(coexistence.strictJsonSchema, true, 'tool coexistence does not weaken strict structured output')

  const fallback = diagnostic(evaluation, 'json-object-fallback-repair')
  assert.equal(fallback.readiness, 'fallback-only', 'JSON object fallback is fallback-only')
  assert.equal(fallback.requestShape, 'json-object-fallback', 'JSON object fallback records fallback shape')
  assert.equal(fallback.jsonObjectFallback, true, 'JSON object fallback is explicit')
  assert.equal(fallback.strictJsonSchema, false, 'JSON object fallback does not claim strict JSON schema')
  assert.equal(fallback.parsed, true, 'JSON object fallback parser extracts JSON from prose wrapper')
  assert.equal(fallback.requiredFieldCoverage, 1, 'JSON object fallback still validates required fields')

  console.log('Structured output compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
