export const APP_UPDATE_QUIET_PERIOD_MS = 5_000

export interface AppUpdateActivitySnapshot {
  readonly foreground: boolean | undefined
  readonly blocked: boolean
  readonly lastActivityAt: number
  readonly revision: number
}

/** A bounded UI/activity projection for update prompts, not a task registry or general event bus. */
export function createAppUpdateActivity(now: () => number = () => globalThis.performance?.now() ?? Date.now()) {
  const blockers = new Set<symbol>()
  const listeners = new Set<() => void>()
  let snapshot: AppUpdateActivitySnapshot = Object.freeze({ foreground: undefined, blocked: false, lastActivityAt: now(), revision: 0 })
  const publish = (patch: Partial<AppUpdateActivitySnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...patch, revision: snapshot.revision + 1 })
    for (const listener of [...listeners]) {
      try { listener() } catch { /* Observers cannot break input or execution activity. */ }
    }
  }
  return {
    now,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    recordActivity() { publish({ lastActivityAt: now() }) },
    setForeground(foreground: boolean | undefined) {
      if (snapshot.foreground !== foreground) publish({ foreground, lastActivityAt: now() })
    },
    acquireBlocker(reason: string): () => void {
      const token = Symbol(reason)
      blockers.add(token)
      publish({ blocked: true })
      return () => {
        if (blockers.delete(token)) publish({ blocked: blockers.size > 0, lastActivityAt: now() })
      }
    },
  }
}

export type AppUpdateActivity = ReturnType<typeof createAppUpdateActivity>

/** At most one deadline. A refused claim waits for a new event instead of spinning or polling. */
export function scheduleIdleAppUpdate(input: {
  activity: AppUpdateActivity
  onIdle: () => boolean
  canPrompt?: () => boolean
  quietPeriodMs?: number
}): () => void {
  const { activity } = input
  const quiet = input.quietPeriodMs ?? APP_UPDATE_QUIET_PERIOD_MS
  if (!Number.isFinite(quiet) || quiet <= 0) throw new TypeError('A positive quiet period is required.')
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  let unsubscribe = () => undefined as void
  const clearDeadline = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const cancel = () => { cancelled = true; clearDeadline(); unsubscribe() }
  const arm = () => {
    clearDeadline()
    if (cancelled) return
    const state = activity.getSnapshot()
    if (state.foreground !== true || state.blocked || input.canPrompt?.() === false) return
    const delay = Math.max(0, quiet - Math.max(0, activity.now() - state.lastActivityAt))
    timer = setTimeout(() => {
      timer = undefined
      if (cancelled) return
      const current = activity.getSnapshot()
      if (current.foreground !== true || current.blocked || input.canPrompt?.() === false) return
      if (current.revision !== state.revision || activity.now() - current.lastActivityAt < quiet) { arm(); return }
      if (input.onIdle()) cancel()
    }, delay)
  }
  unsubscribe = activity.subscribe(arm)
  arm()
  return cancel
}
