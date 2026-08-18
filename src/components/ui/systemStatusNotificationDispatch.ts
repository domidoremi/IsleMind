import type { AndroidStatusNotificationPayload } from '@/bootstrap/androidStatusNotification'

interface SystemStatusNotificationPort {
  update: (payload: AndroidStatusNotificationPayload) => Promise<unknown>
  clear: () => Promise<unknown>
}

export interface SystemStatusNotificationDispatcher {
  update: (payload: AndroidStatusNotificationPayload) => Promise<boolean>
  clear: () => Promise<boolean>
}

/** Keeps semantically identical stream frames off the native bridge and preserves mutation order. */
export function createSystemStatusNotificationDispatcher(
  port: SystemStatusNotificationPort,
): SystemStatusNotificationDispatcher {
  let lastMutationKey: string | null = null
  let mutationTail: Promise<void> = Promise.resolve()

  const dispatch = (mutationKey: string, operation: () => Promise<unknown>): Promise<boolean> => {
    if (mutationKey === lastMutationKey) return Promise.resolve(false)
    lastMutationKey = mutationKey

    const execute = async () => {
      await operation()
      return true
    }
    const result = mutationTail.then(execute, execute)
    const guardedResult = result.catch((error: unknown) => {
      if (lastMutationKey === mutationKey) lastMutationKey = null
      throw error
    })
    mutationTail = guardedResult.then(() => undefined, () => undefined)
    return guardedResult
  }

  return {
    update: (payload) => dispatch(
      buildSystemStatusNotificationMutationKey(payload),
      () => port.update(payload),
    ),
    clear: () => dispatch('clear', port.clear),
  }
}

export function buildSystemStatusNotificationMutationKey(
  payload: AndroidStatusNotificationPayload,
): string {
  return JSON.stringify([
    'update',
    payload.state,
    payload.title,
    payload.message,
    payload.shortText ?? null,
    payload.conversationId ?? null,
    payload.deepLink ?? null,
    payload.progress ?? null,
    payload.indeterminate ?? null,
    payload.ongoing ?? null,
    payload.requestPromotedOngoing ?? null,
    payload.foregroundService ?? null,
  ])
}
