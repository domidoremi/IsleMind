const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA,
  LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS,
  LOCAL_INFERENCE_RUNTIME_FAMILIES,
  runLocalInferenceCompatibilityEvaluation,
} = require('../src/modules/knowledge/testing/localInferenceCompatibilityEvaluation.ts')

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
    module._compile(transformTypeScriptModule(source, filename), filename)
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

async function runOnnxInitializationRecoveryTests() {
  const originalLoad = Module._load
  const tokenizerFailure = new Error('temporary tokenizer read failure')
  const sessionFailure = new Error('temporary native session failure')
  let failTokenizer = true
  let failSession = false
  let tokenizerReads = 0
  let sessionCreates = 0
  let outputFactory
  let finishRun
  let runStarted
  let tensorDisposals = 0
  const released = []
  const tensor = (data, dims) => ({ data: new Float32Array(data), dims, dispose() { tensorDisposals += 1 } })

  Module._load = function loadWithOnnxFakes(request, parent, isMain) {
    if (request === 'expo-file-system/legacy') return {
      EncodingType: { UTF8: 'utf8' },
      async readAsStringAsync() {
        tokenizerReads += 1
        if (failTokenizer) {
          failTokenizer = false
          throw tokenizerFailure
        }
        return JSON.stringify({ model: { vocab: { '[PAD]': 0, '[CLS]': 1, '[SEP]': 2, '[UNK]': 3, hello: 4, world: 5 } } })
      },
    }
    if (request === '@/bootstrap/localModelCatalog') return {
      async resolveConfiguredLocalEmbeddingModel(settings) {
        return {
          model: { id: settings.localEmbeddingModelId, version: 'test-v1', dimension: 2,
            tokenizer: settings.localEmbeddingModelId === 'unigram' ? 'unigram' : 'wordpiece',
            pooling: settings.localEmbeddingModelId === 'cls-pooling' ? 'cls' : 'mean', maxTokens: 8 },
          source: 'downloaded',
          directoryUri: `file:///test-models/${settings.localEmbeddingModelId}/`,
        }
      },
    }
    if (request === '@/services/runtimeHealthLog') return { logContextOperation: async () => {} }
    if (request === 'onnxruntime-react-native') return {
      Tensor: class {
        constructor(type, data, dims) {
          Object.assign(this, { type, data, dims })
        }
        dispose() { tensorDisposals += 1 }
      },
      InferenceSession: {
        async create(uri) {
          sessionCreates += 1
          if (failSession) {
            failSession = false
            throw sessionFailure
          }
          return {
            inputNames: ['input_ids', 'attention_mask'],
            outputNames: ['sentence_embedding'],
            async run(feeds) {
              assert.ok(feeds.input_ids.dims[1] <= 8, 'special tokens fit inside the model token limit')
              if (runStarted) { runStarted(); await new Promise(resolve => { finishRun = resolve }) }
              return outputFactory?.(feeds) ?? { sentence_embedding: tensor([3, 4], [1, 2]) }
            },
            async release() { released.push(uri) },
          }
        },
      },
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const { createOnnxEmbeddingProvider, releaseOnnxEmbeddingResources } = require('../src/bootstrap/knowledgeEmbeddingProvider.ts')
    const tokenizerProvider = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'retry-tokenizer', localEmbeddingModelSource: 'downloaded' })
    assert.equal(await tokenizerProvider.available(), false, 'a tokenizer read failure makes the provider temporarily unavailable')
    assert.equal(tokenizerReads, 1, 'availability attempts the tokenizer read')
    assert.equal(await tokenizerProvider.available(), true, 'a transient tokenizer failure must not poison the model cache')
    assert.deepEqual(await tokenizerProvider.embed('hello'), [0.6, 0.8], 'the recovered tokenizer can produce an embedding')
    assert.equal(tokenizerReads, 2, 'successful tokenizers stay cached after the retry')

    const sessionProvider = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'retry-session', localEmbeddingModelSource: 'downloaded' })
    failSession = true
    sessionCreates = 0
    tokenizerReads = 0
    const first = await Promise.allSettled([sessionProvider.embed('hello'), sessionProvider.embed('world')])
    assert.deepEqual(first, [
      { status: 'rejected', reason: sessionFailure },
      { status: 'rejected', reason: sessionFailure },
    ], 'concurrent callers receive the same initialization failure')
    assert.equal(sessionCreates, 1, 'concurrent embeddings share one pending native session')
    assert.deepEqual(await sessionProvider.embed('hello'), [0.6, 0.8], 'a failed native session can be retried')
    assert.deepEqual(await sessionProvider.embed('world'), [0.6, 0.8], 'a successful native session remains reusable')
    assert.equal(sessionCreates, 2, 'only the failed session is evicted')
    assert.equal(tokenizerReads, 1, 'session failure does not evict the successful tokenizer')
    assert.equal(sessionProvider.dimension, 2, 'the descriptor exposes the actual model dimension, not a hard-coded 384')
    assert.match(sessionProvider.model, /test-v1:onnx-pipeline-v2:mean$/, 'vectors carry model and preprocessing identity')
    assert.ok(released.some(uri => uri.includes('retry-tokenizer')), 'switching models releases the idle native session')
    await sessionProvider.embed('hello '.repeat(30))

    outputFactory = () => ({ sentence_embedding: tensor([3, 4], [1, 2]), last_hidden_state: tensor([1, 0, 1, 0, 1, 0], [1, 3, 2]) })
    assert.deepEqual(await sessionProvider.embed('hello'), [0.6, 0.8], 'sentence embeddings take precedence over raw hidden state')
    outputFactory = () => ({ last_hidden_state: tensor([3, 4, 0, 10, 0, 10], [1, 3, 2]) })
    const cls = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'cls-pooling', localEmbeddingModelSource: 'downloaded' })
    assert.deepEqual(await cls.embed('hello'), [0.6, 0.8], 'CLS models do not mean-pool token states')
    for (const invalid of [tensor([1, 2, 3], [1, 3]), tensor([NaN, 0], [1, 2]), tensor([1, 0], [2, 2]), tensor([0, 0], [1, 2])]) {
      outputFactory = () => ({ sentence_embedding: invalid })
      await assert.rejects(() => cls.embed('hello'), /ONNX embedding/, 'invalid output dimensions/values/norms fail closed')
    }
    outputFactory = undefined
    const unsupported = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'unigram', localEmbeddingModelSource: 'downloaded' })
    assert.equal(await unsupported.available(), false, 'an approximate character tokenizer is not advertised as Unigram')
    await assert.rejects(() => unsupported.embed('hello'), /not supported/)

    const cancelled = new AbortController()
    cancelled.abort()
    const createsBefore = sessionCreates
    await assert.rejects(() => cls.embed('hello', { signal: cancelled.signal }), { name: 'AbortError' })
    assert.equal(sessionCreates, createsBefore, 'pre-cancellation starts no native initialization')
    const during = new AbortController()
    const started = new Promise(resolve => { runStarted = resolve })
    const pending = cls.embed('hello', { signal: during.signal })
    await started
    during.abort()
    const releasesBefore = released.length
    const disposalsBefore = tensorDisposals
    await releaseOnnxEmbeddingResources()
    assert.equal(released.length, releasesBefore, 'cleanup never releases a session still executing')
    finishRun()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.ok(tensorDisposals > disposalsBefore, 'cancelled native runs discard and dispose late tensor results')
    assert.equal(released.length, releasesBefore + 1, 'retired native resources release once the run has settled')
    runStarted = undefined
    await releaseOnnxEmbeddingResources()
  } finally {
    Module._load = originalLoad
  }
}

async function run() {
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

  await runOnnxInitializationRecoveryTests()
  console.log('Local inference compatibility tests passed')
}

if (require.main === module) run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

module.exports = { run }
