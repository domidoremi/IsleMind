import type { Clock, ProcessTrace } from '@/core'

export type WorkflowIntent =
  | 'plain_chat'
  | 'settings_action'
  | 'tool_task'
  | 'rag_evidence'
  | 'work_artifact'
  | 'handoff'
  | 'diagnostic'

export type WorkflowIntentRequestedOutput = 'auto' | 'reply' | 'work-artifact'

export type WorkflowIntentToolSource =
  | 'mcp'
  | 'builtin'
  | 'app-action'
  | 'rag'
  | 'search'
  | 'work-artifact'
  | 'android'

export interface WorkflowIntentToolRequest {
  toolId?: string
  name?: string
  source?: WorkflowIntentToolSource
  serverId?: string
  arguments?: Record<string, unknown>
}

export interface WorkflowIntentClassification {
  intent: WorkflowIntent
  shouldRunWorkflow: boolean
  confidence: number
  reasons: string[]
  suggestedToolRequest?: WorkflowIntentToolRequest
  trace: ProcessTrace
}

export interface ClassifyWorkflowIntentInput {
  goal: string
  content?: string
  explicitToolRequest?: WorkflowIntentToolRequest
  requestedOutput?: WorkflowIntentRequestedOutput
  now?: number
}

export interface WorkflowIntentClassifierDependencies {
  clock: Clock
  projectTrace(trace: ProcessTrace): ProcessTrace
}

export interface WorkflowIntentClassifier {
  classify(input: ClassifyWorkflowIntentInput): WorkflowIntentClassification
  inferClockTime(goal: string): { hour: number; minutes: number } | undefined
  inferReminderDateTimeIso(goal: string): string | undefined
  inferReminderTitle(goal: string): string | undefined
}

export function createWorkflowIntentClassifier(
  dependencies: WorkflowIntentClassifierDependencies,
): WorkflowIntentClassifier {
  return {
    classify: (input) => classifyWorkflowIntent(input, dependencies),
    inferClockTime,
    inferReminderDateTimeIso,
    inferReminderTitle,
  }
}

function classifyWorkflowIntent(
  input: ClassifyWorkflowIntentInput,
  dependencies: WorkflowIntentClassifierDependencies,
): WorkflowIntentClassification {
  const startedAt = input.now ?? dependencies.clock.now()
  if (input.explicitToolRequest) {
    return buildClassification({
      input,
      startedAt,
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 1,
      reasons: ['explicit-tool-request'],
      suggestedToolRequest: input.explicitToolRequest,
    }, dependencies)
  }

  if (input.requestedOutput === 'work-artifact') {
    return buildClassification({
      input,
      startedAt,
      intent: 'work_artifact',
      shouldRunWorkflow: true,
      confidence: 0.98,
      reasons: ['requested-output-work-artifact'],
      suggestedToolRequest: {
        toolId: 'work-artifact:summarize',
        arguments: { content: input.content ?? input.goal },
      },
    }, dependencies)
  }

  return buildClassification({
    input,
    startedAt,
    intent: 'plain_chat',
    shouldRunWorkflow: false,
    confidence: 0.62,
    reasons: ['model-tool-selection'],
  }, dependencies)
}

function buildClassification(input: {
  input: ClassifyWorkflowIntentInput
  startedAt: number
  intent: WorkflowIntent
  shouldRunWorkflow: boolean
  confidence: number
  reasons: string[]
  suggestedToolRequest?: WorkflowIntentToolRequest
}, dependencies: WorkflowIntentClassifierDependencies): WorkflowIntentClassification {
  return {
    intent: input.intent,
    shouldRunWorkflow: input.shouldRunWorkflow,
    confidence: input.confidence,
    reasons: input.reasons,
    suggestedToolRequest: input.suggestedToolRequest,
    trace: dependencies.projectTrace({
      id: `agent-intent-${hashString(`${input.input.goal}:${input.startedAt}`).toString(36)}`,
      type: 'reasoning',
      title: 'Agent intent',
      content: `${input.intent} · confidence=${input.confidence.toFixed(2)} · ${input.reasons.join(', ')}`,
      status: 'done',
      startedAt: input.startedAt,
      metadata: {
        intent: input.intent,
        shouldRunWorkflow: input.shouldRunWorkflow,
        confidence: input.confidence,
        reasons: input.reasons,
        requestedOutput: input.input.requestedOutput,
        toolName: input.suggestedToolRequest?.name,
        toolId: input.suggestedToolRequest?.toolId,
      },
    }),
  }
}

