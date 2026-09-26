import { bindExecutionTimerMirror } from '@/core/executionTimers'
import { ANDROID_EXECUTION_TIMER_EVENT, createAndroidExecutionTimerMirror, type AndroidExecutionTimerModule } from './androidExecutionTimers'

/** Native resource leases are not run/effect authorization or durable recovery state. */
export const ANDROID_AGENT_LEASE_TTL_MS = 15_000
export const ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS = 5_000

export interface AndroidAgentExecutionLease {
  runId: string
  generation: number
  startId: number
  /** Prevents identity reuse when Android restarts service startId numbering. */
  leaseToken: string
  expiresAtElapsedMs: number
}

export interface AndroidAgentMemoryPressure {
  sequence: number
  level: 'normal' | 'moderate' | 'critical'
  source: 'initial' | 'trim_memory' | 'low_memory'
  androidTrimLevel: number
  cacheTrimOnly: boolean
  observedAtElapsedMs: number
}

export interface AndroidAgentExecutionControl {
  sequence: number
  runId: string
  generation: number
  startId: number
  leaseToken: string
  kind: 'stop_requested' | 'expired' | 'timeout' | 'service_destroyed' | 'bridge_invalidated' | 'superseded' | 'native_error' | 'task_removed'
  observedAtElapsedMs: number
}

export interface AndroidAgentExecutionState {
  available: boolean
  reason: 'ready' | 'unavailable' | 'native_error'
  androidApiLevel: number
  elapsedRealtimeMs: number
  leaseTtlMs: number
  renewIntervalMs: number
  foregroundServiceRunning: boolean
  wakeLockHeld: boolean
  /** False on API 34+: running-critical callbacks are not an OOM safety net. */
  runningCriticalCallbacksReliable: boolean
  leases: AndroidAgentExecutionLease[]
  /** Bounded native control barrier history; missing leases are not resumable. */
  controls: AndroidAgentExecutionControl[]
  lastControlSequence: number
  pressure: AndroidAgentMemoryPressure
}

export type AndroidAgentExecutionReleaseReason = 'waiting' | 'completed' | 'cancelled' | 'pressure' | 'shutdown'
export type AndroidAgentExecutionResultReason = 'acquired' | 'renewed' | 'released' | 'unavailable' | 'disabled' | 'invalid_input' | 'not_visible' | 'permission_denied' | 'capacity' | 'stale' | 'expired' | 'native_error'

export interface AndroidAgentExecutionResult {
  ok: boolean
  reason: AndroidAgentExecutionResultReason
  lease?: AndroidAgentExecutionLease
}

export interface AndroidAgentExecutionAcquireInput {
  runId: string
  generation: number
  enabled: boolean
}

export interface AndroidAgentExecutionPort {
  isAvailable(): boolean
  getState(): Promise<AndroidAgentExecutionState>
  /** Only visible, explicitly enabled roots acquire; children share actual root work. */
  acquire(input: AndroidAgentExecutionAcquireInput): Promise<AndroidAgentExecutionResult>
  renew(lease: AndroidAgentExecutionLease): Promise<AndroidAgentExecutionResult>
  release(lease: AndroidAgentExecutionLease, reason?: AndroidAgentExecutionReleaseReason): Promise<AndroidAgentExecutionResult>
  subscribeControl(listener: (event: AndroidAgentExecutionControl) => void): () => void
  subscribeMemoryPressure(listener: (event: AndroidAgentMemoryPressure) => void): () => void
}

type LeaseIdentity = Pick<AndroidAgentExecutionLease, 'runId' | 'generation' | 'startId' | 'leaseToken'>

export interface AndroidAgentExecutionNativeModule {
  getState(): Promise<unknown>
  acquire(input: AndroidAgentExecutionAcquireInput): Promise<unknown>
  renew(identity: LeaseIdentity): Promise<unknown>
  release(identity: LeaseIdentity & { reason: AndroidAgentExecutionReleaseReason }): Promise<unknown>
}

export interface AndroidAgentExecutionAdapterDependencies {
  platform: { os: string; version: number | string }
  nativeModule?: AndroidAgentExecutionNativeModule
  subscribeNativeEvent?: (name: string, listener: (event: unknown) => void) => () => void
}

