import type { KnowledgeDocument, RagIndexingJobStatus } from '@/types'

export interface KnowledgeRecoverySummary {
  failedDocuments: number
  emptyDocuments: number
  indexingDocuments: number
  failedJobs: number
  runningJobs: number
  recoverableDocuments: number
  lastError?: string
}

export function buildKnowledgeRecoverySummary(
  documents: KnowledgeDocument[],
  jobs: RagIndexingJobStatus[] = []
): KnowledgeRecoverySummary {
  const failed = documents.filter((document) => document.status === 'error')
  const empty = documents.filter((document) => document.status === 'ready' && document.chunkCount <= 0)
  const indexing = documents.filter((document) => document.status === 'extracting')
  const failedJobs = jobs.filter((job) => job.status === 'error')
  const runningJobs = jobs.filter((job) => job.status === 'running' || job.status === 'pending')
  const lastError = [
    failed[0]?.error,
    failedJobs[0]?.error,
  ].find((message): message is string => typeof message === 'string' && message.trim().length > 0)

  return {
    failedDocuments: failed.length,
    emptyDocuments: empty.length,
    indexingDocuments: indexing.length,
    failedJobs: failedJobs.length,
    runningJobs: runningJobs.length,
    recoverableDocuments: failed.length + empty.length,
    lastError,
  }
}
