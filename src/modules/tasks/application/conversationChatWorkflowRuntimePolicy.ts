import type { AssistantRunId, Clock, ProcessTrace } from '@/core'
import type { Attachment, Conversation, Message, MessageUsage } from '@/types/chatContracts'
import type {
  RagCitation,
  RagContextPack,
  RagEvaluationResult,
  RagQueryPlan,
  RagRetrievalCandidate,
  RagRetrievalOrigin,
  RagRetrievalStats,
  RagTraceStep,
  RetrievalSource,
} from '@/types/contextContracts'
import type { ChatErrorCode } from '@/types/providerContracts'
import type { RagProfile, Settings } from '@/types/settingsContracts'
import type {
  ConversationChatWorkflowEntryIntentClassification,
  ConversationChatWorkflowEntryRequestedOutput,
  ConversationChatWorkflowEntryRunLimits,
  ConversationChatWorkflowEntryWorkflowRun,
  ConversationChatWorkflowEntryDecision,
  ConversationChatWorkflowEntryInput,
  ConversationChatWorkflowEntryReason,
  ConversationChatWorkflowReply,
} from './conversationChatWorkflowEntryPolicy'
import type { AndroidWorkflowCatalog } from './androidWorkflowCatalog'
import type { WorkflowSearchToolAdmissionPolicy } from './workflowSearchToolAdmissionPolicy'
import type { WorkflowCheckpointStore } from './workflowCheckpoint'
import type {
  WorkflowDefinitionPolicy,
  WorkflowDefinitionRecord,
  WorkflowDefinitionToolManifest,
  WorkflowDefinitionToolRequest,
} from './workflowDefinitionPolicy'
import type { WorkflowRuntimeBlockState, WorkflowSkillPolicy } from './workflowSkillPolicy'

export interface ConversationChatWorkflowRetrievedContext {
  sources: RetrievalSource[]
  prompt: string
  plan?: RagQueryPlan
  trace?: RagTraceStep[]
  quality?: RagEvaluationResult
}

export type ConversationChatWorkflowContextRetriever = (
  conversation: Conversation,
  draftMessage: Message,
  signal?: AbortSignal,
) => Promise<ConversationChatWorkflowRetrievedContext>

export type ConversationChatWorkflowRuntimeToolRisk = 'low' | 'sensitive-read' | 'state-changing' | 'destructive'

export type ConversationChatWorkflowRuntimeToolOutputBoundary = 'mode-session' | 'agent-trace' | 'external-system' | 'local-state'

export interface ConversationChatWorkflowRuntimeToolManifest extends WorkflowDefinitionToolManifest {
  riskLevel?: ConversationChatWorkflowRuntimeToolRisk
  requiresConfirmation?: boolean
  outputBoundary?: ConversationChatWorkflowRuntimeToolOutputBoundary
  inputSchema?: Record<string, unknown>
  serverName?: string
  requiresRuntimeContext?: boolean
  metadata?: Record<string, unknown>
}

export type ConversationChatWorkflowRuntimeToolRequest = WorkflowDefinitionToolRequest

export type ConversationChatWorkflowRuntimeRequestedOutput = ConversationChatWorkflowEntryRequestedOutput

export type ConversationChatWorkflowRuntimeRunLimits = ConversationChatWorkflowEntryRunLimits

export interface ConversationChatWorkflowRuntimeRagContextPackRequest {
  query: string
  conversationTitle?: string
  systemPrompt?: string
  profile?: RagProfile
  profileReason?: string
  tokenBudget?: number
  maxContextItems?: number
}

export interface ConversationChatWorkflowRuntimeRagRuntimeOptions {
  signal?: AbortSignal
}

export interface ConversationChatWorkflowRuntimeRagRuntime {
  buildContextPack(
    request: ConversationChatWorkflowRuntimeRagContextPackRequest,
    options?: ConversationChatWorkflowRuntimeRagRuntimeOptions,
  ): Promise<RagContextPack>
}

export interface ConversationChatWorkflowRuntimeInput {
  conversation: Conversation
  content: string
  /** Durable target-runtime parent when this chat request is already migrated. */
  assistantRunId?: AssistantRunId
  workflowCheckpointStore?: WorkflowCheckpointStore
  attachments?: Attachment[]
  settings: Settings
  manifests?: ConversationChatWorkflowRuntimeToolManifest[]
  explicitToolRequest?: ConversationChatWorkflowRuntimeToolRequest
  workflowId?: string
  requestedOutput?: ConversationChatWorkflowRuntimeRequestedOutput
  ragRuntime?: ConversationChatWorkflowRuntimeRagRuntime
  retrieveContext?: ConversationChatWorkflowContextRetriever
  memorySources?: RetrievalSource[]
  retrieveKnowledge?: (
    query: string,
    limit: number,
    options?: ConversationChatWorkflowRuntimeRagRuntimeOptions,
  ) => Promise<RetrievalSource[]>
  retrieveAgentic?: (
    query: string,
    plan: RagQueryPlan,
    limit: number,
    options?: ConversationChatWorkflowRuntimeRagRuntimeOptions,
  ) => Promise<RetrievalSource[]>
  enabledWorkflowIds?: string[]
  blockedWorkflowStates?: WorkflowRuntimeBlockState[]
  limits?: Partial<ConversationChatWorkflowRuntimeRunLimits>
  intentVisible?: boolean
  userConfirmed?: boolean
  signal?: AbortSignal
  startedAt?: number
  now?: number
}

export type ConversationChatWorkflowRuntimeSkipReason =
  | 'attachments'
  | 'workflow-not-handled'
  | 'workflow-selection-ambiguous'
  | 'workflow-disabled'
  | 'workflow-review-required'
  | 'workflow-invalid'

