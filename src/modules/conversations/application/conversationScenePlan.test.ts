import type { ScenePlan } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import { parseConversationSnapshot } from '../domain/conversationSnapshot'
import { createConversationBranchDraft } from './conversationBranch'
import {
  applyConversationResourceSelectionUpdates, applyConversationScenePlanPatch, captureConversationScenePlan, conversationScenePlanRevision,
  createConversationScenePlanCommand, projectConversationScenePlan, resolveConversationSceneSettings, resolveSceneSkillVariables,
} from './conversationScenePlan'

const conversation: Conversation = { id: 'c', title: 'Retain history', providerId: 'a', model: 'model',
  systemPrompt: 'Current instructions', temperature: 0.6, maxTokens: 1000, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'answer', role: 'assistant', content: 'Historical answer', status: 'done', timestamp: 1,
    usage: { source: 'provider', totalTokens: 40 } }] }
const plan: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'scene', name: 'Research', revision: 1, configuration: {} }

function fixture() {
  let current: Conversation | undefined = conversation
  let busy = false
  const persisted: Conversation[] = []
  const release = jest.fn()
  const publish = jest.fn((next: Conversation) => { current = next })
  const persist = jest.fn(async (next: Conversation) => { persisted.push(next) })
  const command = createConversationScenePlanCommand({ read: id => current?.id === id ? current : undefined, isBusy: () => busy, isDraft: () => false,
    acquireLock: () => release, persist, publish, now: () => 10 })
  const input = { plan, conversationId: conversation.id, expectedRevision: conversationScenePlanRevision(conversation),
    patch: { systemPrompt: 'New instructions' }, validate: jest.fn(async () => true) }
  return { command, input, persist, persisted, publish, release, get: () => current, set: (value: Conversation | undefined) => { current = value }, busy: () => { busy = true } }
}

test('omitted fields keep current configuration, empty lists close scopes, and null restores global inheritance', () => {
  expect(projectConversationScenePlan(conversation, {}).projected).toEqual(conversation)
  const original = { ...conversation, contextPolicyOverride: { schema: 'islemind.conversation-context-policy.v1' as const, remoteCompactThreshold: 0.65 },
    toolDeclarationModeOverride: 'auto' as const }
  const result = projectConversationScenePlan(original, { enabledTools: [], knowledgeSources: [], contextPolicy: null, toolDeclarationMode: null }).projected
  expect(result).toMatchObject({ enabledTools: [], knowledgeSources: [], resourceScopeOverride: {
    schema: 'islemind.conversation-resource-scope.v1', tools: 'none', knowledge: 'none' } })
  expect(result.contextPolicyOverride).toBeUndefined()
  expect(result.toolDeclarationModeOverride).toBeUndefined()
  expect(result.messages).toBe(original.messages)
})

test('uses skill composition first, then explicit scene values, preserving unrelated parameter overrides', () => {
  const original = { ...conversation, generationParameterOverrides: { topP: true } }
  const result = projectConversationScenePlan(original, { skillIds: ['skill'], systemPrompt: 'Explicit', enabledTools: [], model: { target: { providerId: 'b', model: 'scene-model' } } }, {
    snapshot: { skillIds: ['skill'], names: ['Skill'], systemPrompt: 'Skill instructions', variables: {} },
    conversationUpdates: { skillIds: ['skill'], skillSnapshot: { skillIds: ['skill'], names: ['Skill'], systemPrompt: 'Skill instructions', variables: {} },
      systemPrompt: 'Skill instructions', providerId: 'skill-provider', model: 'skill-model', temperature: 0.2,
      generationParameterOverrides: { temperature: true }, enabledTools: ['skill-tool'], knowledgeSources: ['knowledge-a'] },
  }).projected
  expect(result).toMatchObject({ providerId: 'b', model: 'scene-model', providerModelMode: 'manual', systemPrompt: 'Explicit',
    enabledTools: [], knowledgeSources: ['knowledge-a'], resourceScopeOverride: { tools: 'none', knowledge: 'selected' },
    generationParameterOverrides: { topP: true, temperature: true } })
  expect(result.skillSnapshot?.systemPrompt).toBe('Skill instructions')
})

