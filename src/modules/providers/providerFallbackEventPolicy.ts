import type { ProviderFailoverDecision, ProviderFailureClassification } from './providerFailoverPolicy'

const MAX_EVIDENCE_DEPTH = 4
const MAX_EVIDENCE_KEYS = 32
const MAX_EVIDENCE_ITEMS = 100
const MAX_EVIDENCE_TEXT_LENGTH = 512

export interface ProviderFallbackEventRequest {
  conversationId?: string
  providerId: string
  model: string
  requestedModel?: string
}

export interface ProviderFallbackEventPlan {
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidateEvidence: Record<string, unknown>
  rejectedCandidates: readonly unknown[]
}

export interface ProviderFallbackDecisionEventData {
  requestedModel?: string
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidateEvidence: Record<string, unknown>
  rejectedCandidateCount: number
}

export interface ProviderFallbackDecisionLegacyData {
  conversationId?: string
  providerId: string
  model: string
  requestedModel?: string
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidateEvidence: Record<string, unknown>
  rejectedCandidates: unknown[]
}

export interface ProviderFallbackDecisionEventProjection {
  data: ProviderFallbackDecisionEventData
  legacyData: ProviderFallbackDecisionLegacyData
}

export function buildProviderFallbackDecisionEvent(
  request: ProviderFallbackEventRequest,
  plan: ProviderFallbackEventPlan,
): ProviderFallbackDecisionEventProjection {
  const candidateEvidence = sanitizeRecord(plan.candidateEvidence)
  const rejectedCandidates = plan.rejectedCandidates
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((candidate) => sanitizeEvidence(candidate, 0))

  return {
    data: {
      requestedModel: request.requestedModel,
      classification: plan.classification,
      decision: plan.decision,
      candidateEvidence,
      rejectedCandidateCount: plan.rejectedCandidates.length,
    },
    legacyData: {
      conversationId: request.conversationId,
      providerId: request.providerId,
      model: request.model,
      requestedModel: request.requestedModel,
      classification: plan.classification,
      decision: plan.decision,
      candidateEvidence,
      rejectedCandidates,
    },
  }
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeEvidence(value, 0)
  return isRecord(sanitized) ? sanitized : {}
}

function sanitizeEvidence(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, MAX_EVIDENCE_TEXT_LENGTH)
  if (depth >= MAX_EVIDENCE_DEPTH) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_EVIDENCE_ITEMS).map((item) => sanitizeEvidence(item, depth + 1))
  }
  if (!isRecord(value)) return String(value).slice(0, MAX_EVIDENCE_TEXT_LENGTH)

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, MAX_EVIDENCE_KEYS)) {
    result[key] = isSensitiveEvidenceKey(key) ? '[redacted]' : sanitizeEvidence(item, depth + 1)
  }
  return result
}

function isSensitiveEvidenceKey(key: string): boolean {
  return /^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|secret|password|cookie)$/i.test(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
