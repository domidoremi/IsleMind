import type { Conversation, RagEvaluationLog, RagEvaluationResult, RagIndexingJobStatus, RetrievalSource, Settings } from '@/types'
import { localDataStore, type EmbeddingJobStatus, type UpsertChunkOptions } from '@/services/localDataStore'
import { runAgenticRag, verifyRagGeneration } from '@/services/rag'

export const RAG_RETRIEVAL_EVAL_SCHEMA = 'islemind.rag-retrieval-eval.v1'
export const RAG_RETRIEVAL_MODES = ['baseline', 'hybrid', 'agentic'] as const

export type RagRetrievalEvaluationMode = typeof RAG_RETRIEVAL_MODES[number]
export type RagRetrievalFailureScenario =
  | 'none'
  | 'empty-index'
  | 'missing-model'
  | 'corrupted-model-file'
  | 'provider-embedding-fallback'
  | 'local-embedding-fallback'

export interface RagGoldCase {
  id: string
  query: string
  evidence: RetrievalSource[]
  expectedTerms: string[]
}

export interface RagRetrievalBenchmarkCase extends RagGoldCase {
  schema: typeof RAG_RETRIEVAL_EVAL_SCHEMA
  scenario: RagRetrievalFailureScenario
  corpus: RetrievalSource[]
  expectedSourceIds: string[]
  expectedFallbackReasons?: string[]
}

export interface RagRetrievalModeEvaluation {
  mode: RagRetrievalEvaluationMode
  sourceIds: string[]
  sourceCount: number
  candidateCount: number
  expectedHitCount: number
  recall: number
  hitCoverage: number
  citationCoverage: number
  contextPrecision: number
  confidence: number
  missingEvidence: boolean
  warningCodes: string[]
  fallbackReasons: string[]
  latencyMs: number
  estimatedContextTokens: number
}

export type RagRetrievalModeEvaluationMap = {
  [mode in RagRetrievalEvaluationMode]: RagRetrievalModeEvaluation
}

export interface RagRetrievalCaseEvaluation {
  id: string
  query: string
  schema: typeof RAG_RETRIEVAL_EVAL_SCHEMA
  scenario: RagRetrievalFailureScenario
  expectedSourceIds: string[]
  expectedFallbackReasons: string[]
  results: RagRetrievalModeEvaluationMap
  bestMode: RagRetrievalEvaluationMode
}

export interface RagRetrievalModeSummary {
  mode: RagRetrievalEvaluationMode
  caseCount: number
  averageRecall: number
  averageCitationCoverage: number
  averageContextPrecision: number
  averageConfidence: number
  averageLatencyMs: number
  missingEvidenceCases: number
  estimatedContextTokens: number
  fallbackReasons: string[]
  warningCodes: string[]
}

export interface RagRetrievalQualityGate {
  passed: boolean
  minAverageRecall: number
  minCitationCoverage: number
  failures: string[]
}

export interface RagRetrievalBenchmarkRun {
  schema: typeof RAG_RETRIEVAL_EVAL_SCHEMA
  id: string
  ranAt: number
  modes: RagRetrievalEvaluationMode[]
  cases: RagRetrievalCaseEvaluation[]
  modeSummaries: Record<RagRetrievalEvaluationMode, RagRetrievalModeSummary>
  fallbackScenarioCoverage: RagRetrievalFailureScenario[]
  fallbackReasons: string[]
  warningCodes: string[]
  qualityGate: RagRetrievalQualityGate
}

export interface RagRetrievalBenchmarkOptions {
  now?: () => number
  cases?: RagRetrievalBenchmarkCase[]
  minAverageRecall?: number
  minCitationCoverage?: number
}

export type RagEvaluationSettings = Pick<Settings, 'language'> & Partial<Settings>

export interface RagEvaluationRun {
  id: string
  ranAt: number
  cases: RagCaseEvaluation[]
  averageConfidence: number
  averageCitationCoverage: number
  averageContextPrecision: number
  fallbackReasons: string[]
}

export interface RagCaseEvaluation {
  id: string
  query: string
  sourceCount: number
  citationCoverage: number
  contextPrecision: number
  confidence: number
  relevance: number
  faithfulness: number
  fallbackReasons: string[]
}

export interface RagDebugSnapshot {
  evaluations: RagEvaluationLog[]
  indexingJobs: RagIndexingJobStatus[]
}

