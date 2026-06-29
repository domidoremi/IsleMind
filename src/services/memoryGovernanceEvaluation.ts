import type { MemorySourceKind, MemoryStatus } from '@/types'

export const MEMORY_GOVERNANCE_EVAL_SCHEMA = 'islemind.memory-governance-eval.v1'
export const MEMORY_GOVERNANCE_REFERENCE_STACKS = ['mem0', 'zep-graphiti', 'letta'] as const
export const MEMORY_GOVERNANCE_FIXTURE_IDS = [
  'manual-user-preference',
  'model-inferred-preference',
  'mem0-import-review',
  'conversation-summary-scope',
  'conflicting-preference',
  'knowledge-source-boundary',
  'provider-response-boundary',
  'deletion-request-path',
] as const

export type MemoryGovernanceReferenceStack = typeof MEMORY_GOVERNANCE_REFERENCE_STACKS[number]
export type MemoryGovernanceFixtureId = typeof MEMORY_GOVERNANCE_FIXTURE_IDS[number]
export type MemoryGovernanceScope = 'global-user' | 'conversation' | 'imported-external' | 'knowledge-document' | 'provider-response'
export type MemoryGovernanceRetentionClass = 'long-term' | 'review-required' | 'session' | 'knowledge-only' | 'none'
export type MemoryGovernanceRetrievalKind = 'memory' | 'knowledge' | 'provider-response' | 'generated-summary'
export type MemoryGovernanceAction = 'write-active' | 'write-pending-review' | 'reject-memory-write' | 'disable-memory'
export type MemoryGovernanceConflictPolicy = 'none' | 'review-required' | 'disable-existing' | 'auto-overwrite'
export type MemoryGovernanceDeletionPath = 'status-disabled' | 'hard-delete' | 'not-applicable'
export type MemoryGovernanceFailureCode =
  | 'missing-source-message'
  | 'missing-extracted-claim'
  | 'missing-confidence'
  | 'missing-retention-class'
  | 'missing-deletion-path'
  | 'unsafe-autonomous-write'
  | 'conflict-auto-overwrite'
  | 'retrieval-kind-drift'
  | 'imported-memory-active-by-default'
  | 'knowledge-promoted-to-memory'
  | 'provider-response-promoted-to-memory'

export interface MemoryGovernanceFixture {
  id: MemoryGovernanceFixtureId | string
  sourceMessageId?: string
  sourceText: string
  extractedClaim?: string
  sourceKind: MemorySourceKind
  scope: MemoryGovernanceScope
  retrievalKind: MemoryGovernanceRetrievalKind
  confidence?: number
  existingClaim?: string
  userConfirmed?: boolean
  deletionRequested?: boolean
  sourceDetail?: string
}

export interface MemoryGovernanceDiagnostic {
  fixtureId: string
  sourceMessageId?: string
  sourceKind: MemorySourceKind
  sourceDetail?: string
  scope: MemoryGovernanceScope
  retrievalKind: MemoryGovernanceRetrievalKind
  expectedRetrievalKind: MemoryGovernanceRetrievalKind
  extractedClaim?: string
  confidence?: number
  retentionClass: MemoryGovernanceRetentionClass
  status: MemoryStatus | 'not-written'
  action: MemoryGovernanceAction
  conflictDetected: boolean
  conflictPolicy: MemoryGovernanceConflictPolicy
  deletionPath: MemoryGovernanceDeletionPath
  userVisibleReview: boolean
  writeAllowed: boolean
  autonomousWrite: boolean
  failureCodes: MemoryGovernanceFailureCode[]
}

export interface MemoryGovernanceQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  referenceStacks: MemoryGovernanceReferenceStack[]
}

export interface MemoryGovernanceEvaluationRun {
  schema: typeof MEMORY_GOVERNANCE_EVAL_SCHEMA
  id: string
  ranAt: number
  referenceStacks: MemoryGovernanceReferenceStack[]
  diagnostics: MemoryGovernanceDiagnostic[]
  qualityGate: MemoryGovernanceQualityGate
}

export interface MemoryGovernanceEvaluationOptions {
  now?: () => number
  fixtures?: MemoryGovernanceFixture[]
  requiredFixtureIds?: string[]
}

