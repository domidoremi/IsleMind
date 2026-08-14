import { createVNextTaskRuntime } from '@/bootstrap/vnextTaskRuntime'
import type { AssistantRunId, JsonRecord, TaskId } from '@/core'
import {
  createLocalToolAdapter,
  createMcpToolAdapter,
  createToolTaskExecutor,
  decideToolPermission,
  listConversationToolCatalog,
  listAppActionToolDescriptors,
  normalizeExternalToolExecutionResult,
  parseToolArguments,
  resolveTaskBoundInternalToolAdapter,
  resolveToolPermissionPolicyLimits,
  resolveUniqueToolManifest,
  validateToolInputSchema,
  WORK_ARTIFACT_TOOL_MANIFEST,
  type ConversationToolCatalogManifest,
  type ConversationToolCatalogSourcePorts,
  type ExternalToolExecutionResult,
  type ExternalToolObservation,
  type ExternalToolObservationErrorCode,
  type IntegrationSource,
  type ToolAdapter,
  type ToolPermissionPolicyContext,
  type ToolPermissionPolicyDecision,
  type ToolPermissionPolicyLimits,
  type WorkArtifactTaskAdapter,
  type WorkArtifactTaskResult,
} from '@/modules/integrations'
import type { SettingsActionName } from '@/modules/settings'
import type {
  WorkflowRuntimeFailureCode as AgentFailureCode,
  WorkflowStepObservation as AgentStepObservation,
  WorkflowStepToolRequest as AgentToolRequest,
  ModelOperationAuthorizationAttestation,
  ModelOperationAuthorizationPolicy,
  ModelOperationAuthorizationVerification,
  Task,
  TaskPolicyDecision,
  TaskPolicyEvaluator,
  TaskRuntime,
} from '@/modules/tasks'
import {
  createKnowledgeRagReplaySnapshotFromContextPack,
  createSqliteKnowledgeRagReplaySnapshotRepository,
  KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST,
  knowledgeRagReplaySnapshotChecksum,
  replayKnowledgeRagSnapshotOutput,
  type KnowledgeRagReplaySnapshotRepository,
  type KnowledgeRagReplaySnapshot,
} from '@/modules/knowledge'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { clampTraceText, projectProcessTrace, redactSensitiveText } from '@/core'
import { buildWorkArtifactWorkflowOutput } from '@/bootstrap/workArtifactWorkflow'

type TaskBoundExternalToolSource = 'mcp' | 'builtin' | 'app-action' | 'android'
type TaskBoundInternalToolSource = 'rag' | 'search' | 'work-artifact'

