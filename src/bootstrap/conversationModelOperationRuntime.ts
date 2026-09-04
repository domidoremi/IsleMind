import { asTaskId, freezeChatRequest, type ChatReasoningReplayPart, type ChatRequest, type ChatToolCallProviderMetadata, type JsonRecord } from '@/core'
import {
  createFrozenModelOperationCatalog,
  createModelOperationTurnRuntime,
  type AssistantModelOperationProviderCall,
  type AssistantModelOperationSession,
  type ModelOperationCall as RuntimeModelOperationCall,
  type ModelOperationPendingConfirmationState,
  type ModelOperationReceipt,
  type PendingModelOperation,
} from '@/modules/assistant-runtime'
import {
  admitModelOperationCall,
  parseModelOperationProposal,
  stableIdentityHash,
  validateToolInputSchema,
  type ConversationToolCatalogManifest,
  type ModelOperationCatalogSnapshot,
  type ModelOperationDescriptor,
} from '@/modules/integrations'
import {
  createModelOperationAuthorizationPolicy,
  resolveWorkflowRunLimitsFromSettings,
  type ModelOperationAuthorizationPolicy,
  type ModelOperationConfirmationStatus,
} from '@/modules/tasks'
import type {
  executeTaskBoundTool,
  executeExternalTaskBoundTool,
} from '@/bootstrap/taskBoundToolRuntime'
import type { createConversationModelOperationCatalog } from '@/bootstrap/modelOperationCatalogRuntime'
import { resolveProviderNativeToolDeclarationTarget } from '@/bootstrap/providerNativeToolDeclarations'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import type { Settings } from '@/types/settingsContracts'

export interface ConversationModelOperationRuntimeInput {
  readonly conversation: Conversation
  readonly provider: AIProvider
  readonly settings: Settings
  /** Rich callback activities cannot expose a resumable confirmation surface. */
  readonly allowConfirmation?: boolean
}

interface PendingTaskReference extends JsonRecord {
  readonly taskId: string
}

interface CurrentTurn {
  readonly request: ChatRequest
  readonly outputText: string
  readonly nativeCallIds: ReadonlySet<string>
  readonly reasoningReplay: readonly ChatReasoningReplayPart[]
}

export interface ConversationModelOperationSessionDependencies {
  readonly createCatalog: typeof createConversationModelOperationCatalog
  readonly executeInternal: typeof executeTaskBoundTool
  readonly executeExternal: typeof executeExternalTaskBoundTool
  readonly declinePendingTask: typeof expireDeclinedModelOperationTask
  readonly createRagRuntime: typeof createModelOperationConversationRagRuntime
  readonly now: () => number
}

const DEFAULT_MODEL_OPERATION_SESSION_DEPENDENCIES: ConversationModelOperationSessionDependencies = {
  async createCatalog(settings) {
    const { createConversationModelOperationCatalog: createCatalog } = await import('@/bootstrap/modelOperationCatalogRuntime')
    return createCatalog(settings)
  },
  async executeInternal(input) {
    const { executeTaskBoundTool: execute } = await import('@/bootstrap/taskBoundToolRuntime')
    return execute(input)
  },
  async executeExternal(input) {
    const { executeExternalTaskBoundTool: execute } = await import('@/bootstrap/taskBoundToolRuntime')
    return execute(input)
  },
  declinePendingTask: expireDeclinedModelOperationTask,
  createRagRuntime: createModelOperationConversationRagRuntime,
  now: Date.now,
}

