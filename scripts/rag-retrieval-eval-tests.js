const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load

registerTypeScriptSupport()

const {
  RAG_RETRIEVAL_BENCHMARK_CASES,
  RAG_RETRIEVAL_EVAL_SCHEMA,
  RAG_RETRIEVAL_MODES,
  runRagRetrievalBenchmark,
} = require('../src/services/ragEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isRagRetrievalEvalHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === '@/services/localDataStore') {
      return {
        localDataStore: {
          logRagEvaluation: async () => {},
          listRagEvaluationLogs: async () => [],
          listIndexingJobs: async () => [],
          listEmbeddingJobs: async () => [],
          rebuildKnowledgeEmbeddings: async () => 0,
          clearRagCaches: async () => {},
        },
      }
    }
    if (request === '@/services/localEmbeddingModels') {
      return {
        resolveActiveLocalEmbeddingModel: async () => null,
        markLocalEmbeddingModelFailure: async () => {},
      }
    }
    if (request === '@/services/lazyEmbedding') {
      return { lazyEmbedding: { embed: async () => [] } }
    }
    if (request === '@/services/runtimeHealthLog') {
      return { logContextOperation: async () => {} }
    }
    if (request === 'expo-file-system/legacy') {
      return {
        EncodingType: { UTF8: 'utf8' },
        readAsStringAsync: async () => '',
      }
    }
    return originalLoad.call(this, request, parent, isMain)
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
  hook.isRagRetrievalEvalHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function makeClock() {
  let tick = 0
  return () => 1810000000000 + tick++ * 13
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(source, marker, label) {
  assert.ok(source.includes(marker), label)
}

function caseByScenario(run, scenario) {
  const item = run.cases.find((candidate) => candidate.scenario === scenario)
  assert.ok(item, `benchmark includes ${scenario}`)
  return item
}

function assertModeMatrix(item) {
  for (const mode of RAG_RETRIEVAL_MODES) {
    const result = item.results[mode]
    assert.ok(result, `${item.id} includes ${mode} result`)
    assert.equal(result.mode, mode, `${item.id} ${mode} result is self-describing`)
    assert.ok(Array.isArray(result.sourceIds), `${item.id} ${mode} reports source ids`)
    assert.ok(Array.isArray(result.warningCodes), `${item.id} ${mode} reports warning codes`)
    assert.ok(Array.isArray(result.fallbackReasons), `${item.id} ${mode} reports fallback reasons`)
    assert.ok(Number.isFinite(result.recall), `${item.id} ${mode} reports recall`)
    assert.ok(Number.isFinite(result.citationCoverage), `${item.id} ${mode} reports citation coverage`)
    assert.ok(Number.isFinite(result.contextPrecision), `${item.id} ${mode} reports context precision`)
    assert.ok(Number.isFinite(result.latencyMs), `${item.id} ${mode} reports latency`)
    assert.ok(Number.isFinite(result.estimatedContextTokens), `${item.id} ${mode} reports token estimate`)
  }
}

async function run() {
  assert.equal(RAG_RETRIEVAL_EVAL_SCHEMA, 'islemind.rag-retrieval-eval.v1', 'RAG retrieval eval schema is versioned')
  assert.deepEqual(RAG_RETRIEVAL_MODES, ['baseline', 'hybrid', 'agentic'], 'RAG retrieval eval compares baseline, hybrid, and agentic modes')

  for (const scenario of ['none', 'empty-index', 'missing-model', 'corrupted-model-file', 'provider-embedding-fallback', 'local-embedding-fallback']) {
    assert.ok(RAG_RETRIEVAL_BENCHMARK_CASES.some((item) => item.scenario === scenario), `benchmark fixtures cover ${scenario}`)
  }

  const benchmark = await runRagRetrievalBenchmark({
    language: 'en',
    ragMode: 'hybrid',
    ragProfile: 'deep',
    ragQueryRewriteEnabled: true,
    ragHydeEnabled: true,
    ragFlareEnabled: true,
    ragRaptorEnabled: true,
    ragGraphEnabled: true,
    ragCrossEncoderEnabled: true,
    ragColbertEnabled: true,
    ragLlmlinguaEnabled: true,
  }, { now: makeClock() })

  assert.equal(benchmark.schema, RAG_RETRIEVAL_EVAL_SCHEMA, 'benchmark run carries schema')
  assert.equal(benchmark.cases.length, RAG_RETRIEVAL_BENCHMARK_CASES.length, 'benchmark covers every registered case')
  assert.deepEqual(benchmark.modes, RAG_RETRIEVAL_MODES, 'benchmark run uses registered modes')
  assert.equal(benchmark.qualityGate.passed, true, `retrieval quality gate should pass: ${benchmark.qualityGate.failures.join(', ')}`)
  assert.ok(benchmark.qualityGate.minAverageRecall >= 0.72, 'quality gate records a recall floor')
  assert.ok(benchmark.qualityGate.minCitationCoverage >= 0.72, 'quality gate records a citation floor')

  for (const item of benchmark.cases) assertModeMatrix(item)

  for (const item of benchmark.cases.filter((candidate) => candidate.scenario === 'none')) {
    assert.ok(item.results.hybrid.recall >= item.results.baseline.recall, `${item.id} hybrid recall does not trail baseline`)
    assert.ok(item.results.agentic.recall >= item.results.hybrid.recall, `${item.id} agentic recall does not trail hybrid`)
    assert.ok(item.results.agentic.citationCoverage > 0, `${item.id} agentic preserves citations`)
    assert.ok(RAG_RETRIEVAL_MODES.includes(item.bestMode), `${item.id} records a valid best mode`)
  }

  const emptyIndex = caseByScenario(benchmark, 'empty-index')
  for (const mode of RAG_RETRIEVAL_MODES) {
    assert.equal(emptyIndex.results[mode].missingEvidence, true, `empty index is marked missing evidence for ${mode}`)
    assert.ok(emptyIndex.results[mode].warningCodes.includes('empty-index'), `empty index warning is present for ${mode}`)
  }

  for (const scenario of ['missing-model', 'corrupted-model-file', 'provider-embedding-fallback', 'local-embedding-fallback']) {
    const item = caseByScenario(benchmark, scenario)
    assert.ok(benchmark.fallbackScenarioCoverage.includes(scenario), `summary records ${scenario} coverage`)
    for (const reason of item.expectedFallbackReasons) {
      assert.ok(item.results.hybrid.fallbackReasons.includes(reason), `${scenario} hybrid records ${reason}`)
      assert.ok(item.results.agentic.fallbackReasons.includes(reason), `${scenario} agentic records ${reason}`)
      assert.ok(benchmark.fallbackReasons.includes(reason), `summary records ${reason}`)
    }
  }

  assert.ok(benchmark.modeSummaries.agentic.averageRecall >= benchmark.modeSummaries.baseline.averageRecall, 'agentic average recall stays at least baseline')
  assert.ok(benchmark.modeSummaries.agentic.averageCitationCoverage >= benchmark.modeSummaries.baseline.averageCitationCoverage, 'agentic citation coverage stays at least baseline')

  const ragEvaluationSource = readSource('src/services/ragEvaluation.ts')
  assertSourceIncludes(ragEvaluationSource, "RAG_RETRIEVAL_EVAL_SCHEMA = 'islemind.rag-retrieval-eval.v1'", 'RAG eval schema is source-declared')
  assertSourceIncludes(ragEvaluationSource, "RAG_RETRIEVAL_MODES = ['baseline', 'hybrid', 'agentic']", 'RAG eval modes are source-declared')
  assertSourceIncludes(ragEvaluationSource, 'RAG_RETRIEVAL_BENCHMARK_CASES', 'RAG benchmark cases are registered in source')
  assertSourceIncludes(ragEvaluationSource, 'empty-index', 'RAG benchmark covers empty-index fallback')
  assertSourceIncludes(ragEvaluationSource, 'missing-model', 'RAG benchmark covers missing-model fallback')
  assertSourceIncludes(ragEvaluationSource, 'corrupted-model-file', 'RAG benchmark covers corrupted model fallback')
  assertSourceIncludes(ragEvaluationSource, 'provider-embedding-fallback', 'RAG benchmark covers provider embedding fallback')
  assertSourceIncludes(ragEvaluationSource, 'local-embedding-fallback', 'RAG benchmark covers local embedding fallback')
  assertSourceIncludes(ragEvaluationSource, 'minAverageRecall', 'RAG benchmark quality gate records recall threshold')
  assertSourceIncludes(ragEvaluationSource, 'minCitationCoverage', 'RAG benchmark quality gate records citation threshold')

  const ragRuntimeSource = readSource('src/services/rag.ts')
  assertSourceIncludes(ragRuntimeSource, 'ragMode=off', 'RAG runtime records off-mode fallback')
  assertSourceIncludes(ragRuntimeSource, 'fallbackReasons', 'RAG runtime records fallback reasons')
  assertSourceIncludes(ragRuntimeSource, 'citationCoverage', 'RAG runtime computes citation coverage')
  assertSourceIncludes(ragRuntimeSource, 'retrievalBudget', 'RAG runtime applies retrieval budgets')
  assertSourceIncludes(ragRuntimeSource, 'throwIfAgenticRagCancelled(options.signal)', 'RAG runtime propagates cancellation')

  console.log('RAG retrieval eval tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