const CONTROL_EVENT = 'AndroidAgentExecutionControl'
const PRESSURE_EVENT = 'AndroidAgentExecutionMemoryPressure'
const MAX_LEASES = 8
const MAX_CONTROLS = 32
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/
const LEASE_TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const CONTROL_KINDS: readonly AndroidAgentExecutionControl['kind'][] = [
  'stop_requested', 'expired', 'timeout', 'service_destroyed', 'bridge_invalidated', 'superseded', 'native_error', 'task_removed',
]
const RESULT_REASONS: readonly AndroidAgentExecutionResultReason[] = [
  'acquired', 'renewed', 'released', 'unavailable', 'disabled', 'invalid_input', 'not_visible', 'permission_denied', 'capacity', 'stale', 'expired', 'native_error',
]
const RELEASE_REASONS: readonly AndroidAgentExecutionReleaseReason[] = ['waiting', 'completed', 'cancelled', 'pressure', 'shutdown']

/** Constructed by bootstrap. No module-load bridge access or automatic execution. */
export function createExpoAndroidAgentExecutionPort(
  dependencies?: AndroidAgentExecutionAdapterDependencies,
): AndroidAgentExecutionPort {
  let resolved = dependencies
  const runtime = () => (resolved ??= loadDefaultDependencies())
  const isAvailable = () => {
    const value = runtime()
    return value.platform.os === 'android' && isNativeModule(value.nativeModule)
  }

  const mutate = async (
    operation: 'acquire' | 'renew' | 'release',
    input: AndroidAgentExecutionAcquireInput | AndroidAgentExecutionLease,
    reason: AndroidAgentExecutionReleaseReason = 'waiting',
  ): Promise<AndroidAgentExecutionResult> => {
    if (!isAvailable()) return { ok: false, reason: 'unavailable' }
    if (operation === 'acquire' && (input as AndroidAgentExecutionAcquireInput).enabled !== true) {
      return { ok: false, reason: 'disabled' }
    }
    try {
      validateRun(input)
      if (operation !== 'acquire') normalizeLease(input)
      if (!RELEASE_REASONS.includes(reason)) throw new Error('Invalid release reason.')
    } catch {
      return { ok: false, reason: 'invalid_input' }
    }
    const native = runtime().nativeModule!
    try {
      const raw = operation === 'acquire'
        ? await native.acquire({ runId: input.runId, generation: input.generation, enabled: true })
        : operation === 'renew'
          ? await native.renew(identityOf(input as AndroidAgentExecutionLease))
          : await native.release({ ...identityOf(input as AndroidAgentExecutionLease), reason })
      const result = normalizeResult(raw, operation)
      if (result.lease && !sameIdentity(result.lease, input, operation !== 'acquire')) throw invalidResult()
      return result
    } catch {
      // No native exception strings, arbitrary payloads or secrets enter diagnostics.
      return { ok: false, reason: 'native_error' }
    }
  }

  const subscribe = <T>(name: string, normalize: (value: unknown) => T, listener: (value: T) => void): (() => void) => {
    if (!isAvailable()) return () => undefined
    let active = true
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = runtime().subscribeNativeEvent?.(name, value => {
        if (!active) return
        let event: T
        try { event = normalize(value) } catch { return }
        listener(event)
      })
    } catch {
      // getState remains the reconciliation path when event delivery is unavailable.
    }
    return () => {
      if (!active) return
      active = false
      try { unsubscribe?.() } catch { /* Native teardown can race bridge invalidation. */ }
    }
  }

  return {
    isAvailable,
    async getState() {
      if (!isAvailable()) return unavailableState(runtime(), 'unavailable')
      try {
        return normalizeState(await runtime().nativeModule!.getState())
      } catch {
        return unavailableState(runtime(), 'native_error')
      }
    },
    acquire: input => mutate('acquire', input),
    renew: lease => mutate('renew', lease),
    release: (lease, reason) => mutate('release', lease, reason),
    subscribeControl: listener => subscribe(CONTROL_EVENT, normalizeControl, listener),
    subscribeMemoryPressure: listener => subscribe(PRESSURE_EVENT, normalizePressure, listener),
  }
}

