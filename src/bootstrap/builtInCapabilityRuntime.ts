import type { TaskId } from '@/core'
import {
  BUILT_IN_CAPABILITY_SERVER_ID,
  createBuiltInCapabilityAdapters,
  createBuiltInCapabilityToolManifests,
  getBuiltInCapabilityToolPolicy,
  listRunnableBuiltInCapabilityToolNames,
  type BuiltInCapabilityAdmissionDecision,
  type BuiltInCapabilityAdmissionPort,
  type BuiltInCapabilityAdapter,
  type BuiltInCapabilityAdapterDependencies,
  type BuiltInCapabilityToolName,
  type IntegrationToolManifest,
} from '@/modules/integrations'

export interface BuiltInCapabilityRuntimeBinding {
  readonly serverId: string
  readonly enabledToolNames: readonly BuiltInCapabilityToolName[]
  readonly manifests: readonly IntegrationToolManifest[]
  readonly adapters: readonly BuiltInCapabilityAdapter[]
  resolveAdapter(toolId: string): BuiltInCapabilityAdapter | undefined
}

export interface BuiltInCapabilityRuntimeOptions {
  serverId?: string
  serverName?: string
  enabled?: boolean
  enabledToolNames?: readonly BuiltInCapabilityToolName[]
}

/**
 * Bootstrap-owned composition for the target built-in capability boundary.
 * Production callers must supply task admission and concrete platform ports;
 * this binding never invents permission, confirmation, filesystem, media, or
 * network trust evidence.
 */
export function createBuiltInCapabilityRuntimeBinding(
  dependencies: BuiltInCapabilityAdapterDependencies,
  options: BuiltInCapabilityRuntimeOptions = {},
): BuiltInCapabilityRuntimeBinding {
  const serverId = options.serverId ?? BUILT_IN_CAPABILITY_SERVER_ID
  const enabledToolNames = resolveEnabledToolNames(dependencies, options)
  const manifests = createBuiltInCapabilityToolManifests({
    serverId,
    ...(options.serverName !== undefined ? { serverName: options.serverName } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    enabledToolNames,
  })
  const adapters = createBuiltInCapabilityAdapters(dependencies, { serverId, enabledToolNames })
  const adaptersById = new Map<string, BuiltInCapabilityAdapter>(
    adapters.map((adapter) => [adapter.definition.id, adapter] as const),
  )

  for (const manifest of manifests) {
    if (!manifest.enabled) continue
    if (!adaptersById.has(manifest.id)) {
      throw new Error(`Built-in capability manifest ${manifest.id} has no bound adapter.`)
    }
  }

  return {
    serverId,
    enabledToolNames,
    manifests,
    adapters,
    resolveAdapter(toolId) {
      return adaptersById.get(toolId)
    },
  }
}

/**
 * Creates the narrow task-bound attestation used by the built-in adapters.
 * The lookup must reread durable task state; callers may not attest from tool
 * arguments or a stale in-memory permission snapshot.
 */
export function createBuiltInCapabilityTaskAdmissionPort(
  getTask: (taskId: TaskId) => Promise<BuiltInCapabilityTaskRecord | undefined>,
): BuiltInCapabilityAdmissionPort {
  return {
    async admit(request, options): Promise<BuiltInCapabilityAdmissionDecision> {
      if (options.signal.aborted) {
        return { status: 'unavailable', reason: 'The task admission lookup was cancelled.' }
      }
      let task: BuiltInCapabilityTaskRecord | undefined
      try {
        task = await getTask(request.taskId)
      } catch {
        return { status: 'unavailable', reason: 'The durable task admission record is unavailable.' }
      }
      if (options.signal.aborted) {
        return { status: 'unavailable', reason: 'The task admission lookup was cancelled.' }
      }
      if (!task) return { status: 'unavailable', reason: 'The durable task does not exist.' }
      if (task.id !== request.taskId || task.toolId !== request.toolId) {
        return { status: 'denied', reason: 'The durable task is bound to a different tool.' }
      }
      const capabilityPolicy = getBuiltInCapabilityToolPolicy(request.toolName)
      if (
        request.requiresConfirmation !== capabilityPolicy.requiresConfirmation ||
        !samePermissions(request.requiredPermissions, capabilityPolicy.permissions)
      ) {
        return { status: 'denied', reason: 'The requested capability scope does not match the canonical tool policy.' }
      }
      if (task.status !== 'running') {
        return { status: 'denied', reason: 'The durable task is not actively admitted for execution.' }
      }
      if (request.requiresConfirmation && !Number.isFinite(task.confirmationConfirmedAt)) {
        return { status: 'confirmation_required', reason: 'A current durable confirmation is required.' }
      }
      if (
        task.policy.outcome !== 'allowed' &&
        !(request.requiresConfirmation && task.policy.outcome === 'requires-confirmation')
      ) {
        return { status: 'denied', reason: 'The durable task policy does not admit this execution.' }
      }
      return {
        status: 'allowed',
        taskId: task.id,
        toolId: task.toolId,
        grantedPermissions: [...capabilityPolicy.permissions],
        confirmed: !request.requiresConfirmation || Number.isFinite(task.confirmationConfirmedAt),
        ...(request.requiresConfirmation ? {
          confirmationTokenDigest: 'durable-confirmed',
          idempotencyKey: task.idempotencyKey,
        } : {}),
      }
    },
  }
}

export interface BuiltInCapabilityTaskRecord {
  id: TaskId
  toolId: string
  idempotencyKey: string
  status: string
  policy: { outcome: string }
  confirmationConfirmedAt?: number
}

function resolveEnabledToolNames(
  dependencies: BuiltInCapabilityAdapterDependencies,
  options: BuiltInCapabilityRuntimeOptions,
): BuiltInCapabilityToolName[] {
  const available = new Set(listRunnableBuiltInCapabilityToolNames(dependencies))
  const requested = options.enabledToolNames ?? [...available]
  if (options.enabled === false) return []
  return requested.filter((name, index) => available.has(name) && requested.indexOf(name) === index)
}

function samePermissions(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length && actual.every((permission, index) => permission === expected[index])
}