export async function createConversationModelOperationSession(
  input: ConversationModelOperationRuntimeInput,
  dependencies: ConversationModelOperationSessionDependencies = DEFAULT_MODEL_OPERATION_SESSION_DEPENDENCIES,
): Promise<AssistantModelOperationSession | undefined> {
  const created = await dependencies.createCatalog(input.settings)
  if (!created.ok) throw new Error(created.message)
  if (created.catalog.snapshot.operations.length === 0) return undefined

  const { snapshot: createdSnapshot, taggedPrompt } = created.catalog
  const snapshot = input.allowConfirmation === false
    ? {
        ...createdSnapshot,
        operations: createdSnapshot.operations.filter(
          (operation) => operation.permission !== 'destructive' && !operation.requiresConfirmation,
        ),
      }
    : createdSnapshot
  if (snapshot.operations.length === 0) return undefined
  const manifests = created.catalog.manifests.filter((manifest) =>
    snapshot.operations.some((operation) => operation.id === manifest.id))
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const providerNameByOperationId = new Map(
    snapshot.operations.map((operation) => [operation.id, providerOperationName(operation.id)]),
  )
  const operationIdByProviderName = new Map(
    [...providerNameByOperationId].map(([operationId, providerName]) => [providerName, operationId]),
  )
  const nativeProtocol = supportsNativeModelOperationProtocol(input.provider, input.conversation.model)
  const prepareRequest = (request: ChatRequest): ChatRequest => ({
    ...request,
    systemPrompt: [request.systemPrompt, nativeProtocol ? undefined : taggedPrompt].filter(Boolean).join('\n\n'),
    toolDefinitions: snapshot.operations.map((operation) => ({
      operationId: operation.id,
      name: providerNameByOperationId.get(operation.id) as string,
      description: operation.description,
      inputSchema: operation.inputSchema,
      permission: operation.permission,
    })),
  })
  const frozenCatalog = createFrozenModelOperationCatalog({
    revision: snapshot.revision,
    entries: snapshot.operations.map((operation) => ({
      operationId: operation.id,
      declaredName: providerNameByOperationId.get(operation.id) as string,
      schemaRevision: stableIdentityHash(operation.inputSchema),
      available: operation.availability.status === 'available',
      definition: operation,
      validateArguments(argumentsValue) {
        const admitted = admitModelOperationCall(snapshot, {
          schema: 'islemind.model-tool-call.v1',
          catalogRevision: snapshot.revision,
          operationId: operation.id,
          arguments: argumentsValue as JsonRecord,
        })
        return admitted.ok
          ? { ok: true }
          : { ok: false, message: admitted.message }
      },
    })),
  })
  const limits = resolveWorkflowRunLimitsFromSettings(input.settings)
  const permissionCeiling = resolvePermissionCeiling(limits)
  let currentTurn: CurrentTurn | undefined
  const buildIdempotencyKey = (value: {
    readonly runId: string
    readonly callId: string
    readonly operationId: string
    readonly catalogRevision: string
    readonly argumentDigest: string
  }) => `model-operation:${stableIdentityHash(value)}`

  const authorizationPolicy = createModelOperationAuthorizationPolicy({
    resolveOperation(operationId, catalogRevision) {
      if (catalogRevision !== snapshot.revision) return undefined
      const operation = snapshot.operations.find((candidate) => candidate.id === operationId)
      if (!operation) return undefined
      return {
        id: operation.id,
        permission: operation.permission,
        available: operation.availability.status === 'available',
      }
    },
    digestArguments: stableIdentityHash,
    buildIdempotencyKey,
  })
  const validateConfirmationState = (
    state: ModelOperationPendingConfirmationState<PendingTaskReference>,
  ): boolean => state.continuationToken === `confirmation:${stableIdentityHash({
    continuationId: state.continuationId,
    idempotencyKey: state.idempotencyKey,
    turnId: state.turnId,
    stepIndex: state.stepIndex,
    call: state.call,
    catalogRevision: state.catalogRevision,
    argumentDigest: state.argumentDigest,
    pending: state.pending,
  })}`

  const turnRuntime = createModelOperationTurnRuntime<
    ModelOperationDescriptor,
    PendingTaskReference,
    ChatRequest
  >({
    digestArguments: stableIdentityHash,
    buildIdempotencyKey,
    createConfirmationToken(value) {
      return `confirmation:${stableIdentityHash(value)}`
    },
    validateConfirmationState,
    declinePending(state, signal) {
      return dependencies.declinePendingTask(state, signal)
    },
    async dispatch(dispatchInput) {
      const manifest = manifestById.get(dispatchInput.call.operationId)
      if (!manifest) {
        return { status: 'failed', output: 'The selected operation has no bound executor.' }
      }
      const confirmationStatus: ModelOperationConfirmationStatus =
        manifest.permission === 'destructive'
          ? dispatchInput.confirmed ? 'confirmed' : 'pending'
          : 'not-required'
      const attested = authorizationPolicy.attest({
        runId: dispatchInput.turnId,
        catalogRevision: snapshot.revision,
        permissionCeiling,
        confirmationStatus,
      }, {
        callId: dispatchInput.call.callId,
        operationId: dispatchInput.call.operationId,
        arguments: dispatchInput.call.arguments,
      })
      if (!attested.ok) {
        return {
          status: 'failed',
          output: `The operation was rejected by trusted authorization (${attested.code}).`,
        }
      }
      const expected = {
        runId: dispatchInput.turnId,
        callId: dispatchInput.call.callId,
        operationId: dispatchInput.call.operationId,
        catalogRevision: snapshot.revision,
        arguments: dispatchInput.call.arguments,
        permissionCeiling,
        confirmationStatus,
      }
      const taskInput = {
        stepId: attested.value.idempotencyKey,
        assistantRunId: dispatchInput.turnId as PendingModelOperation['runId'],
        modelOperationAuthorization: {
          policy: authorizationPolicy,
          attestation: attested.value,
          expected,
        },
        request: {
          toolId: manifest.id,
          name: manifest.name,
          source: manifest.source,
          serverId: manifest.serverId,
          arguments: dispatchInput.call.arguments,
        },
        options: {
          manifests,
          limits,
          intentVisible: true as const,
          userConfirmed: dispatchInput.confirmed,
          stepIndex: dispatchInput.stepIndex,
          toolCallIndex: 0,
          signal: dispatchInput.signal,
          runtimeLog: {
            enabled: input.settings.runtimeLogEnabled,
            maxBytes: input.settings.runtimeLogMaxBytes,
          },
          ragRuntime: await dependencies.createRagRuntime(input),
        },
      }
      const observation = isInternalManifest(manifest)
        ? await dependencies.executeInternal(taskInput)
        : (await dependencies.executeExternal(taskInput)).observation
      if (!observation) {
        return { status: 'failed', output: 'The selected operation did not produce a bounded receipt.' }
      }
      const taskId = readTaskMetadata(observation.metadata, 'taskId', 'vnextTaskId')
      const taskStatus = readTaskMetadata(observation.metadata, 'taskStatus', 'vnextTaskStatus')
      const output = boundedObservationOutput(observation)
      if (taskStatus === 'awaiting-confirmation' && taskId) {
        return {
          status: 'pending_confirmation',
          output: output || 'The operation requires visible user confirmation.',
          pending: { taskId },
        }
      }
      return {
        status: observation.ok ? 'succeeded' : 'failed',
        output: output || (observation.ok
          ? 'The operation completed without additional output.'
          : 'The operation failed without additional output.'),
      }
    },
    async continueModel({ receipt, call }) {
      if (!currentTurn) throw new Error('model_operation_turn_context_missing')
      return buildContinuationRequest(currentTurn, receipt, call)
    },
  })

  return {
    prepareRequest(request) {
      return prepareRequest(request)
    },

    async evaluateTurn(turnInput) {
      currentTurn = {
        request: turnInput.request,
        outputText: turnInput.outputText,
        nativeCallIds: new Set(turnInput.calls.map((call) => call.callId)),
        reasoningReplay: turnInput.reasoningReplay,
      }
      const normalized = normalizeTurnCalls(
        snapshot,
        turnInput.calls,
        turnInput.outputText,
        operationIdByProviderName,
        providerNameByOperationId,
      )
      if (normalized.kind === 'none') return { kind: 'no-operation' }
      if (normalized.kind === 'invalid-tagged-call') {
        const receipt = invalidTaggedCallReceipt(turnInput.run.id, snapshot.revision, turnInput.stepIndex, normalized.message)
        return {
          kind: 'continue',
          request: buildContinuationRequest(currentTurn, receipt),
          receipt: toJsonRecord(receipt),
        }
      }
      return mapTurnOutcome(await turnRuntime.run({
        turnId: turnInput.run.id,
        stepIndex: turnInput.stepIndex,
        completedSteps: turnInput.stepIndex,
        maxSteps: limits.maxSteps,
        calls: normalized.calls,
        catalog: frozenCatalog,
        signal: turnInput.signal,
      }), turnInput.run.id, dependencies.now(), currentTurn)
    },

    validatePending({ run, pending }) {
      const state = parsePendingConfirmationState(pending.continuationState)
      const entry = state
        ? frozenCatalog.entries.find((candidate) => candidate.operationId === state.call.operationId)
        : undefined
      const argumentDigest = state ? stableIdentityHash(state.call.arguments) : undefined
      const idempotencyKey = state && argumentDigest
        ? buildIdempotencyKey({
            runId: state.turnId,
            callId: state.call.callId,
            operationId: state.call.operationId,
            catalogRevision: state.call.catalogRevision,
            argumentDigest,
          })
        : undefined
  if (!state || pending.schema !== 'islemind.pending-model-operation.v1' ||
        run.id !== pending.runId || pending.catalogRevision !== snapshot.revision ||
        pending.continuationRequest.conversationId !== input.conversation.id ||
        pending.continuationRequest.providerId !== run.providerId ||
        pending.continuationRequest.model !== run.model ||
        pending.continuationRequest.providerStateBinding?.providerId !== run.providerId ||
        pending.continuationRequest.providerStateBinding?.model !== run.model ||
        pending.callId !== state.call.callId || pending.operationId !== state.call.operationId ||
        pending.catalogRevision !== state.catalogRevision || pending.argumentDigest !== state.argumentDigest ||
        pending.idempotencyKey !== state.idempotencyKey || pending.continuationToken !== state.continuationToken ||
        pending.stepIndex !== state.stepIndex || pending.maxSteps !== state.maxSteps ||
        state.turnId !== pending.runId || state.call.catalogRevision !== state.catalogRevision ||
        argumentDigest !== state.argumentDigest || idempotencyKey !== state.idempotencyKey ||
        !entry || entry.declaredName !== state.call.declaredName ||
        entry.schemaRevision !== state.call.schemaRevision || !validateConfirmationState(state)) {
        return false
      }
      return pending.continuationDigest === stableIdentityHash(pendingContinuationDigestInput(pending))
    },

    async resume(resumeInput) {
      currentTurn = {
        request: cloneChatRequest(resumeInput.pending.continuationRequest),
        outputText: resumeInput.pending.continuationOutputText,
        nativeCallIds: resumeInput.pending.continuationMode === 'native'
          ? new Set([resumeInput.pending.callId])
          : new Set(),
        reasoningReplay: extractReasoningReplay(resumeInput.pending.continuationRequest),
      }
      const state = resumeInput.pending.continuationState as unknown as
        ModelOperationPendingConfirmationState<PendingTaskReference>
      return mapTurnOutcome(await turnRuntime.resume({
        state,
        catalog: frozenCatalog,
        approved: resumeInput.approved,
        signal: resumeInput.signal,
      }), resumeInput.run.id, dependencies.now(), currentTurn)
    },
  }
}

