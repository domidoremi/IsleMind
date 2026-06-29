const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

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

const requiredRagCases = [
  'runAgenticWorkflow()',
  'rag:context_pack',
  'evidence_insufficient',
  'profileSource tool-request',
  'ragMode=off',
  'fallbackReasons',
  'lowConfidenceRun',
  'missingEvidenceRun',
  'offlineLowEvidenceRun',
  'RAG_RETRIEVAL_EVAL_SCHEMA',
  'baseline retrieval mode',
  'hybrid retrieval mode',
  'agentic retrieval mode',
  'empty-index',
  'missing-model',
  'corrupted-model-file',
  'provider-embedding-fallback',
  'local-embedding-fallback',
]

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentRagQualityHook) return

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
  hook.isAgentRagQualityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function makeClock() {
  let tick = 0
  return () => 1800000000000 + tick++ * 11
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
  }
}

async function run() {
  assert.ok(requiredRagCases.includes('rag:context_pack'), 'agent RAG contract covers context pack traces')
  assert.ok(requiredRagCases.includes('evidence_insufficient'), 'agent RAG contract covers evidence repair gating')
  assert.ok(requiredRagCases.includes('fallbackReasons'), 'agent RAG contract covers fallback reason evidence')
  assert.equal(RAG_RETRIEVAL_EVAL_SCHEMA, 'islemind.rag-retrieval-eval.v1', 'RAG retrieval eval schema is versioned')
  assert.deepEqual(RAG_RETRIEVAL_MODES, ['baseline', 'hybrid', 'agentic'], 'RAG retrieval eval compares baseline, hybrid, and agentic modes')

  for (const scenario of ['empty-index', 'missing-model', 'corrupted-model-file', 'provider-embedding-fallback', 'local-embedding-fallback']) {
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

  assert.equal(benchmark.schema, RAG_RETRIEVAL_EVAL_SCHEMA, 'benchmark run carries the retrieval eval schema')
  assert.equal(benchmark.cases.length, RAG_RETRIEVAL_BENCHMARK_CASES.length, 'benchmark run covers every registered retrieval case')
  assert.deepEqual(benchmark.modes, RAG_RETRIEVAL_MODES, 'benchmark run uses the registered retrieval modes')
  assert.equal(benchmark.qualityGate.passed, true, `retrieval quality gate should pass: ${benchmark.qualityGate.failures.join(', ')}`)

  for (const item of benchmark.cases) assertModeMatrix(item)

  for (const item of benchmark.cases.filter((candidate) => candidate.scenario === 'none')) {
    assert.ok(item.results.hybrid.recall >= item.results.baseline.recall, `${item.id} hybrid recall should not trail baseline`)
    assert.ok(item.results.agentic.recall >= item.results.hybrid.recall, `${item.id} agentic recall should not trail hybrid`)
    assert.ok(item.results.agentic.citationCoverage > 0, `${item.id} agentic result preserves citations`)
  }

  const emptyIndex = caseByScenario(benchmark, 'empty-index')
  for (const mode of RAG_RETRIEVAL_MODES) {
    assert.equal(emptyIndex.results[mode].missingEvidence, true, `empty index is marked missing evidence for ${mode}`)
    assert.ok(emptyIndex.results[mode].warningCodes.includes('empty-index'), `empty index warning is present for ${mode}`)
  }

  for (const scenario of ['missing-model', 'corrupted-model-file', 'provider-embedding-fallback', 'local-embedding-fallback']) {
    const item = caseByScenario(benchmark, scenario)
    for (const reason of item.expectedFallbackReasons) {
      assert.ok(item.results.hybrid.fallbackReasons.includes(reason), `${scenario} hybrid records ${reason}`)
      assert.ok(item.results.agentic.fallbackReasons.includes(reason), `${scenario} agentic records ${reason}`)
    }
  }

  assert.ok(benchmark.fallbackScenarioCoverage.includes('empty-index'), 'benchmark summary records empty-index coverage')
  assert.ok(benchmark.fallbackScenarioCoverage.includes('missing-model'), 'benchmark summary records missing-model coverage')
  assert.ok(benchmark.fallbackReasons.includes('provider-embedding-unavailable'), 'benchmark summary records provider embedding fallback')
  assert.ok(benchmark.fallbackReasons.includes('local-embedding-unavailable'), 'benchmark summary records local embedding fallback')
  assert.ok(benchmark.modeSummaries.agentic.averageRecall >= benchmark.modeSummaries.baseline.averageRecall, 'agentic summary recall stays at least baseline')

  runArchitectureContractSmoke({
    label: 'Agent RAG quality',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent RAG quality tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run, requiredRagCases }
