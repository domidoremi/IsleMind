export interface AppUpdateCheckPolicy {
  enabled: boolean
  foreground: boolean | undefined
  online: boolean | undefined
  channel: 'stable' | 'every-release'
  intervalMs: number
  lastCheckedAt?: number
}

/** One foreground deadline and one request; event recovery never replays work. */
export function createAppUpdateCheckScheduler(input: {
  readPolicy(): AppUpdateCheckPolicy
  check(channel: AppUpdateCheckPolicy['channel']): Promise<{ success: boolean; retryAfterMs?: number }>
  now?: () => number
}) {
  const now = input.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let disposed = false
  let channel: AppUpdateCheckPolicy['channel'] | undefined
  let failures = 0
  let retryAt = 0
  let completedAt = 0
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const refresh = () => {
    clear()
    if (disposed) return
    const policy = input.readPolicy()
    if (channel !== policy.channel) {
      channel = policy.channel
      failures = 0; retryAt = 0; completedAt = 0
    }
    if (active || !policy.enabled || policy.foreground !== true || policy.online !== true) return
    const time = now()
    const interval = [30, 60, 360, 1440].map((minutes) => minutes * 60_000).includes(policy.intervalMs)
      ? policy.intervalMs : 86_400_000
    const last = Number.isFinite(policy.lastCheckedAt) && (policy.lastCheckedAt ?? 0) > 0 && policy.lastCheckedAt! <= time
      ? policy.lastCheckedAt! : 0
    const due = Math.max(retryAt, Math.max(last, completedAt) > 0 ? Math.max(last, completedAt) + interval : time)
    if (due > time) { timer = setTimeout(refresh, due - time); return }
    active = true
    const requestChannel = policy.channel
    void Promise.resolve().then(() => input.check(requestChannel)).catch(() => ({ success: false }))
      .then((result) => {
        if (disposed || channel !== requestChannel) return
        if (result.success) { completedAt = now(); failures = 0; retryAt = 0 }
        else {
          failures = Math.min(8, failures + 1)
          const serverDelay = 'retryAfterMs' in result && Number.isFinite(result.retryAfterMs)
            ? Math.max(0, Math.min(48 * 3_600_000, result.retryAfterMs ?? 0)) : 0
          retryAt = now() + Math.max(serverDelay, Math.min(3_600_000, 30_000 * 2 ** (failures - 1)))
        }
      }).finally(() => { active = false; refresh() })
  }
  return { refresh, dispose() { disposed = true; clear() } }
}
