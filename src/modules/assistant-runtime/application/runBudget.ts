import type { ProviderUsage } from '@/modules/providers'

export const HARNESS_ENGINE_VERSION = 'islemind.harness.v1' as const
export const DEFAULT_RUN_BUDGET = Object.freeze({ modelRequests: 24, tools: 48, tokens: 120_000, activeMs: 30 * 60_000 })
export interface RunBudgetLimits {
  modelRequests: number
  tools: number
  tokens: number
  activeMs: number
  /** A missing trustworthy quote must fail closed, not turn this into a free run. */
  amountUsd?: number
}
export interface RunAttemptUsageUpdate {
  attemptId: string
  /** Per-attempt monotonically increasing cumulative observation, not a delta. */
  sequence: number
  settled: boolean
  usage?: ProviderUsage
  /** Only true when both sides of the provider usage are final and complete. */
  complete: boolean
}
export interface RunBudgetAttempt {
  attemptId: string
  runId: string
  inputEstimate: number
  outputReservation: number
  sequence: number
  settled: boolean
  complete: boolean
  usage?: ProviderUsage
}
export interface RunBudgetSnapshot {
  schema: 'islemind.run-budget.v1'
  rootRunId: string
  limits: RunBudgetLimits
  attempts: RunBudgetAttempt[]
  toolOperationIds: string[]
  activeMs: number
  activeSince?: number
  /** Union of active members: overlapping children are not charged twice. */
  activeRunIds?: string[]
}
export class RunBudgetAdmissionError extends Error {
  constructor(readonly reason: 'model_requests' | 'tools' | 'tokens' | 'active_time' | 'price_unknown' | 'estimate_unavailable') {
    super(`Run budget admission denied: ${reason}`)
    this.name = 'RunBudgetAdmissionError'
  }
}

export function createRunBudget(rootRunId: string, limits: RunBudgetLimits = DEFAULT_RUN_BUDGET): RunBudgetSnapshot {
  validateRunBudgetLimits(limits)
  return { schema: 'islemind.run-budget.v1', rootRunId, limits: { ...limits }, attempts: [], toolOperationIds: [], activeMs: 0 }
}

export function validateRunBudgetLimits(limits: RunBudgetLimits): void {
  for (const key of ['modelRequests', 'tools', 'tokens', 'activeMs'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new TypeError('Invalid run budget')
  }
  // Bound the ledger itself; definitions cannot turn snapshots into huge allocations.
  if (limits.modelRequests > 256 || limits.tools > 512) throw new TypeError('Run budget exceeds ledger capacity')
  if (limits.amountUsd !== undefined && (!Number.isFinite(limits.amountUsd) || limits.amountUsd < 0)) throw new TypeError('Invalid monetary budget')
}

export function runBudgetTotals(budget: RunBudgetSnapshot, now: number) {
  let actualTokens = 0
  let estimatedTokens = 0
  let reservedTokens = 0
  for (const attempt of budget.attempts) {
    const total = completeUsageTokens(attempt.usage)
    if (attempt.complete && total !== undefined) actualTokens += total
    else {
      // Partial usage is a lower bound, never grounds to release all reservation.
      const observed = attempt.usage?.source === 'provider'
        ? Math.max(attempt.usage.totalTokens ?? 0, (attempt.usage.inputTokens ?? 0) + (attempt.usage.outputTokens ?? 0)) : 0
      const held = Math.max(attempt.inputEstimate + attempt.outputReservation, observed)
      if (attempt.settled) estimatedTokens += held
      else reservedTokens += held
    }
  }
  return { actualTokens, estimatedTokens, reservedTokens,
    chargedTokens: actualTokens + estimatedTokens + reservedTokens,
    modelRequests: budget.attempts.length, tools: budget.toolOperationIds.length,
    activeMs: budget.activeMs + (budget.activeSince === undefined ? 0 : Math.max(0, now - budget.activeSince)),
  }
}

export function reserveRunAttempt(budget: RunBudgetSnapshot, attempt: Omit<RunBudgetAttempt, 'sequence' | 'settled' | 'complete'>, now: number): RunBudgetSnapshot {
  const existing = budget.attempts.find((item) => item.attemptId === attempt.attemptId)
  if (existing) {
    if (existing.runId !== attempt.runId || existing.inputEstimate !== attempt.inputEstimate || existing.outputReservation !== attempt.outputReservation) throw new Error('Attempt identity reused')
    return budget
  }
  assertRunBudgetAdmission(budget, now)
  if (![attempt.inputEstimate, attempt.outputReservation].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new RunBudgetAdmissionError('estimate_unavailable')
  const totals = runBudgetTotals(budget, now)
  if (totals.modelRequests >= budget.limits.modelRequests) throw new RunBudgetAdmissionError('model_requests')
  if (totals.chargedTokens + attempt.inputEstimate + attempt.outputReservation > budget.limits.tokens) throw new RunBudgetAdmissionError('tokens')
  return { ...budget, attempts: [...budget.attempts, { ...attempt, sequence: -1, settled: false, complete: false }] }
}

export function settleRunAttempt(budget: RunBudgetSnapshot, update: RunAttemptUsageUpdate): RunBudgetSnapshot {
  if (!Number.isSafeInteger(update.sequence) || update.sequence < 0) throw new TypeError('Invalid usage sequence')
  const index = budget.attempts.findIndex((item) => item.attemptId === update.attemptId)
  if (index < 0) throw new Error('Usage has no committed reservation')
  const old = budget.attempts[index]
  if (update.sequence <= old.sequence || (old.complete && !update.complete)) return budget
  const incoming = sanitizeUsage(update.usage)
  const usage = update.complete ? incoming : mergePartialUsage(old.usage, incoming)
  const attempts = [...budget.attempts]
  attempts[index] = { ...old, sequence: update.sequence, settled: old.settled || update.settled,
    complete: update.complete && completeUsageTokens(usage) !== undefined, usage: usage ?? old.usage }
  return { ...budget, attempts }
}

export function reserveRunTool(budget: RunBudgetSnapshot, operationId: string, now: number): RunBudgetSnapshot {
  if (budget.toolOperationIds.includes(operationId)) return budget
  assertRunBudgetAdmission(budget, now)
  if (budget.toolOperationIds.length >= budget.limits.tools) throw new RunBudgetAdmissionError('tools')
  return { ...budget, toolOperationIds: [...budget.toolOperationIds, operationId] }
}

export function assertRunBudgetAdmission(budget: RunBudgetSnapshot, now: number): void {
  if (budget.limits.amountUsd !== undefined) throw new RunBudgetAdmissionError('price_unknown')
  const totals = runBudgetTotals(budget, now)
  if (totals.activeMs >= budget.limits.activeMs) throw new RunBudgetAdmissionError('active_time')
  if (totals.chargedTokens >= budget.limits.tokens) throw new RunBudgetAdmissionError('tokens')
}

export function setRunBudgetActive(budget: RunBudgetSnapshot, active: boolean, now: number, runId = budget.rootRunId): RunBudgetSnapshot {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Invalid clock')
  const members = new Set(budget.activeRunIds ?? (budget.activeSince === undefined ? [] : [budget.rootRunId]))
  if (active) members.add(runId)
  else members.delete(runId)
  if (members.size > 7) throw new Error('Budget active member limit exceeded')
  const activeRunIds = [...members]
  if (members.size) return { ...budget, activeRunIds, activeSince: budget.activeSince ?? now }
  return {
    ...budget, activeRunIds, activeMs: runBudgetTotals(budget, now).activeMs, activeSince: undefined,
  }
}

/** Provider normalization already includes cache tokens; Google total includes thoughts.
 * Never add cached/reasoning detail counters to a normalized total a second time. */
function completeUsageTokens(usage: ProviderUsage | undefined): number | undefined {
  if (usage?.source !== 'provider') return undefined
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined
  return usage.totalTokens ?? usage.inputTokens + usage.outputTokens
}
function sanitizeUsage(usage: ProviderUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined
  if (usage.source !== 'provider' && usage.source !== 'estimated') throw new TypeError('Invalid usage source')
  const result: ProviderUsage = { source: usage.source }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'cachedInputTokens', 'reasoningTokens'] as const) {
    const value = usage[key]
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid usage counter')
      result[key] = value
    }
  }
  return result
}
function mergePartialUsage(old: ProviderUsage | undefined, next: ProviderUsage | undefined): ProviderUsage | undefined {
  if (!old || !next || old.source !== next.source) return next ?? old
  const usage = { ...old, ...next }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'cachedInputTokens', 'reasoningTokens'] as const) {
    if (old[key] !== undefined && next[key] !== undefined) usage[key] = Math.max(old[key]!, next[key]!)
  }
  return usage
}

