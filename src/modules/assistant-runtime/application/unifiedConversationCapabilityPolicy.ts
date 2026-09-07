/** Internal lanes selected for one canonical Chat turn. They are not modes. */
export type UnifiedConversationCapabilityLane =
  | 'chat'
  | 'retrieval'
  | 'web'
  | 'read-only-tool'
  | 'workflow'
  | 'local-state'

export interface UnifiedConversationCapabilityInput {
  readonly conversationId: string
  readonly text: string
  readonly hasAttachments?: boolean
  readonly retrievalEnabled?: boolean
  readonly webEnabled?: boolean
  /** Existing native/manual search admission; cues are used only when absent. */
  readonly webRequested?: boolean
  readonly workspaceAvailable?: boolean
  readonly readOnlyToolsAvailable?: boolean
  readonly mutationRequested?: boolean
  readonly destructiveRequested?: boolean
  readonly mobile?: boolean
  readonly estimatedInputTokens?: number
  readonly tokenBudget?: number
}

export interface UnifiedConversationCapabilityPlan {
  readonly schema: 'islemind.unified-conversation-capability-plan.v1'
  readonly conversationId: string
  readonly createsConversation: false
  readonly exposesMode: false
  readonly lanes: readonly UnifiedConversationCapabilityLane[]
  readonly retrieval: boolean
  readonly web: boolean
  readonly readOnlyTools: boolean
  readonly workflow: boolean
  readonly localState: boolean
  readonly requiresConfirmation: boolean
  readonly estimatedInputTokens: number
  readonly tokenBudget: number
  readonly reasons: readonly string[]
}

const SCHEMA = 'islemind.unified-conversation-capability-plan.v1' as const

/**
 * Deterministic, fail-closed pre-plan for the mobile Chat surface. The model
 * may still select among admitted tools, but this policy never grants a
 * mutation, creates a new conversation, or exposes an Agent/Tavern switch.
 */
export function planUnifiedConversationCapabilities(
  input: UnifiedConversationCapabilityInput,
): UnifiedConversationCapabilityPlan {
  const conversationId = requireIdentity(input.conversationId)
  const text = input.text.trim()
  const retrieval = input.retrievalEnabled === true && Boolean(text)
  const currentInformationCue = hasCurrentInformationCue(text)
  const web = input.webEnabled === true
    && (input.webRequested === true || currentInformationCue)
  const localState = input.workspaceAvailable === true
  const readOnlyTools = input.readOnlyToolsAvailable === true && hasToolCue(text)
  const mutation = input.mutationRequested === true || hasMutationCue(text)
  const destructive = input.destructiveRequested === true || hasDestructiveCue(text)
  const workflow = mutation || destructive
  const requiresConfirmation = mutation || destructive
  const lanes: UnifiedConversationCapabilityLane[] = ['chat']
  if (localState) lanes.push('local-state')
  if (retrieval) lanes.push('retrieval')
  if (web) lanes.push('web')
  if (readOnlyTools) lanes.push('read-only-tool')
  if (workflow) lanes.push('workflow')
  const reasons = [
    ...(localState ? ['conversation-local-state'] : []),
    ...(retrieval ? ['retrieval-admitted'] : []),
    ...(web
      ? [input.webRequested === true ? 'web-admitted' : 'current-information-cue']
      : []),
    ...(readOnlyTools ? ['read-only-tool-cue'] : []),
    ...(workflow ? ['durable-workflow-required'] : []),
    ...(input.mobile ? ['mobile-bounded-capabilities'] : []),
  ]
  return Object.freeze({
    schema: SCHEMA,
    conversationId,
    createsConversation: false,
    exposesMode: false,
    lanes: Object.freeze(lanes),
    retrieval,
    web,
    readOnlyTools,
    workflow,
    localState,
    requiresConfirmation,
    estimatedInputTokens: nonNegative(input.estimatedInputTokens),
    tokenBudget: nonNegative(input.tokenBudget),
    reasons: Object.freeze(reasons),
  })
}

function hasCurrentInformationCue(text: string): boolean {
  return /(?:最新|今天|现在|目前|新闻|价格|天气|联网|搜索|查一下|current|latest|today|news|weather|search|look up)/i.test(text)
}

function hasToolCue(text: string): boolean {
  return /(?:读取|查看|检查|列出|分析文件|打开文件|read|inspect|check|list|analy[sz]e\s+(?:the\s+)?file)/i.test(text)
}

function hasMutationCue(text: string): boolean {
  return /(?:修改|写入|创建文件|保存|更新设置|edit|write|create\s+(?:a\s+)?file|save|update\s+settings)/i.test(text)
}

function hasDestructiveCue(text: string): boolean {
  return /(?:删除|清空|重置|卸载|delete|remove|reset|uninstall|wipe)/i.test(text)
}

function requireIdentity(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError('Invalid unified conversation id.')
  }
  return normalized
}

function nonNegative(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined
    ? Math.max(0, Math.floor(value))
    : 0
}
