import type { ProcessTrace } from '@/core'

export interface WorkflowTaskEvidenceSummary {
  evidenceCount?: number
  acceptanceCheckCount?: number
  artifactReady: boolean
}

export function summarizeWorkflowTaskEvidence(traces: ProcessTrace[]): WorkflowTaskEvidenceSummary {
  let evidenceCount: number | undefined
  let acceptanceCheckCount: number | undefined
  let artifactReady = false

  for (const trace of traces) {
    const metadata = trace.metadata ?? {}
    evidenceCount = maxDefinedNumber(evidenceCount, readTraceNonNegativeNumber(metadata, 'evidenceCount'))
    evidenceCount = maxDefinedNumber(evidenceCount, readTraceNonNegativeNumber(metadata, 'sourceEvidenceCount'))
    evidenceCount = maxDefinedNumber(evidenceCount, readTraceNonNegativeNumber(metadata, 'evidenceSourceCount'))
    evidenceCount = maxDefinedNumber(evidenceCount, readTraceNonNegativeNumber(metadata, 'evidenceReliableSourceCount'))
    acceptanceCheckCount = maxDefinedNumber(acceptanceCheckCount, readTraceNonNegativeNumber(metadata, 'acceptanceCheckCount'))
    if (
      trace.status === 'done' &&
      (
        metadata.source === 'work-artifact' ||
        typeof metadata.workArtifactOutput !== 'undefined' ||
        typeof metadata.qualityAuditOk === 'boolean'
      )
    ) {
      artifactReady = true
    }
  }

  return { evidenceCount, acceptanceCheckCount, artifactReady }
}

function readTraceNonNegativeNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

function maxDefinedNumber(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current
  if (current === undefined) return next
  return Math.max(current, next)
}
