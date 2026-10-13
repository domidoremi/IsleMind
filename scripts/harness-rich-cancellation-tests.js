// Regression: real Harness + Rich composition, isolated persistence/fake transport; no device or live model evidence.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createAssistantRuntime } from '../src/modules/assistant-runtime/runtime.ts';
import { createInMemoryRunStore } from '../src/modules/assistant-runtime/testing/inMemoryRunStore.ts';
import { createAssistantConversationDurableExecutionRuntime } from '../src/modules/assistant-runtime/application/assistantConversationDurableExecutionRuntime.ts';
const persistence = createInMemoryRunStore();
const projectedConversations = [];
const coreRuntime = createAssistantRuntime({ clock: { now: () => 1 }, ids: { next: x => x + '-id' }, persistence, providerGateway: { describe: () => undefined, async *stream() {} } });
mock.module('../src/bootstrap/applicationAssistantRuntime.ts', () => ({ applicationAssistantRuntime: coreRuntime, assistantRunPersistence: persistence }));
mock.module('../src/bootstrap/providerRuntime.ts', () => ({ createProviderRuntimeAdapter: () => ({}), streamProviderChat: () => { throw new Error('unexpected provider'); }, toRuntimeChatRequest: () => ({}) }));
mock.module('../src/bootstrap/conversationAssistantProviderDispatchRuntime.ts', () => ({ conversationAssistantProviderDispatchRuntime: {} }));
mock.module('../src/bootstrap/conversationAssistantMessageProjection.ts', () => ({ projectConversationAssistantFailure() {} }));
mock.module('../src/i18n/service.ts', () => ({ st: x => x }));
mock.module('../src/store/chatStore.ts', () => ({ useChatStore: { getState: () => ({ conversations: projectedConversations }) } }));
mock.module('../src/store/chatStreamingStore.ts', () => ({ useChatStreamingStore: { getState: () => ({ activeStreams: new Map() }) } }));
mock.module('../src/presentation/features/conversations/plainChatProjection.ts', () => ({ projectPendingModelOperation() { throw new Error('Unexpected confirmation in cancellation fixture'); } }));
const { createConversationAssistantDurableExecutionRuntime } = await import('../src/bootstrap/conversationAssistantDurableExecutionRuntime.ts');
const results = [];
for (const operation of ['pause','cancel','external','ui-stop']) {
  const caller = new AbortController();
  let resolveDone;
  const providerDone = new Promise(r => resolveDone = r);
  let transportSignal;
  let providerRequest;
  const events = [];
  const id = 'rich-'+operation+'-proof';
  const unsubscribe = coreRuntime.subscribe(({run, journalEntry}) => { if (run.id === id) events.push(journalEntry?.type+':'+run.status); });
  const provider = { id: 'fixture', type: 'openai', name: 'Fixture', enabled: true, apiKey: '', models: ['gpt-4o'] };
  const context = { schema: 'islemind.context-snapshot.v1', id: 'snapshot', createdAt: 1, conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] };
  const bridge = createConversationAssistantDurableExecutionRuntime({
    durableExecutionRuntime: createAssistantConversationDurableExecutionRuntime({ ids: { next: x => x + '-id' }, activityRuntime: coreRuntime }),
    providerDispatchRuntime: {
      prepare(input) { return { request: { provider, conversationId: 'conv', model: 'gpt-4o', systemPrompt: 'system', contextPrompt: 'retrieved context', messages: [{ role: 'user', content: 'hello' }], attachments: [], maxTokens: 100, generationParameterSources: {}, webSearchMode: 'off' } }; },
      async dispatchPrepared(input, prepared) {
        assert.equal(prepared.request.generationParameterSources.maxTokens, 'internal-policy');
        assert.equal(prepared.request.maxTokens, 100);
        providerRequest = prepared.request;
        input.buildStreamLifecycle({});
        transportSignal = prepared.request.signal;
        if (transportSignal !== input.requestController.signal) throw new Error('Mismatched dispatch signals');
        transportSignal.addEventListener('abort', () => resolveDone());
        return { kind: 'dispatched', streamingOutcome: { kind: 'started', handle: { controller: input.requestController, done: providerDone } } };
      }
    },
    createContextSnapshot: async () => ({ ok: true, value: { snapshot: context } }), projectStartFailure() { throw new Error('unexpected start failure'); }
  });
  const modelOperationSession = operation === 'pause' ? {
    prepareRequest(request) { return { ...request, systemPrompt: request.systemPrompt + '\n\nMODEL_OPERATION_CATALOG_JSON=fixture' }; },
    evaluateTurn() { throw new Error('Cancelled fixture must not evaluate a model turn'); },
  } : undefined;
  const dispatched = await bridge.dispatch({ runId: id, conversationId: 'conv', assistantMessageId: 'answer', provider, upstreamModel: 'gpt-4o', requestController: caller, sourceMessages: [{ id: 'user', role: 'user', content: 'hello' }], attachments: [], retrievalSources: [], approvedToolContextIds: [], contextPrompt: '', requestText: 'hello', settings: {}, modelOperationSession, fallbackProviders: [], webSearchMode: 'off', buildStreamLifecycle: () => ({ complete: async () => ({kind:'completed',output:'answer'}), completionFailed() {}, providerFailed() {}, startFailed() {} }) });
  if (dispatched.kind !== 'dispatched') throw new Error('not started');
  assert.equal(providerRequest.systemPrompt, operation === 'pause' ? 'system\n\nretrieved context\n\nMODEL_OPERATION_CATALOG_JSON=fixture' : 'system');
  assert.equal(providerRequest.contextPrompt, operation === 'pause' ? undefined : 'retrieved context', 'Canonical context must not be sent twice');
  if (operation === 'external') caller.abort();
  else if (operation === 'ui-stop') {
    projectedConversations.push({ id: 'conv', messages: [{ id: 'answer', status: 'cancelled' }] });
    dispatched.providerDispatchOutcome.streamingOutcome.handle.controller.abort();
  }
  else await coreRuntime[operation](id, 'budget_exhausted');
  const completion = await dispatched.completion;
  await new Promise(r => setTimeout(r, 0));
  results.push({ operation, callerAborted: caller.signal.aborted, transportAborted: transportSignal.aborted, completion: completion.ok ? completion.value.status : completion.error.code, savedStatus: (await coreRuntime.getRun(id))?.status, events });
  unsubscribe();
  projectedConversations.length = 0;
}

