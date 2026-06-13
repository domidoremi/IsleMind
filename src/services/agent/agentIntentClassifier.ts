import type { ProcessTrace } from '@/types'
import type { AgentRequestedOutput, AgentToolRequest, AgentWorkflowIntent } from '@/services/agent/agentToolTypes'
import { createAgentTrace } from '@/services/agent/agentTrace'

export interface AgentIntentClassification {
  intent: AgentWorkflowIntent
  shouldRunWorkflow: boolean
  confidence: number
  reasons: string[]
  suggestedToolRequest?: AgentToolRequest
  trace: ProcessTrace
}

export interface ClassifyAgentIntentInput {
  goal: string
  content?: string
  explicitToolRequest?: AgentToolRequest
  requestedOutput?: AgentRequestedOutput
  now?: number
}

export function classifyAgentIntent(input: ClassifyAgentIntentInput): AgentIntentClassification {
  const startedAt = input.now ?? Date.now()
  if (input.explicitToolRequest) {
    return buildClassification({
      input,
      startedAt,
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 1,
      reasons: ['explicit-tool-request'],
      suggestedToolRequest: input.explicitToolRequest,
    })
  }

  const text = normalizeText(`${input.goal}\n${input.content ?? ''}`)
  const goal = normalizeText(input.goal)

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
    })
  }

  if (looksLikeWorkArtifact(text)) {
    return buildClassification({
      input,
      startedAt,
      intent: 'work_artifact',
      shouldRunWorkflow: true,
      confidence: 0.86,
      reasons: ['structured-artifact-markers'],
      suggestedToolRequest: {
        toolId: 'work-artifact:summarize',
        arguments: { content: input.content ?? input.goal },
      },
    })
  }

  if (looksLikeSettingsAction(goal)) {
    return buildClassification({
      input,
      startedAt,
      intent: 'settings_action',
      shouldRunWorkflow: true,
      confidence: 0.78,
      reasons: ['settings-keyword'],
      suggestedToolRequest: inferSettingsTool(goal),
    })
  }

  if (looksLikeWebSearchTask(goal)) {
    return buildClassification({
      input,
      startedAt,
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 0.74,
      reasons: ['web-search-keyword'],
      suggestedToolRequest: {
        name: 'search_web',
        source: 'builtin',
        arguments: { query: input.goal },
      },
    })
  }

  const androidUndoToolRequest = inferAndroidTool(goal)
  if (androidUndoToolRequest?.name === 'android.files.undo_operations') {
    return buildClassification({
      input,
      startedAt,
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 0.82,
      reasons: ['android-undo-operations-json'],
      suggestedToolRequest: androidUndoToolRequest,
    })
  }

  if (looksLikeEvidenceTask(goal)) {
    return buildClassification({
      input,
      startedAt,
      intent: 'rag_evidence',
      shouldRunWorkflow: true,
      confidence: 0.72,
      reasons: ['evidence-or-verification-keyword'],
      suggestedToolRequest: {
        toolId: 'rag:context_pack',
        arguments: { query: input.goal },
      },
    })
  }

  const androidToolRequest = inferAndroidTool(goal)
  if (androidToolRequest) {
    return buildClassification({
      input,
      startedAt,
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 0.76,
      reasons: ['android-device-task-keyword'],
      suggestedToolRequest: androidToolRequest,
    })
  }

  if (looksLikeHandoffTask(goal)) {
    return buildClassification({
      input,
      startedAt,
      intent: 'handoff',
      shouldRunWorkflow: true,
      confidence: 0.7,
      reasons: ['handoff-keyword'],
      suggestedToolRequest: buildWorkArtifactToolRequest(input),
    })
  }

  if (looksLikeDiagnosticTask(goal)) {
    return buildClassification({
      input,
      startedAt,
      intent: 'diagnostic',
      shouldRunWorkflow: true,
      confidence: 0.68,
      reasons: ['diagnostic-keyword'],
      suggestedToolRequest: buildWorkArtifactToolRequest(input),
    })
  }

  return buildClassification({
    input,
    startedAt,
    intent: 'plain_chat',
    shouldRunWorkflow: false,
    confidence: 0.62,
    reasons: ['no-workflow-trigger'],
  })
}