export function decodeRunBudget(value: string): RunBudgetSnapshot {
  if (value.length > 512_000) throw new Error('Run budget storage exceeds limit')
  const parsed = JSON.parse(value) as RunBudgetSnapshot
  if (parsed?.schema !== 'islemind.run-budget.v1' || typeof parsed.rootRunId !== 'string' || !Array.isArray(parsed.attempts) || !Array.isArray(parsed.toolOperationIds)) throw new Error('Invalid persisted budget')
  validateRunBudgetLimits(parsed.limits)
  if (parsed.attempts.length > 256 || parsed.toolOperationIds.length > 512 || !Number.isFinite(parsed.activeMs) || parsed.activeMs < 0 || (parsed.activeSince !== undefined && (!Number.isFinite(parsed.activeSince) || parsed.activeSince < 0))) throw new Error('Invalid persisted budget')
  if (parsed.activeRunIds !== undefined && (!Array.isArray(parsed.activeRunIds) || parsed.activeRunIds.length > 7
    || !parsed.activeRunIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 512)
    || new Set(parsed.activeRunIds).size !== parsed.activeRunIds.length
    || Boolean(parsed.activeRunIds.length) !== (parsed.activeSince !== undefined))) throw new Error('Invalid active budget members')
  const ids = new Set<string>()
  for (const attempt of parsed.attempts) {
    if (!attempt || typeof attempt.attemptId !== 'string' || typeof attempt.runId !== 'string' || ids.has(attempt.attemptId)
      || !Number.isSafeInteger(attempt.sequence) || attempt.sequence < -1
      || ![attempt.inputEstimate, attempt.outputReservation].every((n) => Number.isSafeInteger(n) && n >= 0)
      || typeof attempt.complete !== 'boolean' || typeof attempt.settled !== 'boolean') throw new Error('Invalid persisted attempt')
    sanitizeUsage(attempt.usage)
    ids.add(attempt.attemptId)
  }
  if (!parsed.toolOperationIds.every((id) => typeof id === 'string') || new Set(parsed.toolOperationIds).size !== parsed.toolOperationIds.length) throw new Error('Invalid persisted tools')
  return parsed
}