function normalizeTurnCalls(
  snapshot: ModelOperationCatalogSnapshot,
  nativeCalls: readonly AssistantModelOperationProviderCall[],
  outputText: string,
  operationIdByProviderName: ReadonlyMap<string, string>,
  providerNameByOperationId: ReadonlyMap<string, string>,
):
  | { kind: 'none' }
  | { kind: 'invalid-tagged-call'; message: string }
  | { kind: 'calls'; calls: readonly RuntimeModelOperationCall[] } {
  if (nativeCalls.length) {
    return {
      kind: 'calls',
      calls: nativeCalls.map((call) => toRuntimeCall(
        snapshot,
        call.callId,
        operationIdByProviderName.get(call.name) ?? `unavailable:${call.name}`,
        call.name,
        call.arguments,
        undefined,
        call.providerMetadata,
      )),
    }
  }
  if (!outputText.includes('<islemind_tool_call')) return { kind: 'none' }
  const parsed = parseModelOperationProposal(outputText)
  if (!parsed.ok) return { kind: 'invalid-tagged-call', message: parsed.message }
  return {
    kind: 'calls',
    calls: [toRuntimeCall(
      snapshot,
      `structured:${stableIdentityHash(parsed.proposal)}`,
      parsed.proposal.operationId,
      providerNameByOperationId.get(parsed.proposal.operationId) ?? parsed.proposal.operationId,
      parsed.proposal.arguments,
      parsed.proposal.catalogRevision,
    )],
  }
}

