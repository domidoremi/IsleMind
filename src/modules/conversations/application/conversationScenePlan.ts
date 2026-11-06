import type { ScenePlan, ScenePlanConfiguration, ToolDeclarationMode } from '@/core'
import { normalizeModelRoutingPlan, sameModelRoute, snapshotPlainData } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type { SkillDefinition, SkillVariable } from '@/types/skillContracts'
import type { SkillApplyResult } from './conversationSkillPolicy'
import { normalizeConversationContextPolicy } from '../domain/conversationContextPolicy'
import { normalizeConversationResourceScope, normalizeConversationScenePlanSource } from '../domain/conversationScenePlan'
import { normalizeConversationGenerationPreferences } from '../domain/conversationGenerationPreference'

export const CONVERSATION_SCENE_PLAN_CONFLICT = 'conversation_scene_plan_conflict'
export const CONVERSATION_SCENE_PLAN_BUSY = 'conversation_scene_plan_busy'
export const CONVERSATION_SCENE_PLAN_MISSING = 'conversation_scene_plan_missing'
export const CONVERSATION_SCENE_PLAN_INVALID = 'conversation_scene_plan_invalid'

const preferenceKeys = ['providerId', 'model', 'providerModelMode', 'routingPlan', 'skillIds', 'skillSnapshot', 'systemPrompt',
  'enabledTools', 'knowledgeSources', 'temperature', 'topP', 'topK', 'maxTokens', 'reasoningEffort',
  'generationParameterOverrides', 'contextPolicyOverride', 'toolDeclarationModeOverride', 'scenePlanSource', 'resourceScopeOverride'] as const

export type ConversationScenePlanPatch = Partial<Pick<Conversation, typeof preferenceKeys[number]>>
export type ScenePlanChangeField = 'model' | 'routingPlan' | 'skillIds' | 'systemPrompt' | 'enabledTools' | 'knowledgeSources'
  | 'temperature' | 'maxTokens' | 'contextPolicyOverride' | 'toolDeclarationModeOverride'
export interface ScenePlanChange {
  field: ScenePlanChangeField
  before: unknown
  after: unknown
  changed: boolean
}

export function conversationScenePlanRevision(conversation: Conversation): string {
  return JSON.stringify([conversation.id, conversation.updatedAt, ...preferenceKeys.map(key => key === 'generationParameterOverrides'
    ? normalizeConversationGenerationPreferences(conversation) : conversation[key] ?? null)])
}

/** Later explicit edits update an existing restriction; old conversations keep legacy semantics. */
export function applyConversationResourceSelectionUpdates(conversation: Conversation, updates: Partial<Conversation>): Partial<Conversation> {
  if (!conversation.resourceScopeOverride || Object.hasOwn(updates, 'resourceScopeOverride')) return updates
  const scope = normalizeConversationResourceScope(conversation.resourceScopeOverride)
  if (!scope) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  let changed = false
  for (const [field, role] of [['enabledTools', 'tools'], ['knowledgeSources', 'knowledge']] as const) {
    if (!Object.hasOwn(updates, field)) continue
    scope[role] = updates[field]?.length ? 'selected' : 'none'
    changed = true
  }
  return changed ? { ...updates, resourceScopeOverride: scope } : updates
}

export function resolveConversationSceneSettings<T extends { toolDeclarationMode?: ToolDeclarationMode; knowledgeEnabled?: boolean }>(
  settings: T, conversation: Pick<Conversation, 'toolDeclarationModeOverride' | 'resourceScopeOverride'> | undefined,
): T {
  const override = conversation?.toolDeclarationModeOverride
  if (override !== undefined && override !== 'full' && override !== 'auto') throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  const scope = normalizeConversationResourceScope(conversation?.resourceScopeOverride)
  if (conversation?.resourceScopeOverride !== undefined && !scope) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  if (override === undefined && scope?.knowledge !== 'none') return settings
  return { ...settings,
    ...(override === 'full' || override === 'auto' ? { toolDeclarationMode: override } : {}),
    ...(scope?.knowledge === 'none' ? { knowledgeEnabled: false } : {}) }
}

