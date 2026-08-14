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
  createConversationRagRuntime,
  runRagRetrievalBenchmark,
} = require('../src/modules/knowledge/index.ts')

const requiredRagCases = [
  'runWorkflow()',
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
    if (request === '@/bootstrap/localModelRuntime') {
      return {
        resolveActiveLocalEmbeddingModel: async () => null,
        markLocalEmbeddingModelFailure: async () => {},
      }
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

async function runConversationRagRuntimeAdapterChecks() {
  assert.equal(typeof createConversationRagRuntime, 'function', 'Knowledge public API exposes the conversation RAG runtime adapter')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/knowledge/application/conversationRagRuntime.ts')), true, 'the neutral conversation RAG runtime is present')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/knowledge/application/agentRagRuntime.ts')), false, 'the Agent-named Knowledge RAG runtime stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentRagRuntime.ts')), false, 'covered Agent RAG service stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/index.ts')), false, 'the obsolete Agent service barrel stays deleted')

  const settings = Object.freeze({
    language: 'en',
    ragMode: 'agentic',
    ragProfile: 'deep',
    ragQueryRewriteEnabled: true,
    ragHydeEnabled: true,
    ragFlareEnabled: true,
    ragRaptorEnabled: true,
    ragGraphEnabled: true,
    ragCrossEncoderEnabled: true,
    ragColbertEnabled: true,
    ragLlmlinguaEnabled: true,
  })
  const memorySource = Object.freeze({ id: 'memory-1', type: 'memory', title: 'Memory', content: 'Stable remembered evidence.' })
  const memorySources = Object.freeze([memorySource])
  const controller = new AbortController()
  const retrievalCalls = []
  let tick = 0
  const runtime = createConversationRagRuntime({
    settings,
    conversationTitle: 'Factory title',
    systemPrompt: 'Factory prompt',
    memorySources,
    retrieveKnowledge: async (query, limit, options) => {
      retrievalCalls.push({ kind: 'knowledge', query, limit, signal: options?.signal })
      return [{ id: `knowledge-${retrievalCalls.length}`, type: 'knowledge', title: 'Knowledge', content: 'Retrieved source evidence.' }]
    },
    retrieveAgentic: async (query, plan, limit, options) => {
      retrievalCalls.push({ kind: 'agentic', query, limit, signal: options?.signal, profile: plan.profile, profileReason: plan.profileReason })
      return [{ id: 'agentic-1', type: 'knowledge', title: 'Agentic', content: 'Agentic source evidence.' }]
    },
    now: () => 1940000000000 + tick++ * 7,
  })
  const request = Object.freeze({
    query: 'Which evidence is available?',
    conversationTitle: 'Request title',
    systemPrompt: 'Request prompt',
    profile: 'deep',
    profileReason: 'tool-request',
    tokenBudget: 900,
    maxContextItems: 3,
  })
  const pack = await runtime.buildContextPack(request, { signal: controller.signal })
  assert.ok(pack.sources.length > 0, 'Knowledge-owned conversation RAG adapter produces a runnable context pack')
  assert.ok(retrievalCalls.some((call) => call.kind === 'knowledge'), 'conversation RAG adapter invokes knowledge retrieval')
  assert.ok(retrievalCalls.some((call) => call.kind === 'agentic'), 'conversation RAG adapter invokes agentic retrieval')
  assert.ok(retrievalCalls.every((call) => call.signal === controller.signal), 'conversation RAG adapter propagates the exact cancellation signal to every retrieval callback')
  const agenticCall = retrievalCalls.find((call) => call.kind === 'agentic')
  assert.equal(agenticCall.profile, 'deep', 'conversation RAG adapter preserves the requested profile')
  assert.equal(agenticCall.profileReason, 'tool-request', 'conversation RAG adapter preserves the requested profile reason')
  assert.equal(pack.quality.tokenBudget, 900, 'conversation RAG adapter preserves the requested token budget')
  assert.deepEqual(request, {
    query: 'Which evidence is available?',
    conversationTitle: 'Request title',
    systemPrompt: 'Request prompt',
    profile: 'deep',
    profileReason: 'tool-request',
    tokenBudget: 900,
    maxContextItems: 3,
  }, 'conversation RAG adapter does not mutate the request')
  assert.deepEqual(memorySources, [memorySource], 'conversation RAG adapter does not mutate memory sources')

  const aborted = new AbortController()
  aborted.abort('cancel-rag-adapter')
  let cancelledRetrievalCalls = 0
  const cancelledRuntime = createConversationRagRuntime({
    settings,
    retrieveKnowledge: async () => {
      cancelledRetrievalCalls += 1
      return []
    },
  })
  await assert.rejects(
    () => cancelledRuntime.buildContextPack({ query: 'cancelled' }, { signal: aborted.signal }),
    (error) => error?.name === 'AbortError' && error?.message === 'RAG retrieval was cancelled.',
    'pre-aborted conversation RAG work fails with the established cancellation error',
  )
  assert.equal(cancelledRetrievalCalls, 0, 'pre-aborted conversation RAG work performs no retrieval')
}

async function run() {
  const conversationChatWorkflowRuntimeSource = fs.readFileSync(path.join(root, 'src/modules/tasks/application/conversationChatWorkflowRuntimePolicy.ts'), 'utf8')
  const providerToolRuntimeSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationProviderToolTurnRuntime.ts'), 'utf8')
  assert.ok(
    conversationChatWorkflowRuntimeSource.includes('retrieveContext(contextConversation, draftMessage, options?.signal)'),
    'Agent context retrieval propagates the exact task cancellation signal to the underlying knowledge operation'
  )
  assert.ok(
    providerToolRuntimeSource.includes('searchAgentKnowledge(') &&
      providerToolRuntimeSource.includes('options?.signal,') &&
      providerToolRuntimeSource.includes('searchAgenticKnowledgeWithScope({') &&
      providerToolRuntimeSource.includes('signal: options?.signal,'),
    'provider-native Chat RAG propagates the exact signal through both Knowledge retrieval paths'
  )
  assert.ok(requiredRagCases.includes('rag:context_pack'), 'agent RAG contract covers context pack traces')
  assert.ok(requiredRagCases.includes('evidence_insufficient'), 'agent RAG contract covers evidence repair gating')
  assert.ok(requiredRagCases.includes('fallbackReasons'), 'agent RAG contract covers fallback reason evidence')
  await runConversationRagRuntimeAdapterChecks()
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