let leaseTimerTaskRegistered = false
function loadDefaultDependencies(): AndroidAgentExecutionAdapterDependencies {
  try {
    const { AppRegistry, NativeModules, NativeEventEmitter, Platform } = require('react-native') as typeof import('react-native')
    const nativeModule = Platform.OS === 'android' ? NativeModules.AndroidAgentExecution : undefined
    if (isNativeModule(nativeModule) && !isTimerNativeModule(nativeModule)) {
      return { platform: { os: Platform.OS, version: Platform.Version } }
    }
    if (isTimerNativeModule(nativeModule) && !leaseTimerTaskRegistered) {
      // This task has no executor, captured run or retained resolver. Native owns
      // its lifetime: last-lease disposal/expiry finishes the RN scheduler scope.
      // Merely registering it grants no CPU, replay or background-start authority.
      AppRegistry.registerHeadlessTask('IsleMindAgentExecutionLease', () => () => new Promise<void>(() => undefined))
      const timerEmitter = new NativeEventEmitter(nativeModule)
      const timers = createAndroidExecutionTimerMirror({
        native: nativeModule,
        subscribe: listener => {
          const subscription = timerEmitter.addListener(ANDROID_EXECUTION_TIMER_EVENT, listener)
          return () => subscription.remove()
        },
      })
      try { bindExecutionTimerMirror(timers.mirror) }
      catch (error) { timers.dispose(); throw error }
      leaseTimerTaskRegistered = true
    }
    let emitter: InstanceType<typeof NativeEventEmitter> | undefined
    return {
      platform: { os: Platform.OS, version: Platform.Version },
      nativeModule,
      subscribeNativeEvent(name, listener) {
        if (!nativeModule) return () => undefined
        emitter ??= new NativeEventEmitter(nativeModule)
        const subscription = emitter.addListener(name, listener)
        return () => subscription.remove()
      },
    }
  } catch {
    return { platform: { os: 'unknown', version: 0 } }
  }
}

function isNativeModule(value: unknown): value is AndroidAgentExecutionNativeModule {
  if (!value || typeof value !== 'object') return false
  return ['getState', 'acquire', 'renew', 'release'].every(key => typeof (value as Record<string, unknown>)[key] === 'function')
}

function isTimerNativeModule(value: unknown): value is AndroidAgentExecutionNativeModule & AndroidExecutionTimerModule & {
  addListener(eventType: string): void
  removeListeners(count: number): void
} {
  return isNativeModule(value) && ['scheduleExecutionTimer', 'cancelExecutionTimer', 'addListener', 'removeListeners']
    .every(key => typeof (value as unknown as Record<string, unknown>)[key] === 'function')
}

function normalizeResult(value: unknown, operation: 'acquire' | 'renew' | 'release'): AndroidAgentExecutionResult {
  const map = record(value)
  const ok = boolean(map.ok)
  const reason = oneOf(map.reason, RESULT_REASONS)
  const successReason = { acquire: 'acquired', renew: 'renewed', release: 'released' }[operation]
  if (ok !== (reason === successReason) || (!ok && ['acquired', 'renewed', 'released'].includes(reason))) throw invalidResult()
  if (ok && operation !== 'release') return { ok, reason, lease: normalizeLease(map.lease) }
  if (map.lease !== undefined && map.lease !== null) throw invalidResult()
  return { ok, reason }
}

function normalizeState(value: unknown): AndroidAgentExecutionState {
  const map = record(value)
  if (map.available !== true || map.reason !== 'ready' || map.leaseTtlMs !== ANDROID_AGENT_LEASE_TTL_MS || map.renewIntervalMs !== ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS) throw invalidResult()
  const androidApiLevel = integer(map.androidApiLevel, 1)
  const elapsedRealtimeMs = integer(map.elapsedRealtimeMs)
  const leases = boundedArray(map.leases, MAX_LEASES).map(normalizeLease)
  const controls = boundedArray(map.controls, MAX_CONTROLS).map(normalizeControl)
  const lastControlSequence = integer(map.lastControlSequence)
  const foregroundServiceRunning = boolean(map.foregroundServiceRunning)
  const wakeLockHeld = boolean(map.wakeLockHeld)
  const runningCriticalCallbacksReliable = boolean(map.runningCriticalCallbacksReliable)
  const pressure = normalizePressure(map.pressure)
  if ((leases.length === 0 && (foregroundServiceRunning || wakeLockHeld)) ||
      (leases.length > 0 && !foregroundServiceRunning) ||
      (androidApiLevel >= 34 && runningCriticalCallbacksReliable) ||
      new Set(leases.map(lease => lease.runId)).size !== leases.length ||
      new Set(leases.map(lease => lease.leaseToken)).size !== leases.length ||
      leases.some(lease => lease.expiresAtElapsedMs <= elapsedRealtimeMs || lease.expiresAtElapsedMs > elapsedRealtimeMs + ANDROID_AGENT_LEASE_TTL_MS) ||
      controls.some((control, index) => control.sequence > lastControlSequence || control.observedAtElapsedMs > elapsedRealtimeMs || (index > 0 && controls[index - 1].sequence >= control.sequence)) ||
      pressure.observedAtElapsedMs > elapsedRealtimeMs) throw invalidResult()
  return {
    available: true, reason: 'ready', androidApiLevel, elapsedRealtimeMs,
    leaseTtlMs: ANDROID_AGENT_LEASE_TTL_MS, renewIntervalMs: ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS,
    foregroundServiceRunning, wakeLockHeld, runningCriticalCallbacksReliable,
    leases, controls, lastControlSequence, pressure,
  }
}