interface RagContextPackRuntime {
  buildContextPack(
    request: {
      query: string
      conversationTitle?: string
      systemPrompt?: string
      profile?: 'fast' | 'balanced' | 'deep' | 'offline'
      profileReason?: string
      tokenBudget?: number
      maxContextItems?: number
    },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>
}

export interface TaskBoundToolRuntimeOptions extends ToolPermissionPolicyContext {
  manifests?: readonly ConversationToolCatalogManifest[]
  limits?: Partial<ToolPermissionPolicyLimits> & { outputCharLimit?: number }
  signal?: AbortSignal
  runtimeLog?: { enabled?: boolean; maxBytes?: number }
  ragRuntime?: RagContextPackRuntime
}

export interface ExecuteTaskBoundToolInput {
  stepId: string
  /** The durable assistant run that owns this tool task, when available. */
  assistantRunId?: AssistantRunId
  modelOperationAuthorization?: {
    policy: ModelOperationAuthorizationPolicy
    attestation: ModelOperationAuthorizationAttestation
    expected: ModelOperationAuthorizationVerification
  }
  request: AgentToolRequest
  options: TaskBoundToolRuntimeOptions
}

export interface TaskBoundExternalToolExecutionOptions {
  taskId: string
  signal: AbortSignal
  runtimeLog?: TaskBoundToolRuntimeOptions['runtimeLog']
}

export interface TaskBoundToolRuntimeDependencies {
  createTaskRuntime(policyEvaluator: TaskPolicyEvaluator): TaskRuntime
  ragReplaySnapshotRepository?: KnowledgeRagReplaySnapshotRepository
  listToolManifests(): Promise<readonly ConversationToolCatalogManifest[]>
  resolveTool?(
    request: AgentToolRequest,
    manifests: readonly ConversationToolCatalogManifest[],
  ): ConversationToolCatalogManifest | null
  executeMcpTool(
    tool: ConversationToolCatalogManifest,
    argumentsValue: JsonRecord,
    options: TaskBoundExternalToolExecutionOptions,
  ): Promise<ExternalToolExecutionResult>
  executeBuiltinTool(
    tool: ConversationToolCatalogManifest,
    argumentsValue: JsonRecord,
    options: TaskBoundExternalToolExecutionOptions,
  ): Promise<ExternalToolExecutionResult>
  executeAppActionTool(
    tool: ConversationToolCatalogManifest,
    argumentsValue: JsonRecord,
    options: TaskBoundExternalToolExecutionOptions,
  ): Promise<ExternalToolExecutionResult>
  executeAndroidTool(
    tool: ConversationToolCatalogManifest,
    argumentsValue: JsonRecord,
    options: TaskBoundExternalToolExecutionOptions,
  ): Promise<ExternalToolExecutionResult>
}

export interface TaskBoundToolRuntime {
  execute(input: ExecuteTaskBoundToolInput): Promise<AgentStepObservation | undefined>
  executeExternal(input: ExecuteTaskBoundToolInput): Promise<ExternalToolExecutionResult>
}

type TaskBoundToolExecutionOutcome =
  | { kind: 'external'; result: ExternalToolExecutionResult }
  | { kind: 'internal'; result: AgentStepObservation }
  | { kind: 'unhandled' }

const ragReplaySnapshotRepository = createSqliteKnowledgeRagReplaySnapshotRepository(
  createExpoSqliteDatabaseProvider(),
)

export function createTaskBoundToolRuntime(
  dependencies: TaskBoundToolRuntimeDependencies,
): TaskBoundToolRuntime {
  const executeToolTask = async (
    input: ExecuteTaskBoundToolInput,
  ): Promise<TaskBoundToolExecutionOutcome> => {
      if (input.options.signal?.aborted) {
        return externalOutcome(cancelledExternalToolExecutionResult(
          input.request,
          requestedExternalTaskBoundToolSource(input.request) ?? 'builtin',
        ))
      }
      const manifests = input.options.manifests ?? await dependencies.listToolManifests()
      if (input.options.signal?.aborted) {
        return externalOutcome(cancelledExternalToolExecutionResult(
          input.request,
          requestedExternalTaskBoundToolSource(input.request) ?? 'builtin',
        ))
      }
      const tool = dependencies.resolveTool?.(input.request, manifests)
        ?? resolveUniqueToolManifest(input.request, manifests)
      if (!tool) {
        if (isExplicitInternalRequest(input.request)) return unhandledOutcome()
        return externalOutcome(unavailableExternalToolExecutionResult(
          input.request,
          requestedExternalTaskBoundToolSource(input.request) ?? 'builtin',
        ))
      }
      const workArtifactAdapter = resolveWorkArtifactTaskAdapter(tool, input.options)
      const replayRepository = dependencies.ragReplaySnapshotRepository ?? ragReplaySnapshotRepository
      const ragAdapter = resolveRagTaskAdapter(tool, input.options, replayRepository)
      if (isRagContextPackTool(tool) && !ragAdapter) {
        return internalOutcome(ragRuntimeUnavailableResult(tool))
      }
      if (isTaskBoundInternalToolSource(tool.source) && !workArtifactAdapter && !ragAdapter) return unhandledOutcome()
      if (!workArtifactAdapter && !ragAdapter && !isTaskBoundExternalToolSource(tool.source)) {
        return externalOutcome(unavailableExternalToolExecutionResult(input.request, 'builtin'))
      }
      if (tool.source === 'mcp' && !hasCanonicalMcpIdentity(tool)) {
        return toolTaskFailureOutcome(tool, 'tool_unavailable', 'MCP tool identity is invalid.')
      }

      let toolArguments: JsonRecord
      try {
        toolArguments = parseToolArguments(input.request.arguments ?? {})
      } catch (error) {
        return toolTaskFailureOutcome(
          tool,
          'schema_invalid',
          error instanceof Error ? error.message : 'Tool arguments are not valid JSON.',
        )
      }

      const limits = resolveToolPermissionPolicyLimits(input.options.limits)
      let permission: ToolPermissionPolicyDecision
      try {
        permission = decideToolPermission(tool, input.options, limits)
      } catch {
        return toolTaskFailureOutcome(tool, 'execution_failed', 'The tool permission decision could not be evaluated.')
      }

      if (permission.decision !== 'deny') {
        let schema: ReturnType<typeof validateToolInputSchema>
        try {
          schema = validateToolInputSchema(tool.inputSchema, toolArguments)
        } catch {
          return toolTaskFailureOutcome(tool, 'schema_invalid', 'Tool input schema is invalid.')
        }
        if (!schema.ok) {
          return toolTaskFailureOutcome(tool, 'schema_invalid', schema.errors.join('\n'))
        }
      }

      const runtime = dependencies.createTaskRuntime({
        async evaluate() {
          return toTaskPolicyDecision(permission, tool.requiresConfirmation === true)
        },
      })
      const modelAuthorization = input.modelOperationAuthorization
      if (modelAuthorization && !modelAuthorization.policy.verify(
        modelAuthorization.attestation,
        modelAuthorization.expected,
      )) {
        return toolTaskFailureOutcome(
          tool,
          'policy_denied',
          'The model-operation authorization attestation is invalid.',
        )
      }
      const idempotencyKey = modelAuthorization?.attestation.idempotencyKey ??
        buildIdempotencyKey(input.assistantRunId, input.stepId, tool.id, toolArguments)
      const created = await runtime.create({
        toolId: tool.id,
        idempotencyKey,
        ...(input.assistantRunId ? { runId: input.assistantRunId } : {}),
      })
      if (!created.ok) {
        return toolTaskFailureOutcome(tool, mapTaskRuntimeFailure(created.error.code), created.error.message)
      }

      let task = created.value
      if (input.options.signal?.aborted && (task.status === 'queued' || task.status === 'awaiting-confirmation' || task.status === 'running')) {
        const cancelled = await runtime.cancel(task.id)
        if (!cancelled.ok) {
          const authoritativeTask = await runtime.getTask(task.id)
          if (authoritativeTask?.status === 'cancelled') {
            return toolTaskFailureOutcome(tool, 'cancelled', 'Agent workflow execution was cancelled.', authoritativeTask)
          }
          return toolTaskFailureOutcome(
            tool,
            'execution_failed',
            'The tool task cancellation could not be persisted.',
            authoritativeTask ?? task,
          )
        }
        return toolTaskFailureOutcome(
          tool,
          'cancelled',
          'Agent workflow execution was cancelled.',
          cancelled.value,
        )
      }
      if (task.status === 'awaiting-confirmation') {
        if (permission.decision !== 'allow' || (tool.requiresConfirmation === true && !input.options.userConfirmed)) {
          return toolPermissionOutcome(
            tool,
            permission.decision === 'allow' ? durableConfirmationDecision(permission) : permission,
            input.options,
            limits,
            task,
          )
        }
        const confirmed = await runtime.confirm(task.id, {
          confirmationId: `agent-confirm-${hashText(input.stepId)}`,
        })
        if (!confirmed.ok) {
          return toolTaskFailureOutcome(tool, mapTaskRuntimeFailure(confirmed.error.code), confirmed.error.message, task)
        }
        task = confirmed.value
      }

      if (task.status === 'failed') {
        if (task.failure?.code === 'policy_denied') {
          return toolPermissionOutcome(tool, permission, input.options, limits, task)
        }
        return toolTaskFailureOutcome(tool, 'execution_failed', 'The durable tool task is already failed.', task)
      }
      if (task.status === 'succeeded') {
        if (ragAdapter) {
          return internalOutcome(await replaySucceededRagResult(
            ragAdapter,
            task,
            permission,
            input.options,
            limits,
            replayRepository,
          ))
        }
        if (workArtifactAdapter) {
          return internalOutcome(replaySucceededWorkArtifactResult(
            workArtifactAdapter,
            toolArguments,
            task,
            permission,
            input.options,
            limits,
          ))
        }
        return externalOutcome(replaySucceededExternalTaskResult(tool, task, permission, input.options, limits))
      }
      if (task.status === 'cancelled') {
        return toolTaskFailureOutcome(tool, 'cancelled', 'Agent workflow execution was cancelled.', task)
      }
      if (task.status !== 'queued') {
        return toolTaskFailureOutcome(tool, mapTaskRuntimeFailure('task_not_active'), 'The durable tool task is not executable.', task)
      }


      if (ragAdapter) {
        let ragSnapshot: KnowledgeRagReplaySnapshot | undefined
        let ragFailureMessage: string | undefined
        const executed = await runtime.execute(task.id, {
          async execute(activeTask, options) {
            let execution
            try {
              execution = await ragAdapter.execute(
                toolArguments,
                activeTask.id,
                activeTask.startedAt ?? Date.now(),
                options.signal,
              )
            } catch (error) {
              if (isAbortError(error)) throw error
              ragFailureMessage = clampTraceText(
                redactSensitiveText(error instanceof Error ? error.message : `${tool.name} failed.`),
                normalizeWorkArtifactOutputLimit(input.options.limits?.outputCharLimit),
              )
              throw error
            }
            ragSnapshot = execution.snapshot
            return {
              summary: execution.visibleOutput,
              artifacts: [execution.artifact],
            }
          },
        }, {
          ...(input.options.signal ? { cancellationSignal: input.options.signal } : {}),
        })
        if (executed.ok && ragSnapshot) {
          const ragResult = createRagVisibleResult(tool, ragSnapshot, executed.value.completedAt)
          return internalOutcome(withTaskMetadata(
            attachPermissionAuditMetadata(ragResult, tool, permission, input.options, limits),
            executed.value,
          ))
        }
        if (ragSnapshot) {
          await replayRepository.delete(task.id).catch(() => undefined)
        }
        const persisted = executed.ok ? executed.value : await runtime.getTask(task.id)
        const errorCode = !executed.ok && executed.error.code === 'cancelled'
          ? 'cancelled'
          : ragFailureMessage
            ? 'rag_unavailable'
            : 'execution_failed'
        return toolTaskFailureOutcome(
          tool,
          errorCode,
          ragFailureMessage ?? (executed.ok ? 'The RAG task completed without a replay result.' : executed.error.message),
          persisted ?? task,
        )
      }

      if (workArtifactAdapter) {
        let workArtifactResult: WorkArtifactTaskResult | undefined
        const executed = await runtime.execute(task.id, {
          async execute(activeTask, options) {
            workArtifactResult = workArtifactAdapter.execute({
              toolId: activeTask.toolId,
              arguments: toolArguments,
              signal: options.signal,
              startedAt: activeTask.startedAt,
            })
            if (!workArtifactResult.ok) throw new ExternalToolExecutionError()
            return { summary: workArtifactResult.output }
          },
        }, {
          ...(input.options.signal ? { cancellationSignal: input.options.signal } : {}),
        })
        const persisted = executed.ok ? executed.value : await runtime.getTask(task.id)
        if (workArtifactResult) {
          return internalOutcome(withTaskMetadata(
            attachPermissionAuditMetadata(toAgentStepObservation(workArtifactResult), tool, permission, input.options, limits),
            persisted ?? task,
          ))
        }
        return toolTaskFailureOutcome(
          tool,
          executed.ok ? 'execution_failed' : mapTaskRuntimeFailure(executed.error.code),
          executed.ok ? 'The work-artifact task completed without a result.' : executed.error.message,
          executed.ok ? executed.value : persisted ?? task,
        )
      }
      if (!isTaskBoundExternalToolSource(tool.source)) {
        return externalOutcome(unavailableExternalToolExecutionResult(input.request, 'builtin'))
      }

      let executionResult: ExternalToolExecutionResult | undefined
      const executionOptions = (signal: AbortSignal): TaskBoundExternalToolExecutionOptions => ({
        taskId: task.id,
        signal,
        ...(input.options.runtimeLog ? { runtimeLog: input.options.runtimeLog } : {}),
      })
      const adapter: ToolAdapter = tool.source === 'mcp'
        ? createMcpTaskAdapter(tool, toolArguments, dependencies, executionOptions, (result) => {
            executionResult = result
          }, () => runtime.cancel(task.id))
        : createLocalToolAdapter({
            id: tool.id,
            source: integrationSourceFor(tool.source),
            capabilityScope: integrationCapabilityScope(tool),
            requiresConfirmation: tool.requiresConfirmation ?? tool.permission !== 'read-only',
            enabled: tool.enabled,
          }, async (_request, options) => {
            const sourceResult = await executeExternalTool(
              dependencies,
              tool,
              toolArguments,
              executionOptions(options.signal),
            )
            const result = normalizeTargetExecutionResult(tool, sourceResult)
            executionResult = result
            if (result.observation.errorCode === 'cancelled' && !options.signal.aborted) {
              await runtime.cancel(task.id)
            }
            if (!isSuccessfulExternalResult(result)) throw new ExternalToolExecutionError()
            return result
          })

      const executed = await runtime.execute(task.id, createToolTaskExecutor(adapter, {
        arguments: toolArguments,
      }), {
        ...(input.options.signal ? { cancellationSignal: input.options.signal } : {}),
      })

      if (executionResult) {
        const persisted = executed.ok ? executed.value : await runtime.getTask(task.id)
        const observation = reconcileObservationWithTask(executionResult.observation, persisted ?? task)
        return externalOutcome(withExternalTaskMetadata(
          attachExternalPermissionAuditMetadata(
            { ...executionResult, observation },
            tool,
            permission,
            input.options,
            limits,
          ),
          persisted ?? task,
        ))
      }
      return toolTaskFailureOutcome(
        tool,
        executed.ok ? 'execution_failed' : mapTaskRuntimeFailure(executed.error.code),
        executed.ok ? 'The tool completed without a user-visible result.' : executed.error.message,
        executed.ok ? executed.value : (await runtime.getTask(task.id)) ?? task,
      )
  }

  return {
    async execute(input) {
      return resolveTaskBoundToolOutcome(await executeToolTask(input))
    },
    async executeExternal(input) {
      const outcome = await executeToolTask(input)
      if (outcome.kind === 'external') return outcome.result
      return unavailableExternalToolExecutionResult(
        input.request,
        requestedExternalTaskBoundToolSource(input.request) ?? 'builtin',
      )
    },
  }
}

function createMcpTaskAdapter(
  tool: ConversationToolCatalogManifest,
  argumentsValue: JsonRecord,
  dependencies: TaskBoundToolRuntimeDependencies,
  executionOptions: (signal: AbortSignal) => TaskBoundExternalToolExecutionOptions,
  capture: (result: ExternalToolExecutionResult) => void,
  requestCancellation: () => Promise<unknown>,
): ToolAdapter {
  if (!tool.serverId) throw new Error(`MCP tool ${tool.id} has no server identity.`)
  let sourceResult: ExternalToolExecutionResult | undefined
  const sourceAdapter = createMcpToolAdapter({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    permission: tool.permission,
    serverId: tool.serverId,
    enabled: tool.enabled,
  }, {
    async callTool(_request, options) {
      sourceResult = await dependencies.executeMcpTool(
        tool,
        argumentsValue,
        executionOptions(options.signal),
      )
      capture(sourceResult)
      return sourceResult.observation.blocks
    },
  })
  return {
    definition: sourceAdapter.definition,
    async execute(request, options) {
      await sourceAdapter.execute(request, options)
      if (sourceResult?.observation.errorCode === 'cancelled' && !options.signal.aborted) {
        await requestCancellation()
      }
      if (!sourceResult || !isSuccessfulExternalResult(sourceResult)) throw new ExternalToolExecutionError()
      return sourceResult
    },
  }
}

function normalizeTargetExecutionResult(
  tool: ConversationToolCatalogManifest,
  result: ExternalToolExecutionResult,
): ExternalToolExecutionResult {
  const normalized = normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok: result.observation.ok,
    status: result.observation.status,
    output: result.observation.output,
    blocks: result.observation.blocks,
    diagnostic: result.observation.diagnostic,
    errorCode: result.observation.errorCode,
    metadata: result.observation.metadata,
  })
  return {
    ...normalized,
    ...(result.artifacts ? { artifacts: result.artifacts } : {}),
  }
}

