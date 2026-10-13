import { agentActivityState, agentConfirmationExpiry, agentConfirmationPreview, agentEffectNeedsReview, agentEffectRows, agentRecoveryMode, agentRunTone } from './agentRunPresentation'
import { createModelOperationBatch, buildAssistantRequestHash, type AssistantRun } from '@/modules/assistant-runtime'
import type { ProcessTrace } from '@/core'

const call = { callId: 'call', operationId: 'write', declaredName: 'write', arguments: { path: 'draft' }, schemaRevision: 'v1', catalogRevision: 'catalog' }
function run(state: unknown): AssistantRun {
  return { status: 'awaiting-confirmation', pendingModelOperation: {
    operationId: 'write', callId: 'call', stepIndex: 0, continuationState: state,
  } } as AssistantRun
}

it('previews only the exact action and its bounded parameters, not replay or provider metadata', () => {
  const preview = agentConfirmationPreview(run({ call: { ...call, providerMetadata: { thoughtSignature: 'private-signature' } },
    reasoningReplay: ['private-reasoning'], continuationToken: 'private-token' }))
  expect(preview).toEqual({ operation: 'write', parameters: '{\n  "path": "draft"\n}' })
  expect(agentConfirmationPreview(run({ call: { ...call, operationId: 'other' } }))).toBeUndefined()
  expect(agentConfirmationPreview(run({ call: { ...call, arguments: { path: 'x'.repeat(16_000) } } }))).toBeUndefined()
})

it('shows the protected queue position and rejects drift', () => {
  const batch = createModelOperationBatch({ turnId: 'run', startStepIndex: 0, catalogRevision: 'catalog',
    requestHash: buildAssistantRequestHash({ request: 1 }), calls: [call, { ...call, callId: 'second' }], receipts: [], reasoningReplay: [] })
  expect(agentConfirmationPreview(run({ call, operationBatch: batch }))).toMatchObject({ position: 1, total: 2 })
  expect(agentConfirmationPreview(run({ call, operationBatch: { ...batch, digest: 'tampered' } }))).toBeUndefined()
})

it.each(['done', 'error', 'cancelled', 'skipped', 'pending'] as const)('does not settle a %s receipt from overall run success', status => {
  expect(agentActivityState({ status } as ProcessTrace, { status: 'succeeded' } as AssistantRun)).toBe(status === 'pending' ? 'notExecuted' : status)
})

it('an unresolved confirmation waits only while the run can still accept it', () => {
  const pending = { status: 'pending' } as ProcessTrace
  expect(agentActivityState(pending, { status: 'awaiting-confirmation' } as AssistantRun)).toBe('waiting')
  expect(agentActivityState(pending, { status: 'failed' } as AssistantRun)).toBe('notExecuted')
  expect(agentActivityState(pending, { status: 'cancelled' } as AssistantRun)).toBe('cancelled')
})

it('marks missing receipts as incomplete or uncertain, never completed', () => {
  const trace = { status: 'running' } as ProcessTrace
  expect(agentActivityState(trace, { status: 'succeeded' } as AssistantRun)).toBe('incomplete')
  expect(agentActivityState(trace, { status: 'cancelled', lifecycleCheckpoint: { effectCertainty: 'uncertain' } } as AssistantRun)).toBe('uncertain')
})

it('derives confirmation expiry from the durable request time', () => {
  const pending = { requestedAt: 1_000 } as NonNullable<AssistantRun['pendingModelOperation']>
  expect(agentConfirmationExpiry({ pendingModelOperation: pending } as AssistantRun, 1_000 + 15 * 60_000)).toEqual({ expiresAt: 1_000 + 15 * 60_000, expired: false })
  expect(agentConfirmationExpiry({ pendingModelOperation: pending } as AssistantRun, 1_001 + 15 * 60_000)?.expired).toBe(true)
  expect(agentConfirmationExpiry({} as AssistantRun, 1)).toBeUndefined()
})

it('never offers resume for unknown operation outcomes and never tones uncertainty as success', () => {
  const paused = (checkpoint: object) => ({ status: 'paused', lifecycleCheckpoint: checkpoint }) as AssistantRun
  expect(agentRecoveryMode(paused({ recovery: 'resumable', effectCertainty: 'settled' }))).toBe('resumable')
  expect(agentRecoveryMode(paused({ recovery: 'resumable', effectCertainty: 'uncertain' }))).toBe('reconciliation')
  expect(agentRecoveryMode(paused({ recovery: 'reconciliation-required', effectCertainty: 'uncertain' }))).toBe('reconciliation')
  expect(agentRecoveryMode({ status: 'succeeded' } as AssistantRun)).toBeUndefined()
  expect(agentRunTone({ status: 'cancelled', lifecycleCheckpoint: { effectCertainty: 'uncertain' } } as AssistantRun)).toBe('amber')
  expect(agentRunTone({ status: 'succeeded' } as AssistantRun)).toBe('mint')
  const entry = { state: 'succeeded', receipt: { effect: 'applied' } } as Parameters<typeof agentEffectNeedsReview>[0]
  expect(agentEffectNeedsReview(entry)).toBe(false)
  expect(agentEffectNeedsReview({ ...entry, receipt: { ...entry.receipt!, effect: 'partial' } })).toBe(true)
  expect(agentEffectNeedsReview({ ...entry, receipt: undefined, state: 'uncertain' })).toBe(true)
})

it('labels pre-dispatch rejections as not executed rather than executor failures', () => {
  const trace = (code: string) => ({ status: 'error', metadata: { code } }) as unknown as ProcessTrace
  expect(agentActivityState(trace('confirmation_expired'), { status: 'running' } as AssistantRun)).toBe('notExecuted')
  expect(agentActivityState(trace('authorization_denied'), { status: 'running' } as AssistantRun)).toBe('notExecuted')
  expect(agentActivityState(trace('execution_failed'), { status: 'running' } as AssistantRun)).toBe('error')
})

it('keeps the original parent visible when a move invalidates the source URI', () => {
  const entry = { intent: { sourceUri: 'content://p/tree/root/document/old', sourceParentUri: 'content://p/tree/root',
    targetParentUri: 'content://p/tree/target' } } as Parameters<typeof agentEffectRows>[0]
  expect(agentEffectRows(entry)).toContainEqual({ label: 'sourceParentUri', value: 'content://p/tree/root' })
})
