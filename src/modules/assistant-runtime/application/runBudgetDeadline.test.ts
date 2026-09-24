import { createRunBudgetDeadlines } from './runBudgetDeadline'
import { createRunBudget, setRunBudgetActive, DEFAULT_RUN_BUDGET } from './runBudget'

test('only actual active time consumes the deadline; wait and terminal states leave no timer', () => {
  jest.useFakeTimers({ now: 0 })
  const exhausted = jest.fn()
  const deadlines = createRunBudgetDeadlines({ now: Date.now, exhausted })
  try {
    let budget = setRunBudgetActive(createRunBudget('root', { ...DEFAULT_RUN_BUDGET, activeMs: 100 }), true, 0)
    deadlines.update(budget, true)
    jest.advanceTimersByTime(40)
    budget = setRunBudgetActive(budget, false, Date.now())
    deadlines.update(budget, false)
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(10_000)
    expect(exhausted).not.toHaveBeenCalled()
    budget = setRunBudgetActive(budget, true, Date.now())
    deadlines.update(budget, true)
    jest.advanceTimersByTime(59)
    expect(exhausted).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(exhausted).toHaveBeenCalledTimes(1)
    expect(exhausted).toHaveBeenCalledWith('root')
    expect(jest.getTimerCount()).toBe(0)
  } finally { deadlines.dispose(); jest.useRealTimers() }
})