async function executeExternalTool(
  dependencies: TaskBoundToolRuntimeDependencies,
  tool: ConversationToolCatalogManifest,
  argumentsValue: JsonRecord,
  options: TaskBoundExternalToolExecutionOptions,
): Promise<ExternalToolExecutionResult> {
  switch (tool.source) {
    case 'builtin': return dependencies.executeBuiltinTool(tool, argumentsValue, options)
    case 'app-action': return dependencies.executeAppActionTool(tool, argumentsValue, options)
    case 'android': return dependencies.executeAndroidTool(tool, argumentsValue, options)
    default: throw new ExternalToolExecutionError()
  }
}

export async function executeTaskBoundTool(
  input: ExecuteTaskBoundToolInput,
): Promise<AgentStepObservation | undefined> {
  return (await getDefaultTaskBoundToolRuntime()).execute(input)
}

export async function executeExternalTaskBoundTool(
  input: ExecuteTaskBoundToolInput,
): Promise<ExternalToolExecutionResult> {
  return (await getDefaultTaskBoundToolRuntime()).executeExternal(input)
}

function externalOutcome(result: ExternalToolExecutionResult): TaskBoundToolExecutionOutcome {
  return { kind: 'external', result }
}

function internalOutcome(result: AgentStepObservation): TaskBoundToolExecutionOutcome {
  return { kind: 'internal', result }
}