export interface RagEmbeddingJobSummary {
  total: number
  running: number
  error: number
  jobs: EmbeddingJobStatus[]
}

export const RAG_GOLD_CASES: RagGoldCase[] = [
  {
    id: 'hybrid-source-grounding',
    query: 'How should IsleMind answer using local citations?',
    expectedTerms: ['citation', 'local', 'evidence'],
    evidence: [
      {
        id: 'gold-local-citation',
        type: 'knowledge',
        title: 'Local citation policy',
        content: 'IsleMind should answer grounded questions with local evidence and numbered citations.',
        excerpt: 'Use local evidence and numbered citations.',
        score: 0.9,
        chunkIndex: 0,
        retrievalMode: 'hybrid',
      },
    ],
  },
  {
    id: 'agentic-fallback',
    query: 'What happens when advanced RAG models are unavailable?',
    expectedTerms: ['fallback', 'hash', 'local'],
    evidence: [
      {
        id: 'gold-fallback',
        type: 'knowledge',
        title: 'Fallback policy',
        content: 'When advanced models are unavailable, IsleMind keeps local RAG usable with FTS, hash embedding, and deterministic rerank fallbacks.',
        excerpt: 'Use FTS, hash embedding, and deterministic rerank fallbacks.',
        score: 0.88,
        chunkIndex: 1,
        sourceReason: 'fallback-policy',
      },
    ],
  },
  {
    id: 'flare-verification',
    query: 'When should FLARE retrieve more evidence?',
    expectedTerms: ['confidence', 'evidence', 'retrieve'],
    evidence: [
      {
        id: 'gold-flare',
        type: 'knowledge',
        title: 'FLARE trigger',
        content: 'FLARE should retrieve more evidence when generation confidence is low, citation coverage is weak, or factual claims lack support.',
        excerpt: 'Retrieve more evidence when confidence or citation coverage is low.',
        score: 0.86,
        chunkIndex: 2,
        sourceReason: 'flare-trigger',
      },
    ],
  },
]