test('captures explicit overrides and selected references without turning legacy empty lists into none', () => {
  const capture = captureConversationScenePlan({ ...conversation, enabledTools: [], knowledgeSources: [] })
  expect(capture.enabledTools).toBeUndefined()
  expect(capture.knowledgeSources).toBeUndefined()
  expect(capture.contextPolicy).toBeNull()
  expect(capture.toolDeclarationMode).toBeNull()
  expect(captureConversationScenePlan({ ...conversation, resourceScopeOverride: {
    schema: 'islemind.conversation-resource-scope.v1', tools: 'none', knowledge: 'none' } })).toMatchObject({ enabledTools: [], knowledgeSources: [] })
})

test('later explicit skill/resource edits update an existing restriction while old records keep their original semantics', () => {
  const updates = { enabledTools: ['server/read'], knowledgeSources: ['Source A'] }
  expect(applyConversationResourceSelectionUpdates(conversation, updates)).toBe(updates)
  const scoped = { ...conversation, resourceScopeOverride: { schema: 'islemind.conversation-resource-scope.v1' as const, tools: 'none' as const, knowledge: 'none' as const } }
  const next = applyConversationResourceSelectionUpdates(scoped, updates)
  expect(next.resourceScopeOverride).toEqual({ schema: 'islemind.conversation-resource-scope.v1', tools: 'selected', knowledge: 'selected' })
  expect(scoped.resourceScopeOverride.tools).toBe('none')
  expect(applyConversationResourceSelectionUpdates(scoped, { enabledTools: undefined }).resourceScopeOverride?.tools).toBe('none')
})

test('declaration overrides survive later global changes, while resource restrictions cannot enable features', () => {
  const global = { toolDeclarationMode: 'auto' as const, knowledgeEnabled: true, mcpEnabled: false, memoryEnabled: false }
  expect(resolveConversationSceneSettings(global, undefined)).toBe(global)
  const input = { toolDeclarationModeOverride: 'full' as const, resourceScopeOverride: {
    schema: 'islemind.conversation-resource-scope.v1' as const, knowledge: 'none' as const } }
  const captured = resolveConversationSceneSettings(global, input)
  global.knowledgeEnabled = false
  expect(captured).toEqual({ toolDeclarationMode: 'full', knowledgeEnabled: false, mcpEnabled: false, memoryEnabled: false })
  expect(input.toolDeclarationModeOverride).toBe('full')
})

test('variables use typed defaults and require missing values, rejecting conflicting types and unsafe names', () => {
  const skill = { id: 's', variables: [
    { name: 'language', type: 'choice', options: ['en', 'zh'], defaultValue: 'zh' },
    { name: 'count', type: 'number', required: true }, { name: 'topic', type: 'text', required: true },
  ] } as SkillDefinition
  const extract = (item: SkillDefinition) => item.variables!.map(variable => variable.name)
  expect(resolveSceneSkillVariables([skill], { count: 2, topic: 'design' }, extract)).toMatchObject({ variables: { count: 2, topic: 'design', language: 'zh' }, issues: [] })
  expect(resolveSceneSkillVariables([skill], {}, extract).issues).toHaveLength(2)
  expect(resolveSceneSkillVariables([skill], { count: '2', topic: 'design' }, extract).issues[0].kind).toBe('invalid')
  const conflicting = { ...skill, id: 'other', variables: [{ name: 'count', type: 'text' as const }] }
  expect(resolveSceneSkillVariables([skill, conflicting], { count: 2, topic: 'design' }, extract).issues).toContainEqual({ skillId: 'other', name: 'count', kind: 'conflicting' })
  expect(resolveSceneSkillVariables([{ ...skill, variables: [{ name: '__proto__', type: 'text' }] }], {}, extract).issues[0].kind).toBe('invalid')
})

test('publishes after the durable barrier and records provenance without changing historical messages', async () => {
  const f = fixture()
  let finish!: () => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  f.persist.mockImplementationOnce(async next => { started(); await new Promise<void>(resolve => { finish = resolve }); f.persisted.push(next) })
  const pending = f.command(f.input)
  await entered
  expect(f.publish).not.toHaveBeenCalled()
  expect(f.get()).toBe(conversation)
  finish()
  const result = await pending
  expect(result.persisted).toBe(true)
  expect(f.get()?.scenePlanSource).toEqual({ schema: 'islemind.conversation-scene-plan.v1', id: plan.id, name: plan.name, revision: 1, appliedAt: 10 })
  expect(f.get()?.messages).toEqual(conversation.messages)
  expect(f.release).toHaveBeenCalledTimes(1)
  plan.name = 'Edited template'
  expect(f.get()?.scenePlanSource?.name).toBe('Research')
  plan.name = 'Research'
})

