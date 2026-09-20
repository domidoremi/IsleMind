import type { MessageResponseLifecycle, ResponseLifecycleStage } from '@/types/chatContracts'
import { isTerminalResponseLifecycleStage } from './responseLifecycle'

export interface LifecycleActivityStep {
  stage: ResponseLifecycleStage
  startedAt: number
  completedAt?: number
  live: boolean
}

// Projects the durable response lifecycle history into an ordered activity
// timeline. It surfaces only stages recorded from real runtime traces/events
// (the history is written exclusively by transitionResponseLifecycle from a
// real ProcessTrace or a real text delta), so nothing here is inferred.
// Consecutive duplicate stages are merged so a multi-cycle tool loop reads as
// one coherent sequence rather than a flicker of identical rows.
export function collectLifecycleActivitySteps(
  lifecycle: MessageResponseLifecycle | undefined,
): LifecycleActivityStep[] {
  if (!lifecycle) return []
  const steps: LifecycleActivityStep[] = []
  for (const entry of lifecycle.history) {
    const prev = steps[steps.length - 1]
    if (prev && prev.stage === entry.stage) {
      prev.startedAt = Math.min(prev.startedAt, entry.startedAt)
      if (entry.completedAt !== undefined) {
        prev.completedAt = prev.completedAt === undefined
          ? entry.completedAt
          : Math.max(prev.completedAt, entry.completedAt)
      }
      continue
    }
    steps.push({ stage: entry.stage, startedAt: entry.startedAt, completedAt: entry.completedAt, live: false })
  }
  const last = steps[steps.length - 1]
  if (last && !isTerminalResponseLifecycleStage(lifecycle.stage) && last.stage === lifecycle.stage && last.completedAt === undefined) {
    last.live = true
  }
  return steps.slice(-12)
}

export function hasExpandableActivitySteps(lifecycle: MessageResponseLifecycle | undefined): boolean {
  return collectLifecycleActivitySteps(lifecycle).length >= 2
}