export interface ConversationChatWorkflowRuntimeAssistantMessagePatch {
  content: string
  responseText: string
  status: Message['status']
  reasoning?: ProcessTrace[]
  retrievalTrace?: ProcessTrace[]
  toolCalls?: ProcessTrace[]
  usage: MessageUsage
  tokenCount: number
  errorCode?: ChatErrorCode
  durationMs?: number
  completedAt: number
}

export interface ConversationChatWorkflowRuntimeWorkflowRun extends ConversationChatWorkflowEntryWorkflowRun {
  steps: readonly unknown[]
}

export type ConversationChatWorkflowRuntimeWorkflowReply = ConversationChatWorkflowReply<ConversationChatWorkflowRuntimeWorkflowRun>

export interface ConversationChatWorkflowRuntimeAssistantMessageResolution {
  handled: boolean
  reply: ConversationChatWorkflowRuntimeWorkflowReply
  patch?: ConversationChatWorkflowRuntimeAssistantMessagePatch
}

export interface ConversationChatWorkflowRuntimeResolution extends ConversationChatWorkflowRuntimeAssistantMessageResolution {
  reason?: ConversationChatWorkflowRuntimeSkipReason
}

export interface ConversationChatWorkflowRuntimeDecision {
  shouldHandle: boolean
  reason: ConversationChatWorkflowRuntimeSkipReason | ConversationChatWorkflowEntryReason
  traces: ProcessTrace[]
}

export type ConversationChatWorkflowRuntimeEntryInput = ConversationChatWorkflowEntryInput<
  ConversationChatWorkflowRuntimeToolRequest,
  WorkflowDefinitionRecord,
  ConversationChatWorkflowRuntimeToolManifest,
  ConversationChatWorkflowRuntimeRagRuntime
>

export type ConversationChatWorkflowRuntimeEntryDecision = ConversationChatWorkflowEntryDecision<
  ConversationChatWorkflowEntryIntentClassification<ConversationChatWorkflowRuntimeToolRequest>
>

export interface CreateConversationChatWorkflowRuntimeRagRuntimeInput {
  settings: Settings
  conversationTitle?: string
  systemPrompt?: string
  memorySources?: RetrievalSource[]
  retrieveKnowledge(
    query: string,
    limit: number,
    options?: ConversationChatWorkflowRuntimeRagRuntimeOptions,
  ): Promise<RetrievalSource[]>
  retrieveAgentic?(
    query: string,
    plan: RagQueryPlan,
    limit: number,
    options?: ConversationChatWorkflowRuntimeRagRuntimeOptions,
  ): Promise<RetrievalSource[]>
  now?: () => number
}

export interface CreateConversationChatWorkflowRuntimeRagQueryPlanInput {
  query: string
  conversationTitle?: string
  systemPrompt?: string
  settings: Settings
  profile?: RagProfile
  profileReason?: string
  now?: number
  tokenBudget?: number
  maxContextItems?: number
}

export interface ConversationChatWorkflowRuntimeChatEntryDependencies {
  decideConversationChatWorkflowEntry(input: ConversationChatWorkflowRuntimeEntryInput): ConversationChatWorkflowRuntimeEntryDecision
  resolveConversationChatWorkflowAssistantMessage(
    input: ConversationChatWorkflowRuntimeEntryInput & { startedAt?: number },
  ): Promise<ConversationChatWorkflowRuntimeAssistantMessageResolution>
  buildConversationChatWorkflowAssistantMessagePatch(
    reply: ConversationChatWorkflowRuntimeWorkflowReply,
    startedAt?: number,
  ): ConversationChatWorkflowRuntimeAssistantMessagePatch
}

export interface ConversationChatWorkflowRuntimeWorkflowDependencies {
  definitionPolicy: Pick<WorkflowDefinitionPolicy, 'validate'>
  skillPolicy: Pick<
    WorkflowSkillPolicy,
    | 'extractWorkflowDefinitionsFromSkillSnapshot'
    | 'hasWorkflowDefinitionCandidatesInSkillSnapshot'
    | 'listBlockedWorkflowStatesForSkillSnapshot'
    | 'listEnabledWorkflowIdsForSkillSnapshot'
  >
  androidCatalog: AndroidWorkflowCatalog
}

export interface ConversationChatWorkflowRuntimeToolCatalogDependencies {
  listConversationToolManifests(): Promise<ConversationChatWorkflowRuntimeToolManifest[]>
  listStaticConversationToolManifests(): ConversationChatWorkflowRuntimeToolManifest[]
}

export interface ConversationChatWorkflowRuntimeRagDependencies {
  createConversationRagRuntime(input: CreateConversationChatWorkflowRuntimeRagRuntimeInput): ConversationChatWorkflowRuntimeRagRuntime
  createRagQueryPlan(input: CreateConversationChatWorkflowRuntimeRagQueryPlanInput): RagQueryPlan
}

export interface ConversationChatWorkflowRuntimeTraceDependencies {
  projectTrace(trace: ProcessTrace): ProcessTrace
  redactSensitiveText(input: string): string
  clampWorkflowOutput(input: string, limit: number): string
}

export interface ConversationChatWorkflowRuntimePolicyDependencies {
  clock: Clock
  chatEntry: ConversationChatWorkflowRuntimeChatEntryDependencies
  workflows: ConversationChatWorkflowRuntimeWorkflowDependencies
  search: Pick<
    WorkflowSearchToolAdmissionPolicy<Settings>,
    'filterLocalSearchToolManifests' | 'isBuiltinSearchToolRequest' | 'shouldExposeLocalSearchTool'
  >
  tools: ConversationChatWorkflowRuntimeToolCatalogDependencies
  rag: ConversationChatWorkflowRuntimeRagDependencies
  trace: ConversationChatWorkflowRuntimeTraceDependencies
}

export interface ConversationChatWorkflowRuntimePolicy {
  decideConversationChatWorkflowAssistantMessage(input: ConversationChatWorkflowRuntimeInput): ConversationChatWorkflowRuntimeDecision
  resolveConversationChatWorkflowAssistantMessage(input: ConversationChatWorkflowRuntimeInput): Promise<ConversationChatWorkflowRuntimeResolution>
}