test('a failed save leaves the conversation and history intact and releases its lock', async () => {
  const f = fixture()
  f.persist.mockRejectedValueOnce(Error('disk unavailable'))
  await expect(f.command(f.input)).rejects.toThrow('disk unavailable')
  expect(f.get()).toBe(conversation)
  expect(f.publish).not.toHaveBeenCalled()
  expect(f.release).toHaveBeenCalledTimes(1)
})

test.each(['changed', 'busy', 'missing', 'running'] as const)('rejects %s targets before any write', async kind => {
  const f = fixture()
  if (kind === 'changed') f.set({ ...conversation, systemPrompt: 'External edit', updatedAt: 2 })
  if (kind === 'busy') f.busy()
  if (kind === 'missing') f.set(undefined)
  if (kind === 'running') f.set({ ...conversation, messages: [{ ...conversation.messages[0], status: 'streaming' }] })
  await expect(f.command(f.input)).rejects.toThrow()
  expect(f.persist).not.toHaveBeenCalled()
  expect(f.publish).not.toHaveBeenCalled()
})

test('rejects a configuration changed while validation awaits and cancels before writing', async () => {
  const f = fixture()
  f.input.validate.mockImplementationOnce(async () => { f.set({ ...conversation, model: 'changed' }); return true })
  await expect(f.command(f.input)).rejects.toThrow('conversation_scene_plan_conflict')
  expect(f.persist).not.toHaveBeenCalled()
  const g = fixture()
  const controller = new AbortController()
  g.input.validate.mockImplementationOnce(async () => { controller.abort(); return true })
  await expect(g.command({ ...g.input, signal: controller.signal })).rejects.toThrow()
  expect(g.persist).not.toHaveBeenCalled()
})

test('cancellation after persistence still publishes the committed result', async () => {
  const f = fixture()
  const controller = new AbortController()
  f.persist.mockImplementationOnce(async next => { f.persisted.push(next); controller.abort() })
  await expect(f.command({ ...f.input, signal: controller.signal })).resolves.toMatchObject({ persisted: true })
  expect(f.publish).toHaveBeenCalledTimes(1)
})

test('new unsent drafts are published locally and never enter the persistence or send path', async () => {
  const f = fixture()
  const draft = { ...conversation, id: 'new', title: '', messages: [] }
  await expect(f.command({ ...f.input, conversationId: draft.id, expectedRevision: conversationScenePlanRevision(draft), newDraft: draft }))
    .resolves.toMatchObject({ persisted: false })
  expect(f.persist).not.toHaveBeenCalled()
  expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', messages: [] }), true)
})

test('snapshots and branches retain bounded preferences and copies but reject unsupported scope/provenance', () => {
  const applied = applyConversationScenePlanPatch(conversation, { toolDeclarationModeOverride: 'auto',
    resourceScopeOverride: { schema: 'islemind.conversation-resource-scope.v1', knowledge: 'none', tools: 'none' },
    scenePlanSource: { schema: 'islemind.conversation-scene-plan.v1', id: 'scene', name: 'Research', revision: 1, appliedAt: 2 } }, 2)
  expect(parseConversationSnapshot(applied)).toMatchObject({ resourceScopeOverride: applied.resourceScopeOverride, scenePlanSource: applied.scenePlanSource, toolDeclarationModeOverride: 'auto' })
  const branch = createConversationBranchDraft(applied, 'answer', { id: 'branch', title: 'Branch', now: 3 })!
  expect(branch.resourceScopeOverride).toEqual(applied.resourceScopeOverride)
  expect(branch.resourceScopeOverride).not.toBe(applied.resourceScopeOverride)
  expect(branch.scenePlanSource).not.toBe(applied.scenePlanSource)
  expect(parseConversationSnapshot({ ...applied, resourceScopeOverride: { schema: 'future', tools: 'all' } })).toBeUndefined()
  expect(parseConversationSnapshot({ ...applied, scenePlanSource: { ...applied.scenePlanSource, revision: 0 } })).toBeUndefined()
  expect(() => applyConversationScenePlanPatch(conversation, { messages: [] } as never, 2)).toThrow('conversation_scene_plan_invalid')
})