function inferClockTime(goal: string): { hour: number; minutes: number } | undefined {
  const colon = goal.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/)
  if (colon) return { hour: Number.parseInt(colon[1], 10), minutes: Number.parseInt(colon[2], 10) }
  const chinese = goal.match(/(上午|早上|下午|晚上|晚间|中午)?\s*([一二三四五六七八九十\d]{1,3})\s*点(?:\s*([一二三四五六七八九十\d]{1,3})\s*分)?/)
  if (!chinese) return undefined
  const period = chinese[1] ?? ''
  let hour = parseChineseNumber(chinese[2])
  const minutes = chinese[3] ? parseChineseNumber(chinese[3]) : 0
  if ((/下午|晚上|晚间/.test(period) || goal.includes('晚上')) && hour >= 1 && hour < 12) hour += 12
  if (/中午/.test(period) && hour < 11) hour += 12
  if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return undefined
  return { hour, minutes }
}

function inferReminderDateTimeIso(goal: string): string | undefined {
  const date = goal.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/)
  const time = inferClockTime(goal)
  if (!date || !time) return undefined
  const year = Number.parseInt(date[1], 10)
  const month = Number.parseInt(date[2], 10)
  const day = Number.parseInt(date[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(time.hour).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:00+08:00`
}

function inferReminderTitle(goal: string): string | undefined {
  const explicit = firstReminderTitleMatch(goal, [
    /[“"']([^“”"']{1,80})[”"']/,
    /(?:写上|标题|名称|叫做|命名为)[:：]?\s*([^。；;\n]{1,80})/i,
    /\b(?:titled|called|named|label(?:ed)?|with\s+(?:the\s+)?title)\s+([^.;\n]{1,80})/i,
  ])
  if (explicit) return cleanReminderTitle(explicit)
  const task = firstReminderTitleMatch(goal, [
    /\b(?:create|add|set|make)\s+(?:a\s+)?(?:todo|to-do|reminder|task)\s+(?:to\s+)?([^.;\n]{1,80})/i,
    /(?:创建|添加|设置|新建)(?:一个)?(?:待办|提醒|任务)\s*([^。；;\n]{1,80})/i,
  ])
  return cleanReminderTitle(task)
}

function firstReminderTitleMatch(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1]?.trim()
    if (match) return match
  }
  return undefined
}

function cleanReminderTitle(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/\b(?:for|at|on|by)\s+20\d{2}[./-]\d{1,2}[./-]\d{1,2}.*$/i, '')
    ?.replace(/\b(?:for|at|by)\s+(?:[01]?\d|2[0-3])[:：][0-5]\d.*$/i, '')
    ?.replace(/(?:在|于)?\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}.*$/, '')
    ?.replace(/(?:在|于)?\s*(?:[01]?\d|2[0-3])[:：][0-5]\d.*$/, '')
    ?.trim()
    ?.replace(/[，,。.;；:：]+$/, '')
    ?.trim()
  return cleaned || undefined
}

function parseChineseNumber(value: string): number {
  const normalized = value.trim()
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10)
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (normalized === '十') return 10
  if (normalized.includes('十')) {
    const [left, right] = normalized.split('十')
    const tens = left ? digits[left] ?? 0 : 1
    const ones = right ? digits[right] ?? 0 : 0
    return tens * 10 + ones
  }
  return digits[normalized] ?? -1
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
