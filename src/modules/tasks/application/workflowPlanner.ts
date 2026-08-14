import type { Clock, ProcessTrace } from '@/core'

const WORKFLOW_TRACE_ACCEPTANCE_MAX_ITEMS = 3
const WORKFLOW_TRACE_ACCEPTANCE_ITEM_LIMIT = 160
const WORKFLOW_TRACE_TOOL_MAX_ITEMS = 5
const WORKFLOW_TRACE_TOOL_ITEM_LIMIT = 120

export type WorkflowPlannerIntent =
  | 'plain_chat'
  | 'settings_action'
  | 'tool_task'
  | 'rag_evidence'
  | 'work_artifact'
  | 'handoff'
  | 'diagnostic'

export type WorkflowPlannerRequestedOutput = 'auto' | 'reply' | 'work-artifact'

export type WorkflowPlannerToolSource =
  | 'mcp'
  | 'builtin'
  | 'app-action'
  | 'rag'
  | 'search'
  | 'work-artifact'
  | 'android'

export interface WorkflowPlannerToolRequest {
  readonly toolId?: string
  readonly name?: string
  readonly source?: WorkflowPlannerToolSource
  readonly serverId?: string
  readonly arguments?: Readonly<Record<string, unknown>>
}

export interface WorkflowPlannerClassification<
  TRequest extends WorkflowPlannerToolRequest = WorkflowPlannerToolRequest,
> {
  intent: WorkflowPlannerIntent
  shouldRunWorkflow: boolean
  confidence: number
  reasons: string[]
  suggestedToolRequest?: TRequest
  trace: ProcessTrace
}

export interface WorkflowPlannerWorkflowDefinition<
  TRequest extends WorkflowPlannerToolRequest = WorkflowPlannerToolRequest,
> {
  readonly id: string
  readonly name: string
  readonly permissionCeiling: 'read-only' | 'read-write' | 'destructive'
  readonly expectedOutput?: 'reply' | 'rag-evidence' | 'work-artifact' | 'handoff' | 'diagnostic'
  readonly acceptanceChecks: readonly string[]
  readonly steps: readonly {
    readonly id: string
    readonly title: string
    readonly toolRequest?: TRequest
  }[]
}

export interface WorkflowPlannerPlannedStep<
  TRequest extends WorkflowPlannerToolRequest = WorkflowPlannerToolRequest,
> {
  id: string
  title: string
  toolRequest?: TRequest
}

export interface WorkflowPlannerPlan<
  TRequest extends WorkflowPlannerToolRequest = WorkflowPlannerToolRequest,
  TClassification extends WorkflowPlannerClassification<TRequest> = WorkflowPlannerClassification<TRequest>,
> {
  id: string
  goal: string
  intent: WorkflowPlannerIntent
  shouldRunWorkflow: boolean
  classification: TClassification
  steps: WorkflowPlannerPlannedStep<TRequest>[]
  trace: ProcessTrace
}

export interface CreateWorkflowPlanInput<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
  TClassification extends WorkflowPlannerClassification<TRequest>,
> {
  goal: string
  content?: string
  toolRequest?: TRequest
  requestedOutput?: WorkflowPlannerRequestedOutput
  workflowDefinition?: TWorkflow
  classification?: TClassification
  now?: number
}

export interface WorkflowPlannerDependencies<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
  TClassification extends WorkflowPlannerClassification<TRequest>,
> {
  clock: Clock
  classifyIntent(input: {
    goal: string
    content?: string
    explicitToolRequest?: TRequest
    requestedOutput?: WorkflowPlannerRequestedOutput
    now: number
  }): TClassification
  projectTrace(trace: ProcessTrace): ProcessTrace
  redactText(value: string): string
  formatToolIdentity(request: TRequest | undefined): string
  collectRagProfileRequirements(workflow: TWorkflow): string[]
  inferClockTime(value: string): { hour: number; minutes: number } | undefined
  inferReminderDateTimeIso(value: string): string | undefined
  inferReminderTitle(value: string): string | undefined
  sanitizeApkUri(value: string | undefined): string | undefined
}

export type WorkflowPlanner<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
  TClassification extends WorkflowPlannerClassification<TRequest>,
> = (
  input: CreateWorkflowPlanInput<TRequest, TWorkflow, TClassification>,
) => WorkflowPlannerPlan<TRequest, TClassification>

export function createWorkflowPlanner<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
  TClassification extends WorkflowPlannerClassification<TRequest>,
