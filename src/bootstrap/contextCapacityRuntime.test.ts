import { loadContextCapacity } from './contextCapacityRuntime'
import { ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA } from '@/modules/assistant-runtime'
import type { AssistantContextPlanReceipt } from '@/modules/assistant-runtime'
import type { UsageRecord } from '@/modules/diagnostics'

const mockReadReceipt = jest.fn()
const mockReadUsage = jest.fn()
jest.mock('@/modules/assistant-runtime', () => ({
  ...jest.requireActual('@/modules/assistant-runtime'),
  createSqliteAssistantRunPersistence: () => ({ getLatestContextReceipt: (...args: unknown[]) => mockReadReceipt(...args) }),
}))
jest.mock('@/platform/storage', () => ({ createExpoSqliteDatabaseProvider: () => ({}) }))
jest.mock('./usageStatisticsRuntime', () => ({
  loadAssistantRunUsageAttempts: (...args: unknown[]) => mockReadUsage(...args),
}))

const receipt: AssistantContextPlanReceipt = {
  schema: ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA, providerId: 'connection', model: 'model',
  budget: { modelContextWindow: 4096, requestBudgetTokens: 2000, contextPromptTokens: 0, estimatedInputTokens: 200, fixedTokens: 100, messageTokens: 200, includedFragmentTokens: 300, originalFragmentTokens: 300, totalTokenCap: 2100, activeContextTokens: 300, tokensUntilCompaction: 1700 },
  compression: { triggered: false, strategy: 'none', triggerReason: 'disabled_or_unneeded', sourceMessageCount: 0, keptMessageCount: 0, sourceTokens: 0, compressedTokens: 0, estimatedSavedTokens: 0, compressionRatio: 0, summaryTokens: 0, summarySectionCount: 0 },
  sourceManifest: [], failureCodes: [],
}
const usage: UsageRecord = {
  schema: 'islemind.usage-record.v1', id: 'attempt', providerId: 'connection', providerName: 'Connection',
  requestedModel: 'model', upstreamModel: 'model', runId: 'run', conversationId: 'chat',
  occurredAt: 100, completedAt: 200, operationSource: 'chat', dataSource: 'live-provider',
  measurementSource: 'provider', status: 'success', durationMs: 100, attempt: 0, attemptReason: 'initial',
  tokens: { inputTokens: 321, outputTokens: 50 }, costProvenance: 'unavailable',
}
beforeEach(() => {
  mockReadReceipt.mockReset().mockResolvedValue({ runId: 'run', capturedAt: 100, receipt })
  mockReadUsage.mockReset().mockResolvedValue({ records: [usage], truncated: false })
})

it('keeps provider-reported input separate from the local plan estimate', async () => {
  const result = await loadContextCapacity('chat')
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw new Error('Expected a plan')
  expect(result.view.usedTokens).toBe(300)
  expect(result.reportedInput).toEqual({ attemptId: 'attempt', tokens: 321, recordedAt: 200 })
  expect(mockReadUsage).toHaveBeenCalledWith('run', 'connection')
})

it.each([
  { runId: 'other-run' }, { conversationId: 'other-chat' }, { providerId: 'other-connection' },
  { upstreamModel: 'other-model' }, { operationSource: 'tool-continuation' }, { status: 'failed' },
  { measurementSource: 'estimated' }, { dataSource: 'legacy-message' }, { tokens: {} },
  { tokens: { inputTokens: NaN } }, { tokens: { inputTokens: -1 } },
] as Partial<UsageRecord>[])('leaves missing or mismatched counters unknown: %j', async override => {
  mockReadUsage.mockResolvedValue({ records: [{ ...usage, ...override }], truncated: false })
  const result = await loadContextCapacity('chat')
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw new Error('Expected a plan')
  expect(result.reportedInput).toBeUndefined()
})

it('accepts an explicit zero, but does not choose one of several matching attempts', async () => {
  mockReadUsage.mockResolvedValue({ records: [{ ...usage, tokens: { inputTokens: 0 } }], truncated: false })
  expect(await loadContextCapacity('chat')).toMatchObject({ reportedInput: { tokens: 0 } })
  mockReadUsage.mockResolvedValue({ records: [usage, { ...usage, id: 'ambiguous' }], truncated: false })
  const result = await loadContextCapacity('chat')
  if (result.kind !== 'ready') throw new Error('Expected a plan')
  expect(result.reportedInput).toBeUndefined()
})

it('keeps the plan visible when optional usage storage fails', async () => {
  mockReadUsage.mockRejectedValue(new Error('unavailable'))
  expect(await loadContextCapacity('chat')).toMatchObject({ kind: 'ready', view: { model: 'model' } })
})

it('does not choose a counter from a truncated run ledger', async () => {
  mockReadUsage.mockResolvedValue({ records: [usage], truncated: true })
  const result = await loadContextCapacity('chat')
  if (result.kind !== 'ready') throw new Error('Expected a plan')
  expect(result.reportedInput).toBeUndefined()
})

it('skips storage for empty identity and usage reads for missing or unreadable receipts', async () => {
  expect(await loadContextCapacity('')).toEqual({ kind: 'empty' })
  expect(mockReadReceipt).not.toHaveBeenCalled()
  mockReadReceipt.mockResolvedValue(undefined)
  expect(await loadContextCapacity('chat')).toEqual({ kind: 'empty' })
  expect(mockReadUsage).not.toHaveBeenCalled()
  mockReadReceipt.mockRejectedValue(new Error('receipt failed'))
  expect(await loadContextCapacity('chat')).toEqual({ kind: 'unreadable' })
})
