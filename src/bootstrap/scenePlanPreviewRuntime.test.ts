import type { ScenePlan } from '@/core'
import { createConversationScenePlanCommand, createConversationSkillPolicy, type ConversationSkillPolicyDependencies } from '@/modules/conversations'
import type { Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ScenePlanCatalog } from '@/presentation/features/settings/scenePlanWorkspacePort'
import { createScenePlanPreviewRuntime } from './scenePlanPreviewRuntime'

const scene: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'research', name: 'Research', revision: 1, configuration: {
  model: { target: { providerId: 'a', model: 'model' } }, enabledTools: ['mcp:server:read'], knowledgeSources: ['document-a'], toolDeclarationMode: 'auto',
} }
const original: Conversation = { id: 'c', title: 'Existing work', providerId: 'a', model: 'model', systemPrompt: 'Original',
  temperature: 0.6, maxTokens: 1000, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'm', role: 'user', content: 'Retain this message', status: 'done', timestamp: 1 }] }

function fixture(plan = scene) {
  let settings = { scenePlans: [JSON.parse(JSON.stringify(plan))], toolDeclarationMode: 'full', mcpEnabled: false,
    knowledgeEnabled: false, skillsEnabled: true } as Settings
  let providers = [{ id: 'a', name: 'A', type: 'openai', baseUrl: 'https://fixture.invalid', apiKey: '', enabled: true, models: ['model'] }] as AIProvider[]
  let current: Conversation | undefined = original
  let catalog: ScenePlanCatalog = { tools: [{ id: 'mcp:server:read', name: 'read', serverId: 'server', serverName: 'Source server',
    description: 'Read synthetic data', source: 'mcp', permission: 'read-only', enabled: true }],
    knowledge: [{ value: 'document-a', label: 'Source A' }], skills: [], skillVariables: {} }
  const writes: Conversation[] = []
  const publish = jest.fn((next: Conversation) => { current = next })
  const persist = jest.fn(async (next: Conversation, _revision: string, validate: () => Promise<boolean>) => {
    if (!await validate()) throw Error('conversation_scene_plan_conflict')
    writes.push(next)
  })
  const skillPolicy = createConversationSkillPolicy({
    now: () => 1, createSkillId: () => 'skill', translate: key => key, sanitizeSkillForPortable: skill => skill,
    resolveProviderModelAlias: (_provider, model) => model,
    resolveGenerationParameterRanges: () => ({ temperature: { min: 0, max: 2 }, topP: { min: 0, max: 1 },
      topK: { min: 0, max: 100 }, maxTokens: { min: 1, max: 8192 } }), clampGenerationParameter: (_key, value) => value,
  } as ConversationSkillPolicyDependencies)
  const loadCatalog = jest.fn(async () => catalog)
  const command = createConversationScenePlanCommand({ read: id => current?.id === id ? current : undefined,
    isBusy: () => false, isDraft: () => false, acquireLock: () => () => undefined, persist, publish, now: () => 10 })
  let access = true
  const runtime = createScenePlanPreviewRuntime({
    settings: () => settings, providers: () => providers, readConversation: async id => current?.id === id ? current : undefined,
    catalog: loadCatalog, createSeed: (providerId, model) => ({ ...original, id: 'new', title: '', providerId, model, messages: [] }),
    applySkills: skillPolicy.applySkillStack, extractVariables: skillPolicy.extractSkillVariables,
    modelIds: provider => provider.models, modelAllowed: () => access, busy: () => false, commit: command, now: () => 3,
  })
  return { runtime, writes, publish, persist, loadCatalog, settings: () => settings, setSettings: (value: Settings) => { settings = value },
    providers: () => providers, setProviders: (value: AIProvider[]) => { providers = value }, catalog: () => catalog,
    setCatalog: (value: ScenePlanCatalog) => { catalog = value }, current: () => current, setCurrent: (value: Conversation | undefined) => { current = value },
    deny: () => { access = false } }
}

