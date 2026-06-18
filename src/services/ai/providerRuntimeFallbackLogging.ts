import type { ProviderFailoverDecision, ProviderFailoverRoute, ProviderFailureClassification } from '@/services/ai/providerFailover'
import { classifyProviderFailure } from '@/services/ai/providerFailover'
import { recordProviderFailure, recordProviderSuccess } from '@/services/ai/providerHealth'
import { mergeProviderHealthRecords } from '@/services/ai/providerHealthStore'
import { retryAfterMsFromFailure } from '@/services/ai/providerRuntimeFallback'
import { runtimeLogOptions, type ProviderRuntimeRequestLogLike } from '@/services/ai/providerRuntimeDiagnostics'
import { appendRuntimeLog } from '@/services/runtimeLog'

export interface RuntimeFallbackLogPlan {
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidates: {
    evidence: Record<string, unknown>
    rejectedCandidates: unknown[]
  }
}

export async function recordRuntimeFallbackSuccess(route: ProviderFailoverRoute): Promise<void> {
  await mergeProviderHealthRecords([
    recordProviderSuccess(undefined, {
      key: route,
      nowMs: Date.now(),
    }),
  ])
}

export async function recordRuntimeFallbackFailure(route: ProviderFailoverRoute, status: number, responseText: string): Promise<void> {
  const classification = classifyProviderFailure({ status, errorMessage: responseText })
  await mergeProviderHealthRecords([
    recordProviderFailure(undefined, {
      key: route,
      trigger: classification.trigger,
      nowMs: Date.now(),
      retryAfterMs: retryAfterMsFromFailure(status),
    }),
  ])
}

export async function logRuntimeFallbackDecision(req: ProviderRuntimeRequestLogLike, plan: RuntimeFallbackLogPlan): Promise<void> {
  await appendRuntimeLog('fallback.decision', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    classification: plan.classification,
    decision: plan.decision,
    candidateEvidence: plan.candidates.evidence,
    rejectedCandidates: plan.candidates.rejectedCandidates,
  }, runtimeLogOptions(req))
}
