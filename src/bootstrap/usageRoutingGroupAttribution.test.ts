import { recordProviderUsageAttempt } from './usageStatisticsRuntime'
import type { UsageExecutionReference } from '@/core'

const mockRecord = jest.fn(async (..._args: unknown[]) => true)
jest.mock('@/modules/diagnostics', () => ({ ...jest.requireActual('@/modules/diagnostics'),
  createUsageStatisticsService: () => ({ record: (...args: unknown[]) => mockRecord(...args) }),
  createSqliteUsageRecordRepository: () => ({}), createSqliteUsagePortableSnapshotRepository: () => ({}),
}))
jest.mock('@/platform/storage', () => ({ createExpoSqliteDatabaseProvider: () => ({}) }))
jest.mock('@/bootstrap/conversationPersistence', () => ({ conversationPersistence: {} }))
jest.mock('./responseUsageReceipts', () => ({ responseUsageReceipts: {} }))

const execution: UsageExecutionReference = { schema: 'islemind.request-execution.v1', logicalRequestId: 'group-call', requestStartedAt: 1,
  routingPlan: { id: 'group', name: 'Group', primaryProviderId: 'a', primaryModel: 'shared-model', mode: 'group',
    selectedProviderId: 'b', selectedModel: 'shared-model' } }

beforeEach(() => mockRecord.mockClear())

it('records an ordinary group allocation through an alias without a failover', async () => {
  expect(await recordProviderUsageAttempt({ provider: { id: 'b', name: 'B', type: 'openai' }, upstreamModel: 'shared-model',
    requestedModel: 'alias', operationSource: 'chat', status: 'success', startedAt: 1, completedAt: 2,
    attempt: 0, attemptReason: 'initial', execution })).toBe(true)
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'b', requestedModel: 'alias', upstreamModel: 'shared-model',
    originalProviderId: 'b', originalModel: 'shared-model', failoverCount: 0, execution }), expect.anything())
})

it('records a later group fallback against the allocated member', async () => {
  expect(await recordProviderUsageAttempt({ provider: { id: 'c', name: 'C', type: 'openai' }, upstreamModel: 'shared-model',
    operationSource: 'chat', status: 'success', startedAt: 1, completedAt: 2, attempt: 1, attemptReason: 'fallback', execution })).toBe(true)
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'c', originalProviderId: 'b', failoverCount: 1 }), expect.anything())
})