function normalizeLease(value: unknown): AndroidAgentExecutionLease {
  const map = record(value)
  validateRun(map)
  return {
    runId: map.runId as string, generation: map.generation as number,
    startId: integer(map.startId, 1), leaseToken: token(map.leaseToken),
    expiresAtElapsedMs: integer(map.expiresAtElapsedMs, 1),
  }
}

function normalizeControl(value: unknown): AndroidAgentExecutionControl {
  const map = record(value)
  validateRun(map)
  return {
    sequence: integer(map.sequence, 1), runId: map.runId as string, generation: map.generation as number,
    startId: integer(map.startId, 1), leaseToken: token(map.leaseToken),
    kind: oneOf(map.kind, CONTROL_KINDS), observedAtElapsedMs: integer(map.observedAtElapsedMs),
  }
}

function normalizePressure(value: unknown): AndroidAgentMemoryPressure {
  const map = record(value)
  const pressure = {
    sequence: integer(map.sequence),
    level: oneOf(map.level, ['normal', 'moderate', 'critical'] as const),
    source: oneOf(map.source, ['initial', 'trim_memory', 'low_memory'] as const),
    androidTrimLevel: integer(map.androidTrimLevel), cacheTrimOnly: boolean(map.cacheTrimOnly),
    observedAtElapsedMs: integer(map.observedAtElapsedMs),
  }
  // TRIM_MEMORY_UI_HIDDEN signals cache trimming, never emergency admission failure.
  if ((pressure.androidTrimLevel === 20 && (pressure.level !== 'normal' || !pressure.cacheTrimOnly)) ||
      (pressure.cacheTrimOnly && pressure.level === 'critical')) throw invalidResult()
  return pressure
}

function unavailableState(runtime: AndroidAgentExecutionAdapterDependencies, reason: 'unavailable' | 'native_error'): AndroidAgentExecutionState {
  const version = Number(runtime.platform.version)
  return {
    available: reason === 'native_error', reason,
    androidApiLevel: runtime.platform.os === 'android' && Number.isSafeInteger(version) && version > 0 ? version : 0,
    elapsedRealtimeMs: 0, leaseTtlMs: ANDROID_AGENT_LEASE_TTL_MS, renewIntervalMs: ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS,
    foregroundServiceRunning: false, wakeLockHeld: false, runningCriticalCallbacksReliable: false,
    leases: [], controls: [], lastControlSequence: 0,
    pressure: { sequence: 0, level: 'normal', source: 'initial', androidTrimLevel: 0, cacheTrimOnly: false, observedAtElapsedMs: 0 },
  }
}

function validateRun(value: unknown): void {
  const map = record(value)
  if (typeof map.runId !== 'string' || !RUN_ID.test(map.runId)) throw invalidResult()
  integer(map.generation, 1)
}

function identityOf(lease: AndroidAgentExecutionLease): LeaseIdentity {
  return { runId: lease.runId, generation: lease.generation, startId: lease.startId, leaseToken: lease.leaseToken }
}

function sameIdentity(lease: AndroidAgentExecutionLease, input: AndroidAgentExecutionAcquireInput | AndroidAgentExecutionLease, includeNative: boolean): boolean {
  return lease.runId === input.runId && lease.generation === input.generation &&
    (!includeNative || (lease.startId === (input as AndroidAgentExecutionLease).startId && lease.leaseToken === (input as AndroidAgentExecutionLease).leaseToken))
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResult()
  return value as Record<string, unknown>
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalidResult()
  return value
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidResult()
  return value
}

function token(value: unknown): string {
  if (typeof value !== 'string' || !LEASE_TOKEN.test(value)) throw invalidResult()
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalidResult()
  return value as T
}

function boundedArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalidResult()
  return value
}

function invalidResult(): Error {
  return new Error('Invalid Android Agent execution native result.')
}