/** Only configuration fields can enter a scene commit. Undefined clears an explicit patch field. */
export function applyConversationScenePlanPatch(conversation: Conversation, patch: ConversationScenePlanPatch, now: number): Conversation {
  if (Object.keys(patch).some(key => !(preferenceKeys as readonly string[]).includes(key))) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  const next = { ...conversation, updatedAt: now }
  for (const key of preferenceKeys) {
    if (!Object.hasOwn(patch, key)) continue
    if (patch[key] === undefined) delete next[key]
    else Object.assign(next, { [key]: snapshotPlainData(patch[key]) })
  }
  if (next.toolDeclarationModeOverride !== undefined && next.toolDeclarationModeOverride !== 'full' && next.toolDeclarationModeOverride !== 'auto') throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  if (next.contextPolicyOverride !== undefined && !normalizeConversationContextPolicy(next.contextPolicyOverride)) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  if (next.scenePlanSource !== undefined && !normalizeConversationScenePlanSource(next.scenePlanSource)) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  if (next.resourceScopeOverride !== undefined && !normalizeConversationResourceScope(next.resourceScopeOverride)) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
  if (next.routingPlan !== undefined) {
    const plan = normalizeModelRoutingPlan(next.routingPlan)
    if (!plan || !sameModelRoute(plan.primary, { providerId: next.providerId ?? '', model: next.model ?? '' })) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
    next.routingPlan = plan
  }
  return next
}

/** Canonical metadata and historical messages stay with the durable record. */
export function copyConversationScenePlanPreferences(canonical: Conversation, applied: Conversation): Conversation {
  const patch = Object.fromEntries(preferenceKeys.map(key => [key, applied[key]])) as ConversationScenePlanPatch
  return applyConversationScenePlanPatch(canonical, patch, applied.updatedAt)
}

