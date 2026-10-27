import type { Conversation } from '@/types/chatContracts'
import type { RagEvaluationLog, RagIndexingJobStatus } from '@/types/contextContracts'
import type { Settings } from '@/types/settingsContracts'
import {
  clearKnowledgeIndexCaches,
  knowledgeAgenticIndex,
  knowledgeHybridIndex,
  rebuildKnowledgeEmbeddings,
  type KnowledgeIndexingOptions,
} from './knowledgeRepository'
import { ragEvaluationRepository } from './ragEvaluationRepository'
import {
  evaluateRagGoldSet,
  summarizeRagEvaluationRun,
  type KnowledgeProviderEmbeddingJobRecord,
  type RagEvaluationRun,
  type KnowledgeDocumentClearOptions,
  type KnowledgeRepositoryOperationOptions,
} from '@/modules/knowledge'

export interface RagDebugSnapshot {
  evaluations: RagEvaluationLog[]
  indexingJobs: RagIndexingJobStatus[]
}

export interface RagEmbeddingJobSummary {
  total: number
  running: number
  error: number
  jobs: KnowledgeProviderEmbeddingJobRecord[]
}

export async function runRagGoldEvaluation(
  settings: Settings,
  conversation?: Partial<Conversation>,
  operation: KnowledgeRepositoryOperationOptions = {},
): Promise<RagEvaluationRun> {
  operation = { ...operation }
  throwIfRagDiagnosticCancelled(operation.signal)
  settings = { ...settings }
  conversation = conversation ? { ...conversation } : undefined
  const run = await evaluateRagGoldSet(settings, conversation, operation)
  throwIfRagDiagnosticCancelled(operation.signal)
  await ragEvaluationRepository.log({
    query: 'islemind-rag-gold-set',
    quality: summarizeRagEvaluationRun(run),
    sourceCount: run.cases.reduce((sum, item) => sum + item.sourceCount, 0),
    fallbackReasons: run.fallbackReasons,
  })
  throwIfRagDiagnosticCancelled(operation.signal)
  return run
}

export async function loadRagDebugSnapshot(): Promise<RagDebugSnapshot> {
  const [evaluations, indexingJobs] = await Promise.all([
    ragEvaluationRepository.list(8).then((items) => [...items]),
    knowledgeAgenticIndex.listJobs(24).then((jobs) => [...jobs]),
  ])
  return { evaluations, indexingJobs }
}

export async function listRagEmbeddingJobs(limit = 20): Promise<KnowledgeProviderEmbeddingJobRecord[]> {
  return [...await knowledgeHybridIndex.listEmbeddingJobs(limit)]
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

export async function rebuildRagKnowledgeEmbeddings(
  options: KnowledgeIndexingOptions = {},
  operation: KnowledgeDocumentClearOptions = {},
): Promise<number> {
  const count = await rebuildKnowledgeEmbeddings(options, operation)
  await clearKnowledgeIndexCaches()
  return count
}

export async function clearRagQueryCaches(operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
  operation = { ...operation }
  throwIfRagDiagnosticCancelled(operation.signal)
  await clearKnowledgeIndexCaches(operation)
  throwIfRagDiagnosticCancelled(operation.signal)
}

function throwIfRagDiagnosticCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('RAG diagnostic was cancelled.')
  error.name = 'AbortError'
  throw error
}
