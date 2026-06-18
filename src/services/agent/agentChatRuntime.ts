import type {
  Attachment,
  Conversation,
  Message,
  ProcessTrace,
  RagCitation,
  RagContextPack,
  RagEvaluationResult,
  RagQueryPlan,
  RagRetrievalCandidate,
  RagRetrievalOrigin,
  RagRetrievalStats,
  RagTraceStep,
  RetrievalSource,
  Settings,
} from '@/types'
import type {
  AgentToolRequest,
  AgentWorkflowDefinition,
  AgentRagContextPackRequest,
  AgentRagRuntime,
  AgentRagRuntimeOptions,
  AgentRequestedOutput,
  AgentRunLimits,
  AgentToolManifest,
} from '@/services/agent/agentToolTypes'
import type { AgentAssistantMessageResolution } from '@/services/agent/agentMessageAdapter'
import { decideAgenticChatEntry, type AgenticChatEntryInput, type AgenticChatEntryReason, type AgenticChatWorkflowReply } from '@/services/agent/agentChatEntry'
import { buildAgentAssistantMessagePatch, resolveAgentAssistantMessagePatch } from '@/services/agent/agentMessageAdapter'
import { createAgentRagRuntime } from '@/services/agent/agentRagRuntime'
import { clampAgentOutput, createAgentTrace, redactSensitiveText } from '@/services/agent/agentTrace'
import { listAgentToolManifests, listStaticAgentToolManifests } from '@/services/agent/agentToolRegistry'
import { validateAgentWorkflowDefinition } from '@/services/agent/agentWorkflowDefinitions'
import {
  extractAgentWorkflowDefinitionsFromSkillSnapshot,
  listBlockedAgentWorkflowStatesForSkillSnapshot,
  listEnabledAgentWorkflowIdsForSkillSnapshot,
  type AgentWorkflowRuntimeBlockState,
} from '@/services/agent/agentWorkflowSkills'
import {
  ANDROID_ALARM_WORKFLOW_ID,
  ANDROID_APK_INSTALL_WORKFLOW_ID,
  ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID,
  ANDROID_CALENDAR_TODO_WORKFLOW_ID,
  ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID,
  ANDROID_FILE_COPY_RENAME_WORKFLOW_ID,
  ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID,
  listAndroidBuiltInWorkflowDefinitions,
} from '@/services/agent/agentAndroidWorkflows'
import { inferAndroidWorkflowId } from '@/services/agent/agentIntentClassifier'
import { createRagQueryPlan } from '@/services/rag'

export interface AgentRetrievedContext {
  sources: RetrievalSource[]
  prompt: string
  plan?: RagQueryPlan
  trace?: RagTraceStep[]
  quality?: RagEvaluationResult
}

export type AgentContextRetriever = (conversation: Conversation, draftMessage: Message) => Promise<AgentRetrievedContext>

export interface AgentChatRuntimeInput {
  conversation: Conversation
  content: string
  attachments?: Attachment[]
  settings: Settings
  manifests?: AgentToolManifest[]
  explicitToolRequest?: AgentToolRequest
  requestedOutput?: AgentRequestedOutput
  ragRuntime?: AgentRagRuntime
  retrieveContext?: AgentContextRetriever
  memorySources?: RetrievalSource[]
  retrieveKnowledge?: (query: string, limit: number) => Promise<RetrievalSource[]>
  retrieveAgentic?: (query: string, plan: RagQueryPlan, limit: number) => Promise<RetrievalSource[]>
  enabledAgentWorkflowIds?: string[]
  blockedAgentWorkflowStates?: AgentWorkflowRuntimeBlockState[]
  limits?: Partial<AgentRunLimits>
  intentVisible?: boolean
  userConfirmed?: boolean
  signal?: AbortSignal
  startedAt?: number
  now?: number
}

export type AgentChatRuntimeSkipReason =
  | 'attachments'
  | 'agent-not-handled'
  | 'workflow-selection-ambiguous'
  | 'workflow-disabled'
  | 'workflow-review-required'
  | 'workflow-invalid'

