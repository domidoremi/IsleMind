import {
  buildAndroidStatusNotificationMutationKey,
  type AndroidStatusNotificationClearOptions,
  type AndroidStatusNotificationPayload,
  type AndroidStatusNotificationUpdateOptions,
} from '@/platform/native/androidStatusNotification'

interface SystemStatusNotificationPort {
  update: (payload: AndroidStatusNotificationPayload, options?: AndroidStatusNotificationUpdateOptions) => Promise<unknown>
  clear: (options?: AndroidStatusNotificationClearOptions) => Promise<unknown>
}

export interface SystemStatusNotificationDispatcher {
  update: (payload: AndroidStatusNotificationPayload, options?: AndroidStatusNotificationUpdateOptions) => Promise<boolean>
  clear: (options?: AndroidStatusNotificationClearOptions) => Promise<boolean>
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
    update: (payload, options = {}) => dispatch(
      JSON.stringify([options.owner ?? null, buildSystemStatusNotificationMutationKey(payload)]),
      () => port.update(payload, options),
    ),
    clear: (options = {}) => dispatch(
      `clear\u001f${options.owner?.trim() || '*'}`,
      () => port.clear(options),
    ),
  }
}

export function buildSystemStatusNotificationMutationKey(
  payload: AndroidStatusNotificationPayload,
): string {
  return buildAndroidStatusNotificationMutationKey(payload)
}