/** Existing skill composition runs first; explicitly saved scene fields take precedence. */
export function projectConversationScenePlan(conversation: Conversation, configuration: ScenePlanConfiguration, skillResult?: SkillApplyResult) {
  const patch: ConversationScenePlanPatch = {}
  const resourceScope = { schema: 'islemind.conversation-resource-scope.v1' as const, ...conversation.resourceScopeOverride }
  if (configuration.skillIds !== undefined) {
    if (configuration.skillIds.length && !skillResult) throw new Error(CONVERSATION_SCENE_PLAN_INVALID)
    Object.assign(patch, skillResult?.conversationUpdates ?? { skillIds: [], skillSnapshot: undefined })
    if (skillResult) {
      resourceScope.tools = skillResult.conversationUpdates.enabledTools?.length ? 'selected' : 'none'
      resourceScope.knowledge = skillResult.conversationUpdates.knowledgeSources?.length ? 'selected' : 'none'
    }
    if (skillResult?.conversationUpdates.generationParameterOverrides) {
      patch.generationParameterOverrides = { ...conversation.generationParameterOverrides, ...skillResult.conversationUpdates.generationParameterOverrides }
    }
    // A skill model selection uses the original skill path, and breaks a stale routing binding.
    if (patch.providerId !== undefined || patch.model !== undefined) {
      patch.providerModelMode = 'manual'
      patch.routingPlan = undefined
    }
  }
  if (configuration.model) {
    patch.providerId = configuration.model.target.providerId
    patch.model = configuration.model.target.model
    patch.providerModelMode = 'manual'
    patch.routingPlan = configuration.model.routingPlan
  }
  for (const key of ['systemPrompt', 'enabledTools', 'knowledgeSources'] as const) {
    if (configuration[key] !== undefined) Object.assign(patch, { [key]: configuration[key] })
  }
  if (configuration.enabledTools !== undefined) resourceScope.tools = configuration.enabledTools.length ? 'selected' : 'none'
  if (configuration.knowledgeSources !== undefined) resourceScope.knowledge = configuration.knowledgeSources.length ? 'selected' : 'none'
  if (resourceScope.tools || resourceScope.knowledge) patch.resourceScopeOverride = resourceScope
  if (configuration.contextPolicy !== undefined) patch.contextPolicyOverride = configuration.contextPolicy ?? undefined
  if (configuration.toolDeclarationMode !== undefined) patch.toolDeclarationModeOverride = configuration.toolDeclarationMode ?? undefined
  const projected = applyConversationScenePlanPatch(conversation, patch, conversation.updatedAt)
  const fields: ScenePlanChangeField[] = ['model', 'routingPlan', 'skillIds', 'systemPrompt', 'enabledTools', 'knowledgeSources',
    'temperature', 'maxTokens', 'contextPolicyOverride', 'toolDeclarationModeOverride']
  const changes = fields.map(field => ({
    field,
    before: field === 'model' ? { providerId: conversation.providerId, model: conversation.model }
      : field === 'enabledTools' || field === 'knowledgeSources' ? { values: conversation[field], scope: conversation.resourceScopeOverride?.[field === 'enabledTools' ? 'tools' : 'knowledge'] } : conversation[field],
    after: field === 'model' ? { providerId: projected.providerId, model: projected.model }
      : field === 'enabledTools' || field === 'knowledgeSources' ? { values: projected[field], scope: projected.resourceScopeOverride?.[field === 'enabledTools' ? 'tools' : 'knowledge'] } : projected[field],
    changed: field === 'model' ? conversation.providerId !== projected.providerId || conversation.model !== projected.model
      : JSON.stringify(conversation[field] ?? null) !== JSON.stringify(projected[field] ?? null)
        || (field === 'enabledTools' || field === 'knowledgeSources') && conversation.resourceScopeOverride?.[field === 'enabledTools' ? 'tools' : 'knowledge'] !== projected.resourceScopeOverride?.[field === 'enabledTools' ? 'tools' : 'knowledge'],
  }))
  return { patch, projected, changes }
}

/** Captures references and explicit preferences. Resource definitions stay with their owner. */
export function captureConversationScenePlan(conversation: Conversation): ScenePlanConfiguration {
  return {
    ...(conversation.providerId?.trim() && conversation.model?.trim() ? { model: {
      target: { providerId: conversation.providerId, model: conversation.model },
      ...(conversation.routingPlan ? { routingPlan: snapshotPlainData(conversation.routingPlan) } : {}),
    } } : {}),
    ...(conversation.skillIds !== undefined ? { skillIds: [...conversation.skillIds] } : {}),
    ...(conversation.skillIds?.length && conversation.skillSnapshot?.variables ? { skillVariables: { ...conversation.skillSnapshot.variables } } : {}),
    systemPrompt: conversation.systemPrompt,
    ...(conversation.enabledTools?.length || conversation.resourceScopeOverride?.tools === 'none' ? { enabledTools: [...conversation.enabledTools ?? []] } : {}),
    ...(conversation.knowledgeSources?.length || conversation.resourceScopeOverride?.knowledge === 'none' ? { knowledgeSources: [...conversation.knowledgeSources ?? []] } : {}),
    contextPolicy: conversation.contextPolicyOverride ? { ...conversation.contextPolicyOverride } : null,
    toolDeclarationMode: conversation.toolDeclarationModeOverride ?? null,
  }
}