export interface AgentChatRuntimeResolution extends AgentAssistantMessageResolution {
  reason?: AgentChatRuntimeSkipReason
}

export interface AgentChatRuntimeDecision {
  shouldHandle: boolean
  reason: AgentChatRuntimeSkipReason | AgenticChatEntryReason
  traces: ProcessTrace[]
}

interface RuntimeWorkflowSelection {
  workflow?: AgentWorkflowDefinition
  ambiguousTrace?: ProcessTrace
  disabledTrace?: ProcessTrace
}

const WORKFLOW_SKIP_REPLY_LIMIT = 900
const WORKFLOW_SKIP_NAME_LIMIT = 160
const WORKFLOW_SKIP_NAME_LIST_LIMIT = 6

export function decideAgentRuntimeAssistantMessage(input: AgentChatRuntimeInput): AgentChatRuntimeDecision {
  if (input.attachments?.length) {
    return {
      shouldHandle: false,
      reason: 'attachments',
      traces: [],
    }
  }

  const ragRuntime = input.ragRuntime ?? createRuntimeRagAdapter(input)
  const manifests = input.manifests ?? (hasBuiltInRuntimeWorkflowCandidate(input.content) ? listStaticAgentToolManifests() : undefined)
  const blockedWorkflowStates = input.blockedAgentWorkflowStates
  const enabledWorkflowIds = filterBlockedWorkflowIds(input.enabledAgentWorkflowIds, blockedWorkflowStates)
  const workflowSelection = !input.explicitToolRequest && manifests
    ? selectRuntimeWorkflowDefinition({
        snapshot: input.conversation.skillSnapshot,
        content: input.content,
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
  const entry = decideAgenticChatEntry({
    content: input.content,
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

  return {
    shouldHandle: entry.shouldHandle,
    reason: entry.reason,
    traces: entry.traces,
  }
}

export async function resolveAgentRuntimeAssistantMessage(
  input: AgentChatRuntimeInput
): Promise<AgentChatRuntimeResolution> {
  if (input.attachments?.length) {
    return skippedAgentRuntimeResolution('attachments', 'Agentic workflow skipped: attachments require the provider chat path.')
  }

  const ragRuntime = input.ragRuntime ?? createRuntimeRagAdapter(input)
  const hasWorkflowDefinitions = hasAgentWorkflowDefinitions(input.conversation)
  const hasBuiltInWorkflowCandidate = hasBuiltInRuntimeWorkflowCandidate(input.content)
  const initialManifests = input.manifests ?? (hasWorkflowDefinitions || hasBuiltInWorkflowCandidate
    ? await listAgentToolManifests()
    : undefined)
  const blockedWorkflowStates = input.blockedAgentWorkflowStates ?? (hasWorkflowDefinitions
    ? await listBlockedAgentWorkflowStatesForSkillSnapshot(input.conversation.skillSnapshot, initialManifests ?? [])
    : undefined)
  const enabledWorkflowIds = filterBlockedWorkflowIds(input.enabledAgentWorkflowIds, blockedWorkflowStates)
    ?? (hasWorkflowDefinitions
    ? await listEnabledAgentWorkflowIdsForSkillSnapshot(input.conversation.skillSnapshot)
    : undefined)
  const workflowSelection = !input.explicitToolRequest && initialManifests
    ? selectRuntimeWorkflowDefinition({
        snapshot: input.conversation.skillSnapshot,
        content: input.content,
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
    return skippedAgentRuntimeResolution(
      reason,
      formatDisabledWorkflowSkip(workflowSelection.disabledTrace),
      [workflowSelection.disabledTrace],
      { handled: true, startedAt: input.startedAt }
    )
  }
  if (workflowSelection?.ambiguousTrace) {
    return skippedAgentRuntimeResolution(
      'workflow-selection-ambiguous',
      formatAmbiguousWorkflowSkip(workflowSelection.ambiguousTrace),
      [workflowSelection.ambiguousTrace],
      { handled: true, startedAt: input.startedAt }
    )
  }
  const entry = decideAgenticChatEntry({
    content: input.content,
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
  if (!entry.shouldHandle) {
    return skippedAgentRuntimeResolution('agent-not-handled', formatRuntimeSkip(entry.reason), entry.traces)
  }

  const manifests = initialManifests ?? await listAgentToolManifests()
  const resolution = await resolveAgentAssistantMessagePatch({
    content: input.content,
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
    reason: resolution.handled ? undefined : 'agent-not-handled',
  }
}

function isBlockedRuntimeWorkflowSelection(selection: RuntimeWorkflowSelection | undefined): boolean {
  return Boolean(selection?.disabledTrace || selection?.ambiguousTrace)
}

function cancelledRuntimeWorkflowSelectionDecision(
  input: AgentChatRuntimeInput,
  ragRuntime: AgentRagRuntime | undefined,
  manifests: AgentToolManifest[] | undefined
): AgentChatRuntimeDecision {
  const entry = decideAgenticChatEntry(createCancelledRuntimeEntryInput(input, ragRuntime, manifests))
  return {
    shouldHandle: entry.shouldHandle,
    reason: entry.reason,
    traces: entry.traces,
  }
}

async function resolveCancelledRuntimeWorkflowSelection(
  input: AgentChatRuntimeInput,
  ragRuntime: AgentRagRuntime | undefined,
  manifests: AgentToolManifest[] | undefined
): Promise<AgentChatRuntimeResolution> {
  const resolution = await resolveAgentAssistantMessagePatch(createCancelledRuntimeEntryInput(input, ragRuntime, manifests))
  return {
    ...resolution,
    reason: resolution.handled ? undefined : 'agent-not-handled',
  }
}

function createCancelledRuntimeEntryInput(
  input: AgentChatRuntimeInput,
  ragRuntime: AgentRagRuntime | undefined,
  manifests: AgentToolManifest[] | undefined
): AgenticChatEntryInput & { startedAt?: number } {
  return {
    content: input.content,
    conversationTitle: input.conversation.title,
    explicitToolRequest: input.explicitToolRequest,
    requestedOutput: input.requestedOutput,
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
    forceAgenticCancellation: true,
    startedAt: input.startedAt,
    now: input.now,
  }
}

function hasAgentWorkflowDefinitions(conversation: Conversation): boolean {
  return extractAgentWorkflowDefinitionsFromSkillSnapshot(conversation.skillSnapshot).length > 0
}

function selectRuntimeWorkflowDefinition(input: {
  snapshot: Conversation['skillSnapshot']
  content: string
  manifests: AgentToolManifest[]
  enabledWorkflowIds?: string[]
  blockedWorkflowStates?: AgentWorkflowRuntimeBlockState[]
  now?: number
}): RuntimeWorkflowSelection {
  const workflowCandidates = [
    ...extractAgentWorkflowDefinitionsFromSkillSnapshot(input.snapshot),
    ...listBuiltInRuntimeWorkflowCandidates(input.content, input.now),
  ]
  const selection = selectAgentWorkflowDefinitionFromCandidates(workflowCandidates, input.content, input.manifests, {
    enabledWorkflowIds: input.enabledWorkflowIds,
  })
  if (selection) return { workflow: selection.workflow }
  const disabledTrace = buildDisabledSelectedWorkflowTrace(
    workflowCandidates,
    input.enabledWorkflowIds,
    input.blockedWorkflowStates,
    input.now
  )
  if (disabledTrace) return { disabledTrace }
  return {
    ambiguousTrace: buildAmbiguousSelectedWorkflowTrace(workflowCandidates, input.manifests, input.enabledWorkflowIds, input.now),
  }
}

function filterBlockedWorkflowIds(
  enabledWorkflowIds: string[] | undefined,
  blockedWorkflowStates: AgentWorkflowRuntimeBlockState[] | undefined
): string[] | undefined {
  if (!enabledWorkflowIds) return undefined
  if (!blockedWorkflowStates?.length) return enabledWorkflowIds
  const blockedWorkflowIds = new Set(blockedWorkflowStates.map((state) => state.workflowId))
  return enabledWorkflowIds.filter((workflowId) => !blockedWorkflowIds.has(workflowId))
}

function buildDisabledSelectedWorkflowTrace(
  workflows: AgentWorkflowDefinition[],
  enabledWorkflowIds: string[] | undefined,
  blockedWorkflowStates: AgentWorkflowRuntimeBlockState[] | undefined,
  now = Date.now()
): ProcessTrace | undefined {
  if (workflows.length !== 1) return undefined
  const [workflow] = workflows
  if (!workflow) return undefined
  if (isBuiltInRuntimeWorkflowId(workflow.id)) return undefined
  const blockedState = blockedWorkflowStates?.find((state) => state.workflowId === workflow.id)
  if (!blockedState && (!enabledWorkflowIds || enabledWorkflowIds.includes(workflow.id))) return undefined
  const reason = blockedState?.reason ?? 'workflow-disabled'
  const workflowName = safeRuntimeWorkflowText(workflow.name, 'Selected workflow', WORKFLOW_SKIP_NAME_LIMIT)
  const workflowExpectedOutput = safeRuntimeWorkflowText(workflow.expectedOutput ?? 'reply', 'reply', WORKFLOW_SKIP_NAME_LIMIT)

  return createAgentTrace({
    id: `agent-workflow-skill-disabled-${now}`,
    type: 'system',
    title: 'Agent workflow skill',
    content: formatBlockedWorkflowTraceContent(workflowName, reason),
    status: 'skipped',
    startedAt: now,
    completedAt: now,
    metadata: {
      reason,
      workflowId: workflow.id,
      workflowName,
      workflowExpectedOutput,
      workflowCount: workflows.length,
      failureNextStep: formatBlockedWorkflowNextStep(reason),
    },
  })
}

function formatBlockedWorkflowTraceContent(
  workflowName: string,
  reason: AgentWorkflowRuntimeBlockState['reason']
): string {
  if (reason === 'workflow-review-required') {
    return `Workflow "${workflowName}" was imported and requires review in Skills before it can run.`
  }
  if (reason === 'workflow-invalid') {
    return `Workflow "${workflowName}" no longer matches the current tool registry or permission policy. It was not executed.`
  }
  return `Workflow "${workflowName}" is disabled or no longer enabled in Skills. It was not executed.`
}

function formatBlockedWorkflowNextStep(reason: AgentWorkflowRuntimeBlockState['reason']): string {
  if (reason === 'workflow-review-required') {
    return 'Review and enable the imported workflow in Skills before running it again.'
  }
  if (reason === 'workflow-invalid') {
    return 'Review the workflow definition in Skills, fix unavailable or unsafe tools, then enable it again.'
  }
  return 'Enable the workflow in Skills before running it again.'
}

function buildAmbiguousSelectedWorkflowTrace(
  workflows: AgentWorkflowDefinition[],
  manifests: AgentToolManifest[],
  enabledWorkflowIds: string[] | undefined,
  now = Date.now()
): ProcessTrace | undefined {
  const enabledWorkflowIdSet = enabledWorkflowIds ? new Set(enabledWorkflowIds) : undefined
  const validWorkflows = workflows
    .map((workflow) => validateAgentWorkflowDefinition(workflow, manifests))
    .filter((validation) => validation.ok && validation.sanitized?.enabled)
    .map((validation) => validation.sanitized!)
    .filter((workflow) => !enabledWorkflowIdSet || enabledWorkflowIdSet.has(workflow.id) || isBuiltInRuntimeWorkflowId(workflow.id))

  if (validWorkflows.length <= 1) return undefined
  const workflowNames = validWorkflows
    .map((workflow) => safeRuntimeWorkflowText(workflow.name, 'Agent workflow', WORKFLOW_SKIP_NAME_LIMIT))
    .slice(0, WORKFLOW_SKIP_NAME_LIST_LIMIT)
  return createAgentTrace({
    id: `agent-workflow-skill-ambiguous-${now}`,
    type: 'system',
    title: 'Agent workflow skill',
    content: safeRuntimeWorkflowText(
      `Multiple selected workflows are enabled: ${workflowNames.join(', ')}. No workflow was executed.`,
      'Multiple selected workflows are enabled. No workflow was executed.',
      WORKFLOW_SKIP_REPLY_LIMIT
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

function listBuiltInRuntimeWorkflowCandidates(content: string, now?: number): AgentWorkflowDefinition[] {
  const workflowId = inferAndroidWorkflowId(content)
  if (!workflowId) return []
  return listAndroidBuiltInWorkflowDefinitions({ now }).filter((workflow) => workflow.id === workflowId)
}

function selectAgentWorkflowDefinitionFromCandidates(
  workflows: AgentWorkflowDefinition[],
  content: string,
  manifests: AgentToolManifest[],
  options: { enabledWorkflowIds?: string[] } = {}
): { workflow: AgentWorkflowDefinition } | undefined {
  const enabledWorkflowIdSet = options.enabledWorkflowIds ? new Set(options.enabledWorkflowIds) : undefined
  const valid = workflows
    .map((workflow) => ({ workflow, validation: validateAgentWorkflowDefinition(workflow, manifests) }))
    .filter((item) => item.validation.ok && item.validation.sanitized?.enabled)
    .filter((item) => !enabledWorkflowIdSet || enabledWorkflowIdSet.has(item.validation.sanitized!.id) || isBuiltInRuntimeWorkflowId(item.validation.sanitized!.id))
    .map((item) => item.validation.sanitized!)

  if (valid.length === 1) return { workflow: valid[0] }

  const matched = valid.filter((workflow) => runtimeWorkflowMatchesContent(workflow, content))
  if (matched.length === 1) return { workflow: matched[0] }

  return undefined
}

function runtimeWorkflowMatchesContent(workflow: AgentWorkflowDefinition, content: string): boolean {
  const normalizedContent = normalizeRuntimeWorkflowMatchText(content)
  if (!normalizedContent) return false
  const candidates = [
    workflow.name,
    workflow.id,
    ...workflow.triggerHints,
  ]
    .map(normalizeRuntimeWorkflowMatchText)
    .filter((value) => value.length >= 2)
  return candidates.some((candidate) => normalizedContent.includes(candidate))
}

function normalizeRuntimeWorkflowMatchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function hasBuiltInRuntimeWorkflowCandidate(content: string): boolean {
  return Boolean(inferAndroidWorkflowId(content))
}

function isBuiltInRuntimeWorkflowId(workflowId: string): boolean {
  return workflowId === ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID ||
    workflowId === ANDROID_FILE_COPY_RENAME_WORKFLOW_ID ||
    workflowId === ANDROID_APK_INSTALL_WORKFLOW_ID ||
    workflowId === ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID ||
    workflowId === ANDROID_ALARM_WORKFLOW_ID ||
    workflowId === ANDROID_CALENDAR_TODO_WORKFLOW_ID ||
    workflowId === ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID
}

function createRuntimeRagAdapter(input: AgentChatRuntimeInput): AgentRagRuntime | undefined {
  const contextRuntime = createRetrieveContextRagRuntime(input)
  if (contextRuntime) return contextRuntime
  if (!input.retrieveKnowledge) return undefined
  const now = input.now
  return createAgentRagRuntime({
    settings: input.settings,
    conversationTitle: input.conversation.title,
    systemPrompt: input.conversation.systemPrompt,
    memorySources: input.memorySources,
    retrieveKnowledge: input.retrieveKnowledge,
    retrieveAgentic: input.retrieveAgentic,
    now: typeof now === 'number' ? () => now : undefined,
  })
}

function createRetrieveContextRagRuntime(input: AgentChatRuntimeInput): AgentRagRuntime | undefined {
  const retrieveContext = input.retrieveContext
  if (!retrieveContext) return undefined

  return {
    buildContextPack: async (request: AgentRagContextPackRequest, options?: AgentRagRuntimeOptions) => {
      throwIfRuntimeRagCancelled(options?.signal)
      const startedAt = resolveRuntimeNow(input)
      const contextConversation: Conversation = {
        ...input.conversation,
        title: request.conversationTitle ?? input.conversation.title,
        systemPrompt: request.systemPrompt ?? input.conversation.systemPrompt,
      }
      const draftMessage = createAgentRagDraftMessage(request.query, startedAt)
      const retrieved = await retrieveContext(contextConversation, draftMessage)
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

function createAgentRagDraftMessage(content: string, timestamp: number): Message {
  return {
    id: `agent-rag-draft-${timestamp}`,
    role: 'user',
    content,
    timestamp,
    status: 'done',
  }
}

function buildRagContextPackFromRetrievedContext(input: {
  retrieved: AgentRetrievedContext
  request: AgentRagContextPackRequest
  settings: Settings
  conversationTitle?: string
  systemPrompt?: string
  startedAt: number
  completedAt: number
}): RagContextPack {
  const plan = input.retrieved.plan ?? createRagQueryPlan({
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
    quality: input.retrieved.quality ?? buildFallbackRagQuality(input.retrieved, plan, sources, contextPrompt, input.startedAt, input.completedAt),
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
  retrieved: AgentRetrievedContext,
  sources: RagRetrievalCandidate[],
  contextPrompt: string,
  startedAt: number,
  completedAt: number
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
  retrieved: AgentRetrievedContext,
  plan: RagQueryPlan,
  sources: RagRetrievalCandidate[],
  contextPrompt: string,
  startedAt: number,
  completedAt: number
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

function resolveRuntimeNow(input: AgentChatRuntimeInput): number {
  return typeof input.now === 'number' ? input.now : Date.now()
}

function skippedAgentRuntimeResolution(
  reason: AgentChatRuntimeSkipReason,
  content: string,
  traces: AgentChatRuntimeResolution['reply']['traces'] = [],
  options: { handled?: boolean; startedAt?: number } = {}
): AgentChatRuntimeResolution {
  const reply: AgenticChatWorkflowReply = {
    handled: Boolean(options.handled),
    status: 'skipped',
    content,
    traces,
  }
  return {
    handled: reply.handled,
    reason,
    reply,
    patch: reply.handled ? buildAgentAssistantMessagePatch(reply, options.startedAt) : undefined,
  }
}

function formatDisabledWorkflowSkip(trace: ProcessTrace): string {
  const workflowName = safeRuntimeWorkflowText(trace.metadata?.workflowName, 'Selected workflow', WORKFLOW_SKIP_NAME_LIMIT)
  if (trace.metadata?.reason === 'workflow-review-required') {
    return safeRuntimeWorkflowText(
      `${workflowName} was imported and requires review in Skills before it can run. Review and enable it in Settings.`,
      'Selected workflow was imported and requires review in Skills before it can run. Review and enable it in Settings.',
      WORKFLOW_SKIP_REPLY_LIMIT
    )
  }
  if (trace.metadata?.reason === 'workflow-invalid') {
    return safeRuntimeWorkflowText(
      `${workflowName} no longer matches the current tool registry or permission policy. Review the workflow in Settings before running it again.`,
      'Selected workflow no longer matches the current tool registry or permission policy. Review it in Settings before running it again.',
      WORKFLOW_SKIP_REPLY_LIMIT
    )
  }
  return safeRuntimeWorkflowText(
    `${workflowName} is disabled or no longer enabled in Skills. Enable it in Settings before running it again.`,
    'Selected workflow is disabled or no longer enabled in Skills. Enable it in Settings before running it again.',
    WORKFLOW_SKIP_REPLY_LIMIT
  )
}

function resolveDisabledWorkflowSkipReason(trace: ProcessTrace): AgentChatRuntimeSkipReason {
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
    WORKFLOW_SKIP_REPLY_LIMIT
  )
}

function safeRuntimeWorkflowText(value: unknown, fallback: string, limit: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const safe = clampAgentOutput(redactSensitiveText(text || fallback), limit)
    .replace(/\n\[output truncated\]$/, '')
    .trim()
  return safe || fallback
}

function formatRuntimeSkip(reason: AgenticChatEntryReason): string {
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