>(
  dependencies: WorkflowPlannerDependencies<TRequest, TWorkflow, TClassification>,
): WorkflowPlanner<TRequest, TWorkflow, TClassification> {
  return (input) => {
    const startedAt = input.now ?? dependencies.clock.now()
    const id = `agent-plan-${hashString(`${input.goal}:${startedAt}`).toString(36)}`
    const classification = input.classification ?? dependencies.classifyIntent({
      goal: input.goal,
      content: input.content,
      explicitToolRequest: input.toolRequest,
      requestedOutput: input.requestedOutput,
      now: startedAt,
    })
    if (input.workflowDefinition) {
      return planSelectedWorkflow(input, input.workflowDefinition, classification, id, startedAt, dependencies)
    }

    const toolRequest = classification.shouldRunWorkflow
      ? classification.suggestedToolRequest ?? input.toolRequest
      : undefined
    const steps: WorkflowPlannerPlannedStep<TRequest>[] = classification.shouldRunWorkflow
      ? [{
          id: `${id}-step-1`,
          title: toolRequest ? `Execute ${toolRequest.name ?? toolRequest.toolId}` : `Prepare ${classification.intent}`,
          toolRequest,
        }]
      : []

    return {
      id,
      goal: input.goal,
      intent: classification.intent,
      shouldRunWorkflow: classification.shouldRunWorkflow,
      classification,
      steps,
      trace: dependencies.projectTrace({
        id,
        type: 'reasoning',
        title: 'Agent plan',
        content: toolRequest
          ? `Planned ${steps.length} bounded step for ${toolRequest.name ?? toolRequest.toolId}.`
          : classification.shouldRunWorkflow
            ? `Planned ${steps.length} bounded step for ${classification.intent}.`
            : 'Intent classification selected the direct chat path.',
        status: 'done',
        startedAt,
        metadata: {
          intent: classification.intent,
          shouldRunWorkflow: classification.shouldRunWorkflow,
          stepCount: steps.length,
          toolName: toolRequest?.name,
          toolId: toolRequest?.toolId,
          source: toolRequest?.source,
        },
      }),
    }
  }
}

function planSelectedWorkflow<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
  TClassification extends WorkflowPlannerClassification<TRequest>,
>(
  input: CreateWorkflowPlanInput<TRequest, TWorkflow, TClassification>,
  workflow: TWorkflow,
  classification: TClassification,
  id: string,
  startedAt: number,
  dependencies: WorkflowPlannerDependencies<TRequest, TWorkflow, TClassification>,
): WorkflowPlannerPlan<TRequest, TClassification> {
  const runtimeBindings: string[] = []
  const workflowAcceptanceChecks = summarizeWorkflowAcceptanceChecks(
    workflow.acceptanceChecks,
    dependencies.redactText,
  )
  const workflowRequiredToolRefs = collectWorkflowRequiredToolRefs(workflow, dependencies.formatToolIdentity)
  const workflowRequiredTools = summarizeWorkflowToolRefs(workflowRequiredToolRefs, dependencies.redactText)
  const workflowRequiredToolSummary = workflowRequiredTools.length
    ? ` Required tools: ${workflowRequiredTools.join(', ')}.`
    : ' Required tools: none.'
  const workflowRagProfileRequirements = dependencies.collectRagProfileRequirements(workflow)
  const workflowAcceptanceSummary = workflowAcceptanceChecks.length
    ? ` Acceptance checks: ${workflowAcceptanceChecks.join('; ')}.`
    : ''
  const workflowRagProfileRequirementSummary = workflowRagProfileRequirements.length
    ? ` RAG profile requirements: ${workflowRagProfileRequirements.join('; ')}.`
    : ''
  const steps: WorkflowPlannerPlannedStep<TRequest>[] = workflow.steps.map((step, index) => {
    const bound = bindRuntimeArgumentsForSelectedWorkflowStep(step.toolRequest, {
      goal: input.goal,
      content: input.content,
    }, dependencies)
    if (bound.fields.length) runtimeBindings.push(`${step.id || `step-${index + 1}`}:${bound.fields.join(',')}`)
    return {
      id: `${id}-${step.id || `step-${index + 1}`}`,
      title: step.title,
      toolRequest: bound.toolRequest,
    }
  })
  const runtimeBindingSummary = runtimeBindings.length
    ? ` Runtime argument bindings: ${runtimeBindings.join('; ')}.`
    : ''
  return {
    id,
    goal: input.goal,
    intent: classification.intent,
    shouldRunWorkflow: true,
    classification,
    steps,
    trace: dependencies.projectTrace({
      id,
      type: 'reasoning',
      title: 'Agent plan',
      content: `Selected workflow ${workflow.name} with ${steps.length} bounded steps. Permission ceiling: ${workflow.permissionCeiling}.${workflowRequiredToolSummary}${runtimeBindings.length ? ` Runtime arguments bound for ${runtimeBindings.length} step(s).` : ''}${runtimeBindingSummary}${workflowAcceptanceSummary}${workflowRagProfileRequirementSummary}`,
      status: 'done',
      startedAt,
      metadata: {
        intent: classification.intent,
        shouldRunWorkflow: true,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowPermissionCeiling: workflow.permissionCeiling,
        workflowExpectedOutput: workflow.expectedOutput ?? 'reply',
        workflowRequiredToolCount: workflowRequiredToolRefs.length,
        workflowRequiredTools,
        acceptanceCheckCount: workflow.acceptanceChecks.length,
        workflowAcceptanceChecks,
        workflowRagProfileRequirementCount: workflowRagProfileRequirements.length,
        workflowRagProfileRequirements,
        stepCount: steps.length,
        runtimeArgumentBindingCount: runtimeBindings.length,
        runtimeArgumentBindings: runtimeBindings,
        source: 'agent-workflow-skill',
      },
    }),
  }
}