export const MEMORY_GOVERNANCE_FIXTURES: MemoryGovernanceFixture[] = [
  {
    id: 'manual-user-preference',
    sourceMessageId: 'msg-user-1',
    sourceText: 'Remember that I prefer concise daily planning summaries.',
    extractedClaim: 'User prefers concise daily planning summaries.',
    sourceKind: 'manual',
    sourceDetail: 'explicit user memory command',
    scope: 'global-user',
    retrievalKind: 'memory',
    confidence: 1,
    userConfirmed: true,
  },
  {
    id: 'model-inferred-preference',
    sourceMessageId: 'msg-assistant-2',
    sourceText: 'The user asked twice for bilingual summaries, so infer a possible preference.',
    extractedClaim: 'User may prefer bilingual summaries.',
    sourceKind: 'model',
    sourceDetail: 'model-inferred from conversation pattern',
    scope: 'global-user',
    retrievalKind: 'memory',
    confidence: 0.54,
    userConfirmed: false,
  },
  {
    id: 'mem0-import-review',
    sourceMessageId: 'mem0-record-42',
    sourceText: 'Imported mem0 record says the user prefers local-first research notes.',
    extractedClaim: 'User prefers local-first research notes.',
    sourceKind: 'imported',
    sourceDetail: 'mem0:user_id=qa,app_id=islemind',
    scope: 'imported-external',
    retrievalKind: 'memory',
    confidence: 0.88,
    userConfirmed: false,
  },
  {
    id: 'conversation-summary-scope',
    sourceMessageId: 'summary-run-7',
    sourceText: 'Summarize the current conversation for continuation only.',
    extractedClaim: 'Current conversation is about provider compatibility planning.',
    sourceKind: 'deterministic',
    sourceDetail: 'conversation summary compact state',
    scope: 'conversation',
    retrievalKind: 'generated-summary',
    confidence: 0.74,
    userConfirmed: false,
  },
  {
    id: 'conflicting-preference',
    sourceMessageId: 'msg-assistant-9',
    sourceText: 'The user now may prefer long speculative reports.',
    extractedClaim: 'User may prefer long speculative reports.',
    existingClaim: 'User prefers concise daily planning summaries.',
    sourceKind: 'model',
    sourceDetail: 'model-inferred conflicting preference',
    scope: 'global-user',
    retrievalKind: 'memory',
    confidence: 0.48,
    userConfirmed: false,
  },
  {
    id: 'knowledge-source-boundary',
    sourceMessageId: 'knowledge-doc-3',
    sourceText: 'Imported project document says the release checklist requires provider smoke tests.',
    extractedClaim: 'Release checklist requires provider smoke tests.',
    sourceKind: 'imported',
    sourceDetail: 'knowledge document import',
    scope: 'knowledge-document',
    retrievalKind: 'knowledge',
    confidence: 0.91,
    userConfirmed: false,
  },
  {
    id: 'provider-response-boundary',
    sourceMessageId: 'provider-response-5',
    sourceText: 'The provider answered with a tentative claim about API pricing.',
    extractedClaim: 'Provider returned a tentative API pricing claim.',
    sourceKind: 'model',
    sourceDetail: 'provider response, not user memory',
    scope: 'provider-response',
    retrievalKind: 'provider-response',
    confidence: 0.52,
    userConfirmed: false,
  },
  {
    id: 'deletion-request-path',
    sourceMessageId: 'msg-user-delete-1',
    sourceText: 'Forget my previous preference about concise daily planning summaries.',
    extractedClaim: 'User requests deletion of concise daily planning preference.',
    existingClaim: 'User prefers concise daily planning summaries.',
    sourceKind: 'manual',
    sourceDetail: 'explicit user forget command',
    scope: 'global-user',
    retrievalKind: 'memory',
    confidence: 1,
    userConfirmed: true,
    deletionRequested: true,
  },
]

export function runMemoryGovernanceEvaluation(options: MemoryGovernanceEvaluationOptions = {}): MemoryGovernanceEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? MEMORY_GOVERNANCE_FIXTURES
  const diagnostics = fixtures.map(evaluateMemoryGovernanceFixture)
  return {
    schema: MEMORY_GOVERNANCE_EVAL_SCHEMA,
    id: `memory-governance-eval-${ranAt}`,
    ranAt,
    referenceStacks: [...MEMORY_GOVERNANCE_REFERENCE_STACKS],
    diagnostics,
    qualityGate: evaluateMemoryGovernanceQualityGate(diagnostics, options.requiredFixtureIds ?? [...MEMORY_GOVERNANCE_FIXTURE_IDS]),
  }
}

