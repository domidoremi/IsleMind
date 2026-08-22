import {
  ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA,
  type AssistantContextPlanReceipt,
  type AssistantContextPlanReceiptSource,
} from '../contracts'

/**
 * Builds the small, provider-neutral diagnostic record persisted beside a
 * frozen request. The input is intentionally structural so both the rich
 * planner and the plain ConversationRun planner can share it without making
 * their generic planning contracts depend on one another.
 */
export function buildAssistantContextPlanReceipt(input: {
  readonly providerId: string
  readonly model: string
  readonly plan?: unknown
  readonly activePrompt?: unknown
  readonly failureCodes?: readonly string[]
}): AssistantContextPlanReceipt {
  const plan = asRecord(input.plan)
  const manifest = asRecord(plan?.manifest)
  const budget = asRecord(manifest?.budget)
  const windowState = asRecord(plan?.windowState)
  const activePrompt = asRecord(input.activePrompt)
  const compression = asRecord(activePrompt?.compressionMetadata)

  const sourceManifest = readSources(manifest?.fragments ?? plan?.fragments)
  const failureCodes = uniqueStrings([
    ...readStringArray(manifest?.failureCodes),
    ...readStringArray(input.failureCodes),
    readNestedString(windowState, 'compactFailureState', 'code'),
  ])

  const estimatedInputTokens = integer(
    activePrompt?.estimatedInputTokens,
    budget?.estimatedInputTokens,
  )
  const compressedTokens = integer(
    compression?.compressedTokens,
    estimatedInputTokens,
  )
  const sourceTokens = integer(
    compression?.sourceTokens,
    budget?.messageTokens,
  )

  return {
    schema: ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA,
    providerId: bounded(input.providerId, 320),
    model: bounded(input.model, 320),
    ...(stringValue(manifest?.id) ? { manifestId: bounded(stringValue(manifest?.id)!, 512) } : {}),
    budget: {
      modelContextWindow: integer(budget?.modelContextWindow),
      requestBudgetTokens: integer(budget?.requestBudgetTokens, activePrompt?.budgetTokens),
      contextPromptTokens: integer(budget?.contextPromptTokens),
      estimatedInputTokens,
      fixedTokens: integer(activePrompt?.fixedTokens, budget?.fixedTokens),
      messageTokens: integer(activePrompt?.messageTokens, budget?.messageTokens),
      includedFragmentTokens: integer(budget?.includedFragmentTokens),
      originalFragmentTokens: integer(budget?.originalFragmentTokens),
      totalTokenCap: integer(budget?.totalTokenCap),
      activeContextTokens: integer(windowState?.activeContextTokens, budget?.activeContextTokens),
      tokensUntilCompaction: integer(windowState?.tokensUntilCompaction, budget?.tokensUntilCompaction),
    },
    compression: {
      triggered: compression?.strategy !== undefined
        ? Boolean(activePrompt?.compressionTriggered)
        : false,
      strategy: stringValue(compression?.strategy) ?? 'none',
      triggerReason: stringValue(compression?.triggerReason) ?? 'disabled_or_unneeded',
      sourceMessageCount: integer(compression?.sourceMessageCount),
      keptMessageCount: integer(compression?.keptMessageCount),
      sourceTokens,
      compressedTokens,
      estimatedSavedTokens: integer(compression?.estimatedSavedTokens, Math.max(0, sourceTokens - compressedTokens)),
      compressionRatio: finiteNumber(compression?.compressionRatio,
        sourceTokens > 0 ? compressedTokens / sourceTokens : 0),
      summaryTokens: integer(compression?.summaryTokens),
      summarySectionCount: integer(compression?.summarySectionCount),
    },
    sourceManifest,
    failureCodes,
  }
}

function readSources(value: unknown): readonly AssistantContextPlanReceiptSource[] {
  if (!Array.isArray(value)) return []
  const sources: AssistantContextPlanReceiptSource[] = []
  for (const candidate of value.slice(0, 256)) {
    const item = asRecord(candidate)
    if (!item) continue
    const fragmentId = stringValue(item.fragmentId) ?? stringValue(item.id)
    const sourceId = stringValue(item.sourceId)
    const type = stringValue(item.type)
    const priority = stringValue(item.priority)
    if (!fragmentId || !sourceId || !type || !priority) continue
    const decision = resolveDecision(item)
    sources.push({
      fragmentId: bounded(fragmentId, 512),
      type: bounded(type, 160),
      priority: bounded(priority, 80),
      sourceId: bounded(sourceId, 512),
      decision,
      tokenCap: integer(item.tokenCap),
      estimatedTokens: integer(item.estimatedTokens),
      originalEstimatedTokens: integer(item.originalEstimatedTokens),
      ...(stringValue(item.authority) ? { authority: bounded(stringValue(item.authority)!, 160) } : {}),
      ...(stringValue(item.reliability) ? { reliability: bounded(stringValue(item.reliability)!, 160) } : {}),
      ...(item.budgetShare !== undefined ? { budgetShare: finiteNumber(item.budgetShare) } : {}),
      ...(item.sourceCount !== undefined ? { sourceCount: integer(item.sourceCount) } : {}),
      ...(stringValue(item.reason) ? { reason: bounded(stringValue(item.reason)!, 160) } : {}),
    })
  }
  return sources
}

function resolveDecision(item: Record<string, unknown>): 'included' | 'capped' | 'excluded' {
  if (item.decision === 'included' || item.decision === 'capped' || item.decision === 'excluded') {
    return item.decision
  }
  if (item.included === true && item.capped === true) return 'capped'
  if (item.included === true) return 'included'
  return 'excluded'
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : []
}

function uniqueStrings(values: readonly (string | undefined)[]): readonly string[] {
  return Array.from(new Set(values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => bounded(value, 160))))
    .slice(0, 64)
}

function readNestedString(
  record: Record<string, unknown> | undefined,
  key: string,
  nestedKey: string,
): string | undefined {
  return stringValue(asRecord(record?.[key])?.[nestedKey])
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function bounded(value: string, maxLength: number): string {
  return value.slice(0, maxLength)
}

function integer(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(10_000_000, Math.round(value)))
    }
  }
  return 0
}

function finiteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(10_000_000, value))
  }
  return fallback
}
