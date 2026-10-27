import {
  createAssistantMcpToolTurnRuntime,
  type AssistantMcpResolvedTool,
  type AssistantMcpToolObservation,
  type AssistantMcpToolRequest,
  type AssistantMcpToolTurnInput,
  type AssistantMcpToolTurnRuntimeDependencies,
  type AssistantTaggedToolManifestLike,
} from './assistantMcpToolTurnRuntime'
import type { ProcessTrace } from '@/core'

type Provider = { id: string; credential: { token: string } }
type Settings = {
  runtimeLogEnabled: boolean
  tools: { readOnly: boolean; maxCalls: number; outputChars: number }
  generation: { maxTokens: number }
}
type Usage = { inputTokens: number; outputTokens: number; totalTokens: number }
type Dependencies = AssistantMcpToolTurnRuntimeDependencies<Provider, Settings, Usage>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

function fixture() {
  const controller = new AbortController()
  const onStreamEvent = jest.fn()
  const provider: Provider = { id: 'provider', credential: { token: 'fixture-token' } }
  const settings: Settings = {
    runtimeLogEnabled: true,
    tools: { readOnly: true, maxCalls: 2, outputChars: 6400 },
    generation: { maxTokens: 17 },
  }
  const fallbackSettings: Settings = {
    ...copy(settings),
    generation: { maxTokens: 23 },
  }
  const conversation = {
    id: 'durable-conversation', model: 'admitted-model',
    reasoningEffort: { level: 'high' }, untrustedMetadata: { generationOnly: 'admitted' },
  }
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'admitted request' }] }]
  const tool: AssistantMcpResolvedTool = {
    server: { id: 'selected-server', name: 'Selected server', enabled: true, status: 'connected' },
    tool: {
      name: 'selected-tool', description: 'Selected tool', permission: 'read-write', enabled: true,
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  }
  const tools = [tool]
  const manifest: AssistantTaggedToolManifestLike = {
    id: 'builtin:islemind-builtins:search_web', source: 'builtin', name: 'search_web',
    description: 'Search the public web.', permission: 'read-only', enabled: true,
    serverId: 'islemind-builtins', serverName: 'IsleMind', requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['query'] },
  }
  const manifests = [manifest]
  const request: AssistantMcpToolRequest = {
    serverId: 'requested-server', toolName: 'requested-tool', arguments: { query: 'IsleMind' },
  }
  const taskGate = deferred<{ observation: AssistantMcpToolObservation }>()
  const observation: AssistantMcpToolObservation = {
    ok: true, status: 'done', output: 'unbounded raw observation',
    blocks: [{ type: 'text', text: 'raw tool evidence' }],
    diagnostic: { id: 'task-receipt', type: 'tool', title: 'Task', status: 'done', startedAt: 1 },
  }
  const usage: Usage = { inputTokens: 7, outputTokens: 9, totalTokens: 16 }
  const getSettings = jest.fn(() => fallbackSettings)
  const parseRequest = jest.fn((output: string) => output === 'tagged request' ? request : null)
  const findTool = jest.fn((
    selected: readonly AssistantMcpResolvedTool[],
    _request: AssistantMcpToolRequest,
    admittedManifests: readonly AssistantTaggedToolManifestLike[],
    _settings?: Settings,
  ): AssistantMcpResolvedTool | undefined => {
    if (selected[0]) return selected[0]
    const admitted = admittedManifests[0]
    if (!admitted?.enabled) return undefined
    return {
      server: {
        id: admitted.serverId!, name: admitted.serverName!, enabled: true, status: 'connected',
      },
      tool: {
        name: admitted.name, description: admitted.description, permission: admitted.permission,
        inputSchema: admitted.inputSchema, enabled: admitted.enabled,
      },
      manifest: admitted,
    }
  })
  const resolveLimits = jest.fn((value: Settings) => ({
    maxToolCallsPerStep: value.tools.maxCalls,
    outputCharLimit: value.tools.outputChars,
    allowReadOnlyTools: value.tools.readOnly,
    allowReadWriteTools: 'visible' as const,
    allowDestructiveTools: 'confirm' as const,
  }))
  const buildRuntimeLogOptions = jest.fn((value: Settings) => ({ enabled: value.runtimeLogEnabled }))
  const executeTask = jest.fn((_input: Parameters<Dependencies['executeTask']>[0]) => taskGate.promise)
  const buildPendingActionProjection = jest.fn<ReturnType<NonNullable<Dependencies['buildPendingActionProjection']>>,
    Parameters<NonNullable<Dependencies['buildPendingActionProjection']>>>(() => undefined)
  const truncateBlocks = jest.fn<ReturnType<Dependencies['truncateBlocks']>,
    Parameters<Dependencies['truncateBlocks']>>(() => [{ type: 'text', text: 'bounded tool evidence' }])
  const buildRevisionMessages = jest.fn((value: Parameters<Dependencies['buildRevisionMessages']>[0]) => [
    ...value.messages, { role: 'tool', content: value.toolOutput },
  ])
  const resolveGenerationParameters = jest.fn((value: Parameters<Dependencies['resolveGenerationParameters']>[0]) => ({
    temperature: 0.9, topP: 0.8, maxTokens: value.settings.generation.maxTokens,
  }))
  const synthesize = jest.fn(async (_input: Record<string, unknown>) => ({ text: ' synthesized answer ', usage }))
  const recordTrace = jest.fn((_trace: ProcessTrace) => {})
  const runtime = createAssistantMcpToolTurnRuntime<Provider, Settings, Usage>({
    parseRequest, findTool, getSettings, resolveLimits, buildRuntimeLogOptions, executeTask,
    buildPendingActionProjection, truncateBlocks,
    formatBlocks: blocks => blocks.map(block => block.type === 'text' ? block.text : '').join('\n'),
    buildRevisionSystemPrompt: value => `${value}\nMCP revision`,
    buildRevisionMessages, resolveGenerationParameters, synthesize,
    sanitizeAnswer: value => value.trim(), translate: key => key,
    buildTraceMetadata: value => ({ ...value }), completeTrace: value => ({ ...value, completedAt: 2 }),
    recordTrace, traceId: prefix => `${prefix}-${recordTrace.mock.calls.length + 1}`, now: () => 1,
  })
  const input: AssistantMcpToolTurnInput<Provider, AssistantMcpResolvedTool, Settings> = {
    conversationId: 'conversation-store', assistantMessageId: 'assistant-1',
    provider, settings, conversation, messages, tools, manifests,
    systemPrompt: 'admitted system', baseContextPrompt: 'admitted context', firstOutput: 'tagged request',
    signal: controller.signal, onStreamEvent,
  }
  const expected = {
    provider: copy(provider), settings: copy(settings), fallbackSettings: copy(fallbackSettings),
    conversation: copy(conversation), messages: copy(messages), tools: copy(tools), manifests: copy(manifests),
  }
  return {
    controller, onStreamEvent, provider, settings, fallbackSettings, conversation, messages,
    tool, tools, manifest, manifests, request, taskGate, observation, usage, expected,
    getSettings, parseRequest, findTool, resolveLimits, buildRuntimeLogOptions, executeTask,
    buildPendingActionProjection, truncateBlocks, buildRevisionMessages, resolveGenerationParameters,
    synthesize, recordTrace, runtime, input,
  }
}

