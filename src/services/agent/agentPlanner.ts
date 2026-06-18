import type { ProcessTrace } from '@/types'
import type { AgentRequestedOutput, AgentToolRequest, AgentWorkflowDefinition, AgentWorkflowIntent } from '@/services/agent/agentToolTypes'
import {
  classifyAgentIntent,
  inferClockTime,
  inferReminderDateTimeIso,
  inferReminderTitle,
  type AgentIntentClassification,
} from '@/services/agent/agentIntentClassifier'
import { clampAgentOutput, createAgentTrace, redactSensitiveText } from '@/services/agent/agentTrace'
import { formatAgentToolRequestIdentity } from '@/services/agent/agentToolIdentityUtils'
import { collectWorkflowRagProfileRequirements } from '@/services/agent/agentWorkflowSkills'
import { sanitizeAndroidApkUri } from '@/services/androidUriPolicy'

const WORKFLOW_TRACE_ACCEPTANCE_MAX_ITEMS = 3
const WORKFLOW_TRACE_ACCEPTANCE_ITEM_LIMIT = 160
const WORKFLOW_TRACE_TOOL_MAX_ITEMS = 5
const WORKFLOW_TRACE_TOOL_ITEM_LIMIT = 120

export interface AgentPlannedStep {
  id: string
  title: string
  toolRequest?: AgentToolRequest
}

export interface AgentPlan {
  id: string
  goal: string
  intent: AgentWorkflowIntent
  shouldRunWorkflow: boolean
  classification: AgentIntentClassification
  steps: AgentPlannedStep[]
  trace: ProcessTrace
}

export interface CreateAgentPlanInput {
  goal: string
  content?: string
  toolRequest?: AgentToolRequest
  requestedOutput?: AgentRequestedOutput
  workflowDefinition?: AgentWorkflowDefinition
  classification?: AgentIntentClassification
  now?: number
}