test('preview reads local metadata only and application keeps disabled features disabled', async () => {
  const f = fixture()
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  expect(f.writes).toEqual([])
  expect(f.publish).not.toHaveBeenCalled()
  expect(preview.issues).toEqual([])
  expect(preview.warnings.map(warning => warning.kind)).toEqual(['knowledge-disabled', 'mcp-disabled'])
  await f.runtime.apply(preview)
  expect(f.current()).toMatchObject({ enabledTools: ['mcp:server:read'], knowledgeSources: ['document-a'], toolDeclarationModeOverride: 'auto',
    resourceScopeOverride: { tools: 'selected', knowledge: 'selected' } })
  expect(f.current()?.messages).toEqual(original.messages)
  expect(f.settings()).toMatchObject({ mcpEnabled: false, knowledgeEnabled: false, toolDeclarationMode: 'full' })
})

test.each(['template', 'conversation', 'model', 'tool', 'knowledge', 'feature'] as const)('rejects a %s change after preview', async kind => {
  const f = fixture()
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  if (kind === 'template') f.setSettings({ ...f.settings(), scenePlans: [{ ...scene, revision: 2 }] })
  if (kind === 'conversation') f.setCurrent({ ...original, systemPrompt: 'Changed' })
  if (kind === 'model') f.setProviders([{ ...f.providers()[0], models: ['different'] }])
  if (kind === 'tool') f.setCatalog({ ...f.catalog(), tools: [] })
  if (kind === 'knowledge') f.setCatalog({ ...f.catalog(), knowledge: [] })
  if (kind === 'feature') f.setSettings({ ...f.settings(), mcpEnabled: true })
  await expect(f.runtime.apply(preview)).rejects.toThrow('conversation_scene_plan_conflict')
  expect(f.writes).toEqual([])
  expect(f.publish).not.toHaveBeenCalled()
})

test('requires the exact preview object and permits a storage retry without duplicate commits', async () => {
  const f = fixture()
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  await expect(f.runtime.apply({ ...preview })).rejects.toThrow('conversation_scene_plan_conflict')
  f.persist.mockRejectedValueOnce(Error('disk unavailable'))
  await expect(f.runtime.apply(preview)).rejects.toThrow('disk unavailable')
  await f.runtime.apply(preview)
  await expect(f.runtime.apply(preview)).rejects.toThrow('conversation_scene_plan_conflict')
  expect(f.writes).toHaveLength(1)
})

test('keeps the reviewed target, provenance and issues immutable through application', async () => {
  const f = fixture()
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  expect(Reflect.set(preview.plan, 'name', 'A name the user did not review')).toBe(false)
  expect(Reflect.set(preview.before, 'id', 'another-conversation')).toBe(false)
  expect(Reflect.set(preview.issues, '0', { kind: 'busy', label: 'changed' })).toBe(false)
  await f.runtime.apply(preview)
  expect(f.current()).toMatchObject({ id: 'c', scenePlanSource: { id: scene.id, name: scene.name, revision: scene.revision } })
})

test('creates a new unsent draft only on Apply, preserving the captured model', async () => {
  const f = fixture()
  const preview = await f.runtime.preview(scene.id, { kind: 'new' })
  expect(f.current()?.id).toBe('c')
  expect(f.publish).not.toHaveBeenCalled()
  const result = await f.runtime.apply(preview)
  expect(result).toMatchObject({ persisted: false, conversation: { id: 'new', messages: [], providerId: 'a', model: 'model' } })
  expect(f.persist).not.toHaveBeenCalled()
  expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }), true)
})

test('reports missing models/resources and access before enabling Apply', async () => {
  const f = fixture()
  f.setCatalog({ ...f.catalog(), tools: [], knowledge: [] })
  f.deny()
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  expect(preview.issues.map(issue => issue.kind)).toEqual(expect.arrayContaining(['tool-missing', 'knowledge-missing', 'access-blocked']))
  await expect(f.runtime.apply(preview)).rejects.toThrow()
  expect(f.writes).toEqual([])
})