function mutateCallerData(f: ReturnType<typeof fixture>, label: string) {
  f.provider.id = `${label}-provider`
  f.provider.credential.token = `${label}-token`
  f.conversation.id = `${label}-conversation`
  f.conversation.model = `${label}-model`
  f.conversation.reasoningEffort.level = 'low'
  f.conversation.untrustedMetadata.generationOnly = label
  f.messages[0].content[0].text = label
  f.tool.server.id = `${label}-server`
  f.tool.server.name = label
  f.tool.server.enabled = false
  f.tool.tool.name = `${label}-tool`
  f.tool.tool.permission = 'destructive'
  f.tool.tool.enabled = false
  f.tool.tool.inputSchema!.properties = { changed: true }
  f.manifest.id = `${label}-manifest`
  f.manifest.name = label
  f.manifest.source = 'mcp'
  f.manifest.permission = 'destructive'
  f.manifest.enabled = false
  f.manifest.inputSchema!.required = ['changed']
  for (const value of [f.settings, f.fallbackSettings]) {
    value.runtimeLogEnabled = false
    value.tools.readOnly = false
    value.tools.maxCalls = 99
    value.tools.outputChars = 99999
    value.generation.maxTokens = 999
  }
  f.input.conversationId = `${label}-store`
  f.input.assistantMessageId = `${label}-assistant`
  f.input.systemPrompt = label
  f.input.baseContextPrompt = label
  f.input.firstOutput = label
  f.input.signal = new AbortController().signal
  f.input.onStreamEvent = jest.fn()
}