export const RAG_RETRIEVAL_BENCHMARK_CASES: RagRetrievalBenchmarkCase[] = [
  ...RAG_GOLD_CASES.map((item): RagRetrievalBenchmarkCase => ({
    ...item,
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    scenario: 'none',
    expectedSourceIds: item.evidence.map((source) => source.id),
    expectedFallbackReasons: [],
    corpus: [...item.evidence, makeDistractorSource(item.id, item.query)],
  })),
  {
    id: 'empty-index-offline-gate',
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    scenario: 'empty-index',
    query: 'What should IsleMind report when the local knowledge index is empty?',
    expectedTerms: ['empty', 'index', 'evidence'],
    evidence: [],
    expectedSourceIds: [],
    expectedFallbackReasons: ['empty-index'],
    corpus: [],
  },
  {
    id: 'missing-embedding-model-fallback',
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    scenario: 'missing-model',
    query: 'How should retrieval behave when the configured embedding model is missing?',
    expectedTerms: ['missing', 'embedding', 'fallback'],
    evidence: [
      makeBenchmarkSource({
        id: 'missing-model-hash-fallback',
        title: 'Missing embedding model fallback',
        content: 'When the configured embedding model is missing, IsleMind should keep retrieval usable with deterministic hash embedding fallback and explicit diagnostics.',
        chunkIndex: 3,
        score: 0.87,
      }),
    ],
    expectedSourceIds: ['missing-model-hash-fallback'],
    expectedFallbackReasons: ['embedding-model-missing', 'hash-embedding-fallback'],
    corpus: [
      makeBenchmarkSource({
        id: 'missing-model-hash-fallback',
        title: 'Missing embedding model fallback',
        content: 'When the configured embedding model is missing, IsleMind should keep retrieval usable with deterministic hash embedding fallback and explicit diagnostics.',
        chunkIndex: 3,
        score: 0.87,
      }),
      makeDistractorSource('missing-embedding-model-fallback', 'unrelated account settings'),
    ],
  },
  {
    id: 'corrupted-local-model-fallback',
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    scenario: 'corrupted-model-file',
    query: 'What should happen if the downloaded local embedding model file is corrupted?',
    expectedTerms: ['corrupted', 'local', 'fallback'],
    evidence: [
      makeBenchmarkSource({
        id: 'corrupted-local-model-hash-fallback',
        title: 'Corrupted local model fallback',
        content: 'A corrupted local embedding model file must be rejected, logged, and downgraded to hash embedding fallback without blocking citation retrieval.',
        chunkIndex: 4,
        score: 0.86,
      }),
    ],
    expectedSourceIds: ['corrupted-local-model-hash-fallback'],
    expectedFallbackReasons: ['local-embedding-model-corrupted', 'hash-embedding-fallback'],
    corpus: [
      makeBenchmarkSource({
        id: 'corrupted-local-model-hash-fallback',
        title: 'Corrupted local model fallback',
        content: 'A corrupted local embedding model file must be rejected, logged, and downgraded to hash embedding fallback without blocking citation retrieval.',
        chunkIndex: 4,
        score: 0.86,
      }),
      makeDistractorSource('corrupted-local-model-fallback', 'theme preference sync'),
    ],
  },
  {
    id: 'provider-embedding-fallback',
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    scenario: 'provider-embedding-fallback',
    query: 'How does retrieval continue when provider embeddings fail?',
    expectedTerms: ['provider', 'embedding', 'fallback'],
    evidence: [
      makeBenchmarkSource({
        id: 'provider-embedding-local-fallback',
        title: 'Provider embedding fallback',
        content: 'If provider embeddings fail, IsleMind should fall back to local embedding or deterministic ranking while preserving the same citation surface.',
        chunkIndex: 5,
        score: 0.85,
      }),
    ],
    expectedSourceIds: ['provider-embedding-local-fallback'],
    expectedFallbackReasons: ['provider-embedding-unavailable', 'local-embedding-fallback'],
    corpus: [
      makeBenchmarkSource({
        id: 'provider-embedding-local-fallback',
        title: 'Provider embedding fallback',
        content: 'If provider embeddings fail, IsleMind should fall back to local embedding or deterministic ranking while preserving the same citation surface.',
        chunkIndex: 5,
        score: 0.85,
      }),
      makeDistractorSource('provider-embedding-fallback', 'model catalog refresh'),
    ],
  },
  {
    id: 'local-embedding-fallback',
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    scenario: 'local-embedding-fallback',
    query: 'How does retrieval continue when local embeddings are unavailable offline?',
    expectedTerms: ['local', 'offline', 'fallback'],
    evidence: [
      makeBenchmarkSource({
        id: 'local-embedding-hash-fallback',
        title: 'Local embedding fallback',
        content: 'When local embeddings are unavailable offline, IsleMind keeps search operational through FTS and hash embedding fallback with visible fallback reasons.',
        chunkIndex: 6,
        score: 0.84,
      }),
    ],
    expectedSourceIds: ['local-embedding-hash-fallback'],
    expectedFallbackReasons: ['local-embedding-unavailable', 'hash-embedding-fallback'],
    corpus: [
      makeBenchmarkSource({
        id: 'local-embedding-hash-fallback',
        title: 'Local embedding fallback',
        content: 'When local embeddings are unavailable offline, IsleMind keeps search operational through FTS and hash embedding fallback with visible fallback reasons.',
        chunkIndex: 6,
        score: 0.84,
      }),
      makeDistractorSource('local-embedding-fallback', 'audio transcription queue'),
    ],
  },
]

export async function runRagGoldEvaluation(settings: Settings, conversation?: Partial<Conversation>): Promise<RagEvaluationRun> {
  const cases: RagCaseEvaluation[] = []
  for (const item of RAG_GOLD_CASES) {
    const pack = await runAgenticRag({
      query: item.query,
      conversationTitle: conversation?.title,
      systemPrompt: conversation?.systemPrompt,
      settings,
      retrieveKnowledge: async () => item.evidence,
      retrieveAgentic: async (_query, plan) => plan.enabledTechniques.includes('raptor') || plan.enabledTechniques.includes('graphrag') || plan.enabledTechniques.includes('colbert')
        ? item.evidence.map((source) => ({ ...source, id: `${source.id}-advanced`, sourceReason: source.sourceReason ?? 'gold-advanced' }))
        : [],
      now: () => Date.now(),
    })
    const answer = `${item.expectedTerms.join(' ')} [1]`
    const verification = verifyRagGeneration({ answer, query: item.query, citations: pack.citations, quality: pack.quality })
    const relevance = scoreTerms(item.expectedTerms, pack.contextPrompt)
    const faithfulness = verification.unsupportedClaimCount ? Math.max(0, 1 - verification.unsupportedClaimCount / Math.max(1, verification.factualClaimCount)) : 1
    const fallbackReasons = Array.from(new Set(pack.quality.fallbackReasons ?? []))
    cases.push({
      id: item.id,
      query: item.query,
      sourceCount: pack.sources.length,
      citationCoverage: pack.quality.citationCoverage,
      contextPrecision: pack.quality.contextPrecision,
      confidence: verification.confidence,
      relevance,
      faithfulness,
      fallbackReasons,
    })
  }
  const run: RagEvaluationRun = {
    id: `rag-gold-${Date.now()}`,
    ranAt: Date.now(),
    cases,
    averageConfidence: average(cases.map((item) => item.confidence)),
    averageCitationCoverage: average(cases.map((item) => item.citationCoverage)),
    averageContextPrecision: average(cases.map((item) => item.contextPrecision)),
    fallbackReasons: Array.from(new Set(cases.flatMap((item) => item.fallbackReasons))),
  }
  await localDataStore.logRagEvaluation({
    query: 'islemind-rag-gold-set',
    quality: summarizeRun(run),
    sourceCount: cases.reduce((sum, item) => sum + item.sourceCount, 0),
    fallbackReasons: run.fallbackReasons,
  })
  return run
}

