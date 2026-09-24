// Regression: real Harness + Rich composition, isolated persistence/fake transport; no device or live model evidence.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createAssistantRuntime } from '../src/modules/assistant-runtime/runtime.ts';
import { createInMemoryRunStore } from '../src/modules/assistant-runtime/testing/inMemoryRunStore.ts';
import { createAssistantConversationDurableExecutionRuntime } from '../src/modules/assistant-runtime/application/assistantConversationDurableExecutionRuntime.ts';
const persistence = createInMemoryRunStore();
const coreRuntime = createAssistantRuntime({ clock: { now: () => 1 }, ids: { next: x => x + '-id' }, persistence, providerGateway: { describe: () => undefined, async *stream() {} } });
mock.module('../src/bootstrap/applicationAssistantRuntime.ts', () => ({ applicationAssistantRuntime: coreRuntime, assistantRunPersistence: persistence }));
mock.module('../src/bootstrap/providerRuntime.ts', () => ({ createProviderRuntimeAdapter: () => ({}), streamProviderChat: () => { throw new Error('unexpected provider'); }, toRuntimeChatRequest: () => ({}) }));
mock.module('../src/bootstrap/conversationAssistantProviderDispatchRuntime.ts', () => ({ conversationAssistantProviderDispatchRuntime: {} }));
mock.module('../src/bootstrap/conversationAssistantMessageProjection.ts', () => ({ projectConversationAssistantFailure() {} }));
mock.module('../src/i18n/service.ts', () => ({ st: x => x }));
mock.module('../src/store/chatStore.ts', () => ({ useChatStore: { getState: () => ({ conversations: [] }) } }));
const { createConversationAssistantDurableExecutionRuntime } = await import('../src/bootstrap/conversationAssistantDurableExecutionRuntime.ts');
const results = [];
for (const operation of ['pause','cancel','external']) {
  const caller = new AbortController();
  let resolveDone;
  const providerDone = new Promise(r => resolveDone = r);
  let transportSignal;
  const events = [];
  const id = 'rich-'+operation+'-proof';
  const unsubscribe = coreRuntime.subscribe(({run, journalEntry}) => { if (run.id === id) events.push(journalEntry?.type+':'+run.status); });
  const provider = { id: 'fixture', type: 'openai', name: 'Fixture', enabled: true, apiKey: '', models: ['gpt-4o'] };
  const context = { schema: 'islemind.context-snapshot.v1', id: 'snapshot', createdAt: 1, conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] };
  const bridge = createConversationAssistantDurableExecutionRuntime({
    durableExecutionRuntime: createAssistantConversationDurableExecutionRuntime({ ids: { next: x => x + '-id' }, activityRuntime: coreRuntime }),
    providerDispatchRuntime: {
      prepare(input) { return { request: { provider, conversationId: 'conv', model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }], attachments: [], maxTokens: 100, generationParameterSources: {}, webSearchMode: 'off' } }; },
      async dispatchPrepared(input, prepared) {
        input.buildStreamLifecycle({});
        transportSignal = prepared.request.signal;
        if (transportSignal !== input.requestController.signal) throw new Error('Mismatched dispatch signals');
        transportSignal.addEventListener('abort', () => resolveDone());
        return { kind: 'dispatched', streamingOutcome: { kind: 'started', handle: { controller: input.requestController, done: providerDone } } };
      }
    },
    createContextSnapshot: async () => ({ ok: true, value: { snapshot: context } }), projectStartFailure() { throw new Error('unexpected start failure'); }
  });
  const dispatched = await bridge.dispatch({ runId: id, conversationId: 'conv', assistantMessageId: 'answer', provider, upstreamModel: 'gpt-4o', requestController: caller, sourceMessages: [{ id: 'user', role: 'user', content: 'hello' }], attachments: [], retrievalSources: [], approvedToolContextIds: [], contextPrompt: '', requestText: 'hello', settings: {}, fallbackProviders: [], webSearchMode: 'off', buildStreamLifecycle: () => ({ complete: async () => ({kind:'completed',output:'answer'}), completionFailed() {}, providerFailed() {}, startFailed() {} }) });
  if (dispatched.kind !== 'dispatched') throw new Error('not started');
  if (operation === 'external') caller.abort();
  else await coreRuntime[operation](id, 'budget_exhausted');
  const completion = await dispatched.completion;
  await new Promise(r => setTimeout(r, 0));
  results.push({ operation, callerAborted: caller.signal.aborted, transportAborted: transportSignal.aborted, completion: completion.ok ? completion.value.status : completion.error.code, savedStatus: (await coreRuntime.getRun(id))?.status, events });
  unsubscribe();
}

for (const item of results) { const expected = item.operation === 'pause' ? 'paused' : 'cancelled'; assert.equal(item.savedStatus, expected); assert.equal(item.completion, expected); assert.equal(item.transportAborted, true); assert.equal(item.callerAborted, item.operation === 'external'); }

console.log("Rich pause/cancel directionality regressions passed (host bridge; no native/live provider).");
