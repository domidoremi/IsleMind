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
): Promise<RagEvaluationRun> {
  const run = await evaluateRagGoldSet(settings, conversation)
  await ragEvaluationRepository.log({
    query: 'islemind-rag-gold-set',
    quality: summarizeRagEvaluationRun(run),
    sourceCount: run.cases.reduce((sum, item) => sum + item.sourceCount, 0),
    fallbackReasons: run.fallbackReasons,
  })
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

export async function rebuildRagKnowledgeEmbeddings(options: KnowledgeIndexingOptions = {}): Promise<number> {
  const count = await rebuildKnowledgeEmbeddings(options)
  await clearKnowledgeIndexCaches()
  return count
}

export async function clearRagQueryCaches(): Promise<void> {
  await clearKnowledgeIndexCaches()
}
