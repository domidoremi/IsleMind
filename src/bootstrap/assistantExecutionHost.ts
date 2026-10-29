import { setExecutionInterval, clearExecutionInterval } from '@/core/executionTimers'
import type { AssistantRunId } from '@/core'
import type { RunSnapshot } from '@/modules/assistant-runtime'
import type { ExecutionResources } from '@/modules/tasks'
import { ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS, type AndroidAgentExecutionLease,
  type AndroidAgentExecutionPort, type AndroidAgentExecutionReleaseReason } from '@/platform/native/androidAgentExecution'

export type ExecutionHostPauseReason = 'memory_pressure' | 'background_disabled' | 'execution_lease_lost'
type Entry = { snapshot?: RunSnapshot; enabled: boolean; generation: number; executions: Set<symbol>; blocked?: ExecutionHostPauseReason;
  picker?: { onVisible?: () => void };
  lease?: AndroidAgentExecutionLease; acquiring?: { generation: number; promise: Promise<void> }; renewing?: AndroidAgentExecutionLease }

/** Application-scoped native control adapter, not a second run registry or execution engine.
 * Stores bounded control projections only. All durable transitions belong to Harness.
 */
export function createAssistantExecutionHost(input: {
  port: AndroidAgentExecutionPort
  resources: ExecutionResources
  pause(runId: AssistantRunId, reason: ExecutionHostPauseReason): Promise<unknown>
  trimCaches?: (critical: boolean) => void
}) {
  const entries = new Map<string, Entry>()
  const activityListeners = new Set<(busy: boolean) => void>()
  let activeExecutions = 0
  const publishActivity = () => {
    for (const listener of [...activityListeners]) {
      // An observational UI subscription cannot interfere with execution authority.
      try { listener(activeExecutions > 0) } catch { /* Keep the execution scope intact. */ }
    }
  }
  let visible = true
  let generation = Date.now()
  let timer: ReturnType<typeof setExecutionInterval> | undefined
  let unsubscribe: (() => void) | undefined
  const runnable = (entry: Entry) => entry.executions.size > 0 && entry.snapshot?.status === 'running' && !entry.blocked
  const release = (entry: Entry, reason: AndroidAgentExecutionReleaseReason) => {
    const lease = entry.lease
    entry.lease = undefined
    if (lease) void input.port.release(lease, reason).catch(() => undefined)
    if (![...entries.values()].some((item) => item.lease) && timer) { clearExecutionInterval(timer); timer = undefined }
  }
  const pause = (entry: Entry, reason: ExecutionHostPauseReason) => {
    if (entry.blocked) return
    entry.blocked = reason // Synchronous dispatch fence; do not wait for SQLite or cleanup.
    ++entry.generation
    release(entry, reason === 'memory_pressure' ? 'pressure' : 'shutdown')
    if (entry.snapshot) void input.pause(entry.snapshot.id, reason).catch(() => undefined)
  }
  function renew() {
    for (const entry of entries.values()) {
      const lease = entry.lease
      if (!lease || entry.renewing?.generation === lease.generation || !runnable(entry)) continue
      entry.renewing = lease
      void input.port.renew(lease).then((result) => {
        if (entry.lease !== lease) return // A release/new generation wins against this reply.
        if (result.ok && result.lease) entry.lease = result.lease
        else pause(entry, 'execution_lease_lost')
      }, () => { if (entry.lease === lease) pause(entry, 'execution_lease_lost') })
        .finally(() => { if (entry.renewing === lease) entry.renewing = undefined })
    }
  }
  async function acquire(entry: Entry): Promise<void> {
    if (!entry.enabled || !runnable(entry) || entry.lease || entry.picker) return
    if (entry.acquiring?.generation === entry.generation) return entry.acquiring.promise
    if (!visible || !input.port.isAvailable()) { pause(entry, 'execution_lease_lost'); return }
    const runId = entry.snapshot!.id
    const acquiredGeneration = entry.generation = ++generation
    const attempt = (async () => {
      const result = await input.port.acquire({ runId, generation: acquiredGeneration, enabled: true })
      if (entry.generation !== acquiredGeneration || !entry.enabled || !runnable(entry) || entry.picker) {
        if (result.ok && result.lease) await input.port.release(result.lease, 'waiting')
        return
      }
      if (!result.ok || !result.lease) { pause(entry, 'execution_lease_lost'); return }
      entry.lease = result.lease
      timer ??= setExecutionInterval(renew, ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS)
    })().catch(() => { if (entry.generation === acquiredGeneration) pause(entry, 'execution_lease_lost') })
    const acquisition = { generation: acquiredGeneration, promise: attempt }
    entry.acquiring = acquisition
    try { await attempt } finally { if (entry.acquiring === acquisition) entry.acquiring = undefined }
  }
  function entryFor(id: string) {
    let entry = entries.get(id)
    if (!entry) { entry = { enabled: false, generation: ++generation, executions: new Set() }; entries.set(id, entry) }
    return entry
  }
  return {
    isBusy: () => activeExecutions > 0,
    subscribeActivity(listener: (busy: boolean) => void) {
      activityListeners.add(listener)
      return () => { activityListeners.delete(listener) }
    },
    /** A scope spans the whole invocation, including consecutive local dispatch
     * and delegated children. Stored running state alone is never CPU authority. */
    executionStarted({ runId, rootRunId }: { runId: AssistantRunId; rootRunId: AssistantRunId }) {
      const entry = entryFor(rootRunId)
      if (entry.picker) throw new Error('System picker is awaiting the user')
      const token = Symbol(runId)
      entry.executions.add(token)
      if (++activeExecutions === 1) publishActivity()
      return () => {
        if (!entry.executions.delete(token)) return
        if (--activeExecutions === 0) publishActivity()
        if (entry.executions.size) return
        ++entry.generation
        release(entry, 'completed')
      }
    },
    start() {
      if (unsubscribe) return
      const controls = input.port.subscribeControl((event) => {
        const entry = entries.get(event.runId)
        const lease = entry?.lease
        if (!entry || (lease?.generation ?? entry.generation) !== event.generation) return
        // Native may publish stop/expiry before the acquire bridge reply arrives.
        if (lease && (lease.startId !== event.startId || lease.leaseToken !== event.leaseToken)) return
        pause(entry, 'execution_lease_lost')
      })
      const pressure = input.port.subscribeMemoryPressure((event) => {
        // UI_HIDDEN and moderate/cache-only trims are never execution shutdown.
        if (event.cacheTrimOnly || event.level !== 'critical') { input.trimCaches?.(false); return }
        input.resources.setPressure(true)
        input.trimCaches?.(true)
        for (const entry of entries.values()) if (runnable(entry)) pause(entry, 'memory_pressure')
      })
      unsubscribe = () => { controls(); pressure(); unsubscribe = undefined }
    },
    stop() {
      unsubscribe?.()
      for (const entry of entries.values()) {
        if (runnable(entry)) pause(entry, 'execution_lease_lost')
        ++entry.generation
        release(entry, 'shutdown')
      }
      if (timer) { clearExecutionInterval(timer); timer = undefined }
    },
    /** Explicit foreground user action only; never called by a notification tap. */
    async enableBackground(runId: AssistantRunId, enabled: boolean) {
      if (enabled && (!visible || !input.port.isAvailable())) throw new Error('Background execution is unavailable')
      const entry = entryFor(runId)
      entry.enabled = enabled
      if (!enabled) { ++entry.generation; release(entry, 'shutdown'); if (!visible && runnable(entry)) pause(entry, 'background_disabled') }
      else await acquire(entry)
    },
    backgroundEnabled(runId: string) { return entries.get(runId)?.enabled === true },
    /** Only the local, already-authorized SAF picker adapter calls this. Waiting
     * for a system Activity is not permission to run models or tools offscreen. */
    async withSystemPicker<T>(runId: AssistantRunId, signal: AbortSignal, open: () => Promise<T>): Promise<T> {
      input.resources.assertAdmission()
      const entry = entries.get(runId)
      if (!visible || !entry || !runnable(entry) || entry.executions.size !== 1 || entry.picker || signal.aborted) {
        throw new Error('System picker requires a sole active foreground invocation')
      }
      const picker: NonNullable<Entry['picker']> = {}
      entry.picker = picker
      ++entry.generation
      release(entry, 'waiting')
      let rejectAbort!: (error: Error) => void
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
      const cancel = () => rejectAbort(new Error('System picker cancelled'))
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const result = await Promise.race([open(), aborted])
        // Android's result can arrive before the Activity becomes visible.
        // Keep the dispatch fence until both the result and foreground return.
        if (!visible) await Promise.race([new Promise<void>(resolve => { picker.onVisible = resolve }), aborted])
        if (signal.aborted || entry.blocked) throw new Error(entry.blocked ?? 'System picker cancelled')
        return result
      } finally {
        signal.removeEventListener('abort', cancel)
        if (entry.picker === picker) {
          entry.picker = undefined
          if (!visible && runnable(entry)) pause(entry, 'background_disabled')
          else if (visible && !signal.aborted) await acquire(entry)
        }
      }
    },
    setVisible(value: boolean) {
      visible = value
      for (const entry of entries.values()) {
        if (visible) entry.picker?.onVisible?.()
        else if (runnable(entry) && !entry.picker && (!entry.enabled || !entry.lease)) pause(entry, 'background_disabled')
      }
    },
    async persisted(snapshot: RunSnapshot) {
      const entry = entryFor(snapshot.id)
      entry.snapshot = snapshot
      if (!runnable(entry)) {
        ++entry.generation
        release(entry, snapshot.waiting ? 'waiting' : snapshot.status === 'cancelled' ? 'cancelled' : 'completed')
        if (['succeeded', 'failed', 'cancelled'].includes(snapshot.status)) entries.delete(snapshot.id)
        return
      }
      if (!visible && !entry.lease && !entry.picker) { pause(entry, 'background_disabled'); return }
      await acquire(entry)
    },
    assertAdmission(runId: string) {
      input.resources.assertAdmission()
      const entry = entries.get(runId)
      if (entry?.blocked) throw new Error(entry.blocked)
      if (entry?.picker) throw new Error('System picker is awaiting the user')
      if (!visible && (!entry?.enabled || !entry.lease)) throw new Error('background_disabled')
    },
    /** System pressure recovery is not signalled reliably. Only a foreground user
     * action clears the latch, including retries that failed before run creation. */
    prepareUserResume(runId?: AssistantRunId) {
      if (!visible) throw new Error('Resume requires a visible Activity')
      const entry = runId ? entries.get(runId) : undefined
      if (entry?.executions.size || entry?.snapshot?.status === 'running' || entry?.acquiring || entry?.lease) throw new Error('Run is already active')
      input.resources.setPressure(false)
      input.resources.reserveText(0)()
      if (entry) { entry.blocked = undefined; ++entry.generation }
    },
  }
}