function buildWorkArtifactToolRequest(input: ClassifyAgentIntentInput): AgentToolRequest {
  return {
    toolId: 'work-artifact:summarize',
    arguments: { content: input.content ?? input.goal },
  }
}

function buildClassification(input: {
  input: ClassifyAgentIntentInput
  startedAt: number
  intent: AgentWorkflowIntent
  shouldRunWorkflow: boolean
  confidence: number
  reasons: string[]
  suggestedToolRequest?: AgentToolRequest
}): AgentIntentClassification {
  return {
    intent: input.intent,
    shouldRunWorkflow: input.shouldRunWorkflow,
    confidence: input.confidence,
    reasons: input.reasons,
    suggestedToolRequest: input.suggestedToolRequest,
    trace: createAgentTrace({
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

function looksLikeWorkArtifact(text: string): boolean {
  const markers = [
    /结构化摘要/,
    /行动项/,
    /决策记录/,
    /风险和阻塞/,
    /证据仍需补充/,
    /待确认问题/,
    /可分享版本/,
    /action items?/i,
    /decisions?/i,
    /risks?/i,
    /handoff/i,
  ]
  return markers.filter((pattern) => pattern.test(text)).length >= 2
}

function looksLikeSettingsAction(goal: string): boolean {
  return /(settings?|配置|设置|設定|主题|外观|语言|theme|language|feature flag|功能开关)/i.test(goal)
}

function looksLikeEvidenceTask(goal: string): boolean {
  return /(查证|验证|证据|引用|来源|检索|知识库|rag|evidence|verify|citation|source|research|lookup)/i.test(goal)
}

function looksLikeWebSearchTask(goal: string): boolean {
  return /(联网搜索|网络搜索|网页搜索|搜索网页|web search|search web|online search|search online|internet search)/i.test(goal)
}

function looksLikeHandoffTask(goal: string): boolean {
  return /(交接|移交|handoff|继续执行|continuation|next step|下一步|总结成计划|工作产物)/i.test(goal)
}

function looksLikeDiagnosticTask(goal: string): boolean {
  return /(诊断|排查|debug|diagnose|root cause|原因|失败|错误|修复|检查)/i.test(goal)
}

function inferAndroidTool(goal: string): AgentToolRequest | undefined {
  if (!looksLikeAndroidTask(goal)) return undefined
  if (looksLikeAndroidUndoTask(goal)) {
    const undoOperations = inferAndroidUndoOperations(goal)
    if (undoOperations?.length) {
      return {
        name: 'android.files.undo_operations',
        source: 'android',
        arguments: { undoOperations },
      }
    }
  }
  if (looksLikeAndroidAlarmTask(goal)) {
    const alarm = inferClockTime(goal)
    return {
      name: 'android.alarm.open_create_intent',
      source: 'android',
      arguments: {
        hour: alarm?.hour ?? 8,
        minutes: alarm?.minutes ?? 0,
        message: inferReminderTitle(goal) ?? '',
      },
    }
  }
  if (looksLikeAndroidReminderTask(goal)) {
    return {
      name: 'android.reminder.open_create_todo',
      source: 'android',
      arguments: {
        title: inferReminderTitle(goal) ?? goal,
        dueTimeIso: inferReminderDateTimeIso(goal),
      },
    }
  }
  if (looksLikeAndroidApkInstallTask(goal)) {
    const apkUri = inferAndroidUri(goal)
    return apkUri
      ? { name: 'android.apk.open_installer', source: 'android', arguments: { apkUri } }
      : { name: 'android.files.request_directory_access', source: 'android', arguments: { initialDirectory: 'downloads' } }
  }
  if (looksLikeAndroidCleanupTask(goal)) {
    return { name: 'android.storage.propose_cleanup', source: 'android' }
  }
  if (looksLikeAndroidFileTask(goal)) {
    const directoryUri = inferAndroidUri(goal)
    if (directoryUri?.startsWith('content://')) {
      return { name: 'android.files.preview_operations', source: 'android', arguments: { mode: 'organize', directoryUri } }
    }
    return { name: 'android.files.request_directory_access', source: 'android', arguments: { initialDirectory: goal.includes('download') ? 'downloads' : 'root' } }
  }
  return undefined
}

function looksLikeAndroidTask(goal: string): boolean {
  return /(android|安卓|手机|闹钟|提醒|待办|日历|calendar|alarm|reminder|todo|apk|安装包|download|下载目录|下载文件夹|清理手机|垃圾清理|目录|文件|复制|重命名|整理)/i.test(goal)
}

function looksLikeAndroidFileTask(goal: string): boolean {
  return /(download|下载目录|下载文件夹|目录|文件|复制|移动|搬到|重命名|整理|归类|分类|rename|copy|move|organize|folder|directory|file)/i.test(goal)
}

function looksLikeAndroidUndoTask(goal: string): boolean {
  return /(android\.files\.undo_operations|undoOperations|Undo operations JSON|Android SAF.*undo|Android.*撤销|撤销.*Android|取り消し)/i.test(goal)
}

function looksLikeAndroidApkInstallTask(goal: string): boolean {
  return /(安装|install).{0,24}\.apk|\.apk.{0,24}(安装|install)|安装包/i.test(goal)
}

function looksLikeAndroidCleanupTask(goal: string): boolean {
  return /(清理手机|垃圾清理|释放空间|清缓存|cache|cleanup|clean up|storage)/i.test(goal)
}

function looksLikeAndroidAlarmTask(goal: string): boolean {
  return /(闹钟|alarm)/i.test(goal)
}

function looksLikeAndroidReminderTask(goal: string): boolean {
  return /(待办|提醒|日历|todo|reminder|calendar)/i.test(goal)
}

function inferAndroidUri(goal: string): string | undefined {
  return goal.match(/\b(?:content|file):\/\/[^\s"'，。；;、)）]+/i)?.[0]
}

function inferAndroidUndoOperations(goal: string): unknown[] | undefined {
  const marker = goal.match(/Undo operations JSON\s*:/i)
  if (!marker) return undefined
  const start = goal.indexOf('[', marker.index ?? 0)
  if (start < 0) return undefined
  const json = sliceJsonArray(goal, start)
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) && parsed.length ? parsed : undefined
  } catch {
    return undefined
  }
}

function sliceJsonArray(value: string, start: number): string | undefined {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const char = value[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '[') depth += 1
    if (char === ']') {
      depth -= 1
      if (depth === 0) return value.slice(start, index + 1)
    }
  }
  return undefined
}

export function inferClockTime(goal: string): { hour: number; minutes: number } | undefined {
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

export function inferReminderDateTimeIso(goal: string): string | undefined {
  const date = goal.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/)
  const time = inferClockTime(goal)
  if (!date || !time) return undefined
  const year = Number.parseInt(date[1], 10)
  const month = Number.parseInt(date[2], 10)
  const day = Number.parseInt(date[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(time.hour).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:00+08:00`
}

export function inferReminderTitle(goal: string): string | undefined {
  const quoted = goal.match(/[“"']([^“”"']{1,80})[”"']/)?.[1] ?? goal.match(/写上[:：]\s*([^。；;\n]{1,80})/)?.[1]
  return quoted?.trim()
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

function inferSettingsTool(goal: string): AgentToolRequest | undefined {
  const themeMode = goal.match(/(light|dark|system|浅色|深色|跟随系统|系统主题)/i)?.[1]
  if (themeMode) {
    return {
      name: 'set_theme_mode',
      source: 'app-action',
      arguments: { mode: normalizeThemeMode(themeMode) },
    }
  }

  const language = goal.match(/(zh-CN|中文|简体中文|english|英文|en|日本語|日语|ja)/i)?.[1]
  if (language && /(语言|language|界面)/i.test(goal)) {
    return {
      name: 'set_language',
      source: 'app-action',
      arguments: { language: normalizeLanguage(language) },
    }
  }

  return { name: 'get_settings', source: 'app-action' }
}

function normalizeThemeMode(value: string): string {
  if (/(dark|深色)/i.test(value)) return 'dark'
  if (/(light|浅色)/i.test(value)) return 'light'
  return 'system'
}

function normalizeLanguage(value: string): string {
  if (/^(en|english|英文)$/i.test(value)) return 'en'
  if (/^(ja|日本語|日语)$/i.test(value)) return 'ja'
  return 'zh-CN'
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