it.each([
  ['ordinary answer', 'supplied', 0],
  ['ordinary answer', 'fallback', 1],
  ['malformed tagged request', 'supplied', 0],
  ['malformed tagged request', 'fallback', 1],
] as const)('captures %s entry settings from %s without admitting a tagged task', async (firstOutput, source, reads) => {
  const f = fixture()
  f.parseRequest.mockImplementation(output => {
    expect(output).toBe(firstOutput)
    expect(f.getSettings).toHaveBeenCalledTimes(reads)
    return null
  })
  await expect(f.runtime.execute({
    ...f.input, firstOutput, settings: source === 'supplied' ? f.settings : undefined,
  })).resolves.toBeNull()
  expect(f.getSettings).toHaveBeenCalledTimes(reads)
  expect(f.parseRequest).toHaveBeenCalledTimes(1)
  for (const port of [f.findTool, f.resolveLimits, f.executeTask, f.recordTrace,
    f.resolveGenerationParameters, f.synthesize]) expect(port).not.toHaveBeenCalled()
})

it.each(['supplied', 'fallback'] as const)(
  'detaches %s admission before parser and trace callbacks, and retains it across the task await',
  async source => {
    const f = fixture()
    f.parseRequest.mockImplementation(output => {
      expect(output).toBe('tagged request')
      expect(f.getSettings).toHaveBeenCalledTimes(source === 'fallback' ? 1 : 0)
      mutateCallerData(f, 'parser')
      return f.request
    })
    f.recordTrace.mockImplementationOnce(() => mutateCallerData(f, 'observer'))
    const pending = f.runtime.execute({ ...f.input, settings: source === 'supplied' ? f.settings : undefined })
    const [tools, request, manifests, admittedSettings] = f.findTool.mock.calls[0]
    expect(tools).toEqual(f.expected.tools)
    expect(tools).not.toBe(f.tools)
    expect(tools[0].tool.inputSchema).not.toBe(f.tool.tool.inputSchema)
    expect(manifests).toEqual(f.expected.manifests)
    expect(manifests[0].inputSchema).not.toBe(f.manifest.inputSchema)
    expect(request).toBe(f.request)
    expect(admittedSettings).toEqual(source === 'supplied' ? f.expected.settings : f.expected.fallbackSettings)
    expect(admittedSettings).not.toBe(source === 'supplied' ? f.settings : f.fallbackSettings)
    expect(Object.isFrozen(admittedSettings!.tools)).toBe(true)
    expect(f.resolveLimits.mock.calls[0][0]).toBe(admittedSettings)
    expect(f.buildRuntimeLogOptions.mock.calls[0][0]).toBe(admittedSettings)
    expect(f.executeTask).toHaveBeenCalledTimes(1)
    const task = f.executeTask.mock.calls[0][0]
    expect(task.stepId).toBe(
      'tagged-mcp:conversation-store:assistant-1:selected-server:selected-tool:requested-server:requested-tool',
    )
    expect(task.request).toEqual({
      toolId: 'mcp:selected-server:selected-tool', name: 'selected-tool', source: 'mcp',
      serverId: 'selected-server', arguments: { query: 'IsleMind' },
    })
    expect(task.options).toEqual(expect.objectContaining({
      signal: f.controller.signal, intentVisible: true, userConfirmed: false,
      limits: {
        maxToolCallsPerStep: 2, outputCharLimit: 6400, allowReadOnlyTools: true,
        allowReadWriteTools: 'visible', allowDestructiveTools: 'confirm',
      },
      runtimeLog: { enabled: true },
    }))
    expect(task.options).not.toHaveProperty('mode')
    mutateCallerData(f, 'await')
    f.taskGate.resolve({ observation: f.observation })
    await expect(pending).resolves.toEqual({ text: 'synthesized answer', usage: f.usage })
    expect(f.getSettings).toHaveBeenCalledTimes(source === 'fallback' ? 1 : 0)
    const generation = f.resolveGenerationParameters.mock.calls[0][0]
    const revision = f.buildRevisionMessages.mock.calls[0][0]
    const synthesis = f.synthesize.mock.calls[0][0]
    expect(generation.settings).toBe(admittedSettings)
    expect(synthesis.settings).toBe(admittedSettings)
    expect(generation.provider).toEqual(f.expected.provider)
    expect(generation.provider).not.toBe(f.provider)
    expect(generation.provider.credential).not.toBe(f.provider.credential)
    expect(generation.conversation).toEqual(f.expected.conversation)
    expect(generation.conversation).not.toBe(f.conversation)
    expect(revision.conversation).toBe(generation.conversation)
    expect(revision.messages).toEqual(f.expected.messages)
    expect(revision.messages).not.toBe(f.messages)
    expect(revision.toolOutput).toBe('bounded tool evidence')
    expect(f.truncateBlocks).toHaveBeenCalledWith(expect.any(Array), {
      conversationId: 'conversation-store', sourceMessageId: 'assistant-1', authority: 'permissioned-tool',
    })
    expect(synthesis).toEqual(expect.objectContaining({
      provider: generation.provider, model: 'admitted-model', settings: admittedSettings,
      systemPrompt: 'admitted system\nMCP revision', contextPrompt: 'admitted context',
      temperature: 0.4, topP: 0.8, maxTokens: source === 'supplied' ? 17 : 23,
      generationParameterSources: { temperature: 'internal-policy', topP: 'internal-policy', maxTokens: 'internal-policy' },
      conversationId: 'durable-conversation', sessionId: 'durable-conversation',
      reasoningEffort: { level: 'high' }, signal: f.controller.signal,
      onStreamEvent: f.onStreamEvent, stream: false, remoteCompactEligible: false,
    }))
    expect(f.synthesize).toHaveBeenCalledTimes(1)
  },
)

