export type AppFeedbackTone = 'default' | 'mint' | 'amber' | 'danger'
export type AppFeedbackPosition = 'top' | 'bottom'
export type AppFeedbackPriority = 'normal' | 'high'

export interface AppFeedbackOptions {
  title: string
  message?: string
  tone?: AppFeedbackTone
  durationMs?: number
  position?: AppFeedbackPosition
  topOffset?: number
  bottomOffset?: number
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
  dedupeKey?: string
  /** Replaces an in-flight or queued item without presenting it as a repeat. */
  replaceKey?: string
  priority?: AppFeedbackPriority
}

export interface AppFeedbackItem extends AppFeedbackOptions {
  id: number
  occurrences: number
}

export interface AppToastQueueState {
  active: AppFeedbackItem | null
  pending: AppFeedbackItem[]
}

export interface AppConfirmSettlementRegistry {
  register(id: number, resolve: (value: boolean) => void): void
  settle(id: number, value: boolean): boolean
  settleAll(value: boolean): number
}

export const EMPTY_APP_TOAST_QUEUE: AppToastQueueState = {
  active: null,
  pending: [],
}

const MAX_PENDING_TOASTS = 4

export function createAppConfirmSettlementRegistry(): AppConfirmSettlementRegistry {
  const resolvers = new Map<number, (value: boolean) => void>()
  return {
    register(id, resolve) {
      resolvers.set(id, resolve)
    },
    settle(id, value) {
      const resolve = resolvers.get(id)
      if (!resolve) return false
      resolvers.delete(id)
      resolve(value)
      return true
    },
    settleAll(value) {
      const pending = [...resolvers.values()]
      resolvers.clear()
      for (const resolve of pending) resolve(value)
      return pending.length
    },
  }
}

export function enqueueAppToast(state: AppToastQueueState, item: AppFeedbackItem): AppToastQueueState {
  const replacementIndex = item.replaceKey?.trim()
    ? findFeedbackIndex(state, item.replaceKey.trim())
    : -1
  if (replacementIndex >= 0) {
    if (replacementIndex === 0) return { ...state, active: item }
    const pending = [...state.pending]
    pending[replacementIndex - 1] = item
    return { ...state, pending }
  }

  if (state.active && feedbackIdentity(state.active) === feedbackIdentity(item)) {
    return {
      ...state,
      active: mergeRepeatedFeedback(state.active, item),
    }
  }

  const repeatedIndex = state.pending.findIndex((pending) => feedbackIdentity(pending) === feedbackIdentity(item))
  if (repeatedIndex >= 0) {
    const pending = [...state.pending]
    pending[repeatedIndex] = mergeRepeatedFeedback(pending[repeatedIndex], item)
    return { ...state, pending }
  }

  if (!state.active) return { active: item, pending: [] }

  const pending = item.priority === 'high'
    ? [item, ...state.pending]
    : [...state.pending, item]
  return {
    ...state,
    pending: pending.slice(0, MAX_PENDING_TOASTS),
  }
}

function findFeedbackIndex(state: AppToastQueueState, replaceKey: string): number {
  if (state.active?.replaceKey?.trim() === replaceKey) return 0
  const pendingIndex = state.pending.findIndex((pending) => pending.replaceKey?.trim() === replaceKey)
  return pendingIndex >= 0 ? pendingIndex + 1 : -1
}

export function dismissActiveAppToast(state: AppToastQueueState): AppToastQueueState {
  const [active = null, ...pending] = state.pending
  return { active, pending }
}

export function feedbackIdentity(feedback: AppFeedbackOptions): string {
  if (feedback.dedupeKey?.trim()) return `key:${feedback.dedupeKey.trim()}`
  return [
    feedback.tone ?? 'default',
    feedback.title.trim(),
    feedback.message?.trim() ?? '',
  ].join('\u001f')
}

function mergeRepeatedFeedback(current: AppFeedbackItem, incoming: AppFeedbackItem): AppFeedbackItem {
  return {
    ...current,
    ...incoming,
    occurrences: current.occurrences + incoming.occurrences,
  }
}
