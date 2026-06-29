import type { ProviderFailoverDecision, ProviderFailoverRoute, ProviderFailureClassification } from '@/services/ai/providerFailover'
import { classifyProviderFailure } from '@/services/ai/providerFailover'
import { recordProviderRuntimeRouteFailure, recordProviderRuntimeRouteSuccess } from '@/services/ai/providerRuntimeHealth'
import { retryAfterMsFromFailure } from '@/services/ai/providerRuntimeFallback'
import { runtimeLogOptions, type ProviderRuntimeRequestLogLike } from '@/services/ai/providerRuntimeDiagnostics'
import { emitRuntimeEvent } from '@/services/runtimeEvents'

export interface RuntimeFallbackLogPlan {
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidates: {
    evidence: Record<string, unknown>
    rejectedCandidates: unknown[]
  }
}

export async function recordRuntimeFallbackSuccess(route: ProviderFailoverRoute): Promise<void> {
  await recordProviderRuntimeRouteSuccess(route)
}

export async function recordRuntimeFallbackFailure(route: ProviderFailoverRoute, status: number, responseText: string): Promise<void> {
  const classification = classifyProviderFailure({ status, errorMessage: responseText })
  await recordProviderRuntimeRouteFailure(route, {
    status,
    responseText,
    trigger: classification.trigger,
    retryAfterMs: retryAfterMsFromFailure(status),
  })
}

export async function logRuntimeFallbackDecision(req: ProviderRuntimeRequestLogLike, plan: RuntimeFallbackLogPlan): Promise<void> {
  const legacyData = {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    classification: plan.classification,
    decision: plan.decision,
    candidateEvidence: plan.candidates.evidence,
    rejectedCandidates: plan.candidates.rejectedCandidates,
  }
  await emitRuntimeEvent({
    event: 'provider.fallback.decided',
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    data: {
      requestedModel: req.requestedModel,
      classification: plan.classification,
      decision: plan.decision,
      candidateEvidence: plan.candidates.evidence,
      rejectedCandidateCount: plan.candidates.rejectedCandidates.length,
    },
    legacyEvent: 'fallback.decision',
    legacyData,
    options: runtimeLogOptions(req),
  })
}