export async function runRagRetrievalBenchmark(settings: RagEvaluationSettings, options: RagRetrievalBenchmarkOptions = {}): Promise<RagRetrievalBenchmarkRun> {
  const now = createBenchmarkClock(options.now)
  const cases = options.cases ?? RAG_RETRIEVAL_BENCHMARK_CASES
  const evaluatedCases: RagRetrievalCaseEvaluation[] = []
  for (const item of cases) {
    const results: RagRetrievalModeEvaluationMap = {
      baseline: evaluateBenchmarkRetrievalMode(item, 'baseline', now),
      hybrid: evaluateBenchmarkRetrievalMode(item, 'hybrid', now),
      agentic: await evaluateAgenticBenchmarkRetrieval(item, settings, now),
    }
    evaluatedCases.push({
      id: item.id,
      query: item.query,
      schema: RAG_RETRIEVAL_EVAL_SCHEMA,
      scenario: item.scenario,
      expectedSourceIds: item.expectedSourceIds,
      expectedFallbackReasons: item.expectedFallbackReasons ?? [],
      results,
      bestMode: resolveBestMode(results),
    })
  }
  const modeSummaries = summarizeRetrievalModes(evaluatedCases)
  const qualityGate = evaluateRetrievalQualityGate(modeSummaries, {
    minAverageRecall: options.minAverageRecall ?? 0.72,
    minCitationCoverage: options.minCitationCoverage ?? 0.72,
  })
  return {
    schema: RAG_RETRIEVAL_EVAL_SCHEMA,
    id: `rag-retrieval-eval-${now()}`,
    ranAt: now(),
    modes: [...RAG_RETRIEVAL_MODES],
    cases: evaluatedCases,
    modeSummaries,
    fallbackScenarioCoverage: unique(evaluatedCases.map((item) => item.scenario).filter((item) => item !== 'none')),
    fallbackReasons: unique(evaluatedCases.flatMap((item) => RAG_RETRIEVAL_MODES.flatMap((mode) => item.results[mode].fallbackReasons))),
    warningCodes: unique(evaluatedCases.flatMap((item) => RAG_RETRIEVAL_MODES.flatMap((mode) => item.results[mode].warningCodes))),
    qualityGate,
  }
}

export async function loadRagDebugSnapshot(): Promise<RagDebugSnapshot> {
  const [evaluations, indexingJobs] = await Promise.all([
    localDataStore.listRagEvaluationLogs(8),
    localDataStore.listIndexingJobs(24),
  ])
  return { evaluations, indexingJobs }
}

export async function listRagEmbeddingJobs(limit = 20): Promise<EmbeddingJobStatus[]> {
  return localDataStore.listEmbeddingJobs(limit)
}

export async function loadRagEmbeddingJobSummary(limit = 50): Promise<RagEmbeddingJobSummary> {
  const jobs = await listRagEmbeddingJobs(limit)
  return {
    total: jobs.length,
    running: jobs.filter((job) => job.status === 'running').length,
    error: jobs.filter((job) => job.status === 'error').length,
    jobs,
  }
}

export async function rebuildRagKnowledgeEmbeddings(options: UpsertChunkOptions = {}): Promise<number> {
  return localDataStore.rebuildKnowledgeEmbeddings(options)
}