function summarizeWorkflowAcceptanceChecks(
  checks: readonly string[],
  redactText: (value: string) => string,
): string[] {
  return checks
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => clampOutput(redactText(value.trim()), WORKFLOW_TRACE_ACCEPTANCE_ITEM_LIMIT).replace(/\n\[output truncated\]$/, ''))
    .filter(Boolean)
    .slice(0, WORKFLOW_TRACE_ACCEPTANCE_MAX_ITEMS)
}

function collectWorkflowRequiredToolRefs<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
>(
  workflow: TWorkflow,
  formatToolIdentity: (request: TRequest | undefined) => string,
): string[] {
  const refs = workflow.steps
    .map((step) => formatToolIdentity(step.toolRequest))
    .filter(Boolean)
  return [...new Set(refs)]
}

function summarizeWorkflowToolRefs(
  refs: string[],
  redactText: (value: string) => string,
): string[] {
  return refs
    .map((value) => clampOutput(redactText(value.trim()), WORKFLOW_TRACE_TOOL_ITEM_LIMIT).replace(/\n\[output truncated\]$/, ''))
    .filter(Boolean)
    .slice(0, WORKFLOW_TRACE_TOOL_MAX_ITEMS)
}

function bindRuntimeArgumentsForSelectedWorkflowStep<
  TRequest extends WorkflowPlannerToolRequest,
  TWorkflow extends WorkflowPlannerWorkflowDefinition<TRequest>,
  TClassification extends WorkflowPlannerClassification<TRequest>,
>(
  request: TRequest | undefined,
  runtime: { goal: string; content?: string },
  dependencies: WorkflowPlannerDependencies<TRequest, TWorkflow, TClassification>,
): { toolRequest?: TRequest; fields: string[] } {
  if (!request) return { toolRequest: request, fields: [] }
  const fields: string[] = []
  const args = { ...(request.arguments ?? {}) }
  const goal = runtime.goal.trim()
  const content = runtime.content?.trim() || goal
  const ref = dependencies.formatToolIdentity(request)

  if (isWorkArtifactSummarizeRef(ref) && !hasTextArgument(args.content) && content) {
    args.content = content
    fields.push('content')
  }
  if (isQueryRuntimeRef(ref) && !hasTextArgument(args.query) && goal) {
    args.query = goal
    fields.push('query')
  }
  if (isAndroidSafDirectoryRef(ref) && !hasTextArgument(args.directoryUri)) {
    const directoryUri = inferAndroidSafDirectoryUri(content)
    if (directoryUri) {
      args.directoryUri = directoryUri
      fields.push('directoryUri')
    }
  }
  if (isAndroidDirectFilePreviewRef(ref, args)) {
    const fileArgs = inferAndroidDirectFilePreviewArguments(content)
    if (fileArgs.sourceName && !hasTextArgument(args.sourceName)) {
      args.sourceName = fileArgs.sourceName
      fields.push('sourceName')
    }
    if (fileArgs.targetDirectoryName && !hasTextArgument(args.targetDirectoryName)) {
      args.targetDirectoryName = fileArgs.targetDirectoryName
      fields.push('targetDirectoryName')
    }
    if (fileArgs.targetName && !hasTextArgument(args.targetName)) {
      args.targetName = fileArgs.targetName
      fields.push('targetName')
    }
  }
  if (isAndroidApkUriRef(ref) && !hasTextArgument(args.apkUri)) {
    const apkUri = inferAndroidApkUri(content, dependencies.sanitizeApkUri)
    if (apkUri) {
      args.apkUri = apkUri
      fields.push('apkUri')
    }
  }
  if (isAndroidAlarmRef(ref)) {
    const time = dependencies.inferClockTime(content)
    const title = dependencies.inferReminderTitle(content)
    if (time && typeof args.hour !== 'number') {
      args.hour = time.hour
      fields.push('hour')
    }
    if (time && typeof args.minutes !== 'number') {
      args.minutes = time.minutes
      fields.push('minutes')
    }
    if (title && !hasTextArgument(args.message)) {
      args.message = title
      fields.push('message')
    }
  }
  if (isAndroidReminderRef(ref)) {
    const title = dependencies.inferReminderTitle(content) ?? fallbackReminderTitle(content, dependencies.redactText)
    const dueTimeIso = dependencies.inferReminderDateTimeIso(content)
    if (title && !hasTextArgument(args.title)) {
      args.title = title
      fields.push('title')
    }
    if (dueTimeIso && !hasTextArgument(args.dueTimeIso)) {
      args.dueTimeIso = dueTimeIso
      fields.push('dueTimeIso')
    }
  }

  return fields.length
    ? { toolRequest: { ...request, arguments: args } as TRequest, fields }
    : { toolRequest: request, fields }
}

