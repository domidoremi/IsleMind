import { appendRuntimeLog, redactRuntimeLogValue, type RuntimeLogEvent, type RuntimeLogOptions } from '@/services/runtimeLog'
import {
  RUNTIME_EVENT_SCHEMA,
  shouldNotifyRuntimeEventSubscribers,
  shouldPersistRuntimeEvent,
  runtimeLogEventForRuntimeEvent,
  type RuntimeControlPlaneEvent,
} from '@/services/runtimeEventContract'

export const RUNTIME_EVENT_DATA_LIST_LIMIT = 24
export const RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT = 32
export const RUNTIME_EVENT_HISTORY_LIMIT = 200
export const RUNTIME_EVENT_EXPLANATORY_HISTORY_RESERVE = 50
export {
  RUNTIME_EVENT_SCHEMA,
  RUNTIME_EVENT_SKIPPED_LOG_EVENTS,
  RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS,
  runtimeLogEventForRuntimeEvent,
  shouldNotifyRuntimeEventSubscribers,
  shouldPersistRuntimeEvent,
} from '@/services/runtimeEventContract'
export type { RuntimeControlPlaneEvent } from '@/services/runtimeEventContract'

export interface RuntimeEventEnvelope {
  schema: typeof RUNTIME_EVENT_SCHEMA
  id: string
  ts: string
  event: RuntimeControlPlaneEvent
  conversationId?: string
  turnId?: string
  messageId?: string
  providerId?: string
  credentialGroupId?: string
  model?: string
  data: Record<string, unknown>
  redaction: {
    applied: true
    strategy: 'runtime-log-redaction-v1'
  }
}

export interface RuntimeEventInput {
  event: RuntimeControlPlaneEvent
  conversationId?: string
  turnId?: string
  messageId?: string
  providerId?: string
  credentialGroupId?: string
  model?: string
  data?: Record<string, unknown>
  legacyEvent?: RuntimeLogEvent
  legacyData?: Record<string, unknown>
  options?: RuntimeLogOptions
}

export type RuntimeEventSubscriber = (event: RuntimeEventEnvelope) => void

const RESERVED_LEGACY_LOG_KEYS = new Set(['schema', 'ts', 'event', 'runtimeEvent'])
const runtimeEventHistory: RuntimeEventEnvelope[] = []
const runtimeEventSubscribers = new Set<RuntimeEventSubscriber>()

export function buildRuntimeEventEnvelope(input: RuntimeEventInput, now = new Date()): RuntimeEventEnvelope {
  return {
    schema: RUNTIME_EVENT_SCHEMA,
    id: createRuntimeEventId(now),
    ts: now.toISOString(),
    event: input.event,
    conversationId: input.conversationId,
    turnId: input.turnId,
    messageId: input.messageId,
    providerId: input.providerId,
    credentialGroupId: input.credentialGroupId,
    model: input.model,
    data: normalizeRuntimeEventData(redactRuntimeLogValue(input.data ?? {})),
    redaction: {
      applied: true,
      strategy: 'runtime-log-redaction-v1',
    },
  }
}

export async function emitRuntimeEvent(input: RuntimeEventInput): Promise<RuntimeEventEnvelope> {
  const envelope = buildRuntimeEventEnvelope(input)
  recordRuntimeEventEnvelope(envelope)
  if (!shouldPersistRuntimeEvent(input.event)) return envelope
  const legacyEvent = input.legacyEvent ?? runtimeLogEventForRuntimeEvent(input.event)
  await appendRuntimeLog(legacyEvent, {
    ...sanitizeLegacyRuntimeLogData(input.legacyData ?? {}),
    runtimeEvent: envelope,
  }, input.options ?? {})
  return envelope
}

export function subscribeRuntimeEvents(subscriber: RuntimeEventSubscriber): () => void {
  runtimeEventSubscribers.add(subscriber)
  return () => {
    runtimeEventSubscribers.delete(subscriber)
  }
}

export function getRuntimeEventHistory(limit = RUNTIME_EVENT_HISTORY_LIMIT): RuntimeEventEnvelope[] {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.min(RUNTIME_EVENT_HISTORY_LIMIT, Math.max(0, Math.floor(limit)))
    : RUNTIME_EVENT_HISTORY_LIMIT
  if (normalizedLimit === 0) return []
  return runtimeEventHistory.slice(-normalizedLimit)
}

export function clearRuntimeEventHistoryForTest(): void {
  runtimeEventHistory.length = 0
  runtimeEventSubscribers.clear()
}

function sanitizeLegacyRuntimeLogData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !RESERVED_LEGACY_LOG_KEYS.has(key)),
  )
}

function recordRuntimeEventEnvelope(envelope: RuntimeEventEnvelope): void {
  runtimeEventHistory.push(envelope)
  pruneRuntimeEventHistory()
  if (!shouldNotifyRuntimeEventSubscribers(envelope.event)) return
  for (const subscriber of runtimeEventSubscribers) {
    try {
      subscriber(envelope)
    } catch {
      // Runtime event subscribers are diagnostic-only and must not affect request execution.
    }
  }
}

function pruneRuntimeEventHistory(): void {
  while (runtimeEventHistory.length > RUNTIME_EVENT_HISTORY_LIMIT) {
    const explanatoryCount = runtimeEventHistory.filter((event) => shouldNotifyRuntimeEventSubscribers(event.event)).length
    const removableHighFrequencyIndex = explanatoryCount <= RUNTIME_EVENT_EXPLANATORY_HISTORY_RESERVE
      ? runtimeEventHistory.findIndex((event) => !shouldNotifyRuntimeEventSubscribers(event.event))
      : -1
    runtimeEventHistory.splice(removableHighFrequencyIndex >= 0 ? removableHighFrequencyIndex : 0, 1)
  }
}

function normalizeRuntimeEventData(data: unknown): Record<string, unknown> {
  const normalized = normalizeRuntimeEventValue(data, 0)
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? normalized as Record<string, unknown> : {}
}

function normalizeRuntimeEventValue(data: unknown, depth: number): unknown {
  if (Array.isArray(data)) return data.slice(0, RUNTIME_EVENT_DATA_LIST_LIMIT).map((item) => normalizeRuntimeEventValue(item, depth + 1))
  if (!data || typeof data !== 'object') return data
  if (depth >= 6) return '[truncated]'
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>)
      .slice(0, RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT)
      .map(([key, value]) => [key, normalizeRuntimeEventValue(value, depth + 1)]),
  )
}

function createRuntimeEventId(now: Date): string {
  return `runtime-event-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