test('resolves qualified tool and unique knowledge labels into exact IDs without accepting ambiguity', async () => {
  const f = fixture({ ...scene, configuration: { ...scene.configuration, enabledTools: ['server/read'], knowledgeSources: ['Source A'] } })
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  expect(preview.after.enabledTools).toEqual(['mcp:server:read'])
  expect(preview.after.knowledgeSources).toEqual(['document-a'])
  const g = fixture({ ...scene, configuration: { ...scene.configuration, enabledTools: ['read'] } })
  g.setCatalog({ ...g.catalog(), tools: [...g.catalog().tools, { ...g.catalog().tools[0], id: 'mcp:other:read', serverId: 'other' }] })
  expect((await g.runtime.preview(scene.id, { kind: 'new' })).issues).toContainEqual({ kind: 'tool-missing', label: 'read' })
})

test('uses current skill definitions, validates defaults, and refuses edits after preview', async () => {
  const f = fixture({ ...scene, configuration: { ...scene.configuration, skillIds: ['skill'], enabledTools: undefined } })
  f.setCatalog({ ...f.catalog(), skills: [{ schema: 'islemind.skill.v1', id: 'skill', name: 'Skill', layer: 'base', tags: [], priority: 1,
    systemPrompt: 'Write in {{language}}.', variables: [{ name: 'language', type: 'text', defaultValue: 'English' }], createdAt: 1, updatedAt: 1 }],
    skillVariables: { skill: [{ name: 'language', type: 'text', defaultValue: 'English' }] } })
  const preview = await f.runtime.preview(scene.id, { kind: 'conversation', conversationId: 'c' })
  expect(preview.after.systemPrompt).toBe('Write in English.')
  expect(preview.after.skillSnapshot?.variables).toEqual({ language: 'English' })
  expect(preview.after.resourceScopeOverride?.tools).toBe('none')
  f.setCatalog({ ...f.catalog(), skills: [{ ...f.catalog().skills[0], systemPrompt: 'Changed instructions' }] })
  await expect(f.runtime.apply(preview)).rejects.toThrow('conversation_scene_plan_conflict')
  expect(f.writes).toEqual([])
})

test('a routing snapshot keeps its backup and consent, and validates the backup reference', async () => {
  const routingPlan = { schema: 'islemind.model-routing-plan.v1' as const, id: 'route', name: 'Preferred', mode: 'fallback' as const,
    primary: { providerId: 'a', model: 'model' }, backup: { providerId: 'b', model: 'backup' }, crossProvider: 'ask' as const }
  const f = fixture({ ...scene, configuration: { model: { target: routingPlan.primary, routingPlan } } })
  const blocked = await f.runtime.preview(scene.id, { kind: 'new' })
  expect(blocked.issues.map(issue => issue.kind)).toContain('provider-missing')
  f.setProviders([...f.providers(), { ...f.providers()[0], id: 'b', models: ['backup'] }])
  const preview = await f.runtime.preview(scene.id, { kind: 'new' })
  routingPlan.backup.model = 'Later routing edit'
  expect(preview.after.routingPlan?.backup?.model).toBe('backup')
  await f.runtime.apply(preview)
  expect(f.current()?.routingPlan?.crossProvider).toBe('ask')
})

test('metadata preview never traverses provider or group credential fields', async () => {
  const f = fixture()
  const provider = { ...f.providers()[0], credentialGroups: [{ id: 'group', enabled: true, availableModels: ['model'] }] } as AIProvider
  Object.defineProperty(provider, 'apiKey', { get() { throw Error('Credential read is forbidden') } })
  Object.defineProperty(provider.credentialGroups![0], 'apiKey', { get() { throw Error('Group credential read is forbidden') } })
  f.setProviders([provider])
  await expect(f.runtime.preview(scene.id, { kind: 'new' })).resolves.toMatchObject({ issues: [] })
})

test('changes during catalog loading are rejected rather than presenting a mixed preview', async () => {
  const f = fixture()
  f.loadCatalog.mockImplementationOnce(async () => { f.setSettings({ ...f.settings(), scenePlans: [{ ...scene, revision: 2 }] }); return f.catalog() })
  await expect(f.runtime.preview(scene.id, { kind: 'new' })).rejects.toThrow('conversation_scene_plan_conflict')
})