export function evaluateMemoryGovernanceFixture(fixture: MemoryGovernanceFixture): MemoryGovernanceDiagnostic {
  const conflictDetected = Boolean(fixture.existingClaim && fixture.extractedClaim && normalizeClaim(fixture.existingClaim) !== normalizeClaim(fixture.extractedClaim))
  const expectedRetrievalKind = expectedRetrievalKindForScope(fixture.scope)
  const failureCodes: MemoryGovernanceFailureCode[] = []
  const deletionPath = fixture.deletionRequested ? 'status-disabled' : 'not-applicable'
  const action = resolveAction(fixture, conflictDetected)
  const status = resolveStatus(action)
  const retentionClass = resolveRetentionClass(fixture, action)
  const conflictPolicy = resolveConflictPolicy(fixture, conflictDetected)
  const userVisibleReview = action === 'write-pending-review' || conflictPolicy === 'review-required'
  const writeAllowed = action === 'write-active' || action === 'write-pending-review'
  const autonomousWrite = writeAllowed && !fixture.userConfirmed && status === 'active'

  if (!fixture.sourceMessageId) failureCodes.push('missing-source-message')
  if (!fixture.extractedClaim) failureCodes.push('missing-extracted-claim')
  if (!Number.isFinite(fixture.confidence)) failureCodes.push('missing-confidence')
  if (!retentionClass) failureCodes.push('missing-retention-class')
  if (!deletionPath) failureCodes.push('missing-deletion-path')
  if (autonomousWrite) failureCodes.push('unsafe-autonomous-write')
  if (conflictPolicy === 'auto-overwrite') failureCodes.push('conflict-auto-overwrite')
  if (fixture.retrievalKind !== expectedRetrievalKind) failureCodes.push('retrieval-kind-drift')
  if (fixture.id === 'mem0-import-review' && status === 'active') failureCodes.push('imported-memory-active-by-default')
  if (fixture.scope === 'knowledge-document' && action !== 'reject-memory-write') failureCodes.push('knowledge-promoted-to-memory')
  if (fixture.scope === 'provider-response' && action !== 'reject-memory-write') failureCodes.push('provider-response-promoted-to-memory')

  return {
    fixtureId: fixture.id,
    sourceMessageId: fixture.sourceMessageId,
    sourceKind: fixture.sourceKind,
    sourceDetail: fixture.sourceDetail,
    scope: fixture.scope,
    retrievalKind: fixture.retrievalKind,
    expectedRetrievalKind,
    extractedClaim: fixture.extractedClaim,
    confidence: normalizeConfidence(fixture.confidence),
    retentionClass,
    status,
    action,
    conflictDetected,
    conflictPolicy,
    deletionPath,
    userVisibleReview,
    writeAllowed,
    autonomousWrite,
    failureCodes,
  }
}

