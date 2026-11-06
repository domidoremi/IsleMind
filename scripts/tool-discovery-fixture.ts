/** Synthetic qualification fixture. No production provider or capability port is called. */
import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest, type StreamEvent } from '@/core'
import {
  createAssistantRuntime, buildAssistantContextPlanReceipt,
  type AssistantRunPersistence,
} from '@/modules/assistant-runtime'
import {
  createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt,
  MODEL_OPERATION_DISCOVERY_ID, MODEL_OPERATION_DISCOVERY_NAME, type ModelOperationDescriptor,
} from '@/modules/integrations'
import {
  createConversationModelOperationSession,
  type ConversationModelOperationSessionDependencies,
} from '@/bootstrap/conversationModelOperationRuntime'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

export async function runToolDiscoveryFixture(persistence: AssistantRunPersistence, input: {
  protocol: 'native' | 'tagged'
  runId: string
  conversationId: string
}) {
  const native = input.protocol === 'native'
  const provider: AIProvider = { id: 'tool-discovery-fixture', name: '合成工具目录', type: 'openai',
    models: ['gpt-4o'], apiKey: '', enabled: true, capabilities: {
      chat: true, streaming: true, modelList: false, vision: false, files: false, audioInput: false,
      audioTranscription: false, speech: false, nativeSearch: false, reasoningEffort: false, topP: false, nativeTools: native,
    } }
  const conversation: Conversation = {
    id: input.conversationId, title: '工具定义 · 隔离验收', providerId: provider.id, model: 'gpt-4o',
    systemPrompt: '', temperature: 1, maxTokens: 1024, createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ id: 'fixture-user', role: 'user', content: 'Find the synthetic source.', timestamp: Date.now(), status: 'done' }],
  }
  const settings = { toolDeclarationMode: 'auto', agentWorkflowMaxSteps: 8 } as Settings
  const operations: ModelOperationDescriptor[] = Array.from({ length: 24 }, (_, index) => {
    const id = `fixture:source:${String(index).padStart(2, '0')}`
    return { id, name: `Synthetic source ${index}`, description: `Inspect synthetic source ${index} with a complete parameter schema.`,
      inputSchema: { type: 'object', properties: { target: {
        type: 'string', description: 'This target refers only to a synthetic fixture source, with no filesystem or network access. '.repeat(12),
      } }, required: ['target'], additionalProperties: false },
      permission: 'read-only', requiresConfirmation: false, capabilityScopes: ['fixture:source'],
      executor: { kind: 'builtin', id }, availability: { status: 'available' } }
  })
  const created = createModelOperationCatalogSnapshot(operations)
  if (!created.ok) throw new Error(created.message)
  const snapshot = created.snapshot
  const tagged = formatTaggedModelOperationPrompt(snapshot)
  if (!tagged.ok) throw new Error(tagged.message)
  let executions = 0
  const dependencies = {
    createCatalog: async () => ({ ok: true, catalog: { snapshot, taggedPrompt: tagged.prompt,
      manifests: operations.map(operation => ({ ...operation, source: 'builtin', enabled: true })) } }),
    async executeExternal(value: Parameters<ConversationModelOperationSessionDependencies['executeExternal']>[0]) {
      const authorization = value.modelOperationAuthorization
      if (value.request.toolId !== 'fixture:source:03' || !authorization
        || !authorization.policy.verify(authorization.attestation, authorization.expected)) throw new Error('Fixture authority mismatch')
      executions++
      return { observation: { ok: true, output: 'Synthetic source content; no user data was read.',
        metadata: { taskId: 'fixture-task-receipt', taskStatus: 'succeeded' } } }
    },
    executeInternal: async () => { throw new Error('The fixture has no internal executor') },
    declinePendingTask: async () => ({ ok: true }),
    createRagRuntime: async () => ({}),
    now: Date.now,
  } as unknown as ConversationModelOperationSessionDependencies
  const session = (await createConversationModelOperationSession({ conversation, provider, settings }, dependencies))!
  const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: conversation.id, providerId: provider.id, model: 'gpt-4o',
    systemPrompt: 'Use only the explicitly supplied synthetic catalog.', generationParameterSources: {},
    messages: [{ id: 'fixture-user', role: 'user', text: 'Find synthetic source 3.' }] }
  const contextReceipt = buildAssistantContextPlanReceipt({ providerId: provider.id, model: 'gpt-4o',
    plan: { manifest: { budget: {
      modelContextWindow: 128_000, requestBudgetTokens: 80_000, fixedTokens: 200, messageTokens: 100,
      contextPromptTokens: 200, estimatedInputTokens: 300, includedFragmentTokens: 300, originalFragmentTokens: 300,
      totalTokenCap: 80_200, activeContextTokens: 300, tokensUntilCompaction: 79_900,
    }, fragments: [
      { fragmentId: 'system', type: 'system', priority: 'critical', sourceId: 'fixture-system',
        decision: 'included', tokenCap: 200, estimatedTokens: 200, originalEstimatedTokens: 200 },
      { fragmentId: 'messages', type: 'recent_messages', priority: 'critical', sourceId: 'fixture-user',
        decision: 'included', tokenCap: 80_000, estimatedTokens: 100, originalEstimatedTokens: 100 },
    ] } } })
  const requests: ChatRequest[] = []
  const runtime = createAssistantRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => input.runId },
    providerGateway: { describe: () => undefined, async *stream(current): AsyncGenerator<StreamEvent> {
      requests.push(current)
      const id = requests.length === 1 ? MODEL_OPERATION_DISCOVERY_ID : 'fixture:source:03'
      if (requests.length > 2) { yield { type: 'text-delta', text: 'Synthetic discovery and source read completed.' }; return }
      const args = requests.length === 1 ? { query: 'fixture:source:03' } : { target: 'synthetic-source' }
      if (native) {
        const tool = current.toolDefinitions?.find(definition => definition.operationId === id)
        if (!tool) throw new Error('Fixture operation was not declared')
        yield { type: 'tool-call', toolCallId: `fixture-call-${requests.length}`, toolName: tool.name,
          arguments: requests.length === 1 ? { query: 'fixture:source:03' } : { target: 'synthetic-source' } }
      } else yield { type: 'text-delta', text: `<islemind_tool_call>${JSON.stringify({
        schema: 'islemind.model-tool-call.v1', catalogRevision: snapshot.revision, operationId: id, arguments: args,
      })}</islemind_tool_call>` }
    } } })
  const runId = asAssistantRunId(input.runId)
  const result = await runtime.execute({ runId, request, contextReceipt, modelOperationSession: session,
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId(`context-${input.runId}`), createdAt: Date.now(),
      conversationMessageIds: ['fixture-user'], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
  if (!result.ok || result.value.status !== 'succeeded' || executions !== 1 || requests.length !== 3) throw new Error('Synthetic discovery loop did not complete')
  const captured = await persistence.getRequestSnapshot(runId)
  if (captured?.schema !== 'islemind.assistant-run-request-snapshot.v1'
    || captured.contextReceipt?.toolDeclarations?.mode !== 'discovery') throw new Error('Declaration receipt did not persist')
  const journal = await persistence.list(runId)
  const activities = await persistence.listOperationActivities?.(runId)
  conversation.messages.push({ id: 'fixture-assistant', role: 'assistant', content: result.value.result?.outputText ?? 'Synthetic source read completed.',
    timestamp: Date.now(), status: 'done', providerId: provider.id, model: 'gpt-4o' })
  return {
    schema: 'islemind.tool-discovery-fixture.v1', synthetic: true, externalServicesUsed: false,
    liveProviderRequests: 0, realCapabilityExecutions: 0, syntheticExecutorCalls: executions,
    protocol: input.protocol, runId, conversation, provider,
    firstDeclarations: captured.contextReceipt.toolDeclarations,
    publishedDeclarations: session.describeDeclarations!(requests[1]),
    finalDeclaredOperationIds: requests[2].toolDefinitions!.map(tool => tool.operationId),
    journalReceiptCount: journal.filter(entry => entry.type === 'model-operation.selected').length,
    activityCount: activities?.entries.length ?? 0, catalogRevision: snapshot.revision,
    declarationSavingCharacters: captured.contextReceipt.toolDeclarations.fullDeclarationChars - captured.contextReceipt.toolDeclarations.declarationChars,
  }
}