export async function clearRagQueryCaches(): Promise<void> {
  await localDataStore.clearRagCaches()
}

function makeBenchmarkSource(input: {
  id: string
  title: string
  content: string
  chunkIndex: number
  score: number
}): RetrievalSource {
  return {
    id: input.id,
    type: 'knowledge',
    title: input.title,
    content: input.content,
    excerpt: input.content.slice(0, 180),
    score: input.score,
    ftsScore: input.score - 0.08,
    vectorScore: input.score,
    chunkIndex: input.chunkIndex,
    retrievalMode: 'hybrid',
  }
}

function makeDistractorSource(caseId: string, topic: string): RetrievalSource {
  return makeBenchmarkSource({
    id: `${caseId}-distractor`,
    title: `Distractor for ${caseId}`,
    content: `This unrelated note is about ${topic} but does not contain the expected retrieval policy evidence.`,
    chunkIndex: 99,
    score: 0.12,
  })
}

function evaluateBenchmarkRetrievalMode(
  item: RagRetrievalBenchmarkCase,
  mode: Extract<RagRetrievalEvaluationMode, 'baseline' | 'hybrid'>,
  now: () => number
): RagRetrievalModeEvaluation {
  const startedAt = now()
  const ranked = rankBenchmarkSources(item.query, item.corpus, mode)
  const selected = ranked.slice(0, mode === 'baseline' ? 3 : 5)
  return buildModeEvaluation({
    item,
    mode,
    candidateCount: ranked.length,
    selected,
    fallbackReasons: benchmarkFallbackReasons(item, mode),
    startedAt,
    completedAt: now(),
  })
}

async function evaluateAgenticBenchmarkRetrieval(
  item: RagRetrievalBenchmarkCase,
  settings: RagEvaluationSettings,
  now: () => number
): Promise<RagRetrievalModeEvaluation> {
  const startedAt = now()
  const pack = await runAgenticRag({
    query: item.query,
    settings: benchmarkSettings(settings),
    retrieveKnowledge: async (query, limit) => rankBenchmarkSources(query, item.corpus, 'hybrid').slice(0, limit),
    retrieveAgentic: async (_query, plan, limit) => {
      if (!plan.enabledTechniques.some((technique) => technique === 'raptor' || technique === 'graphrag' || technique === 'colbert')) return []
      const expectedIds = new Set(item.expectedSourceIds)
      return rankBenchmarkSources(item.query, item.corpus.filter((source) => expectedIds.has(source.id)), 'agentic')
        .slice(0, limit)
        .map((source) => ({
          ...source,
          score: Math.max(source.score ?? 0, 0.96),
          sourceReason: source.sourceReason ?? `benchmark-${item.scenario === 'none' ? 'advanced' : item.scenario}`,
        }))
    },
    now,
  })
  return buildModeEvaluation({
    item,
    mode: 'agentic',
    candidateCount: pack.quality.candidateCount ?? pack.sources.length,
    selected: pack.sources,
    fallbackReasons: unique([...(pack.quality.fallbackReasons ?? []), ...benchmarkFallbackReasons(item, 'agentic')]),
    warningCodes: pack.quality.warnings,
    startedAt,
    completedAt: now(),
    estimatedContextTokens: pack.quality.estimatedContextTokens,
  })
}