export function evaluateMemoryGovernanceQualityGate(
  diagnostics: MemoryGovernanceDiagnostic[],
  requiredFixtureIds: string[] = [...MEMORY_GOVERNANCE_FIXTURE_IDS]
): MemoryGovernanceQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const item of diagnostics) {
    for (const code of item.failureCodes) failures.push(`${item.fixtureId}:${code}`)
    if (!item.sourceMessageId) failures.push(`${item.fixtureId}:source-message-required`)
    if (!item.extractedClaim) failures.push(`${item.fixtureId}:claim-required`)
    if (!Number.isFinite(item.confidence)) failures.push(`${item.fixtureId}:confidence-required`)
    if (item.deletionPath === 'not-applicable' && item.fixtureId === 'deletion-request-path') failures.push(`${item.fixtureId}:delete-path-required`)
  }

  const manual = byId.get('manual-user-preference')
  if (manual?.status !== 'active') failures.push('manual-user-preference:not-active')
  if (manual?.action !== 'write-active') failures.push('manual-user-preference:not-written')

  const inferred = byId.get('model-inferred-preference')
  if (inferred?.status !== 'pending') failures.push('model-inferred-preference:not-pending-review')
  if (inferred?.userVisibleReview !== true) failures.push('model-inferred-preference:review-not-visible')
  if (inferred?.autonomousWrite !== false) failures.push('model-inferred-preference:autonomous-write')

  const imported = byId.get('mem0-import-review')
  if (imported?.sourceKind !== 'imported') failures.push('mem0-import-review:not-imported')
  if (imported?.status !== 'pending') failures.push('mem0-import-review:not-pending')
  if (!imported?.sourceDetail?.startsWith('mem0:')) failures.push('mem0-import-review:missing-mem0-scope')

  const summary = byId.get('conversation-summary-scope')
  if (summary?.retentionClass !== 'session') failures.push('conversation-summary-scope:not-session-retained')
  if (summary?.retrievalKind !== 'generated-summary') failures.push('conversation-summary-scope:not-generated-summary')
  if (summary?.writeAllowed !== false) failures.push('conversation-summary-scope:written-as-memory')

  const conflict = byId.get('conflicting-preference')
  if (conflict?.conflictDetected !== true) failures.push('conflicting-preference:not-detected')
  if (conflict?.conflictPolicy !== 'review-required') failures.push('conflicting-preference:not-review-required')
  if (conflict?.status !== 'pending') failures.push('conflicting-preference:not-pending')

  const knowledge = byId.get('knowledge-source-boundary')
  if (knowledge?.retrievalKind !== 'knowledge') failures.push('knowledge-source-boundary:not-knowledge')
  if (knowledge?.writeAllowed !== false) failures.push('knowledge-source-boundary:promoted-to-memory')

  const provider = byId.get('provider-response-boundary')
  if (provider?.retrievalKind !== 'provider-response') failures.push('provider-response-boundary:not-provider-response')
  if (provider?.writeAllowed !== false) failures.push('provider-response-boundary:promoted-to-memory')

  const deletion = byId.get('deletion-request-path')
  if (deletion?.action !== 'disable-memory') failures.push('deletion-request-path:not-disable-action')
  if (deletion?.deletionPath !== 'status-disabled') failures.push('deletion-request-path:not-status-disabled')
  if (deletion?.status !== 'disabled') failures.push('deletion-request-path:not-disabled')

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    referenceStacks: [...MEMORY_GOVERNANCE_REFERENCE_STACKS],
  }
}

function resolveAction(fixture: MemoryGovernanceFixture, conflictDetected: boolean): MemoryGovernanceAction {
  if (fixture.deletionRequested) return 'disable-memory'
  if (fixture.scope === 'knowledge-document' || fixture.scope === 'provider-response' || fixture.scope === 'conversation') return 'reject-memory-write'
  if (fixture.userConfirmed && !conflictDetected) return 'write-active'
  return 'write-pending-review'
}

function resolveStatus(action: MemoryGovernanceAction): MemoryStatus | 'not-written' {
  if (action === 'write-active') return 'active'
  if (action === 'write-pending-review') return 'pending'
  if (action === 'disable-memory') return 'disabled'
  return 'not-written'
}

function resolveConflictPolicy(fixture: MemoryGovernanceFixture, conflictDetected: boolean): MemoryGovernanceConflictPolicy {
  if (!conflictDetected) return 'none'
  if (/auto-overwrite/i.test(fixture.sourceDetail ?? '')) return 'auto-overwrite'
  return fixture.userConfirmed ? 'disable-existing' : 'review-required'
}

function resolveRetentionClass(fixture: MemoryGovernanceFixture, action: MemoryGovernanceAction): MemoryGovernanceRetentionClass {
  if (fixture.deletionRequested) return 'none'
  if (fixture.scope === 'conversation') return 'session'
  if (fixture.scope === 'knowledge-document') return 'knowledge-only'
  if (fixture.scope === 'provider-response') return 'none'
  if (action === 'write-active') return 'long-term'
  return 'review-required'
}

function expectedRetrievalKindForScope(scope: MemoryGovernanceScope): MemoryGovernanceRetrievalKind {
  if (scope === 'knowledge-document') return 'knowledge'
  if (scope === 'provider-response') return 'provider-response'
  if (scope === 'conversation') return 'generated-summary'
  return 'memory'
}

function normalizeClaim(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function normalizeConfidence(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return undefined
  return Math.max(0, Math.min(1, Number(numeric.toFixed(3))))
}
