import type { JsonRecord, JsonValue, TaskId } from '@/core'
import type { TaskArtifact, TaskExecutionResult, TaskExecutor } from '@/modules/tasks'

export const INTEGRATION_SOURCES = ['mcp', 'builtin', 'android'] as const

export type IntegrationSource = typeof INTEGRATION_SOURCES[number]

export interface ToolDefinition {
  id: string
  source: IntegrationSource
  capabilityScope: readonly string[]
  requiresConfirmation: boolean
}

export interface ToolRequest {
  taskId: TaskId
  tool: ToolDefinition
  arguments: JsonRecord
}

export interface ToolResult extends TaskExecutionResult {
  artifacts?: readonly TaskArtifact[]
}

export type ExternalToolObservationStatus = 'done' | 'error' | 'skipped'

export type ExternalToolObservationErrorCode =
  | 'tool_unavailable'
  | 'permission_required'
  | 'schema_invalid'
  | 'evidence_insufficient'
  | 'cancelled'
  | 'step_limit_reached'
  | 'policy_denied'
  | 'execution_failed'

export interface ExternalToolObservationBlock {
  type: 'text' | 'image' | 'resource'
  text?: string
  mimeType?: string
  uri?: string
  data?: string
  name?: string
}

export interface ExternalToolDiagnostic {
  id: string
  type: 'tool' | 'system'
  title: string
  content?: string
  status: 'done' | 'error' | 'skipped' | 'cancelled'
  startedAt?: number
  completedAt?: number
  metadata?: JsonRecord
}

/**
 * Source-neutral visible output for an external tool execution. Rich blocks
 * remain live while the bounded summary and artifact references are persisted
 * by the task runtime.
 */
export interface ExternalToolObservation {
  ok: boolean
  status: ExternalToolObservationStatus
  output: string
  blocks: readonly ExternalToolObservationBlock[]
  diagnostic: ExternalToolDiagnostic
  errorCode?: ExternalToolObservationErrorCode
  metadata?: JsonRecord
}

export interface ExternalToolExecutionResult extends ToolResult {
  summary: string
  observation: ExternalToolObservation
}

export interface ToolAdapter {
  definition: ToolDefinition
  execute(request: ToolRequest, options: { signal: AbortSignal }): Promise<ToolResult>
}

export interface ToolTaskExecutorInput {
  arguments: JsonRecord
}

/**
 * Tool arguments enter through provider, MCP, CLI, and native boundaries. Copy
 * them into the shared JSON contract before they reach an adapter so mutable
 * or non-serializable host objects cannot leak into task execution.
 */
export function parseToolArguments(value: unknown): JsonRecord {
  if (!isPlainRecord(value)) {
    throw new InvalidToolArgumentsError('Tool arguments must be a JSON object.')
  }
  return copyJsonRecord(value, new WeakSet<object>(), 0)
}

export function createToolTaskExecutor(
  adapter: ToolAdapter,
  input: ToolTaskExecutorInput,
): TaskExecutor {
  assertToolDefinition(adapter.definition)
  return {
    async execute(task, options) {
      if (task.toolId !== adapter.definition.id) {
        throw new ToolTaskBindingError(task.id, adapter.definition.id)
      }
      return adapter.execute({
        taskId: task.id,
        tool: adapter.definition,
        arguments: input.arguments,
      }, options)
    },
  }
}

export class ToolTaskBindingError extends Error {
  constructor(taskId: TaskId, toolId: string) {
    super(`Task ${taskId} is not bound to tool ${toolId}.`)
    this.name = 'ToolTaskBindingError'
  }
}

export class InvalidToolArgumentsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidToolArgumentsError'
  }
}

function assertToolDefinition(definition: ToolDefinition): void {
  if (!definition || typeof definition !== 'object' || !definition.id.trim() ||
    !isIntegrationSource(definition.source) || !Array.isArray(definition.capabilityScope) || !definition.capabilityScope.length ||
    !definition.capabilityScope.every((value) => typeof value === 'string' && value.trim()) ||
    typeof definition.requiresConfirmation !== 'boolean') {
    throw new Error('Tool definitions require an ID, integration source, and explicit capability scope.')
  }
}

function isIntegrationSource(value: unknown): value is IntegrationSource {
  return value === 'mcp' || value === 'builtin' || value === 'android'
}

function copyJsonRecord(
  value: Record<string, unknown>,
  ancestors: WeakSet<object>,
  depth: number,
): JsonRecord {
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  withAncestor(value, ancestors, () => {
    for (const [key, entry] of Object.entries(value)) {
      output[key] = copyJsonValue(entry, ancestors, depth + 1)
    }
  })
  return output
}

function copyJsonValue(value: unknown, ancestors: WeakSet<object>, depth: number): JsonValue {
  if (depth > 32) throw new InvalidToolArgumentsError('Tool arguments exceed the maximum JSON depth.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidToolArgumentsError('Tool arguments contain a non-finite number.')
    return value
  }
  if (Array.isArray(value)) {
    const output: JsonValue[] = []
    withAncestor(value, ancestors, () => {
      for (const entry of value) output.push(copyJsonValue(entry, ancestors, depth + 1))
    })
    return output
  }
  if (isPlainRecord(value)) return copyJsonRecord(value, ancestors, depth)
  throw new InvalidToolArgumentsError('Tool arguments contain a non-JSON value.')
}

function withAncestor(value: object, ancestors: WeakSet<object>, copy: () => void): void {
  if (ancestors.has(value)) throw new InvalidToolArgumentsError('Tool arguments contain a circular reference.')
  ancestors.add(value)
  try {
    copy()
  } finally {
    ancestors.delete(value)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
