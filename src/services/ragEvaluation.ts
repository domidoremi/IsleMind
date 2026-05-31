import type { Conversation, RagEvaluationLog, RagEvaluationResult, RagIndexingJobStatus, RetrievalSource, Settings } from '@/types'
import { localDataStore, type EmbeddingJobStatus, type UpsertChunkOptions } from '@/services/localDataStore'
import { runAgenticRag, verifyRagGeneration } from '@/services/rag'

export interface RagGoldCase {
  id: string
  query: string
  evidence: RetrievalSource[]
  expectedTerms: string[]
}

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

const GOLD_CASES: RagGoldCase[] = [
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

export async function runRagGoldEvaluation(settings: Settings, conversation?: Partial<Conversation>): Promise<RagEvaluationRun> {
  const cases: RagCaseEvaluation[] = []
  for (const item of GOLD_CASES) {
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
