import {
  buildProviderFallbackDecisionEvent,
  classifyProviderFailure,
  retryAfterMsFromFailure,
  type ProviderFailoverDecision,
  type ProviderFailoverRoute,
  type ProviderFailureClassification,
  type ProviderFallbackCandidateBuildResult,
  type ProviderRuntimeChatRequest,
} from '@/modules/providers'
import {
  recordProviderRuntimeRouteFailure,
  recordProviderRuntimeRouteSuccess,
} from '@/bootstrap/providerRuntimeHealth'
import {
  runtimeLogOptions,
  type ProviderRuntimeRequestLogLike,
} from '@/bootstrap/providerRuntimeDiagnostics'
import { emitRuntimeEvent } from '@/services/runtimeEvents'

export interface ProviderRuntimeFallbackPlan {
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidates: ProviderFallbackCandidateBuildResult
}

export interface ProviderRuntimeFallbackEffects {
  logDecision(req: ProviderRuntimeChatRequest, plan: ProviderRuntimeFallbackPlan): Promise<void>
  recordRouteFailure(
    route: ProviderFailoverRoute,
    status: number,
    responseText: string,
    signal: AbortSignal,
    emptyResponse?: boolean,
  ): Promise<void>
  recordRouteSuccess(route: ProviderFailoverRoute, signal: AbortSignal): Promise<void>
}

export const providerRuntimeFallbackEffects: ProviderRuntimeFallbackEffects = {
  async recordRouteSuccess(route, signal) {
    if (signal.aborted) return
    await recordProviderRuntimeRouteSuccess(route)
  },

  async recordRouteFailure(route, status, responseText, signal, emptyResponse) {
    if (signal.aborted) return
    const classification = classifyProviderFailure({ status, errorMessage: responseText, emptyResponse })
    if (signal.aborted) return
    await recordProviderRuntimeRouteFailure(route, {
      status,
      responseText,
      trigger: classification.trigger,
      retryAfterMs: retryAfterMsFromFailure(status),
    })
  },

  async logDecision(req, plan) {
    await emitProviderRuntimeFallbackDecision(req, plan)
  },
}

async function emitProviderRuntimeFallbackDecision(
  req: ProviderRuntimeRequestLogLike,
  plan: Parameters<ProviderRuntimeFallbackEffects['logDecision']>[1],
): Promise<void> {
  const projection = buildProviderFallbackDecisionEvent({
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
  }, {
    classification: plan.classification,
    decision: plan.decision,
    candidateEvidence: plan.candidates.evidence,
    rejectedCandidates: plan.candidates.rejectedCandidates,
  })
  await emitRuntimeEvent({
    event: 'provider.fallback.decided',
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    data: { ...projection.data },
    legacyEvent: 'fallback.decision',
    legacyData: { ...projection.legacyData },
    options: runtimeLogOptions(req),
  })
}