function toRuntimeCall(
  snapshot: ModelOperationCatalogSnapshot,
  callId: string,
  operationId: string,
  declaredName: string,
  argumentsValue: JsonRecord,
  catalogRevision = snapshot.revision,
  providerMetadata?: ChatToolCallProviderMetadata,
): RuntimeModelOperationCall {
  const operation = snapshot.operations.find((candidate) => candidate.id === operationId)
  return Object.freeze({
    callId,
    operationId,
    declaredName,
    catalogRevision,
    schemaRevision: operation ? stableIdentityHash(operation.inputSchema) : 'unknown-schema',
    arguments: argumentsValue,
    ...(providerMetadata ? { providerMetadata } : {}),
  })
}

function mapTurnOutcome(
  outcome: Awaited<ReturnType<ReturnType<typeof createModelOperationTurnRuntime<ModelOperationDescriptor, PendingTaskReference, ChatRequest>>['run']>>,
  runId: PendingModelOperation['runId'],
  requestedAt: number,
  turn: CurrentTurn,
): ReturnType<AssistantModelOperationSession['evaluateTurn']> extends Promise<infer TResult> ? TResult : never {
  if (outcome.kind === 'no_operation') return { kind: 'no-operation' }
  if (outcome.kind === 'cancelled') {
    return { kind: 'cancelled', receipt: toJsonRecord(outcome.receipt) }
  }
  if (outcome.kind === 'terminal') {
    return {
      kind: 'continue',
      request: outcome.continuation,
      receipt: toJsonRecord(outcome.receipt),
    }
  }
  const continuationRequest = buildContinuationRequest(turn, outcome.receipt, outcome.state.call)
  const continuationMode: PendingModelOperation['continuationMode'] =
    turn.nativeCallIds.has(outcome.state.call.callId) ? 'native' : 'structured'
  const continuationState = toJsonRecord(outcome.state)
  const pendingWithoutDigest = {
    schema: 'islemind.pending-model-operation.v1' as const,
    runId,
    callId: outcome.state.call.callId,
    operationId: outcome.state.call.operationId,
    catalogRevision: outcome.state.catalogRevision,
    argumentDigest: outcome.state.argumentDigest,
    idempotencyKey: outcome.state.idempotencyKey,
    continuationToken: outcome.state.continuationToken,
    stepIndex: outcome.state.stepIndex,
    maxSteps: outcome.state.maxSteps,
    requestedAt,
    continuationRequest,
    continuationMode,
    continuationOutputText: turn.outputText,
    continuationState,
  }
  return {
    kind: 'awaiting-confirmation',
    receipt: toJsonRecord(outcome.receipt),
    pending: {
      ...pendingWithoutDigest,
      continuationDigest: stableIdentityHash(pendingContinuationDigestInput(pendingWithoutDigest)),
    },
  }
}