export function createAgentPlan(input: CreateAgentPlanInput): AgentPlan {
  const startedAt = input.now ?? Date.now()
  const id = `agent-plan-${hashString(`${input.goal}:${startedAt}`).toString(36)}`
  const classification = input.classification ?? classifyAgentIntent({
    goal: input.goal,
    content: input.content,
    explicitToolRequest: input.toolRequest,
    requestedOutput: input.requestedOutput,
    now: startedAt,
  })
  if (input.workflowDefinition) {
    const runtimeBindings: string[] = []
    const workflowAcceptanceChecks = summarizeWorkflowAcceptanceChecks(input.workflowDefinition.acceptanceChecks)
    const workflowRequiredToolRefs = collectWorkflowRequiredToolRefs(input.workflowDefinition)
    const workflowRequiredTools = summarizeWorkflowToolRefs(workflowRequiredToolRefs)
    const workflowRequiredToolSummary = workflowRequiredTools.length
      ? ` Required tools: ${workflowRequiredTools.join(', ')}.`
      : ' Required tools: none.'
    const workflowRagProfileRequirements = collectWorkflowRagProfileRequirements(input.workflowDefinition)
    const workflowAcceptanceSummary = workflowAcceptanceChecks.length
      ? ` Acceptance checks: ${workflowAcceptanceChecks.join('; ')}.`
      : ''
    const workflowRagProfileRequirementSummary = workflowRagProfileRequirements.length
      ? ` RAG profile requirements: ${workflowRagProfileRequirements.join('; ')}.`
      : ''
    const steps: AgentPlannedStep[] = input.workflowDefinition.steps.map((step, index) => {
      const bound = bindRuntimeArgumentsForSelectedWorkflowStep(step.toolRequest, {
        goal: input.goal,
        content: input.content,
      })
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
      trace: createAgentTrace({
        id,
        type: 'reasoning',
        title: 'Agent plan',
        content: `Selected workflow ${input.workflowDefinition.name} with ${steps.length} bounded steps. Permission ceiling: ${input.workflowDefinition.permissionCeiling}.${workflowRequiredToolSummary}${runtimeBindings.length ? ` Runtime arguments bound for ${runtimeBindings.length} step(s).` : ''}${runtimeBindingSummary}${workflowAcceptanceSummary}${workflowRagProfileRequirementSummary}`,
        status: 'done',
        startedAt,
        metadata: {
          intent: classification.intent,
          shouldRunWorkflow: true,
          workflowId: input.workflowDefinition.id,
          workflowName: input.workflowDefinition.name,
          workflowPermissionCeiling: input.workflowDefinition.permissionCeiling,
          workflowExpectedOutput: input.workflowDefinition.expectedOutput ?? 'reply',
          workflowRequiredToolCount: workflowRequiredToolRefs.length,
          workflowRequiredTools,
          acceptanceCheckCount: input.workflowDefinition.acceptanceChecks.length,
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
  const toolRequest = classification.shouldRunWorkflow
    ? classification.suggestedToolRequest ?? input.toolRequest
    : undefined
  const steps: AgentPlannedStep[] = classification.shouldRunWorkflow
    ? [
        {
          id: `${id}-step-1`,
          title: toolRequest ? `Execute ${toolRequest.name ?? toolRequest.toolId}` : `Prepare ${classification.intent}`,
          toolRequest,
        },
      ]
    : []

  return {
    id,
    goal: input.goal,
    intent: classification.intent,
    shouldRunWorkflow: classification.shouldRunWorkflow,
    classification,
    steps,
    trace: createAgentTrace({
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

function summarizeWorkflowAcceptanceChecks(checks: string[]): string[] {
  return checks
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => clampAgentOutput(redactSensitiveText(value.trim()), WORKFLOW_TRACE_ACCEPTANCE_ITEM_LIMIT).replace(/\n\[output truncated\]$/, ''))
    .filter(Boolean)
    .slice(0, WORKFLOW_TRACE_ACCEPTANCE_MAX_ITEMS)
}

function collectWorkflowRequiredToolRefs(workflow: AgentWorkflowDefinition): string[] {
  const refs = workflow.steps
    .map((step) => formatToolRequestRefForTrace(step.toolRequest))
    .filter(Boolean)
  return [...new Set(refs)]
}

function summarizeWorkflowToolRefs(refs: string[]): string[] {
  return refs
    .map((value) => clampAgentOutput(redactSensitiveText(value.trim()), WORKFLOW_TRACE_TOOL_ITEM_LIMIT).replace(/\n\[output truncated\]$/, ''))
    .filter(Boolean)
    .slice(0, WORKFLOW_TRACE_TOOL_MAX_ITEMS)
}

function formatToolRequestRefForTrace(request?: AgentToolRequest): string {
  return formatAgentToolRequestIdentity(request)
}

function bindRuntimeArgumentsForSelectedWorkflowStep(
  request: AgentToolRequest | undefined,
  runtime: Pick<CreateAgentPlanInput, 'goal' | 'content'>
): { toolRequest?: AgentToolRequest; fields: string[] } {
  if (!request) return { toolRequest: request, fields: [] }
  const fields: string[] = []
  const args = { ...(request.arguments ?? {}) }
  const goal = runtime.goal.trim()
  const content = runtime.content?.trim() || goal
  const ref = formatToolRequestRef(request)

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
    const apkUri = inferAndroidApkUri(content)
    if (apkUri) {
      args.apkUri = apkUri
      fields.push('apkUri')
    }
  }

  if (isAndroidAlarmRef(ref)) {
    const time = inferClockTime(content)
    const title = inferReminderTitle(content)
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
    const title = inferReminderTitle(content)
    const dueTimeIso = inferReminderDateTimeIso(content)
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
    ? { toolRequest: { ...request, arguments: args }, fields }
    : { toolRequest: request, fields }
}

function formatToolRequestRef(request: AgentToolRequest): string {
  return formatAgentToolRequestIdentity(request)
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
    operationKind === 'copy' ||
    operationKind === 'move' ||
    operationKind === 'rename'
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

function inferAndroidApkUri(value: string): string | undefined {
  const match = value.match(/\b(?:content|file):\/\/[^\s"'，。；;、)）]+/i)
  return sanitizeAndroidApkUri(match?.[0])
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

function hasTextArgument(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
