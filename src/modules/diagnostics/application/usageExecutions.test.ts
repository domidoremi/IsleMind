import type { UsageRecord, UsageRecordRepository } from '../contracts'
import { projectUsageRequests, projectUsageConversations } from './usageRequests'
import { summarizeUsageRecords, knownUsageTotal } from './usageSummary'
import { createUsageStatisticsService } from './usageStatistics'
import { createResponseUsageReceiptCache } from './responseUsageReceipts'

function attempt(id: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    schema: 'islemind.usage-record.v1', id, attemptIdentity: `wire-${id}`,
    occurredAt: 100, completedAt: 200, providerId: 'gateway', providerName: 'Gateway',
    requestedModel: 'auto', upstreamModel: 'auto', operationSource: 'chat',
    dataSource: 'live-provider', measurementSource: 'unavailable', status: 'limited',
    durationMs: 100, attempt: 0, attemptReason: 'initial', tokens: {}, costProvenance: 'unavailable',
    conversationId: 'conversation', correlationId: 'conversation',
    execution: { schema: 'islemind.request-execution.v1', logicalRequestId: 'call-a',
      responseExecutionId: 'reply-a', requestStartedAt: 50, messageId: 'message' },
    ...overrides,
  }
}

it('groups explicit calls and retains unlinked historical attempts despite a shared conversation correlation ID', () => {
  const rows = projectUsageRequests([
    attempt('first'), attempt('retry', { occurredAt: 250, completedAt: 300, attempt: 1, attemptReason: 'retry' }),
    attempt('continuation', { execution: { ...attempt('x').execution!, logicalRequestId: 'call-b', parentRequestId: 'call-a' } }),
    attempt('legacy-1', { execution: undefined }), attempt('legacy-2', { execution: undefined }),
  ])
  expect(rows).toHaveLength(4)
  expect(rows.find(row => row.reference.id === 'call-a')).toMatchObject({ attemptCount: 2, retryCount: 1 })
  expect(rows.filter(row => row.reference.kind === 'attempt').map(row => row.reference.id).sort()).toEqual(['legacy-1', 'legacy-2'])
  expect(projectUsageConversations([attempt('first'), attempt('second', { execution: undefined })])[0])
    .toMatchObject({ logicalRequestCount: 1, legacyAttemptCount: 1, requestCount: 2 })
})

it('keeps failed retry costs unknown and computes whole-call first text from the recorded request start', () => {
  const records = [
    attempt('first'),
    attempt('retry', { occurredAt: 250, completedAt: 350, attempt: 1, attemptReason: 'retry', retryCount: 1 }),
    attempt('fallback', { occurredAt: 500, completedAt: 1500, providerId: 'direct', providerName: 'Direct',
      requestedModel: 'chosen', upstreamModel: 'chosen', originalProviderId: 'gateway', originalModel: 'auto',
      status: 'success', attemptReason: 'fallback', durationMs: 1000, firstTokenMs: 400,
      tokens: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2, cachedInputTokens: 4 },
      totalCostNanodollars: 8760, costProvenance: 'price-table-estimate',
      reportedExecution: { model: 'reported-version', source: 'response.model' } }),
  ]
  expect(projectUsageRequests(records)[0]).toMatchObject({
    durationMs: 1450, firstVisibleTextMs: 850, retryCount: 1, failoverCount: 1, status: 'success',
    originalProviderId: 'gateway', requestedModel: 'chosen',
    summary: { requestCount: 3, logicalRequestCount: 1, totalTokens: 15, totalCostNanodollars: 8760,
      unknownCostCount: 2, tokenSampleCount: 1, firstTokenSampleCount: 1 },
  })
  expect(summarizeUsageRecords(records.slice(0, 2)).totalCostNanodollars).toBeUndefined()
  expect(summarizeUsageRecords(records.slice(0, 2)).totalTokens).toBeUndefined()
})

it('counts a fallback target once when its capacity recovery makes several attempts', () => {
  const fallback = attempt('fallback', { providerId: 'direct', requestedModel: 'chosen',
    originalProviderId: 'gateway', originalModel: 'auto', occurredAt: 250, completedAt: 300,
    attemptReason: 'fallback', failoverCount: 1 })
  const recovery = { ...fallback, id: 'recovery', attemptIdentity: 'recovery', occurredAt: 400, completedAt: 500,
    attempt: 1, attemptReason: 'rectification' as const }
  expect(projectUsageRequests([attempt('first'), fallback, recovery])[0]).toMatchObject({ failoverCount: 1, retryCount: 1 })
  expect(summarizeUsageRecords([fallback, recovery]).failoverCount).toBe(1)
})