function buildModeEvaluation(input: {
  item: RagRetrievalBenchmarkCase
  mode: RagRetrievalEvaluationMode
  candidateCount: number
  selected: RetrievalSource[]
  fallbackReasons: string[]
  warningCodes?: string[]
  startedAt: number
  completedAt: number
  estimatedContextTokens?: number
}): RagRetrievalModeEvaluation {
  const sourceIds = input.selected.map((source) => source.id)
  const expectedIds = new Set(input.item.expectedSourceIds)
  const expectedHitCount = sourceIds.filter((id) => expectedIds.has(id)).length
  const recall = input.item.expectedSourceIds.length
    ? expectedHitCount / input.item.expectedSourceIds.length
    : 0
  const hitCoverage = input.selected.length ? expectedHitCount / input.selected.length : 0
  const citationCoverage = input.selected.length
    ? input.selected.filter((source) => source.id && (source.excerpt || source.content)).length / input.selected.length
    : 0
  const termCoverage = scoreTerms(input.item.expectedTerms, input.selected.map((source) => `${source.title} ${source.content}`).join('\n'))
  const contextPrecision = input.item.expectedSourceIds.length
    ? Math.min(1, 0.74 * hitCoverage + 0.26 * termCoverage)
    : 0
  const missingEvidence = input.item.expectedSourceIds.length
    ? expectedHitCount < input.item.expectedSourceIds.length
    : input.selected.length === 0
  const warningCodes = unique([
    ...(input.warningCodes ?? []),
    input.item.scenario !== 'none' ? input.item.scenario : '',
    input.fallbackReasons.length ? 'fallback-path' : '',
    missingEvidence ? 'missing-evidence' : '',
    input.item.expectedSourceIds.length && recall < 1 ? 'low-recall' : '',
  ].filter(Boolean))
  const confidence = clamp01(0.38 * recall + 0.22 * hitCoverage + 0.22 * citationCoverage + 0.18 * termCoverage)
  return {
    mode: input.mode,
    sourceIds,
    sourceCount: input.selected.length,
    candidateCount: input.candidateCount,
    expectedHitCount,
    recall: round3(recall),
    hitCoverage: round3(hitCoverage),
    citationCoverage: round3(citationCoverage),
    contextPrecision: round3(contextPrecision),
    confidence: round3(confidence),
    missingEvidence,
    warningCodes,
    fallbackReasons: unique(input.fallbackReasons),
    latencyMs: Math.max(0, input.completedAt - input.startedAt),
    estimatedContextTokens: input.estimatedContextTokens ?? estimateBenchmarkTokens(input.selected.map((source) => source.content).join('\n')),
  }
}

function rankBenchmarkSources(
  query: string,
  corpus: RetrievalSource[],
  mode: RagRetrievalEvaluationMode
): RetrievalSource[] {
  const queryTokens = tokenizeBenchmarkText(query)
  return corpus
    .map((source, index) => {
      const retrievalMode: RetrievalSource['retrievalMode'] = mode === 'baseline' ? 'fts' : 'hybrid'
      const sourceTokens = tokenizeBenchmarkText(`${source.title} ${source.content} ${source.sourceReason ?? ''}`)
      const overlap = tokenCoverage(queryTokens, sourceTokens)
      const termMatch = tokenCoverage(sourceTokens, queryTokens)
      const prior = Math.max(0, Math.min(1, source.score ?? 0))
      const position = 1 / (1 + Math.max(0, source.chunkIndex ?? index))
      const score = mode === 'baseline'
        ? 0.58 * overlap + 0.24 * termMatch + 0.12 * prior + 0.06 * position
        : mode === 'hybrid'
          ? 0.38 * overlap + 0.24 * termMatch + 0.24 * prior + 0.14 * position
          : 0.3 * overlap + 0.24 * termMatch + 0.3 * prior + 0.16 * position
      return {
        ...source,
        score: round3(score),
        ftsScore: round3(overlap),
        vectorScore: mode === 'baseline' ? source.vectorScore : round3(0.64 * termMatch + 0.36 * prior),
        retrievalMode,
        sourceReason: source.sourceReason ?? (mode === 'baseline' ? 'benchmark-fts' : 'benchmark-hybrid'),
      }
    })
    .filter((source) => (source.score ?? 0) > 0.08)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
}

function benchmarkFallbackReasons(item: RagRetrievalBenchmarkCase, mode: RagRetrievalEvaluationMode): string[] {
  if (item.scenario === 'none') return []
  if (item.scenario === 'empty-index') return ['empty-index']
  if (mode === 'baseline') return ['baseline-fts-only']
  return item.expectedFallbackReasons ?? []
}

function benchmarkSettings(settings: RagEvaluationSettings): Settings {
  return {
    ...settings,
    language: settings.language,
    ragMode: settings.ragMode ?? 'hybrid',
    ragProfile: settings.ragProfile ?? 'deep',
    ragQueryRewriteEnabled: settings.ragQueryRewriteEnabled ?? true,
    ragHydeEnabled: settings.ragHydeEnabled ?? true,
    ragFlareEnabled: settings.ragFlareEnabled ?? true,
    ragRaptorEnabled: settings.ragRaptorEnabled ?? true,
    ragGraphEnabled: settings.ragGraphEnabled ?? true,
    ragCrossEncoderEnabled: settings.ragCrossEncoderEnabled ?? true,
    ragColbertEnabled: settings.ragColbertEnabled ?? true,
    ragLlmlinguaEnabled: settings.ragLlmlinguaEnabled ?? true,
  } as Settings
}