function unhandledOutcome(): TaskBoundToolExecutionOutcome {
  return { kind: 'unhandled' }
}

function resolveTaskBoundToolOutcome(
  outcome: TaskBoundToolExecutionOutcome,
): AgentStepObservation | undefined {
  if (outcome.kind === 'external') return outcome.result.observation
  if (outcome.kind === 'internal') return outcome.result
  return undefined
}

interface RagTaskAdapter {
  manifest: ConversationToolCatalogManifest
  execute(
    argumentsValue: JsonRecord,
    taskId: string,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<{
    snapshot: KnowledgeRagReplaySnapshot
    visibleOutput: string
    artifact: Task['artifacts'][number]
  }>
}

function resolveRagTaskAdapter(
  tool: ConversationToolCatalogManifest,
  options: TaskBoundToolRuntimeOptions,
  replayRepository: KnowledgeRagReplaySnapshotRepository,
): RagTaskAdapter | undefined {
  if (!options.ragRuntime || !isRagContextPackTool(tool)) return undefined
  const outputCharLimit = normalizeWorkArtifactOutputLimit(options.limits?.outputCharLimit)
  return {
    manifest: tool,
    async execute(argumentsValue, taskId, startedAt, signal) {
      const pack = await options.ragRuntime!.buildContextPack({
        query: String(argumentsValue.query ?? ''),
        ...(typeof argumentsValue.conversationTitle === 'string' ? { conversationTitle: argumentsValue.conversationTitle } : {}),
        ...(typeof argumentsValue.systemPrompt === 'string' ? { systemPrompt: argumentsValue.systemPrompt } : {}),
        ...(normalizeRagProfile(argumentsValue.profile) ? { profile: normalizeRagProfile(argumentsValue.profile) } : {}),
        ...(typeof argumentsValue.profileReason === 'string' ? { profileReason: argumentsValue.profileReason } : {}),
        ...(typeof argumentsValue.tokenBudget === 'number' ? { tokenBudget: argumentsValue.tokenBudget } : {}),
        ...(typeof argumentsValue.maxContextItems === 'number' ? { maxContextItems: argumentsValue.maxContextItems } : {}),
      }, { signal })
      if (signal.aborted) throw createRagCancellationError()
      const snapshot = createKnowledgeRagReplaySnapshotFromContextPack(pack, startedAt, {
        outputCharLimit,
        sanitizeOutput: redactSensitiveText,
      })
      if (!snapshot) throw new Error('The RAG runtime returned an invalid replay snapshot.')
      let saved = false
      try {
        await replayRepository.save(taskId, snapshot, { signal })
        saved = true
        if (signal.aborted) throw createRagCancellationError()
        const visibleOutput = replayKnowledgeRagSnapshotOutput(snapshot)
        if (visibleOutput === undefined) throw new Error('The RAG replay output is invalid.')
        return {
          snapshot,
          visibleOutput,
          artifact: ragReplayArtifact(taskId, startedAt, snapshot),
        }
      } catch (error) {
        if (saved) await replayRepository.delete(taskId).catch(() => undefined)
        throw error
      }
    },
  }
}

function isRagContextPackTool(tool: Pick<ConversationToolCatalogManifest, 'id' | 'name' | 'source'>): boolean {
  return tool.source === KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.source &&
    tool.id === KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.id &&
    tool.name === KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST.name
}

async function replaySucceededRagResult(
  adapter: RagTaskAdapter,
  task: Task,
  permission: ToolPermissionPolicyDecision,
  context: TaskBoundToolRuntimeOptions,
  limits: ToolPermissionPolicyLimits,
  replayRepository: KnowledgeRagReplaySnapshotRepository,
): Promise<AgentStepObservation> {
  const artifactId = ragReplayArtifactId(task.id)
  const storedArtifact = task.artifacts.find((candidate) => candidate.id === artifactId)
  if (!task.result?.artifactIds.includes(artifactId) || !storedArtifact ||
    storedArtifact.uri !== ragReplayArtifactUri(task.id) || storedArtifact.mediaType !== RAG_REPLAY_MEDIA_TYPE) {
    return taskRuntimeFailure(adapter.manifest, 'execution_failed', 'The durable RAG replay artifact is missing.', task)
  }
  try {
    const snapshot = await replayRepository.get(task.id, { signal: context.signal })
    if (!snapshot) return taskRuntimeFailure(adapter.manifest, 'execution_failed', 'The durable RAG replay snapshot is missing.', task)
    const checksum = knowledgeRagReplaySnapshotChecksum(snapshot)
    if (!checksum || storedArtifact.checksum !== checksum) {
      return taskRuntimeFailure(adapter.manifest, 'execution_failed', 'The durable RAG replay snapshot checksum does not match its task artifact.', task)
    }
    const result = createRagVisibleResult(adapter.manifest, snapshot, task.completedAt, true)
    return withTaskMetadata(
      attachPermissionAuditMetadata(result, adapter.manifest, permission, context, limits),
      task,
    )
  } catch {
    return taskRuntimeFailure(adapter.manifest, 'execution_failed', 'The durable RAG replay snapshot is invalid.', task)
  }
}

function createRagVisibleResult(
  tool: ConversationToolCatalogManifest,
  snapshot: KnowledgeRagReplaySnapshot,
  completedAt?: number,
  replayed = false,
): AgentStepObservation {
  const output = replayKnowledgeRagSnapshotOutput(snapshot)
  if (output === undefined) throw new Error('The RAG replay output is invalid.')
  const metadata = {
    source: tool.source,
    profile: snapshot.profile,
    profileSource: snapshot.profileSource,
    ...(snapshot.profileReason === undefined ? {} : { profileReason: snapshot.profileReason }),
    sourceCount: snapshot.sourceCount,
    citationCount: snapshot.citationCount,
    confidence: snapshot.confidence,
    missingEvidence: snapshot.missingEvidence,
    warnings: [...snapshot.warnings],
    fallbackReasons: [...snapshot.fallbackReasons],
    ragTraceCount: snapshot.ragTraceCount,
    ...(replayed ? { replayed: true } : {}),
  }
  return {
    ok: true,
    status: 'done',
    output,
    blocks: [{ type: 'text', text: output }],
    diagnostic: projectProcessTrace({
      id: `agent-tool-${tool.id}-${snapshot.createdAt}`,
      type: 'retrieval',
      title: `Agent ${tool.name}`,
      content: `profile=${snapshot.profile} · profileSource=${snapshot.profileSource} · sources=${snapshot.sourceCount} · citations=${snapshot.citationCount} · confidence=${snapshot.confidence.toFixed(2)} · fallbackReasons=${snapshot.fallbackReasons.length}`,
      status: 'done',
      startedAt: snapshot.createdAt,
      ...(completedAt === undefined ? {} : { completedAt }),
      metadata,
    }),
    ...(replayed ? { metadata: { replayed: true } } : {}),
  }
}

const RAG_REPLAY_MEDIA_TYPE = 'application/vnd.islemind.knowledge-rag-replay+json'

function ragReplayArtifact(
  taskId: string,
  createdAt: number,
  snapshot: KnowledgeRagReplaySnapshot,
): Task['artifacts'][number] {
  const checksum = knowledgeRagReplaySnapshotChecksum(snapshot)
  if (!checksum) throw new Error('The RAG replay snapshot checksum could not be created.')
  return {
    id: ragReplayArtifactId(taskId),
    label: 'RAG replay snapshot',
    createdAt,
    uri: ragReplayArtifactUri(taskId),
    mediaType: RAG_REPLAY_MEDIA_TYPE,
    checksum,
  }
}

function ragReplayArtifactId(taskId: string): string {
  return `rag-replay:${taskId}`
}

function ragReplayArtifactUri(taskId: string): string {
  return `islemind://knowledge/rag-replay/${encodeURIComponent(taskId)}`
}

function normalizeRagProfile(value: unknown): 'fast' | 'balanced' | 'deep' | 'offline' | undefined {
  return value === 'fast' || value === 'balanced' || value === 'deep' || value === 'offline'
    ? value
    : undefined
}

function createRagCancellationError(): Error {
  const error = new Error('Knowledge RAG execution was cancelled.')
  error.name = 'AbortError'
  return error
}

function resolveWorkArtifactTaskAdapter(
  tool: ConversationToolCatalogManifest,
  options: TaskBoundToolRuntimeOptions,
): WorkArtifactTaskAdapter | undefined {
  const outputLimit = normalizeWorkArtifactOutputLimit(options.limits?.outputCharLimit)
  return resolveTaskBoundInternalToolAdapter(tool, {
    buildWorkflowOutput: buildWorkArtifactWorkflowOutput,
    sanitizeOutput: (output) => clampTraceText(redactSensitiveText(output), outputLimit),
    clampOutput: clampTraceText,
    createTrace: projectProcessTrace,
  })
}

function normalizeWorkArtifactOutputLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 4_800
  return Math.max(512, Math.min(12_000, Math.trunc(value as number)))
}

