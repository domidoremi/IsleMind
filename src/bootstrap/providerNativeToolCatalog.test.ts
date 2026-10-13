import { CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { Platform } from 'react-native'
import { createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt, type ModelOperationDescriptor } from '@/modules/integrations'
import { createConversationModelOperationSession, type ConversationModelOperationSessionDependencies, type ConversationModelOperationRuntimeInput } from './conversationModelOperationRuntime'
import { listStaticConversationToolCatalog, listApplicationBuiltInToolDescriptors, mergeBuiltInCapabilityToolDescriptors,
  listAppActionToolDescriptors, WORK_ARTIFACT_TOOL_MANIFEST } from '@/modules/integrations'
import { KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST } from '@/modules/knowledge'
import { listAndroidDeviceToolManifests } from '@/services/androidDeviceTools'
import { buildProviderNativeToolDeclarations } from './providerNativeToolDeclarations'
import { extractProviderToolCalls, finalizeProviderToolCalls } from '@/modules/providers'

jest.mock('@/platform/native/androidFileOperations', () => ({ createAndroidFileOperationsPort: () => ({
  isAvailable: () => true, execute: () => { throw new Error('No device operations in declaration tests') },
}) }))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn() }))
jest.mock('@/i18n/service', () => ({ st: (_key: string, _args: unknown, fallback: string) => fallback }))

const originalOS = Platform.OS
Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }))
const manifests = listStaticConversationToolCatalog({
  builtinServerId: 'islemind-builtins', listMcpServers: async () => [],
  getBuiltinServer: () => ({ id: 'islemind-builtins', name: 'IsleMind', status: 'connected', enabled: true, tools: [] }),
  listBuiltinTools: () => mergeBuiltInCapabilityToolDescriptors(listApplicationBuiltInToolDescriptors()),
  listAppActionTools: listAppActionToolDescriptors, listAndroidTools: listAndroidDeviceToolManifests,
}, [KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST, WORK_ARTIFACT_TOOL_MANIFEST])

test.each(['openai-chat', 'openai-responses', 'anthropic', 'google'] as const)('%s declares the complete static catalog without schema loss and round-trips exact names', target => {
  const enabled = manifests.filter(item => item.enabled)
  const result = buildProviderNativeToolDeclarations({ manifests: enabled, target, permissionCeiling: 'destructive', maxTools: 64 })
  expect(result.skipped).toEqual([])
  expect(result.toolNameMap).toHaveLength(enabled.length)
  expect(new Set(result.toolNameMap.map(item => item.providerName)).size).toBe(enabled.length)
  const declarations = (target === 'google' ? (result.tools[0] as any).functionDeclarations : result.tools) as any[]
  declarations.forEach((declaration, index) => {
    const tool = declaration.function ?? declaration
    const schema = tool.parameters ?? tool.input_schema ?? tool.parametersJsonSchema
    expect(tool.name).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
    if (enabled[index].inputSchema) expect(schema).toEqual(enabled[index].inputSchema)
    const response = target === 'anthropic' ? { content: [{ type: 'tool_use', id: 'call', name: tool.name, input: {} }] }
      : target === 'google' ? { candidates: [{ content: { parts: [{ functionCall: { name: tool.name, args: {} } }] } }] }
        : { choices: [{ message: { tool_calls: [{ id: 'call', function: { name: tool.name, arguments: '{}' } }] } }] }
    const parsed = finalizeProviderToolCalls(extractProviderToolCalls(response, target === 'anthropic' ? 'anthropic' : target === 'google' ? 'google' : 'openai'))!
    expect(result.toolNameMap.find(item => item.providerName === parsed[0].name)?.toolId).toBe(enabled[index].id)
  })
})

test('schema credential fields remain valid definitions, not trace-redacted strings', () => {
  const schema = { type: 'object', properties: { apiKey: { type: 'string', default: 'private-example' },
    default: { type: 'boolean' }, authorization: { type: 'string' } }, required: ['apiKey'] }
  const result = buildProviderNativeToolDeclarations({ manifests: [{ id: 'schema-test', name: 'schema_test', source: 'mcp',
    enabled: true, permission: 'read-only', description: 'Synthetic schema', inputSchema: schema }], target: 'openai-chat' })
  expect((result.tools[0] as any).function.parameters).toEqual({ type: 'object', properties: {
    apiKey: { type: 'string' }, default: { type: 'boolean' }, authorization: { type: 'string' },
  }, required: ['apiKey'] })
})


test('all frozen Harness names survive native declaration unchanged, including truncated separators', async () => {
  const descriptors = manifests.filter(item => item.enabled).map(item => ({ id: item.id, name: item.name, description: item.description, permission: item.permission,
    inputSchema: item.inputSchema ?? { type: 'object', properties: {} },
    requiresConfirmation: item.permission !== 'read-only', capabilityScopes: [`source:${item.source}`],
    executor: { kind: item.source, id: item.id }, availability: { status: 'available' },
  })) as ModelOperationDescriptor[]
  descriptors.push({ ...descriptors[0], id: 'a'.repeat(39) + ':__tool', name: 'separator_regression' })
  const created = createModelOperationCatalogSnapshot(descriptors)
  if (!created.ok) throw Error(created.message)
  const tagged = formatTaggedModelOperationPrompt(created.snapshot)
  if (!tagged.ok) throw Error(tagged.message)
  const session = await createConversationModelOperationSession({
    conversation: { id: 'catalog', providerId: 'synthetic', model: 'gpt-4o', messages: [] },
    provider: { id: 'synthetic', type: 'openai', models: ['gpt-4o'], capabilities: { nativeTools: true } },
    settings: { agentWorkflowAllowReadWriteTools: true },
  } as unknown as ConversationModelOperationRuntimeInput, {
    createCatalog: async () => ({ ok: true, catalog: { snapshot: created.snapshot, taggedPrompt: tagged.prompt, manifests } }),
    now: Date.now,
  } as unknown as ConversationModelOperationSessionDependencies)
  const request = session!.prepareRequest({ schema: CHAT_REQUEST_SCHEMA, conversationId: 'catalog', providerId: 'synthetic', model: 'gpt-4o', messages: [], generationParameterSources: {} } as ChatRequest)
  const definitions = request.toolDefinitions!
  expect(definitions).toHaveLength(descriptors.length)
  expect(definitions.some(tool => tool.operationId === 'a'.repeat(39) + ':__tool')).toBe(true)
  const result = buildProviderNativeToolDeclarations({ target: 'openai-chat', permissionCeiling: 'destructive', maxTools: 64,
    manifests: definitions.map(tool => ({ ...tool, id: tool.operationId, source: 'model-operation', enabled: true })) })
  expect(result.skipped).toEqual([])
  expect(result.toolNameMap.map(tool => tool.providerName)).toEqual(definitions.map(tool => tool.name))
})
