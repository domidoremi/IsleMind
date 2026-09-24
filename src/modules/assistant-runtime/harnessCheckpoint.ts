import { asAssistantRunId, freezeChatRequest, type AssistantRunId, type ChatRequest } from '@/core'
import { freezeAgentDefinition, type FrozenAgentDefinition } from './agentDefinition'
import { buildAssistantCapabilityRevision, buildAssistantRequestHash } from './application/requestIdentity'
import type { AssistantRun, AssistantRunStatus } from './contracts'
import { HARNESS_PAUSE_REASONS, type HarnessPauseReason } from './harnessPauseReason'
import type { HarnessCheckpoint } from './harnessCheckpointTypes'
import { decodeDelegation } from './agentCollaboration'
export type { HarnessCheckpoint } from './harnessCheckpointTypes'

export const HARNESS_CHECKPOINT_SCHEMA = 'islemind.harness-checkpoint.v1' as const

/** Bounded UI/alert projection: never hands prompts, output or tool arguments to observers. */
export interface RunSnapshot {
  readonly id: AssistantRunId
  readonly rootRunId?: AssistantRunId
  readonly parentRunId?: AssistantRunId
  readonly taskKind?: AssistantRun['taskKind']
  readonly status: AssistantRunStatus
  readonly sequence: number
  readonly agentId?: string
  readonly agentRevision?: number
  readonly phase?: HarnessCheckpoint['phase']
  readonly effectCertainty?: HarnessCheckpoint['effectCertainty']
  readonly recovery?: HarnessCheckpoint['recovery']
  readonly waiting: boolean
  readonly waitingReason?: HarnessPauseReason
  readonly pendingSteeringCount: number
}

export function projectRunSnapshot(run: AssistantRun): RunSnapshot {
  return Object.freeze({ id: run.id, status: run.status, sequence: run.journalSequence,
    ...(run.rootRunId ? { rootRunId: run.rootRunId } : {}),
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    ...(run.taskKind ? { taskKind: run.taskKind } : {}),
    ...(run.agentDefinition ? { agentId: run.agentDefinition.id, agentRevision: run.agentDefinition.revision } : {}),
    ...(run.lifecycleCheckpoint ? { phase: run.lifecycleCheckpoint.phase,
      effectCertainty: run.lifecycleCheckpoint.effectCertainty, recovery: run.lifecycleCheckpoint.recovery } : {}),
    ...(run.lifecycleCheckpoint?.waitingReason ? { waitingReason: run.lifecycleCheckpoint.waitingReason } : {}),
    waiting: run.status === 'paused' || run.status === 'awaiting-confirmation',
    pendingSteeringCount: run.lifecycleCheckpoint?.steering.length ?? 0,
  })
}

export function createHarnessCheckpoint(input: Omit<HarnessCheckpoint, 'schema' | 'requestHash' | 'capabilityRevision'>): HarnessCheckpoint {
  const request = freezeChatRequest(input.request)
  return Object.freeze({ ...input, request, schema: HARNESS_CHECKPOINT_SCHEMA,
    requestHash: buildAssistantRequestHash(request), capabilityRevision: buildAssistantCapabilityRevision(request),
    steering: Object.freeze(input.steering.map((entry) => Object.freeze({ ...entry }))),
  })
}

/** Persistence boundary, fail closed on malformed/unsupported continuation data. */
export function decodeHarnessState(json: string | null | undefined): {
  agentDefinition?: FrozenAgentDefinition; lifecycleCheckpoint?: HarnessCheckpoint
} & Pick<AssistantRun, 'rootRunId' | 'parentRunId' | 'taskKind' | 'delegation'> {
  if (!json) return {}
  if (json.length > 5 * 1024 * 1024) throw new Error('Harness checkpoint exceeds limit.')
  const value = JSON.parse(json)
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['agentDefinition', 'lifecycleCheckpoint', 'rootRunId', 'parentRunId', 'taskKind', 'delegation'].includes(key))) {
    throw new Error('Invalid Harness checkpoint envelope.')
  }
  const definition = value.agentDefinition === undefined ? undefined : freezeAgentDefinition(value.agentDefinition)
  const ownership: Pick<AssistantRun, 'rootRunId' | 'parentRunId' | 'taskKind' | 'delegation'> = {}
  for (const key of ['rootRunId', 'parentRunId'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || !value[key] || value[key].length > 512) throw new Error('Invalid Harness ownership')
      ownership[key] = asAssistantRunId(value[key])
    }
  }
  if (ownership.parentRunId && ownership.parentRunId !== ownership.rootRunId) throw new Error('Harness child depth exceeds limit')
  if (value.taskKind !== undefined) {
    if (!['chat', 'research', 'artifact'].includes(value.taskKind)) throw new Error('Invalid Harness task kind')
    ownership.taskKind = value.taskKind
  }
  if (value.delegation !== undefined) ownership.delegation = decodeDelegation(value.delegation)
  if (ownership.parentRunId && ownership.delegation?.children.length) throw new Error('Child cannot delegate')
  const item = value.lifecycleCheckpoint
  if (item === undefined) return { ...ownership, ...(definition ? { agentDefinition: definition } : {}) }
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || Object.keys(item).length !== (item.waitingReason === undefined ? 12 : 13) || item.schema !== HARNESS_CHECKPOINT_SCHEMA
    || (item.waitingReason !== undefined && !HARNESS_PAUSE_REASONS.includes(item.waitingReason))
    || !['ready', 'provider', 'operation', 'confirmation', 'complete'].includes(item.phase)
    || !['none', 'settled', 'uncertain'].includes(item.effectCertainty)
    || !['resumable', 'reconciliation-required'].includes(item.recovery)
    || typeof item.requiresOperationSession !== 'boolean'
    || !Number.isSafeInteger(item.stepIndex) || item.stepIndex < 0 || item.stepIndex > 1_000_000
    || typeof item.outputText !== 'string' || item.outputText.length > 1_000_000
    || !Number.isSafeInteger(item.streamEventCount) || item.streamEventCount < 0
    || !Array.isArray(item.steering) || item.steering.length > 64
    || !item.steering.every((entry: { id?: unknown; text?: unknown; createdAt?: unknown }) => entry
      && Object.keys(entry).length === 3 && typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 512
      && typeof entry.text === 'string' && entry.text.trim().length > 0 && entry.text.length <= 8_000
      && Number.isSafeInteger(entry.createdAt) && Number(entry.createdAt) >= 0)
    || (item.effectCertainty === 'uncertain' && item.recovery !== 'reconciliation-required')
    || (item.phase === 'operation' && item.effectCertainty !== 'uncertain')) {
    throw new Error('Invalid Harness continuation checkpoint.')
  }
  const checkpoint = createHarnessCheckpoint(item)
  if (checkpoint.requestHash !== item.requestHash || checkpoint.capabilityRevision !== item.capabilityRevision) {
    throw new Error('Harness checkpoint identity mismatch.')
  }
  return { ...ownership, ...(definition ? { agentDefinition: definition } : {}), lifecycleCheckpoint: checkpoint }
}