function toAgentStepObservation(result: WorkArtifactTaskResult): AgentStepObservation {
  const { trace, ...observation } = result
  return { ...observation, diagnostic: trace }
}

function replaySucceededWorkArtifactResult(
  adapter: WorkArtifactTaskAdapter,
  argumentsValue: JsonRecord,
  task: Task,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): AgentStepObservation {
  const replayed = adapter.execute({
    toolId: task.toolId,
    arguments: argumentsValue,
    startedAt: task.startedAt ?? task.completedAt,
  })
  const result: AgentStepObservation = {
    ...toAgentStepObservation(replayed),
    metadata: {
      ...(replayed.metadata ?? {}),
      replayed: true,
    },
    diagnostic: {
      ...replayed.trace,
      metadata: {
        ...(replayed.trace.metadata ?? {}),
        replayed: true,
      },
    },
  }
  return withTaskMetadata(
    attachPermissionAuditMetadata(result, adapter.manifest, permission, context, limits),
    task,
  )
}

function replaySucceededExternalTaskResult(
  tool: ConversationToolCatalogManifest,
  task: Task,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): ExternalToolExecutionResult {
  const summary = task.result?.summary?.trim() || `${tool.name} completed successfully.`
  const artifactIds = new Set(task.result?.artifactIds ?? [])
  const artifacts = task.artifacts.filter((artifact) => artifactIds.has(artifact.id))
  const execution = normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok: true,
    status: 'done',
    output: summary,
    blocks: [
      { type: 'text', text: summary },
      ...artifacts.map((artifact) => ({
        type: 'resource',
        name: artifact.label,
        ...(artifact.uri ? { uri: artifact.uri } : {}),
        ...(artifact.mediaType ? { mimeType: artifact.mediaType } : {}),
      })),
    ],
    diagnostic: {
      id: `agent-task-replay-${task.id}`,
      type: 'tool',
      title: `Agent ${tool.name}`,
      content: summary,
      status: 'done',
      completedAt: task.completedAt,
      metadata: {
        replayed: true,
        artifactCount: artifacts.length,
        artifactIds: artifacts.map((artifact) => artifact.id),
      },
    },
    metadata: {
      replayed: true,
      artifactCount: artifacts.length,
      artifactIds: artifacts.map((artifact) => artifact.id),
    },
  })
  return withExternalTaskMetadata(
    attachExternalPermissionAuditMetadata(execution, tool, permission, context, limits),
    task,
  )
}

function reconcileObservationWithTask(
  observation: ExternalToolObservation,
  task: { status: string },
): ExternalToolObservation {
  if (task.status !== 'cancelled' || observation.errorCode === 'cancelled') return observation
  const message = 'Agent workflow execution was cancelled.'
  return {
    ...observation,
    ok: false,
    status: 'skipped',
    output: message,
    blocks: [{ type: 'text', text: message }],
    errorCode: 'cancelled',
    diagnostic: {
      ...observation.diagnostic,
      content: message,
      status: 'cancelled',
      metadata: {
        ...(observation.diagnostic.metadata ?? {}),
        errorCode: 'cancelled',
      },
    },
  }
}

function toTaskPolicyDecision(
  permission: ToolPermissionPolicyDecision,
  requiresDurableConfirmation = false,
): TaskPolicyDecision {
  if (permission.decision === 'allow') {
    if (requiresDurableConfirmation) {
      return { outcome: 'requires-confirmation', reasonCode: 'agent_confirmation_required' }
    }
    return { outcome: 'allowed', reasonCode: permission.code ?? 'agent_policy_allowed' }
  }
  if (permission.decision === 'confirm') {
    return { outcome: 'requires-confirmation', reasonCode: permission.code ?? 'agent_confirmation_required' }
  }
  return { outcome: 'denied', reasonCode: permission.code ?? 'agent_policy_denied' }
}

