import { createRunBudget, DEFAULT_RUN_BUDGET, reserveRunAttempt, reserveRunTool, runBudgetTotals, setRunBudgetActive, settleRunAttempt } from './runBudget'

const reserve = (attemptId: string, runId = 'root') => ({ attemptId, runId, inputEstimate: 100, outputReservation: 200 })
test('actual requests share reservations, including children, retries and fallback', () => {
  let budget = createRunBudget('root', { ...DEFAULT_RUN_BUDGET, modelRequests: 2, tokens: 600 })
  budget = reserveRunAttempt(budget, reserve('initial'), 0)
  budget = reserveRunAttempt(budget, reserve('fallback', 'child'), 0)
  expect(reserveRunAttempt(budget, reserve('initial'), 0)).toBe(budget)
  expect(() => reserveRunAttempt(budget, reserve('retry'), 0)).toThrow()
  expect(runBudgetTotals(budget, 0).reservedTokens).toBe(600)
})
test('complete cumulative usage replaces estimates exactly once; details are not added twice', () => {
  let budget = reserveRunAttempt(createRunBudget('root'), reserve('a'), 0)
  const update = { attemptId: 'a', sequence: 1, complete: true, settled: true, usage: { source: 'provider' as const, inputTokens: 50, outputTokens: 60, totalTokens: 110, reasoningTokens: 20, cachedInputTokens: 25 } }
  budget = settleRunAttempt(budget, update)
  expect(settleRunAttempt(budget, update)).toBe(budget)
  expect(runBudgetTotals(budget, 0)).toMatchObject({ actualTokens: 110, reservedTokens: 0, estimatedTokens: 0 })
  // Google already includes thoughts in its normalized total.
  budget = settleRunAttempt(budget, { ...update, sequence: 2, usage: { ...update.usage, totalTokens: 130 } })
  expect(runBudgetTotals(budget, 0).actualTokens).toBe(130)
})
test('partial usage, missing usage and cancellation never make requests free; late complete usage corrects them', () => {
  let budget = reserveRunAttempt(createRunBudget('root'), reserve('a'), 0)
  budget = settleRunAttempt(budget, { attemptId: 'a', sequence: 0, complete: false, settled: false, usage: { source: 'provider', inputTokens: 400 } })
  expect(runBudgetTotals(budget, 0).reservedTokens).toBe(400)
  budget = settleRunAttempt(budget, { attemptId: 'a', sequence: 1, complete: false, settled: true })
  expect(runBudgetTotals(budget, 0)).toMatchObject({ reservedTokens: 0, estimatedTokens: 400 })
  budget = settleRunAttempt(budget, { attemptId: 'a', sequence: 2, complete: true, settled: true, usage: { source: 'provider', inputTokens: 250, outputTokens: 10 } })
  expect(runBudgetTotals(budget, 0)).toMatchObject({ actualTokens: 260, estimatedTokens: 0 })
  expect(settleRunAttempt(budget, { attemptId: 'a', sequence: 3, complete: false, settled: true })).toBe(budget)
})
test('human waiting does not spend active time and unknown prices reject monetary limits', () => {
  let budget = setRunBudgetActive(createRunBudget('root'), true, 100)
  budget = setRunBudgetActive(budget, false, 200)
  budget = setRunBudgetActive(budget, true, 10_000)
  expect(runBudgetTotals(budget, 10_050).activeMs).toBe(150)
  expect(() => reserveRunAttempt(createRunBudget('root', { ...DEFAULT_RUN_BUDGET, amountUsd: 1 }), reserve('a'), 0)).toThrow('price_unknown')
})
test('tool identities are idempotent but new operations cannot bypass their cap', () => {
  let budget = createRunBudget('root', { ...DEFAULT_RUN_BUDGET, tools: 1 })
  budget = reserveRunTool(budget, 'operation-a', 0)
  expect(reserveRunTool(budget, 'operation-a', 0)).toBe(budget)
  expect(() => reserveRunTool(budget, 'operation-b', 0)).toThrow('tools')
})

test('root and children share the union of active intervals, including a waiting root', () => {
  let budget = setRunBudgetActive(createRunBudget('root'), true, 100, 'root')
  budget = setRunBudgetActive(budget, true, 120, 'child-a')
  budget = setRunBudgetActive(budget, true, 130, 'child-b')
  budget = setRunBudgetActive(budget, false, 140, 'root')
  budget = setRunBudgetActive(budget, false, 160, 'child-a')
  expect(runBudgetTotals(budget, 180).activeMs).toBe(80)
  budget = setRunBudgetActive(budget, false, 200, 'child-b')
  expect(runBudgetTotals(budget, 10_000).activeMs).toBe(100)
  expect(budget.activeRunIds).toEqual([])
})