it('routes the detached built-in manifest without borrowing mutated caller identity or confirmation', async () => {
  const f = fixture()
  f.parseRequest.mockImplementation(() => { mutateCallerData(f, 'parser'); return f.request })
  f.taskGate.resolve({ observation: f.observation })
  await expect(f.runtime.execute({ ...f.input, tools: [] })).resolves.toEqual({
    text: 'synthesized answer', usage: f.usage,
  })
  const admitted = f.findTool.mock.calls[0][2][0]
  expect(admitted).toEqual(f.expected.manifests[0])
  expect(admitted).not.toBe(f.manifest)
  const task = f.executeTask.mock.calls[0][0]
  expect(task.request).toEqual({
    toolId: 'builtin:islemind-builtins:search_web', name: 'search_web', source: 'builtin',
    serverId: 'islemind-builtins', arguments: { query: 'IsleMind' },
  })
  expect(task.options).toEqual(expect.objectContaining({
    manifests: [admitted], intentVisible: true, userConfirmed: false, signal: f.controller.signal,
    evidenceSources: ['runtime:tagged-builtin-request'],
  }))
  expect(task.options).not.toHaveProperty('mode')
})

it('keeps destructive intent unconfirmed and returns the exact pending action without synthesis', async () => {
  const f = fixture()
  f.tool.tool.permission = 'destructive'
  const pendingAction = { id: 'pending', reason: 'permission_required', confirmable: true }
  f.buildPendingActionProjection.mockReturnValue({ pendingAction, output: 'Confirm the selected action' })
  f.taskGate.resolve({
    observation: {
      ...f.observation, ok: false, status: 'skipped', errorCode: 'permission_required',
      diagnostic: { ...f.observation.diagnostic, status: 'skipped' },
    },
  })
  await expect(f.runtime.execute(f.input)).resolves.toEqual({ text: 'Confirm the selected action' })
  const task = f.executeTask.mock.calls[0][0]
  expect(task.options).toEqual(expect.objectContaining({
    intentVisible: true, userConfirmed: false, signal: f.controller.signal,
    manifests: [expect.objectContaining({ permission: 'destructive', requiresConfirmation: true })],
  }))
  expect(f.buildPendingActionProjection.mock.calls[0][0].step.toolRequest).toEqual(task.request)
  expect(f.recordTrace.mock.calls.at(-1)![0].metadata?.pendingAction).toBe(pendingAction)
  for (const port of [f.resolveGenerationParameters, f.synthesize, f.truncateBlocks]) {
    expect(port).not.toHaveBeenCalled()
  }
})

it('does not parse, trace or dispatch an already-aborted admitted input', async () => {
  const f = fixture()
  const reason = new Error('original entry cancellation')
  f.controller.abort(reason)
  await expect(f.runtime.execute(f.input)).resolves.toBeNull()
  expect(f.controller.signal.reason).toBe(reason)
  for (const port of [f.parseRequest, f.findTool, f.executeTask, f.recordTrace, f.synthesize]) {
    expect(port).not.toHaveBeenCalled()
  }
})

