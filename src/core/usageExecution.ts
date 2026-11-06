/** Host-side attribution only. These identities never enter a provider payload. */
export const USAGE_EXECUTION_SCHEMA = 'islemind.request-execution.v1' as const

export interface UsageExecutionReference {
  readonly schema: typeof USAGE_EXECUTION_SCHEMA
  readonly logicalRequestId: string
  readonly requestStartedAt: number
  readonly responseExecutionId?: string
  readonly parentRequestId?: string
  readonly messageId?: string
  readonly routingPlan?: {
    readonly id: string
    readonly name: string
    readonly primaryProviderId: string
    readonly primaryModel: string
  }
}

export interface ReportedProviderExecution {
  readonly model: string
  /** The response field that supplied the model, independent of catalog declarations. */
  readonly source: 'response.model' | 'response.modelVersion' | 'response.message.model'
}

export function isUsageExecutionIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value)
}

export function isUsageExecutionReference(value: unknown): value is UsageExecutionReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Record<string, unknown>
  return reference.schema === USAGE_EXECUTION_SCHEMA
    && Object.keys(reference).every(key => ['schema', 'logicalRequestId', 'requestStartedAt', 'responseExecutionId', 'parentRequestId', 'messageId', 'routingPlan'].includes(key))
    && (reference.routingPlan === undefined || validRoutingReceipt(reference.routingPlan))
    && isUsageExecutionIdentity(reference.logicalRequestId)
    && typeof reference.requestStartedAt === 'number' && Number.isSafeInteger(reference.requestStartedAt) && reference.requestStartedAt >= 0
    && ['responseExecutionId', 'parentRequestId', 'messageId'].every(key =>
      reference[key] === undefined || isUsageExecutionIdentity(reference[key]))
    && reference.parentRequestId !== reference.logicalRequestId
}

function validRoutingReceipt(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return Object.keys(plan).length === 4 && [['id', 120], ['name', 80], ['primaryProviderId', 120], ['primaryModel', 240]].every(([key, limit]) => {
    const text = plan[key as string]
    return typeof text === 'string' && text.trim() === text && text.length > 0 && text.length <= (limit as number) && !/[\u0000-\u001f\u007f]/u.test(text)
  })
}