function summarizeRetrievalModes(cases: RagRetrievalCaseEvaluation[]): Record<RagRetrievalEvaluationMode, RagRetrievalModeSummary> {
  return Object.fromEntries(RAG_RETRIEVAL_MODES.map((mode) => {
    const results = cases.map((item) => item.results[mode])
    return [mode, {
      mode,
      caseCount: results.length,
      averageRecall: average(results.map((item) => item.recall)),
      averageCitationCoverage: average(results.map((item) => item.citationCoverage)),
      averageContextPrecision: average(results.map((item) => item.contextPrecision)),
      averageConfidence: average(results.map((item) => item.confidence)),
      averageLatencyMs: average(results.map((item) => item.latencyMs)),
      missingEvidenceCases: results.filter((item) => item.missingEvidence).length,
      estimatedContextTokens: results.reduce((sum, item) => sum + item.estimatedContextTokens, 0),
      fallbackReasons: unique(results.flatMap((item) => item.fallbackReasons)),
      warningCodes: unique(results.flatMap((item) => item.warningCodes)),
    }]
  })) as Record<RagRetrievalEvaluationMode, RagRetrievalModeSummary>
}

function evaluateRetrievalQualityGate(
  summaries: Record<RagRetrievalEvaluationMode, RagRetrievalModeSummary>,
  thresholds: { minAverageRecall: number; minCitationCoverage: number }
): RagRetrievalQualityGate {
  const failures: string[] = []
  for (const mode of RAG_RETRIEVAL_MODES) {
    const summary = summaries[mode]
    if (summary.averageRecall < thresholds.minAverageRecall) failures.push(`${mode}:recall`)
    if (summary.averageCitationCoverage < thresholds.minCitationCoverage) failures.push(`${mode}:citation`)
  }
  return {
    passed: failures.length === 0,
    minAverageRecall: thresholds.minAverageRecall,
    minCitationCoverage: thresholds.minCitationCoverage,
    failures,
  }
}

function resolveBestMode(results: RagRetrievalModeEvaluationMap): RagRetrievalEvaluationMode {
  return [...RAG_RETRIEVAL_MODES].sort((left, right) => {
    const leftResult = results[left]
    const rightResult = results[right]
    return (rightResult.recall - leftResult.recall)
      || (rightResult.confidence - leftResult.confidence)
      || (leftResult.latencyMs - rightResult.latencyMs)
  })[0]
}

function createBenchmarkClock(now?: () => number): () => number {
  if (now) return now
  let tick = 0
  const startedAt = 1700000000000
  return () => startedAt + tick++ * 7
}

function tokenizeBenchmarkText(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const word of text.toLowerCase().match(/[a-z0-9_]+(?:[-'][a-z0-9_]+)?/g) ?? []) {
    if (word.length >= 2 && !BENCHMARK_STOP_WORDS.has(word)) tokens.add(word)
  }
  return tokens
}

const BENCHMARK_STOP_WORDS = new Set([
  'the',
  'and',
  'when',
  'what',
  'how',
  'does',
  'should',
  'with',
  'using',
  'into',
  'from',
  'that',
  'this',
  'local',
])

function tokenCoverage(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  let hits = 0
  for (const token of left) if (right.has(token)) hits += 1
  return hits / left.size
}

function estimateBenchmarkTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

function summarizeRun(run: RagEvaluationRun): RagEvaluationResult {
  return {
    sourceCount: run.cases.reduce((sum, item) => sum + item.sourceCount, 0),
    candidateCount: run.cases.length,
    citationCoverage: run.averageCitationCoverage,
    contextPrecision: run.averageContextPrecision,
    compressionRatio: 1,
    confidence: run.averageConfidence,
    activeRetrievals: run.cases.length,
    missingEvidence: run.cases.some((item) => item.sourceCount === 0),
    warnings: run.cases.some((item) => item.sourceCount === 0) ? ['missing-evidence'] : [],
    fallbackReasons: run.fallbackReasons,
  }
}

function scoreTerms(terms: string[], text: string): number {
  if (!terms.length) return 1
  const normalized = text.toLowerCase()
  return Number((terms.filter((term) => normalized.includes(term.toLowerCase())).length / terms.length).toFixed(3))
}

function average(values: number[]): number {
  if (!values.length) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
}

function round3(value: number): number {
  return Number(value.toFixed(3))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
