/** Shared, pure routing identities: references only, never credentials or hydrated providers. */
export interface ModelRouteTarget {
  providerId: string
  model: string
}

export const MAX_MODEL_ROUTING_GROUP_MEMBERS = 64
export type ModelRoutingGroupStrategy = 'priority' | 'round-robin' | 'health-first'

export interface ModelRoutingGroup {
  /** Exact upstream ID; display aliases never establish model equivalence. */
  model: string
  strategy: ModelRoutingGroupStrategy
  members: ModelRouteTarget[]
}

export interface ModelRoutingPlan {
  schema: 'islemind.model-routing-plan.v1'
  id: string
  name: string
  mode: 'fixed' | 'fallback' | 'group'
  primary: ModelRouteTarget
  backup?: ModelRouteTarget
  group?: ModelRoutingGroup
  crossProvider: 'ask' | 'allow'
}

export function normalizeModelRoutingPlan(value: unknown): ModelRoutingPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const plan = value as Record<string, unknown>
  const primary = normalizeTarget(plan.primary)
  const backup = normalizeTarget(plan.backup)
  const group = normalizeGroup(plan.group)
  if (plan.schema !== 'islemind.model-routing-plan.v1' || !validText(plan.id, 120) || !validText(plan.name, 80)
    || !primary || !['fixed', 'fallback', 'group'].includes(String(plan.mode)) || !['ask', 'allow'].includes(String(plan.crossProvider))) return undefined
  if (plan.mode === 'fallback' && (!backup || sameModelRoute(primary, backup))) return undefined
  if (plan.mode === 'group' && (!group || !sameModelRoute(primary, group.members[0]))) return undefined
  return {
    schema: 'islemind.model-routing-plan.v1', id: plan.id, name: plan.name,
    mode: plan.mode as ModelRoutingPlan['mode'], primary,
    ...(plan.mode === 'fallback' ? { backup } : {}), ...(plan.mode === 'group' ? { group } : {}),
    crossProvider: plan.crossProvider as ModelRoutingPlan['crossProvider'],
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

export function modelRoutingPlanTargets(plan: ModelRoutingPlan): ModelRouteTarget[] {
  return plan.mode === 'group' ? plan.group?.members ?? []
    : [plan.primary, ...(plan.mode === 'fallback' && plan.backup ? [plan.backup] : [])]
}

/** A group preference may point at any saved member without changing its order. */
export function isModelRoutingPlanTarget(plan: ModelRoutingPlan, target: ModelRouteTarget): boolean {
  return plan.mode === 'group' ? modelRoutingPlanTargets(plan).some(member => sameModelRoute(member, target))
    : sameModelRoute(plan.primary, target)
}

function normalizeGroup(value: unknown): ModelRoutingGroup | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const group = value as Record<string, unknown>
  if (!validText(group.model, 240) || !['priority', 'round-robin', 'health-first'].includes(String(group.strategy))
    || !Array.isArray(group.members) || !group.members.length || group.members.length > MAX_MODEL_ROUTING_GROUP_MEMBERS) return undefined
  const members = group.members.map(normalizeTarget)
  if (members.some(member => !member) || new Set(members.map(member => member!.providerId)).size !== members.length) return undefined
  return { model: group.model, strategy: group.strategy as ModelRoutingGroupStrategy, members: members as ModelRouteTarget[] }
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