function isWorkArtifactSummarizeRef(ref: string): boolean {
  return ref.includes('work-artifact:summarize') || ref.includes('work_artifact.summarize')
}

function isQueryRuntimeRef(ref: string): boolean {
  return ref.includes('rag:context_pack') || ref.includes('rag.context_pack') || ref.includes('search_web')
}

function isAndroidSafDirectoryRef(ref: string): boolean {
  return ref.includes('android:files.scan') ||
    ref.includes('android.files.scan') ||
    ref.includes('android:files.propose_structure') ||
    ref.includes('android.files.propose_structure') ||
    ref.includes('android:files.preview_operations') ||
    ref.includes('android.files.preview_operations')
}

function isAndroidDirectFilePreviewRef(ref: string, args: Record<string, unknown>): boolean {
  const operationKind = args.mode ?? args.action
  return isAndroidSafDirectoryRef(ref) && (
    operationKind === 'copy' || operationKind === 'move' || operationKind === 'rename'
  )
}

function isAndroidApkUriRef(ref: string): boolean {
  return ref.includes('android:apk.inspect') ||
    ref.includes('android.apk.inspect') ||
    ref.includes('android:apk.open_installer') ||
    ref.includes('android.apk.open_installer')
}

function isAndroidAlarmRef(ref: string): boolean {
  return ref.includes('android:alarm.open_create_intent') || ref.includes('android.alarm.open_create_intent')
}

function isAndroidReminderRef(ref: string): boolean {
  return ref.includes('android:reminder.open_create_todo') || ref.includes('android.reminder.open_create_todo')
}

function inferAndroidSafDirectoryUri(value: string): string | undefined {
  const match = value.match(/\bcontent:\/\/[^\s"'，。；;、)）]+/i)
  return match?.[0]
}

function inferAndroidApkUri(
  value: string,
  sanitizeApkUri: (value: string | undefined) => string | undefined,
): string | undefined {
  const match = value.match(/\b(?:content|file):\/\/[^\s"'，。；;、)）]+/i)
  return sanitizeApkUri(match?.[0])
}

function inferAndroidDirectFilePreviewArguments(value: string): {
  sourceName?: string
  targetDirectoryName?: string
  targetName?: string
} {
  const sourceName = firstMatch(value, [
    /把\s*([^\s"'，。；;、/\\]+)\s*(?:复制|拷贝|移动|搬到|重命名|改名)/i,
    /\b(?:copy|move|rename)\s+([^\s"'，。；;、/\\]+)/i,
  ])
  const targetDirectoryName = firstMatch(value, [
    /(?:复制|拷贝|移动|搬)?到\s*([^\s"'，。；;、/\\]+?)\s*(?:目录|文件夹|folder|directory|dir|下)/i,
    /\b(?:to|into)\s+([^\s"'，。；;、/\\]+?)\s*(?:folder|directory|dir)\b/i,
  ])
  const targetName = firstMatch(value, [
    /(?:重命名为|改名为|命名为)\s*([^\s"'，。；;、/\\]+)/i,
    /\b(?:as|renamed?\s+(?:to|as))\s+([^\s"'，。；;、/\\]+)/i,
  ]) ?? sourceName
  return {
    sourceName: sanitizeSimpleFileName(sourceName),
    targetDirectoryName: sanitizeSimpleFileName(targetDirectoryName),
    targetName: sanitizeSimpleFileName(targetName),
  }
}

function firstMatch(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1]?.trim()
    if (match) return match
  }
  return undefined
}

function sanitizeSimpleFileName(value: string | undefined): string | undefined {
  if (!value || value.includes('..') || /[\\/:*?"<>|]/.test(value)) return undefined
  return value
}

function fallbackReminderTitle(
  value: string,
  redactText: (value: string) => string,
): string | undefined {
  const text = redactText(value).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > 80 ? `${text.slice(0, 77).trimEnd()}...` : text
}

function hasTextArgument(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function clampOutput(input: string, limit: number): string {
  const max = Math.max(0, limit)
  if (input.length <= max) return input
  return `${input.slice(0, Math.max(0, max - 32)).trimEnd()}\n[output truncated]`
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