type WorkflowToolRequest = ConversationChatWorkflowRuntimeToolRequest
type WorkflowDefinition = WorkflowDefinitionRecord
type ConversationRagContextPackRequest = ConversationChatWorkflowRuntimeRagContextPackRequest
type ConversationRagRuntime = ConversationChatWorkflowRuntimeRagRuntime
type ConversationRagRuntimeOptions = ConversationChatWorkflowRuntimeRagRuntimeOptions
type WorkflowToolManifest = ConversationChatWorkflowRuntimeToolManifest

interface RuntimeWorkflowSelection {
  workflow?: WorkflowDefinition
  ambiguousTrace?: ProcessTrace
  disabledTrace?: ProcessTrace
}

const WORKFLOW_SKIP_REPLY_LIMIT = 900
const WORKFLOW_SKIP_NAME_LIMIT = 160
const WORKFLOW_SKIP_NAME_LIST_LIMIT = 6

export function createConversationChatWorkflowRuntimePolicy(dependencies: ConversationChatWorkflowRuntimePolicyDependencies): ConversationChatWorkflowRuntimePolicy {
  const decideConversationChatWorkflowEntry = dependencies.chatEntry.decideConversationChatWorkflowEntry
  const resolveConversationChatWorkflowAssistantMessagePatch = dependencies.chatEntry.resolveConversationChatWorkflowAssistantMessage
  const buildConversationChatWorkflowAssistantMessagePatch = dependencies.chatEntry.buildConversationChatWorkflowAssistantMessagePatch
  const workflowDefinitionPolicy = dependencies.workflows.definitionPolicy
  const {
    extractWorkflowDefinitionsFromSkillSnapshot,
    hasWorkflowDefinitionCandidatesInSkillSnapshot,
    listBlockedWorkflowStatesForSkillSnapshot,
    listEnabledWorkflowIdsForSkillSnapshot,
  } = dependencies.workflows.skillPolicy
  const androidWorkflowCatalog = dependencies.workflows.androidCatalog
  const { filterLocalSearchToolManifests, isBuiltinSearchToolRequest, shouldExposeLocalSearchTool } =
    dependencies.search
  const { listConversationToolManifests, listStaticConversationToolManifests } = dependencies.tools
  const { createConversationRagRuntime, createRagQueryPlan } = dependencies.rag
  const { clampWorkflowOutput, projectTrace, redactSensitiveText } = dependencies.trace

  function decideConversationChatWorkflowAssistantMessage(input: ConversationChatWorkflowRuntimeInput): ConversationChatWorkflowRuntimeDecision {
    if (input.attachments?.length) {
      return {
        shouldHandle: false,
        reason: 'attachments',
        traces: [],
      }
    }

    const ragRuntime = input.ragRuntime ?? createRuntimeRagAdapter(input)
    const manifests = input.manifests
      ? filterLocalSearchToolManifests(input.manifests, input.settings)
      : input.workflowId
        ? filterLocalSearchToolManifests(
            listStaticConversationToolManifests(),
            input.settings,
          )
        : undefined
    const blockedWorkflowStates = input.blockedWorkflowStates
    const enabledWorkflowIds = filterBlockedWorkflowIds(input.enabledWorkflowIds, blockedWorkflowStates)
    const workflowSelection =
      !input.explicitToolRequest && manifests
        ? selectRuntimeWorkflowDefinition({
            snapshot: input.conversation.skillSnapshot,
            workflowId: input.workflowId,
            manifests,
            enabledWorkflowIds,
            blockedWorkflowStates,
            now: input.now,
          })
        : undefined
    if (input.signal?.aborted && isBlockedRuntimeWorkflowSelection(workflowSelection)) {
      return cancelledRuntimeWorkflowSelectionDecision(input, ragRuntime, input.manifests)
    }
    if (workflowSelection?.disabledTrace) {
      const reason = resolveDisabledWorkflowSkipReason(workflowSelection.disabledTrace)
      return {
        shouldHandle: true,
        reason,
        traces: [workflowSelection.disabledTrace],
      }
    }
    if (workflowSelection?.ambiguousTrace) {
      return {
        shouldHandle: true,
        reason: 'workflow-selection-ambiguous',
        traces: [workflowSelection.ambiguousTrace],
      }
    }
    const entry = decideConversationChatWorkflowEntry({
      content: input.content,
      ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
      ...(input.workflowCheckpointStore ? { workflowCheckpointStore: input.workflowCheckpointStore } : {}),
      conversationTitle: input.conversation.title,
      explicitToolRequest: input.explicitToolRequest,
      requestedOutput: input.requestedOutput,
      workflowDefinition: workflowSelection?.workflow,
      ragRuntime,
      manifests,
      limits: input.limits,
      intentVisible: input.intentVisible,
      userConfirmed: input.userConfirmed,
      signal: input.signal,
      now: input.now,
    })
    if (shouldDeferWorkflowSearchTool(input, entry)) {
      return {
        shouldHandle: false,
        reason: 'workflow-not-handled',
        traces: entry.traces,
      }
    }

    return {
      shouldHandle: entry.shouldHandle,
      reason: entry.reason,
      traces: entry.traces,
    }
  }

  async function resolveConversationChatWorkflowAssistantMessage(
    input: ConversationChatWorkflowRuntimeInput,
  ): Promise<ConversationChatWorkflowRuntimeResolution> {
    if (input.attachments?.length) {
      return skippedWorkflowRuntimeResolution(
        'attachments',
        'Agentic workflow skipped: attachments require the provider chat path.',
      )
    }

    const ragRuntime = input.ragRuntime ?? createRuntimeRagAdapter(input)
    const hasWorkflowDefinitions = hasWorkflowDefinitionCandidates(input.conversation)
    const hasWorkflowSelection = Boolean(input.workflowId) || hasWorkflowDefinitions
    const initialManifests = input.manifests
      ? filterLocalSearchToolManifests(input.manifests, input.settings)
      : hasWorkflowSelection
        ? filterLocalSearchToolManifests(
            await listConversationToolManifests(),
            input.settings,
          )
        : undefined
    const blockedWorkflowStates =
      input.blockedWorkflowStates ??
      (hasWorkflowDefinitions
        ? await listBlockedWorkflowStatesForSkillSnapshot(input.conversation.skillSnapshot, initialManifests ?? [])
        : undefined)
    const enabledWorkflowIds =
      filterBlockedWorkflowIds(input.enabledWorkflowIds, blockedWorkflowStates) ??
      (hasWorkflowDefinitions
        ? await listEnabledWorkflowIdsForSkillSnapshot(input.conversation.skillSnapshot)
        : undefined)
    const workflowSelection =
      !input.explicitToolRequest && initialManifests
        ? selectRuntimeWorkflowDefinition({
            snapshot: input.conversation.skillSnapshot,
            workflowId: input.workflowId,
            manifests: initialManifests,
            enabledWorkflowIds,
            blockedWorkflowStates,
            now: input.now ?? input.startedAt,
          })
        : undefined
    if (input.signal?.aborted && isBlockedRuntimeWorkflowSelection(workflowSelection)) {
      return resolveCancelledRuntimeWorkflowSelection(input, ragRuntime, initialManifests)
    }
    if (workflowSelection?.disabledTrace) {
      const reason = resolveDisabledWorkflowSkipReason(workflowSelection.disabledTrace)
      return skippedWorkflowRuntimeResolution(
        reason,
        formatDisabledWorkflowSkip(workflowSelection.disabledTrace),
        [workflowSelection.disabledTrace],
        { handled: true, startedAt: input.startedAt },
      )
    }
    if (workflowSelection?.ambiguousTrace) {
      return skippedWorkflowRuntimeResolution(
        'workflow-selection-ambiguous',
        formatAmbiguousWorkflowSkip(workflowSelection.ambiguousTrace),
        [workflowSelection.ambiguousTrace],
        { handled: true, startedAt: input.startedAt },
      )
    }
    const entry = decideConversationChatWorkflowEntry({
      content: input.content,
      ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
      ...(input.workflowCheckpointStore ? { workflowCheckpointStore: input.workflowCheckpointStore } : {}),
      conversationTitle: input.conversation.title,
      explicitToolRequest: input.explicitToolRequest,
      requestedOutput: input.requestedOutput,
      workflowDefinition: workflowSelection?.workflow,
      ragRuntime,
      manifests: initialManifests,
      limits: input.limits,
      intentVisible: input.intentVisible,
      userConfirmed: input.userConfirmed,
      signal: input.signal,
      now: input.now,
    })
    if (shouldDeferWorkflowSearchTool(input, entry)) {
      return skippedWorkflowRuntimeResolution('workflow-not-handled', formatRuntimeSkip('direct-chat'), entry.traces)
    }
    if (!entry.shouldHandle) {
      return skippedWorkflowRuntimeResolution('workflow-not-handled', formatRuntimeSkip(entry.reason), entry.traces)
    }

    const manifests =
      initialManifests ??
      filterLocalSearchToolManifests(
        await listConversationToolManifests(),
        input.settings,
      )
    const resolution = await resolveConversationChatWorkflowAssistantMessagePatch({
      content: input.content,
      ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
      ...(input.workflowCheckpointStore ? { workflowCheckpointStore: input.workflowCheckpointStore } : {}),
      conversationTitle: input.conversation.title,
      explicitToolRequest: input.explicitToolRequest,
      requestedOutput: input.requestedOutput,
      workflowDefinition: workflowSelection?.workflow,
      manifests,
      ragRuntime,
      runtimeLog: {
        enabled: input.settings.runtimeLogEnabled,
        maxBytes: input.settings.runtimeLogMaxBytes,
      },
      limits: input.limits,
      intentVisible: input.intentVisible,
      userConfirmed: input.userConfirmed,
      signal: input.signal,
      startedAt: input.startedAt,
      now: input.now,
    })
    return {
      ...resolution,
      reason: resolution.handled ? undefined : 'workflow-not-handled',
    }
  }

  function isBlockedRuntimeWorkflowSelection(selection: RuntimeWorkflowSelection | undefined): boolean {
    return Boolean(selection?.disabledTrace || selection?.ambiguousTrace)
  }

  function shouldDeferWorkflowSearchTool(input: ConversationChatWorkflowRuntimeInput, entry: ConversationChatWorkflowEntryDecision): boolean {
    const request = input.explicitToolRequest ?? entry.classification.suggestedToolRequest
    return isBuiltinSearchToolRequest(request) && !shouldExposeLocalSearchTool(input.settings)
  }

  function cancelledRuntimeWorkflowSelectionDecision(
    input: ConversationChatWorkflowRuntimeInput,
    ragRuntime: ConversationRagRuntime | undefined,
    manifests: WorkflowToolManifest[] | undefined,
  ): ConversationChatWorkflowRuntimeDecision {
    const entry = decideConversationChatWorkflowEntry(createCancelledRuntimeEntryInput(input, ragRuntime, manifests))
    return {
      shouldHandle: entry.shouldHandle,
      reason: entry.reason,
      traces: entry.traces,
    }
  }

  async function resolveCancelledRuntimeWorkflowSelection(
    input: ConversationChatWorkflowRuntimeInput,
    ragRuntime: ConversationRagRuntime | undefined,
    manifests: WorkflowToolManifest[] | undefined,
  ): Promise<ConversationChatWorkflowRuntimeResolution> {
    const resolution = await resolveConversationChatWorkflowAssistantMessagePatch(
      createCancelledRuntimeEntryInput(input, ragRuntime, manifests),
    )
    return {
      ...resolution,
      reason: resolution.handled ? undefined : 'workflow-not-handled',
    }
  }

  function createCancelledRuntimeEntryInput(
    input: ConversationChatWorkflowRuntimeInput,
    ragRuntime: ConversationRagRuntime | undefined,
    manifests: WorkflowToolManifest[] | undefined,
  ): ConversationChatWorkflowRuntimeEntryInput & { startedAt?: number } {
    return {
      content: input.content,
      ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
      ...(input.workflowCheckpointStore ? { workflowCheckpointStore: input.workflowCheckpointStore } : {}),
      conversationTitle: input.conversation.title,
      explicitToolRequest: input.explicitToolRequest,
      requestedOutput: input.requestedOutput,
      manifests: manifests ? filterLocalSearchToolManifests(manifests, input.settings) : undefined,
      ragRuntime,
      runtimeLog: {
        enabled: input.settings.runtimeLogEnabled,
        maxBytes: input.settings.runtimeLogMaxBytes,
      },
      limits: input.limits,
      intentVisible: input.intentVisible,
      userConfirmed: input.userConfirmed,
      signal: input.signal,
      forceConversationChatWorkflowCancellation: true,
      startedAt: input.startedAt,
      now: input.now,
    }
  }

  function hasWorkflowDefinitionCandidates(conversation: Conversation): boolean {
    return hasWorkflowDefinitionCandidatesInSkillSnapshot(conversation.skillSnapshot)
  }

  function selectRuntimeWorkflowDefinition(input: {
    snapshot: Conversation['skillSnapshot']
    workflowId?: string
    manifests: WorkflowToolManifest[]
    enabledWorkflowIds?: string[]
    blockedWorkflowStates?: WorkflowRuntimeBlockState[]
    now?: number
  }): RuntimeWorkflowSelection {
    const skillWorkflowCandidates = extractWorkflowDefinitionsFromSkillSnapshot(input.snapshot)
    const workflowCandidates = [
      ...(input.workflowId
        ? skillWorkflowCandidates.filter((workflow) => workflow.id === input.workflowId)
        : skillWorkflowCandidates),
      ...(input.workflowId
        ? androidWorkflowCatalog.list({ now: input.now }).filter((workflow) => workflow.id === input.workflowId)
        : []),
    ]
    const selection = selectWorkflowDefinitionFromCandidates(
      workflowCandidates,
      input.manifests,
      { enabledWorkflowIds: input.enabledWorkflowIds },
    )
    if (selection) return { workflow: selection.workflow }
    const disabledTrace = buildDisabledSelectedWorkflowTrace(
      workflowCandidates,
      input.enabledWorkflowIds,
      input.blockedWorkflowStates,
      input.now,
      input.workflowId,
    )
    if (disabledTrace) return { disabledTrace }
    return {
      ambiguousTrace: buildAmbiguousSelectedWorkflowTrace(
        workflowCandidates,
        input.manifests,
        input.enabledWorkflowIds,
        input.now,
      ),
    }
  }

  function filterBlockedWorkflowIds(
    enabledWorkflowIds: string[] | undefined,
    blockedWorkflowStates: WorkflowRuntimeBlockState[] | undefined,
  ): string[] | undefined {
    if (!enabledWorkflowIds) return undefined
    if (!blockedWorkflowStates?.length) return enabledWorkflowIds
    const blockedWorkflowIds = new Set(blockedWorkflowStates.map((state) => state.workflowId))
    return enabledWorkflowIds.filter((workflowId) => !blockedWorkflowIds.has(workflowId))
  }

  function buildDisabledSelectedWorkflowTrace(
    workflows: WorkflowDefinition[],
    enabledWorkflowIds: string[] | undefined,
    blockedWorkflowStates: WorkflowRuntimeBlockState[] | undefined,
    now = dependencies.clock.now(),
    requestedWorkflowId?: string,
  ): ProcessTrace | undefined {
    if (workflows.length > 1) return undefined
    const workflow = workflows[0]
    if (workflow && isBuiltInRuntimeWorkflowId(workflow.id)) return undefined
    const blockedState = blockedWorkflowStates?.find((state) => (
      state.workflowId === (workflow?.id ?? requestedWorkflowId)
    )) ?? (
      !workflow && !requestedWorkflowId && blockedWorkflowStates?.length === 1
        ? blockedWorkflowStates[0]
        : undefined
    )
    if (!workflow && !blockedState) return undefined
    const workflowId = workflow?.id ?? blockedState!.workflowId
    if (!blockedState && (!enabledWorkflowIds || enabledWorkflowIds.includes(workflowId))) return undefined
    const reason = blockedState?.reason ?? 'workflow-disabled'
    const workflowName = safeRuntimeWorkflowText(workflow?.name, 'Selected workflow', WORKFLOW_SKIP_NAME_LIMIT)
    const workflowExpectedOutput = safeRuntimeWorkflowText(
      workflow?.expectedOutput ?? 'reply',
      'reply',
      WORKFLOW_SKIP_NAME_LIMIT,
    )

    return projectTrace({
      id: `agent-workflow-skill-disabled-${now}`,
      type: 'system',
      title: 'Agent workflow skill',
      content: formatBlockedWorkflowTraceContent(workflowName, reason),
      status: 'skipped',
      startedAt: now,
      completedAt: now,
      metadata: {
        reason,
        workflowId,
        workflowName,
        workflowExpectedOutput,
        workflowCount: workflows.length,
        failureNextStep: formatBlockedWorkflowNextStep(reason),
      },
    })
  }

  function formatBlockedWorkflowTraceContent(
    workflowName: string,
    reason: WorkflowRuntimeBlockState['reason'],
  ): string {
    if (reason === 'workflow-review-required') {
      return `Workflow "${workflowName}" was imported and requires review in Skills before it can run.`
    }
    if (reason === 'workflow-invalid') {
      return `Workflow "${workflowName}" no longer matches the current tool registry or permission policy. It was not executed.`
    }
    return `Workflow "${workflowName}" is disabled or no longer enabled in Skills. It was not executed.`
  }

  function formatBlockedWorkflowNextStep(reason: WorkflowRuntimeBlockState['reason']): string {
    if (reason === 'workflow-review-required') {
      return 'Review and enable the imported workflow in Skills before running it again.'
    }
    if (reason === 'workflow-invalid') {
      return 'Review the workflow definition in Skills, fix unavailable or unsafe tools, then enable it again.'
    }
    return 'Enable the workflow in Skills before running it again.'
  }

  function buildAmbiguousSelectedWorkflowTrace(
    workflows: WorkflowDefinition[],
    manifests: WorkflowToolManifest[],
    enabledWorkflowIds: string[] | undefined,
    now = dependencies.clock.now(),
  ): ProcessTrace | undefined {
    const enabledWorkflowIdSet = enabledWorkflowIds ? new Set(enabledWorkflowIds) : undefined
    const validWorkflows = workflows
      .map((workflow) => workflowDefinitionPolicy.validate(workflow, manifests))
      .filter((validation) => validation.ok && validation.definition?.enabled)
      .map((validation) => validation.definition!)
      .filter(
        (workflow) =>
          !enabledWorkflowIdSet || enabledWorkflowIdSet.has(workflow.id) || isBuiltInRuntimeWorkflowId(workflow.id),
      )

    if (validWorkflows.length <= 1) return undefined
    const workflowNames = validWorkflows
      .map((workflow) => safeRuntimeWorkflowText(workflow.name, 'Agent workflow', WORKFLOW_SKIP_NAME_LIMIT))
      .slice(0, WORKFLOW_SKIP_NAME_LIST_LIMIT)
    return projectTrace({
      id: `agent-workflow-skill-ambiguous-${now}`,
      type: 'system',
      title: 'Agent workflow skill',
      content: safeRuntimeWorkflowText(
        `Multiple selected workflows are enabled: ${workflowNames.join(', ')}. No workflow was executed.`,
        'Multiple selected workflows are enabled. No workflow was executed.',
        WORKFLOW_SKIP_REPLY_LIMIT,
      ),
      status: 'skipped',
      startedAt: now,
      completedAt: now,
      metadata: {
        reason: 'workflow-selection-ambiguous',
        workflowCount: validWorkflows.length,
        workflowIds: validWorkflows.map((workflow) => workflow.id),
        workflowNames,
        failureNextStep: 'Name one workflow in the request or disable extra selected workflows before running again.',
      },
    })
  }

  function selectWorkflowDefinitionFromCandidates(
    workflows: WorkflowDefinition[],
    manifests: WorkflowToolManifest[],
    options: { enabledWorkflowIds?: string[] } = {},
  ): { workflow: WorkflowDefinition } | undefined {
    const enabledWorkflowIdSet = options.enabledWorkflowIds ? new Set(options.enabledWorkflowIds) : undefined
    const valid = workflows
      .map((workflow) => ({
        workflow,
        validation: workflowDefinitionPolicy.validate(workflow, manifests),
      }))
      .filter((item) => item.validation.ok && item.validation.definition?.enabled)
      .filter(
        (item) =>
          !enabledWorkflowIdSet ||
          enabledWorkflowIdSet.has(item.validation.definition!.id) ||
          isBuiltInRuntimeWorkflowId(item.validation.definition!.id),
      )
      .map((item) => item.validation.definition!)

    if (valid.length === 1) return { workflow: valid[0] }
    return undefined
  }

  function isBuiltInRuntimeWorkflowId(workflowId: string): boolean {
    return androidWorkflowCatalog.isBuiltInWorkflowId(workflowId)
  }

  function createRuntimeRagAdapter(input: ConversationChatWorkflowRuntimeInput): ConversationRagRuntime | undefined {
    const contextRuntime = createRetrieveContextRagRuntime(input)
    if (contextRuntime) return contextRuntime
    if (!input.retrieveKnowledge) return undefined
    const now = input.now
    return createConversationRagRuntime({
      settings: input.settings,
      conversationTitle: input.conversation.title,
      systemPrompt: input.conversation.systemPrompt,
      memorySources: input.memorySources,
      retrieveKnowledge: input.retrieveKnowledge,
      retrieveAgentic: input.retrieveAgentic,
      now: typeof now === 'number' ? () => now : undefined,
    })
  }

  function createRetrieveContextRagRuntime(input: ConversationChatWorkflowRuntimeInput): ConversationRagRuntime | undefined {
    const retrieveContext = input.retrieveContext
    if (!retrieveContext) return undefined

    return {
      buildContextPack: async (request: ConversationRagContextPackRequest, options?: ConversationRagRuntimeOptions) => {
        throwIfRuntimeRagCancelled(options?.signal)
        const startedAt = resolveRuntimeNow(input)
        const contextConversation: Conversation = {
          ...input.conversation,
          title: request.conversationTitle ?? input.conversation.title,
          systemPrompt: request.systemPrompt ?? input.conversation.systemPrompt,
        }
        const draftMessage = createConversationRagDraftMessage(request.query, startedAt)
        const retrieved = await retrieveContext(contextConversation, draftMessage, options?.signal)
        throwIfRuntimeRagCancelled(options?.signal)
        return buildRagContextPackFromRetrievedContext({
          retrieved,
          request,
          settings: input.settings,
          conversationTitle: contextConversation.title,
          systemPrompt: contextConversation.systemPrompt,
          startedAt,
          completedAt: resolveRuntimeNow(input),
        })
      },
    }
  }

  function throwIfRuntimeRagCancelled(signal?: AbortSignal): void {
    if (!signal?.aborted) return
    const error = new Error('RAG retrieval was cancelled.')
    error.name = 'AbortError'
    throw error
  }

  function createConversationRagDraftMessage(content: string, timestamp: number): Message {
    return {
      id: `agent-rag-draft-${timestamp}`,
      role: 'user',
      content,
      timestamp,
      status: 'done',
    }
  }

  function buildRagContextPackFromRetrievedContext(input: {
    retrieved: ConversationChatWorkflowRetrievedContext
    request: ConversationRagContextPackRequest
    settings: Settings
    conversationTitle?: string
    systemPrompt?: string
    startedAt: number
    completedAt: number
  }): RagContextPack {
    const plan =
      input.retrieved.plan ??
      createRagQueryPlan({
        query: input.request.query,
        conversationTitle: input.conversationTitle,
        systemPrompt: input.systemPrompt,
        settings: input.settings,
        profile: input.request.profile,
        profileReason: input.request.profileReason,
        now: input.startedAt,
        tokenBudget: input.request.tokenBudget,
        maxContextItems: input.request.maxContextItems,
      })
    const sourceLimit = Math.max(0, input.request.maxContextItems ?? plan.contextItemBudget)
    const sources = input.retrieved.sources
      .slice(0, sourceLimit)
      .map((source, index) => toRagRetrievalCandidate(source, plan, index))
    const contextPrompt = input.retrieved.prompt || formatRetrievedContextPrompt(sources)
    const citations = sources.map((source, index) => toRagCitation(source, index))
    return {
      plan,
      sources,
      citations,
      contextPrompt,
      trace: buildRetrievedContextTrace(input.retrieved, sources, contextPrompt, input.startedAt, input.completedAt),
      quality:
        input.retrieved.quality ??
        buildFallbackRagQuality(input.retrieved, plan, sources, contextPrompt, input.startedAt, input.completedAt),
      retrievalStats: buildRetrievedContextStats(plan, sources),
    }
  }

  function toRagRetrievalCandidate(source: RetrievalSource, plan: RagQueryPlan, index: number): RagRetrievalCandidate {
    const id = source.id || `retrieved-context-${index + 1}`
    return {
      ...source,
      id,
      candidateId: `agent-context-${index + 1}-${id}`,
      origin: toRagRetrievalOrigin(source),
      queryVariant: plan.query,
      originalRank: index + 1,
      originalScore: source.score ?? source.similarityScore ?? source.vectorScore ?? source.ftsScore,
    }
  }

  function toRagRetrievalOrigin(source: RetrievalSource): RagRetrievalOrigin {
    return source.type
  }

  function toRagCitation(source: RagRetrievalCandidate, index: number): RagCitation {
    return {
      id: source.id,
      type: source.type,
      title: source.title,
      excerpt: source.excerpt ?? source.content.slice(0, 240),
      url: source.url,
      documentId: source.documentId,
      chunkId: source.chunkId,
      score: source.score,
      ftsScore: source.ftsScore,
      vectorScore: source.vectorScore,
      chunkIndex: source.chunkIndex,
      similarityScore: source.similarityScore,
      sourceUri: source.sourceUri,
      retrievalMode: source.retrievalMode,
      rerankScore: source.rerankScore,
      compressionRatio: source.compressionRatio,
      sourceReason: source.sourceReason,
      headingPath: source.headingPath,
      semanticBoundary: source.semanticBoundary,
      qualityScore: source.qualityScore,
      label: `[${index + 1}]`,
    }
  }

  function formatRetrievedContextPrompt(sources: RagRetrievalCandidate[]): string {
    return sources
      .map((source, index) => {
        const excerpt = source.excerpt ?? source.content.slice(0, 600)
        return `[${index + 1}] ${source.title}\n${excerpt}`
      })
      .join('\n\n')
  }

  function buildRetrievedContextTrace(
    retrieved: ConversationChatWorkflowRetrievedContext,
    sources: RagRetrievalCandidate[],
    contextPrompt: string,
    startedAt: number,
    completedAt: number,
  ): RagTraceStep[] {
    const durationMs = Math.max(0, completedAt - startedAt)
    const packTrace: RagTraceStep = {
      id: `agent-rag-pack-${startedAt}`,
      stage: 'pack',
      title: 'Agent RAG context adapter',
      status: 'done',
      content: `Adapted ${sources.length} retrieved sources into an agent context pack.`,
      startedAt,
      completedAt,
      durationMs,
      metadata: {
        sourceCount: sources.length,
        hasPlan: Boolean(retrieved.plan),
        hasQuality: Boolean(retrieved.quality),
        hasPrompt: Boolean(contextPrompt.trim()),
      },
    }
    if (retrieved.trace?.length) {
      return [...retrieved.trace, packTrace]
    }
    return [
      {
        id: `agent-rag-retrieve-${startedAt}`,
        stage: 'retrieve',
        title: 'Chat context retrieval',
        status: sources.length ? 'done' : 'skipped',
        content: sources.length
          ? `Retrieved ${sources.length} sources through the chat context pipeline.`
          : 'No sources were returned by the chat context pipeline.',
        startedAt,
        completedAt,
        durationMs,
        metadata: { sourceCount: sources.length },
      },
      packTrace,
    ]
  }

  function buildFallbackRagQuality(
    retrieved: ConversationChatWorkflowRetrievedContext,
    plan: RagQueryPlan,
    sources: RagRetrievalCandidate[],
    contextPrompt: string,
    startedAt: number,
    completedAt: number,
  ): RagEvaluationResult {
    const sourceCount = sources.length
    const memoryOnly = sourceCount > 0 && sources.every((source) => source.type === 'memory')
    const warnings = ['agent-rag-quality-fallback']
    if (!retrieved.plan) warnings.push('agent-rag-plan-fallback')
    if (!sourceCount) warnings.push('agent-rag-no-sources')
    if (memoryOnly) warnings.push('agent-rag-memory-only-context')
    return {
      sourceCount,
      candidateCount: sourceCount,
      citationCoverage: sourceCount ? 1 : 0,
      contextPrecision: sourceCount ? (memoryOnly ? 0.45 : 0.55) : 0,
      compressionRatio: 1,
      confidence: sourceCount ? (memoryOnly ? 0.42 : 0.5) : 0.12,
      activeRetrievals: sourceCount ? 1 : 0,
      missingEvidence: sourceCount === 0,
      warnings,
      fallbackReasons: warnings,
      latencyMs: Math.max(0, completedAt - startedAt),
      tokenBudget: plan.tokenBudget,
      estimatedContextTokens: estimateRagContextTokens(contextPrompt),
    }
  }

  function buildRetrievedContextStats(plan: RagQueryPlan, sources: RagRetrievalCandidate[]): RagRetrievalStats {
    const byOrigin: Partial<Record<RagRetrievalOrigin, number>> = {}
    for (const source of sources) {
      byOrigin[source.origin] = (byOrigin[source.origin] ?? 0) + 1
    }
    return {
      queryVariants: Math.max(1, plan.rewrittenQueries.length),
      memoryCandidates: sources.filter((source) => source.type === 'memory').length,
      knowledgeCandidates: sources.filter((source) => source.type === 'knowledge').length,
      advancedCandidates: sources.filter((source) => !['memory', 'knowledge', 'web'].includes(source.origin)).length,
      byOrigin,
    }
  }

  function estimateRagContextTokens(contextPrompt: string): number {
    const trimmed = contextPrompt.trim()
    return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0
  }

  function resolveRuntimeNow(input: ConversationChatWorkflowRuntimeInput): number {
    return typeof input.now === 'number' ? input.now : dependencies.clock.now()
  }

  function skippedWorkflowRuntimeResolution(
    reason: ConversationChatWorkflowRuntimeSkipReason,
    content: string,
    traces: ConversationChatWorkflowRuntimeResolution['reply']['traces'] = [],
    options: { handled?: boolean; startedAt?: number } = {},
  ): ConversationChatWorkflowRuntimeResolution {
    const reply: ConversationChatWorkflowRuntimeWorkflowReply = {
      handled: Boolean(options.handled),
      status: 'skipped',
      content,
      traces,
    }
    return {
      handled: reply.handled,
      reason,
      reply,
      patch: reply.handled ? buildConversationChatWorkflowAssistantMessagePatch(reply, options.startedAt) : undefined,
    }
  }

  function formatDisabledWorkflowSkip(trace: ProcessTrace): string {
    const workflowName = safeRuntimeWorkflowText(
      trace.metadata?.workflowName,
      'Selected workflow',
      WORKFLOW_SKIP_NAME_LIMIT,
    )
    if (trace.metadata?.reason === 'workflow-review-required') {
      return safeRuntimeWorkflowText(
        `${workflowName} was imported and requires review in Skills before it can run. Review and enable it in Settings.`,
        'Selected workflow was imported and requires review in Skills before it can run. Review and enable it in Settings.',
        WORKFLOW_SKIP_REPLY_LIMIT,
      )
    }
    if (trace.metadata?.reason === 'workflow-invalid') {
      return safeRuntimeWorkflowText(
        `${workflowName} no longer matches the current tool registry or permission policy. Review the workflow in Settings before running it again.`,
        'Selected workflow no longer matches the current tool registry or permission policy. Review it in Settings before running it again.',
        WORKFLOW_SKIP_REPLY_LIMIT,
      )
    }
    return safeRuntimeWorkflowText(
      `${workflowName} is disabled or no longer enabled in Skills. Enable it in Settings before running it again.`,
      'Selected workflow is disabled or no longer enabled in Skills. Enable it in Settings before running it again.',
      WORKFLOW_SKIP_REPLY_LIMIT,
    )
  }

  function resolveDisabledWorkflowSkipReason(trace: ProcessTrace): ConversationChatWorkflowRuntimeSkipReason {
    if (trace.metadata?.reason === 'workflow-review-required') return 'workflow-review-required'
    if (trace.metadata?.reason === 'workflow-invalid') return 'workflow-invalid'
    return 'workflow-disabled'
  }

  function formatAmbiguousWorkflowSkip(trace: ProcessTrace): string {
    const workflowNames = Array.isArray(trace.metadata?.workflowNames)
      ? trace.metadata.workflowNames
          .map((value) => safeRuntimeWorkflowText(value, '', WORKFLOW_SKIP_NAME_LIMIT))
          .filter(Boolean)
          .slice(0, WORKFLOW_SKIP_NAME_LIST_LIMIT)
      : []
    const suffix = workflowNames.length ? `: ${workflowNames.join(', ')}` : ''
    return safeRuntimeWorkflowText(
      `Multiple selected workflows are enabled${suffix}. Name one workflow or disable extras before running it.`,
      'Multiple selected workflows are enabled. Name one workflow or disable extras before running it.',
      WORKFLOW_SKIP_REPLY_LIMIT,
    )
  }

  function safeRuntimeWorkflowText(value: unknown, fallback: string, limit: number): string {
    const text = typeof value === 'string' ? value.trim() : ''
    const safe = clampWorkflowOutput(redactSensitiveText(text || fallback), limit)
      .replace(/\n\[output truncated\]$/, '')
      .trim()
    return safe || fallback
  }

  function formatRuntimeSkip(reason: ConversationChatWorkflowEntryReason): string {
    switch (reason) {
      case 'direct-chat':
        return 'Direct chat path selected.'
      case 'settings-local-command-router':
        return 'Settings action is handled by the local command router.'
      case 'rag-runtime-missing':
        return 'RAG evidence workflow requires a RAG runtime adapter.'
      case 'planner-tool-missing':
        return 'Agentic planner did not produce an executable tool step.'
      case 'explicit-tool-request':
      case 'selected-workflow-skill':
      case 'work-artifact':
      case 'rag-runtime-ready':
        return 'Agentic workflow entry is ready.'
    }
    return 'Agentic workflow skipped.'
  }

  return {
    decideConversationChatWorkflowAssistantMessage,
    resolveConversationChatWorkflowAssistantMessage,
  }
}