for (const item of results) { const expected = item.operation === 'pause' ? 'paused' : 'cancelled'; assert.equal(item.savedStatus, expected); assert.equal(item.completion, expected); assert.equal(item.transportAborted, true); assert.equal(item.callerAborted, item.operation === 'external' || item.operation === 'ui-stop'); }

// Tagged proposals have no provider-native tool-call event. They must still
// enter the same Harness evaluator; ordinary prose must not start a tool turn.
for (const tagged of [false, true]) {
  let evaluated = 0;
  let finishProvider;
  const done = new Promise(resolve => { finishProvider = resolve; });
  const text = tagged ? '<islemind_tool_call>{}</islemind_tool_call>' : 'ordinary answer';
  const provider = { id: 'fixture', type: 'openai', name: 'Fixture', enabled: true, models: ['gpt-4o'] };
  const bridge = createConversationAssistantDurableExecutionRuntime({
    durableExecutionRuntime: createAssistantConversationDurableExecutionRuntime({ ids: { next: x => x + '-id' }, activityRuntime: coreRuntime }),
    providerDispatchRuntime: {
      prepare() { return { request: { provider, conversationId: 'conv', model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }], attachments: [], maxTokens: 100, generationParameterSources: {}, webSearchMode: 'off' } }; },
      async dispatchPrepared(input) {
        const lifecycle = input.buildStreamLifecycle({});
        Promise.resolve().then(() => lifecycle.complete({ text }, {})).then(finishProvider, finishProvider);
        return { kind: 'dispatched', streamingOutcome: { kind: 'started', handle: { controller: input.requestController, done } } };
      },
    },
    createContextSnapshot: async () => ({ ok: true, value: { snapshot: { schema: 'islemind.context-snapshot.v1', id: 'snapshot', createdAt: 1, conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } } }),
    projectStartFailure() { throw new Error('Unexpected tagged bridge failure'); },
  });
  const dispatched = await bridge.dispatch({ runId: 'rich-tagged-' + tagged, conversationId: 'conv', assistantMessageId: 'answer', provider, upstreamModel: 'gpt-4o', requestController: new AbortController(), sourceMessages: [{ id: 'user', role: 'user', content: 'hello' }], attachments: [], retrievalSources: [], approvedToolContextIds: [], contextPrompt: '', requestText: 'hello', settings: {}, fallbackProviders: [], webSearchMode: 'off',
    modelOperationSession: { prepareRequest: request => request, async evaluateTurn(input) { evaluated++; assert.equal(input.outputText, text); assert.equal(input.calls.length, 0); return { kind: 'no-operation' }; } },
    buildStreamLifecycle: () => ({ complete: async result => ({ kind: 'completed', output: result.text }), completionFailed() {}, providerFailed() {}, startFailed() {} }),
  });
  assert.equal(dispatched.kind, 'dispatched');
  const completion = await dispatched.completion;
  assert.equal(completion.ok, true);
  assert.equal(evaluated, tagged ? 1 : 0, 'Tagged output must reach the Harness without a native tool-call event');
}

console.log("Rich canonical prompt and pause/cancel directionality regressions passed (host bridge; no native/live provider).");