it('deduplicates a known wire attempt without merging different requests or filling unknown token fields', () => {
  const earlier = attempt('early', { attemptIdentity: 'same-wire' })
  const completed = attempt('complete', { attemptIdentity: 'same-wire', completedAt: 300,
    tokens: { inputTokens: 0, outputTokens: 0 }, totalCostNanodollars: 0 })
  expect(summarizeUsageRecords([earlier, completed])).toMatchObject({
    requestCount: 1, totalTokens: 0, totalCostNanodollars: 0, costSampleCount: 1, unknownCostCount: 0,
  })
  expect(knownUsageTotal({ inputTokens: 10 })).toBeUndefined()
  expect(knownUsageTotal({ totalTokens: 12, inputTokens: 10, outputTokens: 2, reasoningTokens: 9 })).toBe(12)
  const overflow = summarizeUsageRecords([
    attempt('huge', { tokens: { totalTokens: Number.MAX_SAFE_INTEGER }, totalCostNanodollars: Number.MAX_SAFE_INTEGER }),
    attempt('one', { tokens: { totalTokens: 1 }, totalCostNanodollars: 1 }),
  ])
  expect(overflow.totalTokens).toBeUndefined()
  expect(overflow.totalCostNanodollars).toBeUndefined()
  expect(overflow.totalsOverflowed).toBe(true)
})

it('loads a response independently of list filters and pagination and preserves multiple calls', async () => {
  const records = [attempt('first'), attempt('tool', {
    operationSource: 'tool-continuation',
    execution: { ...attempt('x').execution!, logicalRequestId: 'call-b', parentRequestId: 'call-a' },
  })]
  const findExecution = jest.fn().mockResolvedValue({ records, truncated: true })
  const listAll = jest.fn()
  const service = createUsageStatisticsService({ findExecution, listAll } as unknown as UsageRecordRepository)
  const reference = { kind: 'response' as const, id: 'reply-a' }
  const detail = await service.detail(reference)
  expect(findExecution).toHaveBeenCalledWith(reference)
  expect(listAll).not.toHaveBeenCalled()
  expect(detail).toMatchObject({ truncated: true, summary: { logicalRequestCount: 2, requestCount: 2 } })
  expect(detail?.requests.map(row => row.reference.id).sort()).toEqual(['call-a', 'call-b'])
  findExecution.mockResolvedValueOnce({ records: [], truncated: false })
  await expect(service.detail({ kind: 'request', id: 'cleared' })).resolves.toBeUndefined()
})

it('exports explicit execution and pricing sources, protects formula-like names and leaves missing measurements empty', async () => {
  const records = [attempt('first', { providerName: '=SUM(A1)', upstreamModel: '@relay',
    reportedExecution: { model: 'explicit-model', source: 'response.modelVersion' } })]
  const service = createUsageStatisticsService({
    listAll: jest.fn().mockResolvedValue(records), listRollups: jest.fn().mockResolvedValue([]),
  } as unknown as UsageRecordRepository)
  const csv = await service.export({ conversationIds: ['conversation'] }, 'csv')
  expect(csv).toContain('logical_request_id,response_execution_id,parent_request_id,conversation_id,message_id')
  expect(csv).toContain("'=SUM(A1),'@relay,,,,")
  expect(csv).toContain('call-a,reply-a,,conversation,message,explicit-model,response.modelVersion,unavailable')
})

it('updates session receipts only after a successful durable append and clears all observers', async () => {
  const cache = createResponseUsageReceiptCache(2)
  const changed = jest.fn()
  const unsubscribe = cache.subscribe('reply-a', changed)
  const append = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('disk'))
  const service = createUsageStatisticsService({ append } as unknown as UsageRecordRepository, { recorded: value => cache.record(value) })
  const known = attempt('first', { costProvenance: 'supplier-known', totalCostNanodollars: 5 })
  await service.record(known)
  expect(cache.get('reply-a')).toBeUndefined()
  await service.record(known)
  expect(cache.get('reply-a')).toMatchObject({ totalCostNanodollars: 5, logicalRequestIds: ['call-a'] })
  await expect(service.record(known)).rejects.toThrow('disk')
  expect(changed).toHaveBeenCalledTimes(1)
  cache.clear()
  expect(changed).toHaveBeenCalledTimes(2)
  expect(cache.get('reply-a')).toBeUndefined()
  unsubscribe()
})

it('bounds response receipts and stops presenting a partial 501-attempt cache as complete', () => {
  const cache = createResponseUsageReceiptCache(1)
  cache.record(attempt('first'))
  cache.record(attempt('next', { execution: { ...attempt('x').execution!, responseExecutionId: 'reply-b' } }))
  expect(cache.get('reply-a')).toBeUndefined()
  for (let index = 0; index < 501; index += 1) cache.record(attempt(`wire-${index}`))
  expect(cache.get('reply-a')).toBeUndefined()
  cache.record(attempt('wire-0', { completedAt: 300 }))
  expect(cache.get('reply-a')).toBeUndefined()
})
