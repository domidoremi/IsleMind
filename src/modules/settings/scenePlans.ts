import { normalizeModelRoutingPlan, sameModelRoute, type ScenePlan, type ScenePlanConfiguration } from '@/core'
import { normalizeConversationContextPolicy } from '@/modules/conversations'

export const SCENE_PLAN_LIMIT = 50
export const SCENE_PLAN_CONFLICT = 'scene_plan_conflict'
export const SCENE_PLAN_INVALID = 'scene_plan_invalid'
export const SCENE_PLAN_SAVE_FAILED = 'scene_plan_save_failed'

const configurationKeys = new Set(['model', 'skillIds', 'skillVariables', 'systemPrompt', 'enabledTools', 'knowledgeSources', 'contextPolicy', 'toolDeclarationMode'])

export function normalizeScenePlanConfiguration(value: unknown): ScenePlanConfiguration | undefined {
  if (!record(value) || Object.keys(value).some(key => !configurationKeys.has(key))) return undefined
  const next: ScenePlanConfiguration = {}
  if (value.model !== undefined) {
    if (!record(value.model) || Object.keys(value.model).some(key => key !== 'target' && key !== 'routingPlan')
      || !record(value.model.target) || Object.keys(value.model.target).some(key => key !== 'providerId' && key !== 'model')
      || !identity(value.model.target.providerId, 120) || !identity(value.model.target.model, 240)) return undefined
    const target = { providerId: value.model.target.providerId, model: value.model.target.model }
    const routingPlan = normalizeModelRoutingPlan(value.model.routingPlan)
    if (value.model.routingPlan !== undefined && (!routingPlan || !sameModelRoute(routingPlan.primary, target))) return undefined
    next.model = { target, ...(routingPlan ? { routingPlan } : {}) }
  }
  for (const [field, count, length] of [['skillIds', 32, 120], ['enabledTools', 128, 320], ['knowledgeSources', 128, 120]] as const) {
    if (value[field] === undefined) continue
    const list = value[field]
    if (!Array.isArray(list) || list.length > count || list.some(id => !identity(id, length)) || new Set(list).size !== list.length) return undefined
    next[field] = [...list]
  }
  if (value.skillVariables !== undefined) {
    if (!record(value.skillVariables) || Object.keys(value.skillVariables).length > 64) return undefined
    const variables: Record<string, string | number | boolean> = {}
    for (const [key, item] of Object.entries(value.skillVariables)) {
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)
        || !(typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)
          || typeof item === 'string' && item.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(item))) return undefined
      variables[key] = item
    }
    next.skillVariables = variables
  }
  if (value.systemPrompt !== undefined) {
    if (typeof value.systemPrompt !== 'string' || value.systemPrompt.length > 16000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.systemPrompt)) return undefined
    next.systemPrompt = value.systemPrompt
  }
  if (value.contextPolicy !== undefined) {
    const contextPolicy = normalizeConversationContextPolicy(value.contextPolicy)
    if (value.contextPolicy !== null && !contextPolicy) return undefined
    next.contextPolicy = value.contextPolicy === null ? null : contextPolicy!
  }
  if (value.toolDeclarationMode !== undefined) {
    if (value.toolDeclarationMode !== null && value.toolDeclarationMode !== 'full' && value.toolDeclarationMode !== 'auto') return undefined
    next.toolDeclarationMode = value.toolDeclarationMode
  }
  if (next.skillVariables && !next.skillIds?.length) return undefined
  return next
}

export function normalizeScenePlan(value: unknown): ScenePlan | undefined {
  if (!record(value) || Object.keys(value).some(key => !['schema', 'id', 'name', 'description', 'revision', 'configuration'].includes(key))
    || value.schema !== 'islemind.scene-plan.v1' || !identity(value.id, 120) || !identity(value.name, 80)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 240
      || /[\u0000-\u001f\u007f]/u.test(value.description))) return undefined
  const configuration = normalizeScenePlanConfiguration(value.configuration)
  return configuration ? {
    schema: 'islemind.scene-plan.v1', id: value.id, name: value.name, revision: value.revision as number,
    ...(value.description !== undefined ? { description: value.description as string } : {}), configuration,
  } : undefined
}

export function normalizeScenePlans(value: unknown): ScenePlan[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > SCENE_PLAN_LIMIT) throw new TypeError(SCENE_PLAN_INVALID)
  const plans = value.map(normalizeScenePlan)
  if (plans.some(plan => !plan) || new Set(plans.map(plan => plan!.id)).size !== plans.length) throw new TypeError(SCENE_PLAN_INVALID)
  return plans as ScenePlan[]
}

export function normalizeSettingsScenePlans<T extends { scenePlans?: ScenePlan[] }>(settings: T): T {
  const scenePlans = normalizeScenePlans(settings.scenePlans)
  return scenePlans === undefined || JSON.stringify(scenePlans) === JSON.stringify(settings.scenePlans) ? settings : { ...settings, scenePlans }
}

export interface ScenePlanManagementPorts {
  read(): ScenePlan[]
  /** Publishes only this Settings-owned collection, preserving other settings. */
  publish(plans: ScenePlan[]): void
  persist(): Promise<void>
}

/**
 * Local writes use the existing Settings queue. A failed optimistic write restores
 * this collection and queues that restoration behind any later settings snapshots.
 */
export function createScenePlanManagement(ports: ScenePlanManagementPorts) {
  let tail: Promise<unknown> = Promise.resolve()
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work)
    tail = result.catch(() => undefined)
    return result
  }
  async function commit(next: ScenePlan[], previous: ScenePlan[]) {
    ports.publish(next)
    try { await ports.persist() }
    catch {
      if (JSON.stringify(ports.read()) === JSON.stringify(next)) {
        ports.publish(previous)
        // The original rejection remains authoritative even if restoration saves.
        await ports.persist().catch(() => undefined)
      }
      throw new Error(SCENE_PLAN_SAVE_FAILED)
    }
  }
  return Object.freeze({
    save(input: ScenePlan, expectedRevision: number | null): Promise<ScenePlan> {
      const draft = normalizeScenePlan(input)
      if (!draft) return Promise.reject(new Error(SCENE_PLAN_INVALID))
      return run(async () => {
        const previous = ports.read()
        const current = previous.find(plan => plan.id === draft.id)
        if ((current?.revision ?? null) !== expectedRevision) throw new Error(SCENE_PLAN_CONFLICT)
        const revision = current ? current.revision + 1 : 1
        if (!Number.isSafeInteger(revision)) throw new Error(SCENE_PLAN_INVALID)
        const plan = { ...draft, revision }
        const next = normalizeScenePlans(current
          ? previous.map(item => item.id === plan.id ? plan : item) : [...previous, plan])!
        await commit(next, previous)
        return next.find(item => item.id === plan.id)!
      })
    },
    remove(id: string, expectedRevision: number): Promise<void> {
      return run(async () => {
        const previous = ports.read()
        const current = previous.find(plan => plan.id === id)
        if (!current || current.revision !== expectedRevision) throw new Error(SCENE_PLAN_CONFLICT)
        await commit(previous.filter(plan => plan.id !== id), previous)
      })
    },
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function identity(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}