function buildContinuationRequest(
  turn: CurrentTurn,
  receipt: ModelOperationReceipt,
  call?: RuntimeModelOperationCall,
): ChatRequest {
  const receiptText = JSON.stringify(receipt)
  const native = Boolean(call && turn.nativeCallIds.has(call.callId))
  const continuationMessages = native && call
    ? [
        {
          id: `model-operation-call:${call.callId}`,
          role: 'assistant' as const,
          text: '',
          ...(turn.reasoningReplay?.length ? { reasoningReplay: turn.reasoningReplay } : {}),
          toolCalls: [{
            callId: call.callId,
            name: call.declaredName,
            arguments: call.arguments as JsonRecord,
            ...(call.providerMetadata ? { providerMetadata: call.providerMetadata as ChatToolCallProviderMetadata } : {}),
          }],
        },
        {
          id: `model-operation-result:${call.callId}`,
          role: 'tool' as const,
          text: receiptText,
          toolCallId: call.callId,
          name: call.declaredName,
        },
      ]
    : [
        {
          id: `model-operation-proposal:${receipt.turnId}:${receipt.stepIndex}`,
          role: 'assistant' as const,
          text: turn.outputText,
        },
        {
          id: `model-operation-result:${receipt.turnId}:${receipt.stepIndex}`,
          role: 'user' as const,
          text: `IsleMind model-operation receipt:\n${receiptText}\nContinue with a final user-facing response.`,
        },
      ]
  return {
    ...turn.request,
    providerStateBinding: turn.request.providerStateBinding ?? {
      providerId: turn.request.providerId,
      model: turn.request.model,
    },
    messages: [
      ...turn.request.messages.filter((message) => !continuationMessages.some((candidate) => candidate.id === message.id)),
      ...continuationMessages,
    ],
  }
}