export function resolveSceneSkillVariables(
  skills: readonly SkillDefinition[], supplied: Record<string, string | number | boolean> = {},
  extract: (skill: SkillDefinition) => string[],
) {
  const variables = { ...supplied }
  const issues: { skillId: string; name: string; kind: 'required' | 'invalid' | 'conflicting' }[] = []
  const seen = new Map<string, SkillVariable>()
  for (const skill of skills) for (const name of extract(skill)) {
    const variable: SkillVariable = skill.variables?.find(item => item.name === name) ?? { name, type: 'text', required: true }
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name) || seen.size >= 64 && !seen.has(name)) {
      issues.push({ skillId: skill.id, name, kind: 'invalid' }); continue
    }
    const previous = seen.get(variable.name)
    if (previous && (previous.type !== variable.type || JSON.stringify(previous.options ?? []) !== JSON.stringify(variable.options ?? []))) {
      issues.push({ skillId: skill.id, name: variable.name, kind: 'conflicting' }); continue
    }
    seen.set(variable.name, variable)
    const value = variables[variable.name] ?? variable.defaultValue
    if (value === undefined || typeof value === 'string' && !value.trim()) {
      if (variable.required) issues.push({ skillId: skill.id, name: variable.name, kind: 'required' })
      continue
    }
    const valid = variable.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : variable.type === 'boolean' ? typeof value === 'boolean'
        : typeof value === 'string' && value.length <= 1000 && (variable.type !== 'choice' || !!variable.options?.includes(value))
    if (!valid) issues.push({ skillId: skill.id, name: variable.name, kind: 'invalid' })
    else variables[variable.name] = value
  }
  return { variables, issues, definitions: [...seen.values()] }
}

export interface ConversationScenePlanCommandPorts {
  read(id: string): Conversation | undefined | Promise<Conversation | undefined>
  isBusy(id: string): boolean
  isDraft(id: string): boolean
  acquireLock(id: string): () => void
  persist(conversation: Conversation, expectedRevision: string, validate: () => Promise<boolean>): Promise<void>
  publish(conversation: Conversation, newDraft: boolean): void
  now(): number
}

export function createConversationScenePlanCommand(ports: ConversationScenePlanCommandPorts) {
  return async (input: {
    plan: Pick<ScenePlan, 'id' | 'name' | 'revision'>
    conversationId: string
    expectedRevision: string
    patch: ConversationScenePlanPatch
    newDraft?: Conversation
    signal?: AbortSignal
    validate(): Promise<boolean>
  }) => {
    const patch = snapshotPlainData(input.patch)
    const source = { ...input.plan }
    const seed = input.newDraft ? snapshotPlainData(input.newDraft) : undefined
    const ensureActive = () => { if (input.signal?.aborted) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT) }
    const read = async () => seed ?? await ports.read(input.conversationId)
    ensureActive()
    const initial = await read()
    if (!initial) throw new Error(CONVERSATION_SCENE_PLAN_MISSING)
    if (seed && (seed.id !== input.conversationId || seed.messages.length || await ports.read(seed.id))) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
    if (conversationScenePlanRevision(initial) !== input.expectedRevision) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
    if (ports.isBusy(input.conversationId) || initial.messages.some(message => message.status === 'sending' || message.status === 'streaming')) throw new Error(CONVERSATION_SCENE_PLAN_BUSY)
    const release = ports.acquireLock(input.conversationId)
    try {
      ensureActive()
      if (!await input.validate()) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
      ensureActive()
      const current = await read()
      if (!current) throw new Error(CONVERSATION_SCENE_PLAN_MISSING)
      if (conversationScenePlanRevision(current) !== input.expectedRevision) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
      if (seed && await ports.read(seed.id)) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
      const now = ports.now()
      const next = applyConversationScenePlanPatch(current, { ...patch, scenePlanSource: {
        schema: 'islemind.conversation-scene-plan.v1', id: source.id, name: source.name, revision: source.revision, appliedAt: now,
      } }, now)
      const draft = !!seed || ports.isDraft(next.id)
      if (!draft) await ports.persist(next, input.expectedRevision, async () => {
        ensureActive()
        const valid = await input.validate()
        ensureActive()
        return valid
      })
      // Cancellation after the durable barrier cannot undo a committed configuration.
      ports.publish(next, !!seed)
      return { conversation: next, persisted: !draft }
    } finally { release() }
  }
}
