const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA,
  LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS,
  LOCAL_INFERENCE_RUNTIME_FAMILIES,
  runLocalInferenceCompatibilityEvaluation,
} = require('../src/services/localInferenceCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isLocalInferenceCompatibilityHook) return

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
  hook.isLocalInferenceCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertRuntimeEnvelope(item) {
  assert.ok(item.runtimeSource, `${item.fixtureId} records runtime source`)
  assert.ok(item.docs.length > 0, `${item.fixtureId} records docs`)
  assert.ok(item.baseUrl, `${item.fixtureId} records base URL`)
  assert.ok(item.endpointShape.chat, `${item.fixtureId} records chat endpoint`)
  assert.ok(item.timeoutMs >= 30000, `${item.fixtureId} records timeout policy`)
  assert.ok(item.requirements.minSystemRamGb > 0, `${item.fixtureId} records memory requirement`)
  assert.equal(item.requirements.mobileRuntimeSupported, false, `${item.fixtureId} is not mislabeled as a React Native mobile runtime`)
}

function assertReadyLanRuntime(item) {
  assertRuntimeEnvelope(item)
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready as a LAN service target`)
  assert.equal(item.hostKind, 'lan', `${item.fixtureId} is modeled as a LAN target`)
  assert.equal(item.userOptIn, true, `${item.fixtureId} requires explicit opt-in`)
  assert.equal(item.mobileReachability, 'requires-lan-host', `${item.fixtureId} records mobile LAN reachability`)
  assert.ok(item.capabilitySummary.declared.includes('chat'), `${item.fixtureId} declares chat`)
  assert.ok(item.capabilitySummary.declared.includes('streaming'), `${item.fixtureId} declares streaming`)
  assert.ok(item.modelCount > 0, `${item.fixtureId} records model metadata`)
  assert.ok(item.riskCodes.includes('not_mobile_runtime'), `${item.fixtureId} records server-runtime boundary`)
}

function run() {
  assert.equal(LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA, 'islemind.local-inference-compatibility-eval.v1', 'local inference schema is versioned')
  assert.deepEqual(
    LOCAL_INFERENCE_RUNTIME_FAMILIES,
    ['ollama', 'llama-cpp', 'lm-studio', 'localai', 'vllm', 'sglang'],
    'local inference gate covers current local runtime families'
  )
  assert.deepEqual(
    LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS,
    [
      'ollama-openai-compatible',
      'llama-cpp-server',
      'lm-studio-openai-compatible',
      'localai-audio-and-grammar',
      'vllm-gpu-server',
      'sglang-reasoning-server',
      'mobile-loopback-warning',
      'model-list-fallback',
      'memory-pressure-boundary',
    ],
    'local inference fixtures cover ready runtimes and failure boundaries'
  )

  const evaluation = runLocalInferenceCompatibilityEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `local inference gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  assertReadyLanRuntime(diagnostic(evaluation, 'ollama-openai-compatible'))
  assertReadyLanRuntime(diagnostic(evaluation, 'llama-cpp-server'))
  assertReadyLanRuntime(diagnostic(evaluation, 'lm-studio-openai-compatible'))
  assertReadyLanRuntime(diagnostic(evaluation, 'vllm-gpu-server'))
  assertReadyLanRuntime(diagnostic(evaluation, 'sglang-reasoning-server'))

  const ollama = diagnostic(evaluation, 'ollama-openai-compatible')
  assert.ok(ollama.docs.some((url) => url.includes('docs.ollama.com')), 'Ollama fixture records current docs')
  assert.ok(ollama.capabilitySummary.declared.includes('structuredOutput'), 'Ollama fixture records structured output')
  assert.ok(ollama.capabilitySummary.declared.includes('embeddings'), 'Ollama fixture records embeddings')

  const llamaCpp = diagnostic(evaluation, 'llama-cpp-server')
  assert.equal(llamaCpp.family, 'llama-cpp', 'llama.cpp fixture records family')
  assert.ok(llamaCpp.manualModelFallbackUsed === false, 'llama.cpp ready fixture uses discovered metadata')

  const localai = diagnostic(evaluation, 'localai-audio-and-grammar')
  assertRuntimeEnvelope(localai)
  assert.equal(localai.readiness, 'ready', 'LocalAI remains ready as a LAN service target')
  assert.ok(localai.capabilitySummary.declared.includes('audio'), 'LocalAI fixture records transcription capability')
  assert.ok(localai.capabilitySummary.declared.includes('speech'), 'LocalAI fixture records speech capability')
  assert.ok(localai.riskCodes.includes('structured_output_adapter_required'), 'LocalAI grammar-backed structured output requires an adapter')

  const loopback = diagnostic(evaluation, 'mobile-loopback-warning')
  assertRuntimeEnvelope(loopback)
  assert.equal(loopback.hostKind, 'loopback', 'mobile loopback fixture records loopback host')
  assert.equal(loopback.mobileReachability, 'not-reachable', 'mobile loopback fixture records mobile reachability failure')
  assert.equal(loopback.readiness, 'blocked', 'mobile localhost is blocked')
  assert.ok(loopback.riskCodes.includes('mobile_loopback_unreachable'), 'mobile localhost risk is explicit')

  const fallback = diagnostic(evaluation, 'model-list-fallback')
  assertRuntimeEnvelope(fallback)
  assert.equal(fallback.modelListStatus, 'error', 'model-list fallback fixture records failed model list')
  assert.equal(fallback.manualModelFallbackUsed, true, 'model-list fallback uses a manual model')
  assert.equal(fallback.modelCount, 1, 'manual model counts as one configured model')
  assert.equal(fallback.readiness, 'needs-user-config', 'model-list failure requires user configuration')
  assert.ok(fallback.riskCodes.includes('model_list_unavailable'), 'model-list failure risk is explicit')

  const memoryPressure = diagnostic(evaluation, 'memory-pressure-boundary')
  assertRuntimeEnvelope(memoryPressure)
  assert.equal(memoryPressure.readiness, 'blocked', 'oversized local runtime is blocked')
  assert.ok(memoryPressure.riskCodes.includes('memory_pressure'), 'memory pressure risk is explicit')
  assert.equal(memoryPressure.requirements.minSystemRamGb, 48, 'memory pressure fixture records system RAM requirement')
  assert.equal(memoryPressure.requirements.minGpuVramGb, 48, 'memory pressure fixture records GPU VRAM requirement')

  console.log('Local inference compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