function invalidTaggedCallReceipt(
  runId: string,
  catalogRevision: string,
  stepIndex: number,
  message: string,
): ModelOperationReceipt {
  return {
    schema: 'islemind.model-operation-receipt.v1',
    turnId: runId,
    stepIndex,
    status: 'rejected',
    code: 'arguments_invalid',
    output: message.slice(0, 4_800),
    terminal: true,
    catalogRevision,
  }
}

function resolvePermissionCeiling(
  limits: ReturnType<typeof resolveWorkflowRunLimitsFromSettings>,
): 'read-only' | 'read-write' | 'destructive' {
  if (limits.allowDestructiveTools === true || limits.allowDestructiveTools === 'confirm') return 'destructive'
  if (limits.allowReadWriteTools === true || limits.allowReadWriteTools === 'visible') return 'read-write'
  return 'read-only'
}

function providerOperationName(operationId: string): string {
  const readable = operationId.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return `islemind_${readable.slice(0, 40)}_${stableIdentityHash(operationId).slice(0, 12)}`.slice(0, 64)
}

function supportsNativeModelOperationProtocol(provider: AIProvider, modelId: string): boolean {
  if (provider.capabilities?.nativeTools !== true) return false
  const model = getModelConfig(modelId, provider.type, provider.modelConfigs)
  if (model.supportsTools === false) return false
  return Boolean(resolveProviderNativeToolDeclarationTarget(provider.type, {
    preferredEndpoint: model.preferredEndpoint === 'responses' ? 'responses' : 'chat',
    assumeOpenAICompatibleTools: true,
    wireProtocol: provider.wireProtocol,
  }))
}

async function expireDeclinedModelOperationTask(
  state: ModelOperationPendingConfirmationState<PendingTaskReference>,
  signal: AbortSignal,
): Promise<{ ok: boolean; message?: string }> {
  if (signal.aborted) return { ok: false, message: 'The declined operation was cancelled before its task could be closed.' }
  const { createTaskRuntime } = await import('@/bootstrap/taskRuntime')
  const runtime = createTaskRuntime({
    async evaluate() {
      return { outcome: 'denied', reasonCode: 'model_operation_decline_does_not_create_tasks' }
    },
  })
  const taskId = asTaskId(state.pending.taskId)
  const task = await runtime.getTask(taskId)
  if (!task || task.runId !== state.turnId || task.toolId !== state.call.operationId ||
    task.idempotencyKey !== state.idempotencyKey || task.status !== 'awaiting-confirmation') {
    return { ok: false, message: 'The declined operation no longer matches its durable task.' }
  }
  const expired = await runtime.expire(taskId, 'model_operation_confirmation_declined')
  return expired.ok
    ? { ok: true }
    : { ok: false, message: 'The declined operation task could not be closed safely.' }
}

function cloneChatRequest(request: ChatRequest): ChatRequest {
  return freezeChatRequest(request)
}

function extractReasoningReplay(request: ChatRequest): readonly ChatReasoningReplayPart[] {
  const assistant = [...request.messages].reverse().find((message) => message.role === 'assistant')
  return assistant?.reasoningReplay ?? Object.freeze([])
}

