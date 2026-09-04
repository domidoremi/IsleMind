import type {
  AssistantContextPlanReceipt,
  AssistantContextPlanReceiptSource,
} from '../contracts'

export const CONTEXT_CAPACITY_VIEW_SCHEMA = 'islemind.context-capacity-view.v1'

/**
 * `measured` means the receipt carried a usable model window and input budget.
 * `unmeasured` means the planner did not report them, so every ratio in the
 * view is meaningless and must not be rendered as a gauge.
 */
export type ContextCapacityStatus = 'measured' | 'unmeasured'

export type ContextCapacityNotice =
  | 'unmeasured_sources'
  | 'budget_overrun'
  | 'compression_active'
  | 'excluded_sources'
  | 'plan_failures'

export interface ContextCapacitySegment {
  /** Planner fragment type. Several fragments of one type are merged. */
  readonly type: string
  readonly tokens: number
  /** Share of the input budget. Zero while the view is `unmeasured`. */
  readonly ratio: number
  readonly sourceCount: number
  /**
   * Sources counted by the planner without a token estimate. The planner
   * reports attachments, tool outputs, and the count-only memory fragment as
   * zero tokens, so this segment understates the real cost by that many items.
   */
  readonly unmeasuredSourceCount: number
  readonly cappedCount: number
  readonly excludedCount: number
  /** Tokens removed by capping or exclusion, relative to the original source. */
  readonly droppedTokens: number
}

export interface ContextCapacityView {
  readonly schema: typeof CONTEXT_CAPACITY_VIEW_SCHEMA
  readonly status: ContextCapacityStatus
  /** Every token number here is a local heuristic estimate, never a tokenizer count. */
  readonly measurement: 'estimated'
  readonly runId: string
  readonly capturedAt: number
  readonly providerId: string
  readonly model: string
  /** Full advertised model window. */
  readonly contextWindowTokens: number
  /** Planner ceiling for input: window ratio minus the output and reasoning reserve. */
  readonly inputBudgetTokens: number
  /** Window tokens the planner never spends on input. */
  readonly reservedTokens: number
  readonly usedTokens: number
  readonly remainingTokens: number
  readonly usedRatio: number
  readonly tokensUntilCompaction: number
  readonly activeContextTokens: number
  readonly compression: {
    readonly triggered: boolean
    readonly strategy: string
    readonly savedTokens: number
    readonly keptMessageCount: number
    readonly sourceMessageCount: number
  }
  readonly segments: readonly ContextCapacitySegment[]
  readonly notices: readonly ContextCapacityNotice[]
  readonly failureCodes: readonly string[]
}

export interface ContextCapacityProjectionInput {
  readonly runId: string
  readonly capturedAt: number
  readonly receipt: AssistantContextPlanReceipt
}

/**
 * Projects the durable context plan receipt into the read model the Chat
 * context capacity card renders. Pure: no clock, storage, or network access.
 *
 * The receipt reports `estimatedInputTokens` without the fixed system and
 * context prompt block, and `requestBudgetTokens` already net of that block.
 * Comparing either against `modelContextWindow` understates usage twice, so
 * this projection rebuilds the planner's own ceiling instead:
 * `inputBudgetTokens = requestBudgetTokens + fixedTokens`.
 */