function durableConfirmationDecision(
  permission: ToolPermissionPolicyDecision,
): ToolPermissionPolicyDecision {
  return {
    decision: 'confirm',
    code: 'permission_required',
    reason: 'A current durable confirmation is required.',
    evidence: permission.evidence,
  }
}

function permissionResult(
  tool: ConversationToolCatalogManifest,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): AgentStepObservation {
  const errorCode = permission.code ?? (permission.decision === 'deny' ? 'policy_denied' : 'permission_required')
  const startedAt = Date.now()
  const status = permission.decision === 'allow'
    ? 'done'
    : permission.decision === 'confirm' || errorCode === 'tool_unavailable'
      ? 'skipped'
      : 'error'
  const metadata = permissionAuditMetadata(tool, permission, context, limits)
  return {
    ok: false,
    status: 'skipped',
    output: permission.reason,
    blocks: [{ type: 'text', text: permission.reason }],
    diagnostic: {
      id: `agent-policy-${tool.id}-${startedAt}`,
      type: 'system',
      title: `Agent policy ${tool.name}`,
      content: permission.reason,
      status,
      startedAt,
      metadata,
    },
    errorCode,
    metadata: { decision: permission.decision, toolId: tool.id, source: tool.source },
  }
}

function toolPermissionOutcome(
  tool: ConversationToolCatalogManifest,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
  task: { id: string; status: string; policy: TaskPolicyDecision; runId?: AssistantRunId },
): TaskBoundToolExecutionOutcome {
  if (!isTaskBoundExternalToolSource(tool.source)) {
    return internalOutcome(withTaskMetadata(permissionResult(tool, permission, context, limits), task))
  }
  const errorCode = toExternalToolErrorCode(
    permission.code ?? (permission.decision === 'deny' ? 'policy_denied' : 'permission_required'),
  )
  const result = externalTaskRuntimeFailure(tool, errorCode, permission.reason)
  return externalOutcome(withExternalTaskMetadata(
    normalizeExternalToolExecutionResult({
      toolId: tool.id,
      source: tool.source,
      name: tool.name,
      ok: result.observation.ok,
      status: result.observation.status,
      output: result.observation.output,
      blocks: result.observation.blocks,
      diagnostic: {
        ...result.observation.diagnostic,
        metadata: {
          ...(result.observation.diagnostic.metadata ?? {}),
          ...permissionAuditMetadata(tool, permission, context, limits),
        },
      },
      errorCode: result.observation.errorCode,
      metadata: {
        ...(result.observation.metadata ?? {}),
        decision: permission.decision,
        ...permissionAuditMetadata(tool, permission, context, limits),
      },
    }),
    task,
  ))
}

function attachPermissionAuditMetadata(
  result: AgentStepObservation,
  tool: ConversationToolCatalogManifest,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): AgentStepObservation {
  if (permission.decision !== 'allow') return result
  return {
    ...result,
    diagnostic: {
      ...result.diagnostic,
      metadata: {
        ...(result.diagnostic.metadata ?? {}),
        ...permissionAuditMetadata(tool, permission, context, limits),
      },
    },
  }
}

function attachExternalPermissionAuditMetadata(
  result: ExternalToolExecutionResult,
  tool: ConversationToolCatalogManifest,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): ExternalToolExecutionResult {
  if (permission.decision !== 'allow') return result
  const metadata = permissionAuditMetadata(tool, permission, context, limits)
  return normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok: result.observation.ok,
    status: result.observation.status,
    output: result.observation.output,
    blocks: result.observation.blocks,
    diagnostic: {
      ...result.observation.diagnostic,
      metadata: {
        ...(result.observation.diagnostic.metadata ?? {}),
        ...metadata,
      },
    },
    errorCode: result.observation.errorCode,
    metadata: {
      ...(result.observation.metadata ?? {}),
      ...metadata,
    },
  })
}

function permissionAuditMetadata(
  tool: ConversationToolCatalogManifest,
  permission: ToolPermissionPolicyDecision,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): Record<string, unknown> {
  return {
    toolId: tool.id,
    source: tool.source,
    permission: tool.permission,
    decision: permission.decision,
    code: permission.code,
    allowReason: permission.allowReason,
    riskLevel: tool.riskLevel,
    outputBoundary: tool.outputBoundary,
    requiresConfirmation: tool.requiresConfirmation,
    intentVisible: Boolean(context.intentVisible),
    userConfirmed: Boolean(context.userConfirmed),
    evidenceReady: permission.evidence.ready,
    evidenceReliable: permission.evidence.reliable,
    evidenceSourceCount: permission.evidence.sources.length,
    evidenceReliableSourceCount: permission.evidence.reliableSources.length,
    evidenceKinds: permission.evidence.kinds,
    evidenceSources: permission.evidence.sources,
    evidenceReliableSources: permission.evidence.reliableSources,
    evidenceSummary: permission.evidence.summary,
    stepIndex: context.stepIndex,
    toolCallIndex: context.toolCallIndex,
    maxStepCount: limits.maxSteps,
    maxToolCallsPerStep: limits.maxToolCallsPerStep,
    readWriteToolPolicy: limits.allowReadWriteTools,
    destructiveToolPolicy: limits.allowDestructiveTools,
  }
}

function withTaskMetadata(
  result: AgentStepObservation,
  task: { id: string; status: string; policy: TaskPolicyDecision; runId?: AssistantRunId },
): AgentStepObservation {
  const metadata = {
    ...(result.metadata ?? {}),
    vnextTaskId: task.id,
    vnextTaskStatus: task.status,
    vnextTaskPolicy: task.policy.outcome,
    ...(task.runId ? { vnextAssistantRunId: task.runId } : {}),
  }
  return {
    ...result,
    metadata,
    diagnostic: {
      ...result.diagnostic,
      metadata: {
        ...(result.diagnostic.metadata ?? {}),
        ...metadata,
      },
    },
  }
}

function withExternalTaskMetadata(
  result: ExternalToolExecutionResult,
  task: { id: string; status: string; policy: TaskPolicyDecision; runId?: AssistantRunId },
): ExternalToolExecutionResult {
  const metadata: JsonRecord = {
    ...(result.observation.metadata ?? {}),
    vnextTaskId: task.id,
    vnextTaskStatus: task.status,
    vnextTaskPolicy: task.policy.outcome,
    ...(task.runId ? { vnextAssistantRunId: task.runId } : {}),
  }
  return {
    ...result,
    observation: {
      ...result.observation,
      metadata,
      diagnostic: {
        ...result.observation.diagnostic,
        metadata: {
          ...(result.observation.diagnostic.metadata ?? {}),
          ...metadata,
        },
      },
    },
  }
}

