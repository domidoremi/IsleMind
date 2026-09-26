import { setExecutionInterval, clearExecutionInterval } from '@/core/executionTimers'
import type { AssistantRunId } from '@/core'
import type { RunSnapshot } from '@/modules/assistant-runtime'
import type { ExecutionResources } from '@/modules/tasks'
import { ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS, type AndroidAgentExecutionLease,
  type AndroidAgentExecutionPort, type AndroidAgentExecutionReleaseReason } from '@/platform/native/androidAgentExecution'

export type ExecutionHostPauseReason = 'memory_pressure' | 'background_disabled' | 'execution_lease_lost'
type Entry = { snapshot?: RunSnapshot; enabled: boolean; generation: number; executions: Set<symbol>; blocked?: ExecutionHostPauseReason;
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
    if (!entry.enabled || !runnable(entry) || entry.lease) return
    if (entry.acquiring?.generation === entry.generation) return entry.acquiring.promise
    if (!visible || !input.port.isAvailable()) { pause(entry, 'execution_lease_lost'); return }
    const runId = entry.snapshot!.id
    const acquiredGeneration = entry.generation = ++generation
    const attempt = (async () => {
      const result = await input.port.acquire({ runId, generation: acquiredGeneration, enabled: true })
      if (entry.generation !== acquiredGeneration || !entry.enabled || !runnable(entry)) {
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
    /** A scope spans the whole invocation, including consecutive local dispatch
     * and delegated children. Stored running state alone is never CPU authority. */
    executionStarted({ runId, rootRunId }: { runId: AssistantRunId; rootRunId: AssistantRunId }) {
      const entry = entryFor(rootRunId)
      const token = Symbol(runId)
      entry.executions.add(token)
      return () => {
        if (!entry.executions.delete(token) || entry.executions.size) return
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
    setVisible(value: boolean) {
      visible = value
      if (!visible) for (const entry of entries.values()) {
        if (runnable(entry) && (!entry.enabled || !entry.lease)) pause(entry, 'background_disabled')
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
      if (!visible && !entry.lease) { pause(entry, 'background_disabled'); return }
      await acquire(entry)
    },
    assertAdmission(runId: string) {
      input.resources.assertAdmission()
      const entry = entries.get(runId)
      if (entry?.blocked) throw new Error(entry.blocked)
      if (!visible && (!entry?.enabled || !entry.lease)) throw new Error('background_disabled')
    },
    /** System pressure recovery is not signalled reliably. Only a user retry clears the latch. */
    prepareUserResume(runId: AssistantRunId) {
      if (!visible) throw new Error('Resume requires a visible Activity')
      const entry = entries.get(runId)
      if (entry?.executions.size || entry?.snapshot?.status === 'running' || entry?.acquiring || entry?.lease) throw new Error('Run is already active')
      input.resources.setPressure(false)
      input.resources.reserveText(0)()
      if (entry) { entry.blocked = undefined; ++entry.generation }
    },
  }
}
