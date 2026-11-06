/** Shared, pure routing identities: references only, never credentials or hydrated providers. */
export interface ModelRouteTarget {
  providerId: string
  model: string
}

export interface ModelRoutingPlan {
  schema: 'islemind.model-routing-plan.v1'
  id: string
  name: string
  mode: 'fixed' | 'fallback'
  primary: ModelRouteTarget
  backup?: ModelRouteTarget
  crossProvider: 'ask' | 'allow'
}

export function normalizeModelRoutingPlan(value: unknown): ModelRoutingPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const plan = value as Record<string, unknown>
  const primary = normalizeTarget(plan.primary)
  const backup = normalizeTarget(plan.backup)
  if (plan.schema !== 'islemind.model-routing-plan.v1' || !validText(plan.id, 120) || !validText(plan.name, 80)
    || !primary || !['fixed', 'fallback'].includes(String(plan.mode)) || !['ask', 'allow'].includes(String(plan.crossProvider))) return undefined
  if (plan.mode === 'fallback' && (!backup || sameModelRoute(primary, backup))) return undefined
  return {
    schema: 'islemind.model-routing-plan.v1', id: plan.id, name: plan.name,
    mode: plan.mode as ModelRoutingPlan['mode'], primary,
    ...(plan.mode === 'fallback' ? { backup } : {}), crossProvider: plan.crossProvider as ModelRoutingPlan['crossProvider'],
  }
}

export function normalizeModelRoutingPlans(value: unknown): ModelRoutingPlan[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 50) throw new TypeError('Invalid routing plans.')
  const plans = value.map(normalizeModelRoutingPlan)
  if (plans.some(plan => !plan) || new Set(plans.map(plan => plan!.id)).size !== plans.length) throw new TypeError('Invalid routing plan.')
  return plans as ModelRoutingPlan[]
}

export function sameModelRoute(left: ModelRouteTarget, right: ModelRouteTarget): boolean {
  return left.providerId === right.providerId && left.model === right.model
}

function normalizeTarget(value: unknown): ModelRouteTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const target = value as Record<string, unknown>
  return validText(target.providerId, 120) && validText(target.model, 240)
    ? { providerId: target.providerId, model: target.model } : undefined
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value)
}