function toolTaskFailureOutcome(
  tool: ConversationToolCatalogManifest,
  errorCode: AgentFailureCode,
  message: string,
  task?: { id: string; status: string; policy: TaskPolicyDecision; runId?: AssistantRunId },
): TaskBoundToolExecutionOutcome {
  if (isTaskBoundExternalToolSource(tool.source)) {
    return externalOutcome(externalTaskRuntimeFailure(tool, toExternalToolErrorCode(errorCode), message, task))
  }
  return internalOutcome(taskRuntimeFailure(tool, errorCode, message, task))
}

function externalTaskRuntimeFailure(
  tool: ConversationToolCatalogManifest,
  errorCode: ExternalToolObservationErrorCode,
  message: string,
  task?: { id: string; status: string; policy: TaskPolicyDecision; runId?: AssistantRunId },
): ExternalToolExecutionResult {
  const startedAt = Date.now()
  const metadata = task
    ? {
        toolId: tool.id,
        source: tool.source,
        errorCode,
        vnextTaskId: task.id,
        vnextTaskStatus: task.status,
        vnextTaskPolicy: task.policy.outcome,
        ...(task.runId ? { vnextAssistantRunId: task.runId } : {}),
      }
    : { toolId: tool.id, source: tool.source, errorCode }
  const skipped = errorCode === 'cancelled' || errorCode === 'permission_required' || errorCode === 'policy_denied'
  return normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok: false,
    status: skipped ? 'skipped' : 'error',
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: {
      id: `external-task-${tool.id}-${startedAt}`,
      type: 'tool',
      title: `External tool ${tool.name}`,
      content: message,
      status: errorCode === 'cancelled' ? 'cancelled' : skipped ? 'skipped' : 'error',
      startedAt,
      metadata,
    },
    errorCode,
    metadata,
  })
}

function taskRuntimeFailure(
  tool: ConversationToolCatalogManifest,
  errorCode: AgentFailureCode,
  message: string,
  task?: { id: string; status: string; policy: TaskPolicyDecision; runId?: AssistantRunId },
): AgentStepObservation {
  const startedAt = Date.now()
  const metadata = task
    ? {
        toolId: tool.id,
        source: tool.source,
        errorCode,
        vnextTaskId: task.id,
        vnextTaskStatus: task.status,
        vnextTaskPolicy: task.policy.outcome,
        ...(task.runId ? { vnextAssistantRunId: task.runId } : {}),
      }
    : { toolId: tool.id, source: tool.source, errorCode }
  const skipped = errorCode === 'cancelled' || errorCode === 'permission_required' || errorCode === 'policy_denied'
  return {
    ok: false,
    status: skipped ? 'skipped' : 'error',
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: {
      id: `agent-task-${tool.id}-${startedAt}`,
      type: 'tool',
      title: `Agent ${tool.name}`,
      content: message,
      status: skipped ? 'skipped' : 'error',
      startedAt,
      metadata,
    },
    errorCode,
    metadata,
  }
}

function ragRuntimeUnavailableResult(tool: ConversationToolCatalogManifest): AgentStepObservation {
  const result = taskRuntimeFailure(tool, 'rag_unavailable', `${tool.name} requires a RAG runtime adapter.`)
  return {
    ...result,
    status: 'skipped',
    diagnostic: { ...result.diagnostic, status: 'skipped' },
  }
}

function mapTaskRuntimeFailure(code: string): AgentFailureCode {
  if (code === 'cancelled') return 'cancelled'
  if (code === 'policy_denied') return 'policy_denied'
  if (code === 'confirmation_required' || code === 'confirmation_not_required') return 'permission_required'
  return 'execution_failed'
}

function toExternalToolErrorCode(code: AgentFailureCode): ExternalToolObservationErrorCode {
  return code === 'provider_unavailable' || code === 'rag_unavailable' ? 'execution_failed' : code
}

function integrationSourceFor(
  source: Exclude<TaskBoundExternalToolSource, 'mcp'>,
): Extract<IntegrationSource, 'builtin' | 'android'> {
  return source === 'app-action' ? 'builtin' : source
}

function isTaskBoundExternalToolSource(source: string): source is TaskBoundExternalToolSource {
  return source === 'mcp' || source === 'builtin' || source === 'app-action' || source === 'android'
}

function hasCanonicalMcpIdentity(tool: ConversationToolCatalogManifest): boolean {
  const serverId = tool.serverId
  const name = tool.name
  return isCanonicalMcpIdentityComponent(serverId) && isCanonicalMcpIdentityComponent(name)
    && tool.id === `mcp:${serverId}:${name}`
}

function isCanonicalMcpIdentityComponent(value: string | undefined): value is string {
  return Boolean(value) && value === value?.trim() && !value?.includes(':') && !/[\u0000-\u001f\u007f]/.test(value ?? '')
}

function isTaskBoundInternalToolSource(source: string): source is TaskBoundInternalToolSource {
  return source === 'rag' || source === 'search' || source === 'work-artifact'
}

function isExplicitInternalRequest(request: AgentToolRequest): boolean {
  if (request.source && isTaskBoundInternalToolSource(request.source)) return true
  const identity = request.toolId ?? ''
  return identity.startsWith('rag:') || identity.startsWith('search:') || identity.startsWith('work-artifact:')
}

function integrationCapabilityScope(tool: ConversationToolCatalogManifest): readonly string[] {
  return [
    `tool:${tool.id}`,
    `permission:${tool.permission}`,
    ...(tool.serverId ? [`server:${tool.serverId}`] : []),
  ]
}

function buildIdempotencyKey(
  assistantRunId: AssistantRunId | undefined,
  stepId: string,
  toolId: string,
  argumentsValue: JsonRecord,
): string {
  return `agent:${hashText(assistantRunId ?? 'unowned')}:${hashText(stepId)}:${hashText(toolId)}:${hashText(stableSerialize(argumentsValue))}`
}

function requestedExternalTaskBoundToolSource(request: AgentToolRequest): TaskBoundExternalToolSource | undefined {
  if (request.source && isTaskBoundExternalToolSource(request.source)) return request.source
  const identity = request.toolId ?? request.name ?? ''
  if (identity.startsWith('mcp:')) return 'mcp'
  if (identity.startsWith('builtin:')) return 'builtin'
  if (identity.startsWith('app-action:')) return 'app-action'
  if (identity.startsWith('android:') || identity.startsWith('android.')) return 'android'
  return undefined
}

function unavailableExternalToolExecutionResult(
  request: AgentToolRequest,
  source: TaskBoundExternalToolSource,
): ExternalToolExecutionResult {
  const identity = request.toolId ?? request.name ?? `${source}:unavailable`
  return externalTaskRuntimeFailure({
    id: identity,
    source,
    name: request.name ?? identity,
    description: 'Unavailable external tool request.',
    permission: 'read-only',
    enabled: false,
    ...(request.serverId ? { serverId: request.serverId } : {}),
  }, 'tool_unavailable', 'Tool is unavailable.')
}

