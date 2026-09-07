import {
  ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA,
  type AssistantContextPlanReceipt,
  type AssistantContextPlanReceiptSource,
} from '../contracts'
import {
  CONTEXT_ARTIFACT_POINTER_SCHEMA,
  type ContextArtifactAuthority,
} from './contextArtifactPolicy'

/**
 * Builds the small, provider-neutral diagnostic record persisted beside a
 * frozen request. The input is intentionally structural so both the rich
 * planner and the plain ConversationRun planner can share it without making
 * their generic planning contracts depend on one another.
 */
export function buildAssistantContextPlanReceipt(input: {
  readonly providerId: string
  readonly model: string
  readonly conversationId?: string
  readonly sourceMessageIds?: readonly string[]
  readonly continuationId?: string
  readonly artifactPointers?: readonly unknown[]
  readonly compressionEpoch?: number
  readonly capabilityPlan?: unknown
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
  const cacheDiagnostics = Array.isArray(plan?.cacheDiagnostics) ? plan.cacheDiagnostics : []
  const capabilityPlan = readCapabilityPlan(input.capabilityPlan)

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
    ...(stringValue(input.conversationId)
      ? { conversationId: bounded(stringValue(input.conversationId)!, 512) }
      : {}),
    ...(input.sourceMessageIds?.length
      ? { sourceMessageIds: uniqueBoundedStrings(input.sourceMessageIds, 256, 512) }
      : {}),
    ...(sourceManifest.some((source) => (
      source.decision === 'excluded' || Boolean(source.excludedSourceIds?.length)
    ))
      ? {
          excludedSourceIds: uniqueBoundedStrings(
            sourceManifest.flatMap((source) => [
              ...(source.decision === 'excluded' && !source.excludedSourceIds?.length
                ? [source.sourceId]
                : []),
              ...(source.excludedSourceIds ?? []),
            ]),
            256,
            512,
          ),
        }
      : {}),
    ...(input.artifactPointers?.length
      ? { artifactPointers: readArtifactPointers(input.artifactPointers) }
      : {}),
    ...(input.compressionEpoch !== undefined
      ? { compressionEpoch: integer(input.compressionEpoch) }
      : {}),
    ...(stringValue(input.continuationId)
      ? { continuationId: bounded(stringValue(input.continuationId)!, 512) }
      : {}),
    ...(stringValue(manifest?.id)
      ? { prefixHash: bounded(stringValue(manifest?.id)!, 512) }
      : {}),
    ...(cacheDiagnostics.length || stringValue(manifest?.id)
      ? {
          cacheDiagnostics: {
            ...(stringValue(manifest?.id) ? { prefixHash: bounded(stringValue(manifest?.id)!, 512) } : {}),
            changedSourceCount: cacheDiagnostics.filter((item) => asRecord(item)?.kind === 'source_hash_changed').length,
            diagnosticCount: Math.min(1_000_000, cacheDiagnostics.length),
          },
        }
      : {}),
    ...(capabilityPlan ? { capabilityPlan } : {}),
  }
}

function readCapabilityPlan(
  value: unknown,
): AssistantContextPlanReceipt['capabilityPlan'] {
  const plan = asRecord(value)
  if (!plan || plan.createsConversation !== false || plan.exposesMode !== false) return undefined
  const schema = stringValue(plan.schema)
  if (!schema) return undefined
  return {
    schema: bounded(schema, 160),
    createsConversation: false,
    exposesMode: false,
    lanes: uniqueBoundedStrings(readStringArray(plan.lanes), 8, 80),
    retrieval: plan.retrieval === true,
    web: plan.web === true,
    readOnlyTools: plan.readOnlyTools === true,
    workflow: plan.workflow === true,
    localState: plan.localState === true,
    requiresConfirmation: plan.requiresConfirmation === true,
    reasons: uniqueBoundedStrings(readStringArray(plan.reasons), 16, 160),
  }
}

function readArtifactPointers(value: readonly unknown[]): AssistantContextPlanReceipt['artifactPointers'] {
  const pointers: NonNullable<AssistantContextPlanReceipt['artifactPointers']>[number][] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const pointer = asRecord(candidate)
    if (!pointer) continue
    const schema = stringValue(pointer.schema)
    const artifactId = stringValue(pointer.artifactId)
    const authority = stringValue(pointer.authority)
    const contentHash = stringValue(pointer.contentHash)
    const uri = stringValue(pointer.uri)
    const expiresAt = positiveInteger(pointer.expiresAt)
    if (
      schema !== CONTEXT_ARTIFACT_POINTER_SCHEMA
      || !artifactId
      || !isContextArtifactAuthority(authority)
      || !contentHash
      || !uri
      || expiresAt === undefined
      || seen.has(artifactId)
    ) continue
    seen.add(artifactId)
    pointers.push({
      schema: bounded(schema, 160),
      artifactId: bounded(artifactId, 512),
      authority: bounded(authority, 160),
      contentHash: bounded(contentHash, 512),
      uri: bounded(uri, 1_024),
      expiresAt,
    })
    if (pointers.length >= 32) break
  }
  return pointers
}

function isContextArtifactAuthority(value: string | undefined): value is ContextArtifactAuthority {
  return value === 'user-private'
    || value === 'external-public'
    || value === 'permissioned-tool'
    || value === 'conversation'
    || value === 'local-state'
}

function uniqueBoundedStrings(
  values: readonly string[],
  limit: number,
  maxLength: number,
): readonly string[] {
  return Array.from(new Set(values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => bounded(value, maxLength))))
    .slice(0, limit)
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
      ...(readStringArray(item.includedSourceIds).length
        ? { includedSourceIds: uniqueBoundedStrings(readStringArray(item.includedSourceIds), 256, 512) }
        : {}),
      ...(readStringArray(item.excludedSourceIds).length
        ? { excludedSourceIds: uniqueBoundedStrings(readStringArray(item.excludedSourceIds), 256, 512) }
        : {}),
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

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

function finiteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(10_000_000, value))
  }
  return fallback
}
