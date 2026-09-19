import { formatReportedTokens, reportedCacheTokens, reportedTotalTokens } from './usageTokenPresentation'

it('distinguishes missing measurements from measured zero', () => {
  expect(formatReportedTokens(undefined)).toBe('—')
  expect(formatReportedTokens(0)).toBe('0')
  expect(reportedTotalTokens({})).toBeUndefined()
  expect(reportedTotalTokens({ inputTokens: 4 })).toBeUndefined()
  expect(reportedCacheTokens({})).toBeUndefined()
  expect(reportedCacheTokens({ cacheReadInputTokens: 0 })).toBe(0)
})

it('preserves reported totals and does not double-count reasoning output', () => {
  expect(reportedTotalTokens({ inputTokens: 123456, outputTokens: 7890, reasoningTokens: 500 })).toBe(131346)
  expect(reportedTotalTokens({ totalTokens: 0, inputTokens: 10, outputTokens: 10 })).toBe(0)
  expect(formatReportedTokens(123456)).toBe((123456).toLocaleString())
})