export function projectContextCapacity(
  input: ContextCapacityProjectionInput,
): ContextCapacityView {
  const budget = input.receipt.budget
  const contextWindowTokens = nonNegative(budget.modelContextWindow)
  const inputBudgetTokens = nonNegative(budget.requestBudgetTokens) + nonNegative(budget.fixedTokens)
  const segments = buildSegments(input.receipt.sourceManifest, inputBudgetTokens)
  const usedTokens = segments.length
    ? segments.reduce((total, segment) => total + segment.tokens, 0)
    : nonNegative(budget.includedFragmentTokens)
  const status: ContextCapacityStatus = contextWindowTokens > 0 && inputBudgetTokens > 0
    ? 'measured'
    : 'unmeasured'
  const notices = buildNotices({
    receipt: input.receipt,
    segments,
    usedTokens,
    inputBudgetTokens,
    status,
  })

  return {
    schema: CONTEXT_CAPACITY_VIEW_SCHEMA,
    status,
    measurement: 'estimated',
    runId: input.runId,
    capturedAt: input.capturedAt,
    providerId: input.receipt.providerId,
    model: input.receipt.model,
    contextWindowTokens,
    inputBudgetTokens,
    reservedTokens: Math.max(0, contextWindowTokens - inputBudgetTokens),
    usedTokens,
    remainingTokens: Math.max(0, inputBudgetTokens - usedTokens),
    usedRatio: status === 'measured' ? ratio(usedTokens, inputBudgetTokens) : 0,
    tokensUntilCompaction: nonNegative(budget.tokensUntilCompaction),
    activeContextTokens: nonNegative(budget.activeContextTokens),
    compression: {
      triggered: input.receipt.compression.triggered,
      strategy: input.receipt.compression.strategy,
      savedTokens: nonNegative(input.receipt.compression.estimatedSavedTokens),
      keptMessageCount: nonNegative(input.receipt.compression.keptMessageCount),
      sourceMessageCount: nonNegative(input.receipt.compression.sourceMessageCount),
    },
    segments,
    notices,
    failureCodes: input.receipt.failureCodes,
  }
}

interface MutableSegment {
  type: string
  tokens: number
  sourceCount: number
  unmeasuredSourceCount: number
  cappedCount: number
  excludedCount: number
  droppedTokens: number
}

function buildSegments(
  sources: readonly AssistantContextPlanReceiptSource[],
  inputBudgetTokens: number,
): readonly ContextCapacitySegment[] {
  const groups = new Map<string, MutableSegment>()
  for (const source of sources) {
    const type = source.type.trim() || 'unknown'
    const group = groups.get(type) ?? {
      type,
      tokens: 0,
      sourceCount: 0,
      unmeasuredSourceCount: 0,
      cappedCount: 0,
      excludedCount: 0,
      droppedTokens: 0,
    }
    const estimatedTokens = nonNegative(source.estimatedTokens)
    const originalTokens = nonNegative(source.originalEstimatedTokens)
    const sourceCount = nonNegative(source.sourceCount ?? 0)
    group.sourceCount += sourceCount
    if (source.decision === 'excluded') {
      group.excludedCount += 1
      group.droppedTokens += originalTokens
    } else {
      group.tokens += estimatedTokens
      if (source.decision === 'capped') {
        group.cappedCount += 1
        group.droppedTokens += Math.max(0, originalTokens - estimatedTokens)
      }
      if (estimatedTokens === 0 && sourceCount > 0) {
        group.unmeasuredSourceCount += sourceCount
      }
    }
    groups.set(type, group)
  }
  return Array.from(groups.values())
    .map((group) => ({
      type: group.type,
      tokens: group.tokens,
      ratio: ratio(group.tokens, inputBudgetTokens),
      sourceCount: group.sourceCount,
      unmeasuredSourceCount: group.unmeasuredSourceCount,
      cappedCount: group.cappedCount,
      excludedCount: group.excludedCount,
      droppedTokens: group.droppedTokens,
    }))
    .sort(compareSegments)
}

function compareSegments(left: ContextCapacitySegment, right: ContextCapacitySegment): number {
  if (right.tokens !== left.tokens) return right.tokens - left.tokens
  if (right.unmeasuredSourceCount !== left.unmeasuredSourceCount) {
    return right.unmeasuredSourceCount - left.unmeasuredSourceCount
  }
  return left.type.localeCompare(right.type)
}

function buildNotices(input: {
  receipt: AssistantContextPlanReceipt
  segments: readonly ContextCapacitySegment[]
  usedTokens: number
  inputBudgetTokens: number
  status: ContextCapacityStatus
}): readonly ContextCapacityNotice[] {
  const notices: ContextCapacityNotice[] = []
  if (input.segments.some((segment) => segment.unmeasuredSourceCount > 0)) {
    notices.push('unmeasured_sources')
  }
  if (input.status === 'measured' && input.usedTokens > input.inputBudgetTokens) {
    notices.push('budget_overrun')
  }
  if (input.receipt.compression.triggered) notices.push('compression_active')
  if (input.segments.some((segment) => segment.excludedCount > 0)) {
    notices.push('excluded_sources')
  }
  if (input.receipt.failureCodes.length) notices.push('plan_failures')
  return notices
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, value / total))
}