it('honors original running-trace cancellation even when the parser replaces the caller signal', async () => {
  const f = fixture()
  const reason = new Error('original observer cancellation')
  f.parseRequest.mockImplementation(() => {
    f.input.signal = new AbortController().signal
    return f.request
  })
  f.recordTrace.mockImplementationOnce(() => f.controller.abort(reason))
  await expect(f.runtime.execute(f.input)).resolves.toBeNull()
  expect(f.input.signal.aborted).toBe(false)
  expect(f.controller.signal.reason).toBe(reason)
  expect(f.executeTask).not.toHaveBeenCalled()
  expect(f.synthesize).not.toHaveBeenCalled()
})

it('waits for the admitted task receipt after cancellation without claiming rollback or synthesis', async () => {
  const f = fixture()
  const reason = new Error('original task cancellation')
  const pending = f.runtime.execute(f.input)
  let settled = false
  void pending.then(() => { settled = true })
  f.controller.abort(reason)
  await tick()
  expect(settled).toBe(false)
  expect(f.executeTask.mock.calls[0][0].options.signal).toBe(f.controller.signal)
  f.taskGate.resolve({ observation: f.observation })
  await expect(pending).resolves.toBeNull()
  expect(f.controller.signal.reason).toBe(reason)
  expect(f.recordTrace.mock.calls.at(-1)![0]).toBe(f.observation.diagnostic)
  expect(f.resolveGenerationParameters).not.toHaveBeenCalled()
  expect(f.synthesize).not.toHaveBeenCalled()
})

it('settles a late rejected task after original cancellation without fabricating visible failure', async () => {
  const f = fixture()
  const reason = new Error('original cancellation before rejection')
  const pending = f.runtime.execute(f.input)
  f.controller.abort(reason)
  f.taskGate.reject(new Error('late adapter rejection'))
  await expect(pending).resolves.toBeNull()
  expect(f.controller.signal.reason).toBe(reason)
  expect(f.recordTrace).toHaveBeenCalledTimes(1)
  expect(f.synthesize).not.toHaveBeenCalled()
})

it('retains live synthesis ports but suppresses a late answer after original cancellation', async () => {
  const f = fixture()
  const synthesisGate = deferred<{ text: string; usage: Usage }>()
  f.synthesize.mockImplementation(() => synthesisGate.promise)
  f.taskGate.resolve({ observation: f.observation })
  const pending = f.runtime.execute(f.input)
  await tick()
  expect(f.synthesize).toHaveBeenCalledTimes(1)
  const synthesis = f.synthesize.mock.calls[0][0]
  expect(synthesis.signal).toBe(f.controller.signal)
  expect(synthesis.onStreamEvent).toBe(f.onStreamEvent)
  mutateCallerData(f, 'synthesis-await')
  const reason = new Error('original synthesis cancellation')
  f.controller.abort(reason)
  let settled = false
  void pending.then(() => { settled = true })
  await tick()
  expect(settled).toBe(false)
  expect(f.input.signal.aborted).toBe(false)
  synthesisGate.resolve({ text: 'late answer', usage: f.usage })
  await expect(pending).resolves.toBeNull()
  expect(f.controller.signal.reason).toBe(reason)
  expect(f.recordTrace.mock.calls.map(([trace]) => trace.status)).toEqual(['running', 'done'])
})

it('never exposes raw or bounded observation as chat content when detached synthesis fails', async () => {
  const f = fixture()
  f.taskGate.resolve({ observation: f.observation })
  f.synthesize.mockRejectedValue(new Error('fixture synthesis failed'))
  const result = await f.runtime.execute(f.input)
  expect(result).toEqual({ text: 'chatRunner.error.providerToolSynthesisFailed' })
  expect(result!.text).not.toContain('raw')
  expect(result!.text).not.toContain('bounded tool evidence')
  expect(f.buildRevisionMessages.mock.calls[0][0].toolOutput).toBe('bounded tool evidence')
  expect(f.getSettings).not.toHaveBeenCalled()
  expect(f.recordTrace.mock.calls.at(-1)![0]).toEqual(expect.objectContaining({
    status: 'error', completedAt: 2, content: 'fixture synthesis failed',
  }))
})
