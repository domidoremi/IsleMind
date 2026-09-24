import { runBudgetTotals, type RunBudgetSnapshot } from './runBudget'

/** One active-time deadline; no polling and no timer during human waiting. */
export function createRunBudgetDeadlines(input: {
  now(): number
  exhausted(runId: string): void | Promise<unknown>
}) {
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout> }>()
  const clear = (runId: string) => {
    const old = timers.get(runId)
    if (old) clearTimeout(old.timer)
    timers.delete(runId)
  }
  return {
    update(budget: RunBudgetSnapshot, running: boolean) {
      clear(budget.rootRunId)
      if (!running) return
      const remaining = Math.max(0, budget.limits.activeMs - runBudgetTotals(budget, input.now()).activeMs)
      const entry = { timer: setTimeout(() => {
        if (timers.get(budget.rootRunId) !== entry) return
        timers.delete(budget.rootRunId)
        // Durable budget admission still denies dispatch if saving the pause fails.
        void Promise.resolve(input.exhausted(budget.rootRunId)).catch(() => undefined)
      }, remaining) }
      timers.set(budget.rootRunId, entry)
    },
    clear,
    dispose() { for (const runId of timers.keys()) clear(runId) },
  }
}