function cancelledExternalToolExecutionResult(
  request: AgentToolRequest,
  source: TaskBoundExternalToolSource,
): ExternalToolExecutionResult {
  const identity = request.toolId ?? request.name ?? `${source}:cancelled`
  return externalTaskRuntimeFailure({
    id: identity,
    source,
    name: request.name ?? identity,
    description: 'Cancelled external tool request.',
    permission: 'read-only',
    enabled: false,
    ...(request.serverId ? { serverId: request.serverId } : {}),
  }, 'cancelled', 'Agent workflow execution was cancelled.')
}

function isSuccessfulExternalResult(result: ExternalToolExecutionResult): boolean {
  return result.observation.ok && result.observation.status === 'done'
}

function stableSerialize(value: unknown, depth = 0): string {
  if (depth > 8) return '[depth-limit]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 4_096))
  if (Array.isArray(value)) return `[${value.slice(0, 64).map((item) => stableSerialize(item, depth + 1)).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().slice(0, 64).map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], depth + 1)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

class ExternalToolExecutionError extends Error {
  constructor() {
    super('External tool execution did not complete successfully.')
    this.name = 'ExternalToolExecutionError'
  }
}

let defaultAdapterPromise: Promise<TaskBoundToolRuntime> | undefined

async function getDefaultTaskBoundToolRuntime(): Promise<TaskBoundToolRuntime> {
  defaultAdapterPromise ??= loadDefaultDependencies().then(createTaskBoundToolRuntime)
  return defaultAdapterPromise
}

async function loadDefaultDependencies(): Promise<TaskBoundToolRuntimeDependencies> {
  const [mcp, mcpCatalog, settings, android] = await Promise.all([
    import('@/bootstrap/mcpExecutionRuntime'),
    import('@/bootstrap/mcpCatalog'),
    import('@/presentation/features/settings/settingsActionCommand'),
    import('@/services/androidDeviceTools'),
  ])
  const catalogSources: ConversationToolCatalogSourcePorts = {
    builtinServerId: mcpCatalog.BUILTIN_SERVER_ID,
    listMcpServers: mcpCatalog.listMcpServers,
    getBuiltinServer: mcpCatalog.builtinMcpServer,
    listBuiltinTools: mcpCatalog.listBuiltinToolDescriptors,
    listAppActionTools: listAppActionToolDescriptors,
    listAndroidTools: android.listAndroidDeviceToolManifests,
  }
  return {
    createTaskRuntime: createVNextTaskRuntime,
    listToolManifests: () => listConversationToolCatalog(catalogSources, {
      internalTools: [KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST, WORK_ARTIFACT_TOOL_MANIFEST],
    }),
    async executeMcpTool(tool, argumentsValue, options) {
      try {
        const server = (await mcpCatalog.listMcpServers()).find((candidate) => candidate.id === tool.serverId)
        if (!server) return externalBoundaryFailure(tool, 'tool_unavailable', 'MCP server is unavailable.')
        return await mcp.callMcpTool(
          server,
          tool.name,
          argumentsValue,
          undefined,
          { signal: options.signal, skipApproval: true, taskId: options.taskId },
        )
      } catch (error) {
        return externalBoundaryFailure(
          tool,
          options.signal.aborted || isAbortError(error) ? 'cancelled' : 'execution_failed',
          options.signal.aborted || isAbortError(error) ? 'Agent workflow execution was cancelled.' : errorMessage(error),
        )
      }
    },
    async executeBuiltinTool(tool, argumentsValue, options) {
      try {
        const targetAdapter = mcpCatalog.resolveBuiltInCapabilityAdapter(tool.id)
        if (targetAdapter) {
          const targetResult = await targetAdapter.execute({
            taskId: options.taskId as TaskId,
            tool: targetAdapter.definition,
            arguments: argumentsValue,
          }, { signal: options.signal })
          return targetResult as ExternalToolExecutionResult
        }
        return await mcp.callMcpTool(
          mcpCatalog.builtinMcpServer(),
          tool.name,
          argumentsValue,
          undefined,
          { signal: options.signal, skipApproval: true, taskId: options.taskId },
        )
      } catch (error) {
        return externalBoundaryFailure(
          tool,
          options.signal.aborted || isAbortError(error) ? 'cancelled' : 'execution_failed',
          options.signal.aborted || isAbortError(error) ? 'Agent workflow execution was cancelled.' : errorMessage(error),
        )
      }
    },
    async executeAppActionTool(tool, argumentsValue, options) {
      try {
        return normalizeExternalBoundaryResult(tool, await settings.executeSettingsAction({
          name: tool.name as SettingsActionName,
          arguments: argumentsValue,
          source: 'builtin-tool',
        }, { signal: options.signal }))
      } catch (error) {
        return externalBoundaryFailure(
          tool,
          options.signal.aborted || isAbortError(error) ? 'cancelled' : 'execution_failed',
          options.signal.aborted || isAbortError(error) ? 'Agent workflow execution was cancelled.' : errorMessage(error),
        )
      }
    },
    async executeAndroidTool(tool, argumentsValue, options) {
      try {
        return await android.executeAndroidDeviceTool(tool, argumentsValue, {
          signal: options.signal,
          runtimeLog: options.runtimeLog,
        })
      } catch (error) {
        return externalBoundaryFailure(
          tool,
          options.signal.aborted || isAbortError(error) ? 'cancelled' : 'execution_failed',
          options.signal.aborted || isAbortError(error) ? 'Agent workflow execution was cancelled.' : errorMessage(error),
        )
      }
    },
  }
}

interface ExternalBoundaryResultLike {
  ok: boolean
  status?: string
  output?: string
  message?: string
  blocks?: readonly unknown[]
  content?: readonly unknown[]
  trace: {
    id: string
    type?: string
    title: string
    content?: string
    status: string
    startedAt?: number
    completedAt?: number
    metadata?: Record<string, unknown>
  }
  error?: string
  errorCode?: string
  metadata?: Record<string, unknown>
}

function normalizeExternalBoundaryResult(
  tool: ConversationToolCatalogManifest,
  result: ExternalBoundaryResultLike,
): ExternalToolExecutionResult {
  return normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok: result.ok,
    status: result.status,
    output: result.output ?? result.message,
    blocks: result.blocks ?? result.content,
    diagnostic: result.trace,
    error: result.error,
    errorCode: result.errorCode,
    metadata: result.metadata,
  })
}

function externalBoundaryFailure(
  tool: ConversationToolCatalogManifest,
  errorCode: ExternalToolObservationErrorCode,
  message: string,
): ExternalToolExecutionResult {
  const startedAt = Date.now()
  return normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok: false,
    status: errorCode === 'cancelled' || errorCode === 'permission_required' || errorCode === 'policy_denied' ? 'skipped' : 'error',
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: {
      id: `external-tool-${tool.id}-${startedAt}`,
      type: 'tool',
      title: `External tool ${tool.name}`,
      content: message,
      status: errorCode === 'cancelled' ? 'cancelled' : 'error',
      startedAt,
      metadata: { toolId: tool.id, source: tool.source, errorCode },
    },
    errorCode,
    metadata: { toolId: tool.id, source: tool.source },
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'External tool execution failed.'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