function pendingContinuationDigestInput(
  pending: Omit<PendingModelOperation, 'continuationDigest'> | PendingModelOperation,
): Omit<PendingModelOperation, 'schema' | 'continuationDigest'> {
  const {
    schema: _schema,
    continuationDigest: _continuationDigest,
    ...value
  } = pending as PendingModelOperation
  return value
}

function parsePendingConfirmationState(
  value: JsonRecord,
): ModelOperationPendingConfirmationState<PendingTaskReference> | undefined {
  const state = value as Record<string, unknown>
  const call = state.call
  const pending = state.pending
  if (state.schema !== 'islemind.model-operation-confirmation.v1' ||
    typeof state.continuationId !== 'string' || typeof state.idempotencyKey !== 'string' ||
    typeof state.turnId !== 'string' || !Number.isSafeInteger(state.stepIndex) ||
    !Number.isSafeInteger(state.maxSteps) || typeof state.catalogRevision !== 'string' ||
    typeof state.argumentDigest !== 'string' || typeof state.continuationToken !== 'string' ||
    !isRecord(call) || typeof call.callId !== 'string' || typeof call.operationId !== 'string' ||
    typeof call.declaredName !== 'string' || typeof call.catalogRevision !== 'string' ||
    typeof call.schemaRevision !== 'string' || !isRecord(call.arguments) ||
    !isRecord(pending) || typeof pending.taskId !== 'string') {
    return undefined
  }
  return value as unknown as ModelOperationPendingConfirmationState<PendingTaskReference>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isInternalManifest(manifest: ConversationToolCatalogManifest): boolean {
  return manifest.source === 'rag' || manifest.source === 'work-artifact'
}

function readTaskMetadata(
  metadata: Readonly<Record<string, unknown>> | JsonRecord | undefined,
  key: string,
  legacyKey?: string,
): string | undefined {
  const value = metadata?.[key] ?? (legacyKey ? metadata?.[legacyKey] : undefined)
  return typeof value === 'string' && value.trim() ? value : undefined
}

function boundedObservationOutput(observation: {
  readonly output?: string
  readonly blocks?: readonly unknown[]
}): string {
  const output = observation.output?.trim()
  if (output) return output.slice(0, 4_800)
  try {
    return JSON.stringify(observation.blocks ?? []).slice(0, 4_800)
  } catch {
    return ''
  }
}

async function createModelOperationConversationRagRuntime(input: ConversationModelOperationRuntimeInput) {
  const [{ createConversationRagRuntime: createKnowledgeConversationRagRuntime, buildKnowledgeScope }, {
    searchAgenticKnowledgeWithScope,
    searchKnowledgeWithFallback,
  }] = await Promise.all([
    import('@/modules/knowledge'),
    import('@/bootstrap/knowledgeRetrievalRuntime'),
  ])
  const knowledgeScope = buildKnowledgeScope(
    input.conversation.knowledgeSources ?? input.conversation.skillSnapshot?.knowledgeSources,
  )
  return createKnowledgeConversationRagRuntime({
    settings: input.settings,
    conversationTitle: input.conversation.title,
    systemPrompt: input.conversation.systemPrompt,
    memorySources: [],
    retrieveKnowledge: (query, limit, options) => {
      if (options?.signal?.aborted || !input.settings.knowledgeEnabled || input.settings.ragMode === 'off') {
        return Promise.resolve([])
      }
      return searchKnowledgeWithFallback({
        query,
        limit,
        ragMode: input.settings.ragMode === 'hybrid' && options?.mode === 'advanced' ? 'hybrid' : 'fts',
        embeddingMode: input.settings.embeddingMode ?? 'hybrid',
        localEmbeddingModelId: input.settings.localEmbeddingModelId,
        localEmbeddingModelSource: input.settings.localEmbeddingModelSource,
        provider: input.provider,
        knowledgeScope,
        onEmbeddingResolved: options?.onEmbeddingResolved,
        signal: options?.signal,
      })
    },
    retrieveAgentic: (query, plan, limit, options) => searchAgenticKnowledgeWithScope({
      query,
      plan,
      limit,
      knowledgeScope,
      onEmbeddingResolved: options?.onEmbeddingResolved,
      signal: options?.signal,
    }),
  })
}

function toJsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord
}
