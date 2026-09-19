import type {
  ProviderRuntimeAudioTranscriptionInput,
  ProviderRuntimeChatMessage,
  ProviderRuntimeChatRequest,
  ProviderRuntimeChatStreamRuntime,
  ProviderRuntimeChunkCallback,
  ProviderRuntimeCitationCallback,
  ProviderRuntimeCompletionResult,
  ProviderRuntimeDoneCallback,
  ProviderRuntimeErrorCallback,
  ProviderRuntimeModelTestResult,
  ProviderRuntimeSpeechInput,
  ProviderRuntimeStreamHandle,
  ProviderRuntimeTraceCallback,
  ProviderExecutionTarget,
  ProviderChatExecutionConstraint,
  ProviderModelOperation,
  ProviderModelAvailabilityEvidence,
  ProviderModelListOptions,
  ProviderModelTestOptions,
} from '@/modules/providers'
import type { MessageCitation } from '@/types/contextContracts'
import type {
  ChatReasoningReplayPart,
  ChatRequest as CanonicalChatRequest,
  ChatToolCallProviderMetadata,
  StreamEvent,
} from '@/core'
import {
  createProviderCredentialSynchronization,
  createProviderEmbeddingAdapter,
  resolveProviderEmbeddingModel,
  createProviderMediaAdapter,
  createProviderModelList,
  createProviderModelDiscoveryAdapter,
  createProviderModelTest,
  createProviderProbe,
  createProviderStreamRuntime,
  ProviderHttpError,
  ProviderStreamEventBuffer,
  type ProviderAdapter,
  type ProviderEmbeddingAdapter,
  type ProviderEmbeddingOptions,
  type ProviderEmbeddingResult,
  type ProviderCredentialSynchronization,
  type ProviderMediaAdapter,
  type ProviderModelList,
  type ProviderModelDiscoveryAdapter,
  type ProviderModelTest,
  type ProviderModelTestRequest,
  type ProviderOperationResult,
  type ProviderContentPart,
} from '@/modules/providers'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { parseToolArguments } from '@/modules/integrations'
import { recordProviderUsageAttempt } from '@/bootstrap/usageStatisticsRuntime'
import {
  buildProviderNativeToolDeclarations,
  resolveProviderNativeToolDeclarationTarget,
} from '@/bootstrap/providerNativeToolDeclarations'
import { bindProviderModelAvailabilityOperations } from './providerModelAvailabilityRuntime'

const PROVIDER_REQUEST_TIMEOUT_MS = 18000
const MODEL_TEST_TIMEOUT_MS = 22000
let providerEmbeddingAdapterPromise: Promise<ProviderEmbeddingAdapter> | undefined
let providerCredentialSynchronizationPromise: Promise<ProviderCredentialSynchronization> | undefined
let providerMediaAdapterPromise: Promise<ProviderMediaAdapter> | undefined
let providerModelListPromise: Promise<ProviderModelList> | undefined
let providerModelDiscoveryAdapterPromise: Promise<ProviderModelDiscoveryAdapter> | undefined
let providerModelTestPromise: Promise<ProviderModelTest> | undefined
let providerStreamRuntimePromise: Promise<ProviderRuntimeChatStreamRuntime> | undefined

bindProviderModelAvailabilityOperations({
  async refresh(input) {
    const [{ useSettingsStore }, { providerForRuntimeFallback }, { providerModelAvailabilityRuntime }] = await Promise.all([
      import('@/store/settingsStore'), import('@/modules/providers'), import('./providerModelAvailabilityRuntime'),
    ])
    const checkConfiguration = providerModelAvailabilityRuntime.captureConfiguration()
    checkConfiguration()
    const provider = await useSettingsStore.getState().hydrateProviderKey(input.providerId)
    checkConfiguration()
    if (!provider) throw new Error('Provider no longer exists')
    const sources = input.credentialSource ? [input.credentialSource] : provider.credentialGroups?.length
      ? provider.credentialGroups.filter((group) => group.enabled).map((group) => group.source ?? { kind: 'group' as const, groupId: group.id })
      : [provider.apiKeySource ?? { kind: 'primary' as const }]
    let failed = false
    for (const source of sources) {
      if (input.signal?.aborted) return
      try {
        checkConfiguration()
        const scoped = providerForRuntimeFallback({ provider, model: '' }, { providerId: provider.id, model: '', credentialSource: source })
        const result = await listProviderModelConfigsDetailed(scoped, scoped.apiKey, { forceRefresh: true, signal: input.signal, credentialSource: source })
        if (!result.ok) failed = true
      } catch { failed = true }
    }
    if (failed) throw new Error('Some credential scopes could not be refreshed. Prior trusted availability was preserved.')
  },
  async retest(input) {
    const [{ useSettingsStore }, { chooseCredentialForModel, providerForRuntimeFallback }, { providerModelAvailabilityRuntime }] = await Promise.all([
      import('@/store/settingsStore'), import('@/modules/providers'), import('./providerModelAvailabilityRuntime'),
    ])
    const checkConfiguration = providerModelAvailabilityRuntime.captureConfiguration()
    checkConfiguration()
    const provider = await useSettingsStore.getState().hydrateProviderKey(input.providerId)
    checkConfiguration()
    if (!provider) throw new Error('Provider no longer exists')
    const source = input.credentialSource ?? chooseCredentialForModel(provider, input.model).source
    const scoped = providerForRuntimeFallback({ provider, model: input.model }, { providerId: provider.id, model: input.model, credentialSource: source })
    await testProviderModelRuntime(scoped, input.model, scoped.apiKey, { signal: input.signal, credentialSource: source })
  },
})

export interface ProviderRuntimeAdapterOptions {
  provider: AIProvider
  settings?: ProviderRuntimeChatRequest['settings']
  streamChat?: ProviderStreamChat
  executionConstraint?: ProviderChatExecutionConstraint
}

export type ProviderStreamChat = (
  request: ProviderRuntimeChatRequest,
  onChunk: ProviderRuntimeChunkCallback,
  onDone: ProviderRuntimeDoneCallback,
  onError: ProviderRuntimeErrorCallback,
  onCitations?: ProviderRuntimeCitationCallback,
  onTrace?: ProviderRuntimeTraceCallback,
) => Promise<ProviderRuntimeStreamHandle>

export function createProviderRuntimeAdapter(options: ProviderRuntimeAdapterOptions): ProviderAdapter {
  return {
    providerId: options.provider.id,
    capabilities: providerAdapterCapabilities(options.provider),
    stream(request, gatewayOptions) {
      return streamProviderRuntimeEvents(options, request, gatewayOptions)
    },
  }
}

async function* streamProviderRuntimeEvents(
  options: ProviderRuntimeAdapterOptions,
  request: CanonicalChatRequest,
  gatewayOptions: Parameters<ProviderAdapter['stream']>[1],
): AsyncIterable<StreamEvent> {
  if (gatewayOptions.signal.aborted) return
  const queue = new ProviderRuntimeEventQueue(() => {
    upstreamRequestController.abort(new Error('The provider event buffer is full.'))
    handle?.controller.abort()
  })
  let handle: ProviderRuntimeStreamHandle | undefined
  let producerSettled = false
  let emittedText = ''
  const seenCitations = new Set<string>()
  const streamChat = options.streamChat ?? streamProviderChat
  const runtimeRequest = toRuntimeChatRequest(options, request)
  let executionTarget: ProviderExecutionTarget | undefined
  runtimeRequest.onExecutionTarget = async (target) => {
    if (gatewayOptions.signal.aborted) return
    await gatewayOptions.onExecutionTarget?.(target)
    if (!gatewayOptions.signal.aborted) executionTarget = target
  }
  const upstreamRequestController = new AbortController()
  runtimeRequest.signal = upstreamRequestController.signal
  const abort = () => {
    upstreamRequestController.abort(gatewayOptions.signal.reason)
    handle?.controller.abort(gatewayOptions.signal.reason)
    queue.complete()
  }
  gatewayOptions.signal.addEventListener('abort', abort, { once: true })
  if (gatewayOptions.signal.aborted) abort()

  const producer = (async () => {
    try {
      if (gatewayOptions.signal.aborted) return
      handle = await streamChat(
        runtimeRequest,
        (text) => {
          if (!text || gatewayOptions.signal.aborted) return
          emittedText += text
          queue.push({ type: 'text-delta', text })
        },
        (result) => {
          if (gatewayOptions.signal.aborted) return
          emitMissingFinalText(result, emittedText, (event) => queue.push(event))
          const toolCallEvents = (result.providerToolCalls ?? []).map((call, index): StreamEvent => {
            const providerMetadata = modelOperationProviderMetadata(call)
            return {
              type: 'tool-call',
              toolCallId: call.callId || call.id || `tool-call-${index}`,
              toolName: call.name,
              arguments: parseToolArguments(call.arguments),
              ...(providerMetadata ? { providerMetadata } : {}),
            }
          })
          const reasoningReplay = toChatReasoningReplay(result)
          if (reasoningReplay.length || toolCallEvents.length) {
            queue.push({
              type: 'provider-continuation-state',
              binding: { providerId: executionTarget?.providerId ?? options.provider.id, model: executionTarget?.model ?? request.model },
              reasoningReplay,
            })
          }
          for (const event of toolCallEvents) queue.push(event)
          if (result.usage) {
            queue.push({
              type: 'usage',
              ...(typeof result.usage.inputTokens === 'number' ? { inputTokens: result.usage.inputTokens } : {}),
              ...(typeof result.usage.outputTokens === 'number' ? { outputTokens: result.usage.outputTokens } : {}),
              ...(typeof result.usage.totalTokens === 'number' ? { totalTokens: result.usage.totalTokens } : {}),
              ...(typeof result.usage.cacheCreationInputTokens === 'number' ? { cacheCreationInputTokens: result.usage.cacheCreationInputTokens } : {}),
              ...(typeof result.usage.cacheReadInputTokens === 'number' ? { cacheReadInputTokens: result.usage.cacheReadInputTokens } : {}),
              ...(typeof result.usage.cachedInputTokens === 'number' ? { cachedInputTokens: result.usage.cachedInputTokens } : {}),
              ...(typeof result.usage.reasoningTokens === 'number' ? { reasoningTokens: result.usage.reasoningTokens } : {}),
            })
          }
          for (const citation of result.citations ?? []) {
            emitCitation(citation, seenCitations, (event) => queue.push(event))
          }
        },
        (error) => queue.fail(error),
        (citations) => {
          if (gatewayOptions.signal.aborted) return
          for (const citation of citations) {
            emitCitation(citation, seenCitations, (event) => queue.push(event))
          }
        },
        (trace) => {
          if (gatewayOptions.signal.aborted) return
          queue.push({
            type: 'trace',
            traceId: trace.id,
            traceType: trace.type,
            traceStatus: trace.status,
            ...(trace.title ? { title: trace.title } : {}),
          })
        },
      )
      if (upstreamRequestController.signal.aborted) {
        handle.controller.abort(upstreamRequestController.signal.reason)
      }
      await handle.done
      producerSettled = true
      queue.complete()
    } catch (error) {
      producerSettled = true
      queue.fail(error)
    }
  })()
  void producer.catch(() => undefined)

  try {
    for await (const event of queue) yield event
  } finally {
    gatewayOptions.signal.removeEventListener('abort', abort)
    if (!gatewayOptions.signal.aborted && !producerSettled) {
      upstreamRequestController.abort(new DOMException('Provider stream consumer stopped.', 'AbortError'))
      handle?.controller.abort(new DOMException('Provider stream consumer stopped.', 'AbortError'))
    }
  }
}

class ProviderRuntimeEventQueue implements AsyncIterable<StreamEvent> {
  private readonly values = new ProviderStreamEventBuffer()
  private completion: { error?: unknown } | undefined
  private wake?: () => void

  constructor(private readonly onOverflow: () => void) {}

  push(value: StreamEvent): void {
    if (this.completion) return
    try {
      this.values.push(value, () => undefined)
    } catch (error) {
      this.fail(error)
      this.onOverflow()
      return
    }
    this.wake?.()
    this.wake = undefined
  }

  complete(): void {
    if (this.completion) return
    this.completion = {}
    this.wake?.()
    this.wake = undefined
  }

  fail(error: unknown): void {
    if (this.completion) return
    this.completion = { error }
    this.wake?.()
    this.wake = undefined
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    while (true) {
      const value = this.values.shift()
      if (value !== undefined) {
        yield value.event
        continue
      }
      if (this.completion) {
        if (this.completion.error) throw this.completion.error
        return
      }
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }
}

function providerAdapterCapabilities(provider: AIProvider): ProviderAdapter['capabilities'] {
  const capabilities: NonNullable<ProviderAdapter['capabilities']>[number][] = ['chat']
  if (provider.capabilities?.vision === true) capabilities.push('vision')
  if (provider.capabilities?.files === true) capabilities.push('files')
  if (provider.capabilities?.audioInput === true) capabilities.push('audio')
  if (provider.capabilities?.nativeTools === true) capabilities.push('tools')
  return capabilities
}

export async function streamProviderChat(
  request: ProviderRuntimeChatRequest,
  onChunk: ProviderRuntimeChunkCallback,
  onDone: ProviderRuntimeDoneCallback,
  onError: ProviderRuntimeErrorCallback,
  onCitations?: ProviderRuntimeCitationCallback,
  onTrace?: ProviderRuntimeTraceCallback,
): Promise<ProviderRuntimeStreamHandle> {
  // The request fence is set by Chat admission; generic non-Chat consumers keep
  // their existing contract and do not accidentally acquire another route loop.
  if (!request.executionConstraint) return (await resolveProviderStreamRuntime()).start(request, {
    onChunk, onDone, onError,
    ...(onCitations ? { onCitations } : {}),
    ...(onTrace ? { onTrace } : {}),
  })
  const [{ providerChatResolutionRuntime, chatFallbackConfirmation }, { providerModelAvailabilityRuntime },
    { requiredFallbackCapabilities, providerFailureAvailabilityEvidence }] = await Promise.all([import('./providerChatResolutionRuntime'), import('./providerModelAvailabilityRuntime'), import('@/modules/providers')])
  const signal = request.signal ?? new AbortController().signal
  const selection = await providerChatResolutionRuntime.revalidate(request.executionConstraint, {
    preferred: { providerId: request.provider.id, model: request.requestedModel ?? request.model }, signal,
    settings: request.settings, requiredCapabilities: requiredFallbackCapabilities(request),
    targetCredentialGroupId: request.targetCredentialGroupId,
  })
  if (!selection) {
    if (signal.aborted) return { controller: new AbortController(), done: Promise.resolve() }
    throw new Error('The admitted model route changed before dispatch. Retry to re-evaluate your preference.')
  }
  let active: { operation: ProviderModelOperation; model: string; completed: boolean; evidence?: ProviderModelAvailabilityEvidence } | undefined
  const settle = async () => {
    const previous = active
    active = undefined
    if (previous) await providerModelAvailabilityRuntime.settleExecution(previous.operation, previous.model,
      signal.aborted ? { kind: 'operational', reason: 'cancelled' }
        : previous.evidence ?? (previous.completed ? { kind: 'generation_success' } : { kind: 'operational', reason: 'partial' }))
  }
  const observedRequest: ProviderRuntimeChatRequest = {
    ...request, provider: selection.provider,
    failoverPolicy: { mode: 'ask-before-cross-provider', ...request.failoverPolicy },
    confirmFallback: request.confirmFallback ?? chatFallbackConfirmation(request),
    // An admission fallback already consumed the one route-fallback attempt.
    ...(request.executionConstraint.fallbackUsed ? { allowFallback: false, settings: { ...request.settings, upstreamMaxRetries: 0 } } : {}),
    onExecutionFailure(code) {
      if (active) active.evidence = providerFailureAvailabilityEvidence(code)
      request.onExecutionFailure?.(code)
    },
    async onExecutionTarget(target) {
      await settle()
      const operation = await providerModelAvailabilityRuntime.beginExecution(target, target.attemptId)
      if (target.scope && (target.scope.scopeId !== operation.scopeId || target.scope.epoch !== operation.epoch)) throw new Error('Provider scope changed before dispatch')
      active = { operation, model: target.model, completed: false }
      await request.onExecutionTarget?.({ ...target, scope: { scopeId: operation.scopeId, epoch: operation.epoch } })
    },
  }
  try {
    const handle = await (await resolveProviderStreamRuntime()).start(observedRequest, {
      onChunk,
      onDone(result) { if (active) active.completed = Boolean(result.text?.trim() || result.providerToolCalls?.length); onDone(result) },
      onError(error) {
        const code = 'chatErrorCode' in error ? String(error.chatErrorCode) : 'code' in error ? String(error.code) : ''
        // A terminal error can still describe the original route after a failed fallback.
        if (active) active.evidence ??= providerFailureAvailabilityEvidence(code)
        onError(error)
      },
      ...(onCitations ? { onCitations } : {}), ...(onTrace ? { onTrace } : {}),
    })
    return { ...handle, done: handle.done.catch((error) => {
      if (active) active.evidence ??= { kind: 'operational', reason: 'partial' }
      throw error
    }).finally(settle) }
  } catch (error) {
    if (active) active.evidence ??= { kind: 'operational', reason: 'partial' }
    await settle()
    throw error
  }
}

export async function generateProviderText(request: ProviderRuntimeChatRequest): Promise<string> {
  let text = ''
  let failure: Error | undefined
  const handle = await streamProviderChat(
    { ...request, stream: false },
    (chunk) => { text += chunk },
    (result) => { text = result.text || text },
    (error) => { failure = error },
  )
  await handle.done
  if (failure) throw failure
  return text
}

export async function testProviderModelRuntime(
  provider: AIProvider,
  model: string,
  apiKey: string,
  options: ProviderModelTestOptions = {},
): Promise<ProviderOperationResult<ProviderRuntimeModelTestResult>> {
  return (await resolveProviderModelTest()).testDetailed(provider, model, apiKey, options)
}

export async function synchronizeProviderCredentials(
  provider: AIProvider,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProviderOperationResult<AIProvider>> {
  const synchronization = await resolveProviderCredentialSynchronization()
  return synchronization.synchronize(provider, options)
}

export async function listProviderModelConfigsDetailed(
  provider: AIProvider,
  apiKey: string,
  options: ProviderModelListOptions = {},
): Promise<ProviderOperationResult<AIModel[]>> {
  return (await resolveProviderModelList()).listDetailed(provider, apiKey, options)
}

export async function listProviderModelConfigs(
  provider: AIProvider,
  apiKey: string,
  options: ProviderModelListOptions = {},
) {
  return (await resolveProviderModelList()).list(provider, apiKey, options)
}

export async function listProviderModelIds(
  provider: AIProvider,
  apiKey: string,
  options: ProviderModelListOptions = {},
): Promise<string[]> {
  return (await resolveProviderModelList()).listIds(provider, apiKey, options)
}

export async function discoverProviderModels(
  provider: AIProvider,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AIModel[]> {
  if (provider.apiKeySource) {
    const result = await discoverProviderModelsDetailed(provider, timeoutMs, signal)
    if (result.status === 'cancelled') { const error = new Error('Model discovery cancelled'); error.name = 'AbortError'; throw error }
    if (result.status === 'failure') {
      // Preserve the legacy operation classifier without putting raw response
      // bodies into the evidence envelope or persisted diagnostics.
      if (result.httpStatus !== undefined) throw new ProviderHttpError(result.httpStatus, '', result.retryAfterMs)
      const error = new Error(result.failureReason === 'network' ? 'Network request failed' : `Model discovery failed: ${result.failureReason ?? 'unknown'}`)
      if (result.failureReason === 'timeout') error.name = 'AbortError'
      throw error
    }
    return result.models
  }
  return (await resolveProviderModelDiscoveryAdapter()).discover(provider, {
    timeoutMs,
    ...(signal ? { signal } : {}),
  })
}

export async function discoverProviderModelsDetailed(
  provider: AIProvider,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const { providerModelAvailabilityRuntime, resolveRuntimeModelIdentity } = await import('./providerModelAvailabilityRuntime')
  const checkConfiguration = providerModelAvailabilityRuntime.captureConfiguration()
  checkConfiguration()
  const adapter = await resolveProviderModelDiscoveryAdapter()
  if (!provider.apiKeySource) return adapter.discoverDetailed(provider, { timeoutMs, signal })
  const identity = await resolveRuntimeModelIdentity(provider, provider.models[0] ?? '')
  checkConfiguration()
  return providerModelAvailabilityRuntime.observeDiscovery(identity,
    (operation) => { checkConfiguration(); return adapter.discoverDetailed(provider, { timeoutMs, signal, scope: identity, operation }) })
}

export async function transcribeProviderAudio(request: ProviderRuntimeAudioTranscriptionInput): Promise<string> {
  const operation = () => resolveProviderMediaAdapter().then((adapter) => adapter.transcribe(request))
  return request.provider.type === 'google'
    ? operation()
    : observeDirectProviderOperation(request.provider, request.model ?? 'whisper-1', 'transcription', operation)
}

export async function synthesizeProviderSpeech(request: ProviderRuntimeSpeechInput): Promise<string> {
  return observeDirectProviderOperation(
    request.provider,
    request.model ?? 'gpt-4o-mini-tts',
    'speech',
    () => resolveProviderMediaAdapter().then((adapter) => adapter.synthesize(request)),
  )
}

function resolveProviderMediaAdapter(): Promise<ProviderMediaAdapter> {
  providerMediaAdapterPromise ??= Promise.all([
    import('@/i18n/service'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/types/providerBaseUrls'),
  ]).then(([
    { st },
    { providerCompatibilityCapabilityCanBeSentForProvider },
    { chooseCredentialForModel },
    { getProviderRequestHeaders: getHeaders },
    { fetchProviderWithTimeout: fetchWithTimeout },
    { defaultOpenAICompatibleBaseUrl, normalizeProviderBaseUrl },
    { getProviderConfigIssue },
  ]) => createProviderMediaAdapter({
    selectProvider(provider, model) {
      const credential = chooseCredentialForModel(provider, model)
      return { ...provider, apiKey: credential.apiKey || provider.apiKey }
    },
    validateConfiguration(provider) {
      const issue = getProviderConfigIssue(provider, provider.apiKey)
      return issue ? `${issue.code}: ${st(issue.messageKey ?? issue.message, undefined, issue.message)}` : undefined
    },
    supportsAudio: (provider) => providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true),
    request: (input, init, timeoutMs) => fetchWithTimeout(fetch, input, init, timeoutMs),
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    resolveBaseUrl: (provider) => normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider)),
    resolveHeaders: getHeaders,
    transcribeGoogle: (input) => generateProviderText({
      provider: input.provider,
      model: input.model ?? input.provider.models[0] ?? 'gemini-2.5-flash',
      systemPrompt: '请把用户提供的音频转写为原始文字。只输出转写文本。',
      messages: [{ role: 'user', content: '请转写这段音频。' }],
      attachments: [{
        id: `audio-${Date.now()}`,
        type: 'document',
        uri: '',
        name: input.fileName ?? 'audio.m4a',
        mimeType: input.mimeType,
        size: Math.ceil(input.audioBase64.length * 0.75),
        base64: input.audioBase64,
      }],
      temperature: 0.1,
      maxTokens: 2048,
      generationParameterSources: { temperature: 'internal-policy', maxTokens: 'internal-policy' },
      usageContext: { source: 'transcription' },
    }),
  }))
  return providerMediaAdapterPromise
}

export async function embedProviderText(
  provider: AIProvider,
  text: string,
  options: ProviderEmbeddingOptions = {},
): Promise<ProviderEmbeddingResult> {
  const model = resolveProviderEmbeddingModel(provider) ?? 'embedding-model-unconfigured'
  return observeDirectProviderOperation(
    provider,
    model,
    'embedding',
    () => resolveProviderEmbeddingAdapter().then((adapter) => adapter.embed(provider, text, options)),
  )
}

async function observeDirectProviderOperation<T>(
  provider: AIProvider,
  model: string,
  source: 'embedding' | 'transcription' | 'speech' | 'media',
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await operation()
    void recordProviderUsageAttempt({
      provider,
      upstreamModel: model,
      operationSource: source,
      status: 'success',
      startedAt,
      attempt: 0,
      attemptReason: 'initial',
    })
    return result
  } catch (error) {
    const statusCode = typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined
    void recordProviderUsageAttempt({
      provider,
      upstreamModel: model,
      operationSource: source,
      status: statusCode === 429 ? 'limited' : error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
      ...(statusCode === undefined ? {} : { statusCode }),
      errorCode: statusCode === undefined
        ? error instanceof Error ? error.name : 'request_failed'
        : `http_${statusCode}`,
      startedAt,
      attempt: 0,
      attemptReason: 'initial',
    })
    throw error
  }
}

function resolveProviderEmbeddingAdapter(): Promise<ProviderEmbeddingAdapter> {
  providerEmbeddingAdapterPromise ??= Promise.all([
    import('@/i18n/service'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/types/providerBaseUrls'),
  ]).then(([
    { st },
    { providerCompatibilityCapabilityCanBeSentForProvider },
    { getProviderRequestHeaders: getHeaders },
    { fetchProviderWithTimeout: fetchWithTimeout },
    { defaultOpenAICompatibleBaseUrl, normalizeProviderBaseUrl },
    { getProviderConfigIssue },
  ]) => createProviderEmbeddingAdapter({
    request: (input, init, timeoutMs) => fetchWithTimeout(fetch, input, init, timeoutMs),
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    supportsEmbeddings: (provider) => providerCompatibilityCapabilityCanBeSentForProvider(
      provider,
      'embeddings',
      provider.capabilities?.embeddings === true,
    ),
    configurationIssue(provider) {
      const issue = getProviderConfigIssue(provider, provider.apiKey)
      return issue
        ? `${issue.code}: ${st(issue.messageKey ?? issue.message, undefined, issue.message)}`
        : undefined
    },
    resolveBaseUrl: (provider) => normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider)),
    resolveHeaders: getHeaders,
  }))
  return providerEmbeddingAdapterPromise
}

function resolveProviderCredentialSynchronization(): Promise<ProviderCredentialSynchronization> {
  providerCredentialSynchronizationPromise ??= Promise.all([
    import('@/i18n/service'),
    import('@/modules/providers'),
    import('./providerRegistry'),
  ]).then(([
    { st },
    { runCredentialGroupModelSync },
    { getProviderPreset },
  ]) => createProviderCredentialSynchronization({
    messages: {
      saveTokenGroupFirst: st('providerOperation.saveTokenGroupFirst'),
      defaultToken: st('providerOperation.defaultToken'),
      credentialGroupsSynced: st('providerOperation.credentialGroupsSynced'),
    },
    synchronize(provider, dependencies) {
      return runCredentialGroupModelSync(provider, {
        ...dependencies,
        resolveCapabilities: (source) => getProviderPreset(source.presetId).capabilities,
        messages: {
          defaultToken: st('providerOperation.defaultToken'),
          groupName: (index) => st('apiKeyPanel.groupName', { index }),
          modelsFetched: (count) => st('providerOperation.modelsFetched', { count }),
          modelSyncFailed: st('apiKeyPanel.modelSyncFailed'),
          notSynced: st('providerOperation.notSynced'),
        },
      })
    },
    fetchModels: listProviderModelConfigsDetailed,
  }))
  return providerCredentialSynchronizationPromise
}

function resolveProviderModelList(): Promise<ProviderModelList> {
  providerModelListPromise ??= Promise.all([
    import('@/i18n/service'),
    import('@/modules/providers'),
    import('./providerPolicies'),
    import('./providerResponsePolicies'),
    import('@/types/providerBaseUrls'),
  ]).then(([
    { st },
    { findCredentialGroupIdForKey },
    { getHostedProviderSupportIssue },
    { providerFetchFailure },
    { getProviderConfigIssue },
  ]) => createProviderModelList({
    defaultTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    messages: {
      saveApiKeyFirst: st('providerOperation.saveApiKeyFirst'),
      emptyModels: st('providerOperation.emptyModels'),
      modelsFetched: (count) => st('providerOperation.modelsFetched', { count }),
    },
    configurationIssue(provider, apiKey) {
      const issue = getProviderConfigIssue(provider, apiKey)
      return issue ? {
        code: issue.code === 'bad_base_url' ? 'bad_base_url' : 'credential_mismatch',
        message: st(issue.messageKey ?? issue.message, undefined, issue.message),
      } : undefined
    },
    hostedIssue(provider) {
      const issue = getHostedProviderSupportIssue(provider, 'modelList')
      return issue ? { code: 'models_endpoint_unavailable', message: issue.message } : undefined
    },
    credentialGroupId: findCredentialGroupIdForKey,
    fetchModels: (provider, timeoutMs, signal) => discoverProviderModels(provider, timeoutMs, signal),
    fetchFailure: providerFetchFailure,
  }))
  return providerModelListPromise
}

function resolveProviderModelDiscoveryAdapter(): Promise<ProviderModelDiscoveryAdapter> {
  providerModelDiscoveryAdapterPromise ??= Promise.all([
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('./providerPolicies'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('@/types/providerBaseUrls'),
  ]).then(([
    { providerCompatibilityCapabilityCanBeSentForProvider },
    { getProviderRequestHeaders: getHeaders },
    { fetchProviderWithTimeout: fetchWithTimeout, safeProviderResponseText: safeResponseText },
    { parseProviderJson },
    { mapAnthropicModels, mapGoogleModels, mapOpenAICompatibleModels },
    { defaultOpenAICompatibleBaseUrl, isOpenAICompatibleProvider, normalizeProviderBaseUrl },
    { getProviderConfigIssue },
  ]) => createProviderModelDiscoveryAdapter({
    configurationIssue(provider) {
      const issue = getProviderConfigIssue(provider, provider.apiKey)
      return issue?.messageKey ?? issue?.message
    },
    supportsModelList: (provider) => providerCompatibilityCapabilityCanBeSentForProvider(
      provider,
      'modelList',
      provider.capabilities?.modelList === true,
    ),
    isOpenAICompatible: isOpenAICompatibleProvider,
    resolveBaseUrl: (provider) => normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider)),
    resolveHeaders: getHeaders,
    request: (input, init, timeoutMs) => fetchWithTimeout(fetch, input, init, timeoutMs),
    readResponseText: safeResponseText,
    parseResponseJson: (text, response, provider) => parseProviderJson(
      text,
      response,
      provider,
      '模型列表',
    ),
    mapOpenAICompatible: (value, provider) => mapOpenAICompatibleModels(
      value as Parameters<typeof mapOpenAICompatibleModels>[0],
      provider.type,
      { providerPresetId: provider.presetId ?? provider.detectedPresetId },
    ),
    mapAnthropic: (value) => mapAnthropicModels(value as Parameters<typeof mapAnthropicModels>[0]),
    mapGoogle: (value) => mapGoogleModels(value as Parameters<typeof mapGoogleModels>[0]),
  }))
  return providerModelDiscoveryAdapterPromise
}

function resolveProviderModelTest(): Promise<ProviderModelTest> {
  providerModelTestPromise ??= Promise.all([
    import('@/i18n/service'),
    import('./providerRequestBinding'),
    import('./providerCapabilityMatrix'),
    import('@/modules/providers'),
    import('@/modules/providers'),
    import('./providerPolicies'),
    import('@/modules/providers'),
    Promise.all([
      import('@/utils/modelReasoning'),
      import('@/types/modelCatalog'),
    ]),
    import('./providerRequestPolicies'),
    import('./providerResponsePolicies'),
    import('./providerResponsePolicies'),
    import('@/modules/providers'),
    import('@/bootstrap/providerRuntimePipeline'),
    import('@/types/providerBaseUrls'),
    import('@/utils/providerModels'),
    import('@/modules/providers'),
    import('@/modules/providers'),
  ]).then(([
    { st },
    {
      buildProviderProtocolRequestBody,
      resolveProviderRoute,
    },
    { getProviderModelCapabilityStatus, providerModelCapabilityCanBeSent },
    { chooseCredentialForModel, findCredentialGroupIdForKey },
    { getProviderRequestHeaders: getHeaders },
    { getHostedProviderSupportIssue },
    { fetchProviderWithTimeout: fetchWithTimeout, safeProviderResponseText: safeResponseText },
    [
      { getReasoningEffortOptions, normalizeModelId },
      { getModelConfig },
    ],
    { usesOpenAIResponses },
    { formatProviderHttpError, providerFetchFailure },
    { parseProviderNonStreamingText },
    { createProviderRouteAssemblyPolicy },
    { prepareHttpJsonRequest },
    { getProviderConfigIssue },
    { resolveProviderModelAlias },
    { classifyHttpStatus, getWireProviderType },
    { providerCompatibilityCapabilityCanBeSentForProvider },
  ]) => {
    const { resolveEndpoint: resolveProviderEndpoint } = createProviderRouteAssemblyPolicy({
      compatibilityCapabilityCanBeSent: providerCompatibilityCapabilityCanBeSentForProvider,
    })
    const probe = createProviderProbe({
      defaultTimeoutMs: MODEL_TEST_TIMEOUT_MS,
      resolveUpstreamModel: resolveProviderModelAlias,
      configurationIssue(provider, apiKey) {
        const issue = getProviderConfigIssue(provider, apiKey)
        return issue ? {
          code: issue.code === 'bad_base_url' ? 'bad_base_url' : 'credential_mismatch',
          message: st(issue.messageKey ?? issue.message, undefined, issue.message),
        } : undefined
      },
      hostedIssue(provider) {
        const issue = getHostedProviderSupportIssue(provider, 'modelList')
        return issue ? { message: issue.message } : undefined
      },
      supportsModelDiscovery(provider) {
        return providerCompatibilityCapabilityCanBeSentForProvider(
          provider,
          'modelList',
          provider.capabilities?.modelList === true,
        )
      },
      discoverModels: (provider, timeoutMs, signal) => (
        discoverProviderModels(provider, timeoutMs, signal)
      ),
      discoverModelsDetailed: async (provider, timeoutMs, signal) => (await resolveProviderModelDiscoveryAdapter()).discoverDetailed(provider, { timeoutMs, signal }),
    })
    return createProviderModelTest({
    defaultTimeoutMs: MODEL_TEST_TIMEOUT_MS,
    messages: {
      saveApiKeyFirst: st('providerOperation.saveApiKeyFirst'),
      chooseModelFirst: st('providerOperation.chooseModelFirst'),
      emptyModelResponse: st('providerOperation.emptyModelResponse'),
      modelTestPassed: st('providerOperation.modelTestPassed'),
    },
    resolveUpstreamModel: resolveProviderModelAlias,
    selectCredential: chooseCredentialForModel,
    credentialGroupId: findCredentialGroupIdForKey,
    configurationIssue(provider, apiKey) {
      const issue = getProviderConfigIssue(provider, apiKey)
      return issue ? {
        code: issue.code === 'bad_base_url' ? 'bad_base_url' : 'credential_mismatch',
        message: st(issue.messageKey ?? issue.message, undefined, issue.message),
      } : undefined
    },
    hostedIssue(provider) {
      const issue = getHostedProviderSupportIssue(provider, 'chat')
      return issue ? { code: 'models_endpoint_unavailable', message: issue.message } : undefined
    },
    reasoningEffortOptions: getReasoningEffortOptions,
    maxOutputTokens: (provider, model) => getModelConfig(model, provider.type, provider.modelConfigs).maxOutputTokens,
    normalizeModelId,
    usesResponsesApi: (request) => usesOpenAIResponses(request as unknown as ProviderRuntimeChatRequest),
    resolveEndpoint(request, usesResponsesApi) {
      return resolveProviderEndpoint({
        provider: request.provider,
        model: request.model,
        stream: false,
        usesResponsesApi,
      })
    },
    buildPayload(request, endpoint) {
      const runtimeRequest = request as unknown as ProviderRuntimeChatRequest
      const rawBody = buildProviderProtocolRequestBody(runtimeRequest)
      return resolveProviderRoute({
        request: runtimeRequest,
        body: rawBody,
        context: {
          endpoint,
          transport: 'http',
          requestedTransportMode: 'http',
        },
      }).body
    },
    resolveCapability(provider, model, capability) {
      const canSend = providerModelCapabilityCanBeSent(provider, model, capability)
      const evidence = getProviderModelCapabilityStatus(provider, model, capability)
      return {
        canSend,
        ...(evidence ? {
          evidence: {
            status: evidence.status,
            source: evidence.source,
            reason: evidence.reason,
          },
        } : {}),
      }
    },
    prepareRequest(provider, model, url, payload) {
      return prepareHttpJsonRequest({
        provider,
        model,
        url,
        headers: getHeaders(provider, { model }),
        body: payload,
      })
    },
    request: (request, timeoutMs, signal) => fetchWithTimeout(
      fetch,
      request.url,
      {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        ...(signal ? { signal } : {}),
      },
      timeoutMs,
    ),
    readErrorText: safeResponseText,
    classifyHttpStatus,
    formatHttpError: formatProviderHttpError,
    parseResponseText: (response, provider) => parseProviderNonStreamingText(
      response,
      getWireProviderType(provider),
    ),
    fetchFailure: providerFetchFailure,
    probe: { async probe(request) {
      if (!request.provider.apiKeySource) return probe.probe(request)
      const { providerModelAvailabilityRuntime, resolveRuntimeModelIdentity } = await import('./providerModelAvailabilityRuntime')
      const identity = await resolveRuntimeModelIdentity(request.provider, request.model ?? '')
      return providerModelAvailabilityRuntime.observeProbe(identity, () => probe.probe(request))
    } },
    usesResponsesApiForModel: (provider, model) => usesOpenAIResponses({ provider, model }),
    })
  })
  return providerModelTestPromise
}

function resolveProviderStreamRuntime() {
  providerStreamRuntimePromise ??= Promise.all([
    import('./providerRequestBinding'),
    import('./providerRuntimeExecutor'),
    import('@/bootstrap/providerRuntimeGateway'),
    import('@/bootstrap/providerRuntimePipeline'),
    import('./providerTransport'),
    import('./providerFallbackCandidates'),
    import('./providerRuntimeFallbackEffects'),
    import('./providerResponsePolicies'),
    import('@/modules/providers'),
  ]).then(([
    { providerRequestSerializer },
    { executeProviderRuntimeChat },
    { emitProviderRuntimeGatewayOutcome },
    { prepareProviderRuntimePipeline },
    { providerTransport },
    { buildProviderFallbackCandidates },
    { providerRuntimeFallbackEffects },
    { withProviderTextToolCallFallback },
    { createResponsesWebSocketTransport },
  ]) => {
    const responsesWebSocketTransport = createResponsesWebSocketTransport({
      finalizeCompletion: withProviderTextToolCallFallback,
    })

    return createProviderStreamRuntime({
      resolveRoute: (request: ProviderRuntimeChatRequest, context?: unknown, failover?: unknown) => providerRequestSerializer.serialize(
        request,
        context as Parameters<typeof providerRequestSerializer.serialize>[1],
        failover as Parameters<typeof providerRequestSerializer.serialize>[2],
      ),
      prepare: ({ request, controller, resolveRoute, onTrace, hasWebSocketRuntime }) => prepareProviderRuntimePipeline({
        req: request,
        controller,
        resolveRoute: resolveRoute as Parameters<typeof prepareProviderRuntimePipeline>[0]['resolveRoute'],
        onTrace,
        hasWebSocketRuntime,
        assembleProviderRoute: providerTransport.assembleRoute,
      }),
      emitOutcome: (pipeline, onTrace) => emitProviderRuntimeGatewayOutcome({ result: pipeline, onTrace }),
      blockedError: (pipeline) => pipeline.status === 'blocked' ? pipeline.error : undefined,
      execute: ({ pipeline, controller, resolveRoute, callbacks }) => executeProviderRuntimeChat({
        pipeline: pipeline as Exclude<typeof pipeline, { status: 'blocked' }>,
        controller,
        resolveRoute: resolveRoute as Parameters<typeof executeProviderRuntimeChat>[0]['resolveRoute'],
        onChunk: callbacks.onChunk,
        onDone: callbacks.onDone,
        onError: callbacks.onError,
        onCitations: callbacks.onCitations,
        onTrace: callbacks.onTrace,
        transport: providerTransport,
        responsesWebSocketTransport,
        buildFallbackCandidates: buildProviderFallbackCandidates,
        fallbackEffects: providerRuntimeFallbackEffects,
      }),
      hasWebSocketRuntime: () => typeof WebSocket !== 'undefined',
    })
  })
  return providerStreamRuntimePromise
}

export function toRuntimeChatRequest(
  options: ProviderRuntimeAdapterOptions,
  request: CanonicalChatRequest,
): ProviderRuntimeChatRequest {
  const providerToolDeclarations = buildModelOperationDeclarations(options.provider, request)
  return {
    provider: options.provider,
    model: request.model,
    requestedModel: request.model,
    messages: toProviderRuntimeMessages(options.provider, request.messages),
    ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { topP: request.topP }),
    ...(request.topK === undefined ? {} : { topK: request.topK }),
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    generationParameterSources: request.generationParameterSources,
    ...(options.executionConstraint && !request.providerStateBinding ? { executionConstraint: options.executionConstraint } : {}),
    failoverPolicy: { mode: 'ask-before-cross-provider' },
    ...(request.providerStateBinding ? { allowFallback: false } : {}),
    stream: true,
    conversationId: request.conversationId,
    sessionId: request.conversationId,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(providerToolDeclarations.length ? { providerToolDeclarations } : {}),
  }
}

function toProviderRuntimeMessages(
  provider: AIProvider,
  messages: CanonicalChatRequest['messages'],
): ProviderRuntimeChatMessage[] {
  return messages.flatMap<ProviderRuntimeChatMessage>((message): ProviderRuntimeChatMessage[] => {
    if (message.role === 'system') return []
    if (usesAnthropicModelOperationMessages(provider)) {
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const replay = providerReplayFields(message.reasoningReplay)
        const content: ProviderContentPart[] = []
        if (message.text) content.push({ type: 'text', text: message.text })
        content.push(...message.toolCalls.map((call) => ({
          type: 'tool_use' as const,
          text: '',
          toolUse: {
            id: providerCallId(call),
            name: call.name,
            input: call.arguments,
          },
        })))
        return [{
          role: 'assistant' as const,
          content,
          ...(replay.providerContentBlocks?.length ? { providerContentBlocks: replay.providerContentBlocks } : {}),
        }]
      }
      if (message.role === 'tool') {
        return [{
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            text: '',
            toolResult: {
              tool_use_id: message.toolCallId,
              content: message.text,
            },
          }],
        }]
      }
    }
    if (provider.type === 'google') {
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const content: ProviderContentPart[] = []
        if (message.text) content.push({ type: 'text', text: message.text })
        content.push(...message.toolCalls.map((call) => ({
          type: 'function_call' as const,
          text: '',
          functionCall: { name: call.name, args: call.arguments },
          ...(providerThoughtSignature(call) ? { thoughtSignature: providerThoughtSignature(call) } : {}),
        })))
        return [{ role: 'assistant' as const, content }]
      }
      if (message.role === 'tool') {
        return [{
          role: 'user' as const,
          content: [{
            type: 'function_response' as const,
            text: '',
            functionResponse: {
              name: message.name ?? 'islemind_operation',
              response: { result: message.text },
            },
          }],
        }]
      }
    }
    return [{
      role: message.role,
      content: message.text,
      ...providerReplayFields(message.reasoningReplay),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.name ? { name: message.name } : {}),
      ...(message.toolCalls?.length ? {
        toolCalls: message.toolCalls.map((call) => ({
          id: providerCallId(call),
          callId: call.callId,
          name: call.name,
          arguments: call.arguments,
          ...(providerThoughtSignature(call) ? { thoughtSignature: providerThoughtSignature(call) } : {}),
        })),
      } : {}),
    }]
  })
}

function usesAnthropicModelOperationMessages(provider: AIProvider): boolean {
  return provider.type === 'anthropic' || provider.wireProtocol === 'anthropic-compatible'
}

function providerCallId(call: NonNullable<CanonicalChatRequest['messages'][number]['toolCalls']>[number]): string {
  const value = call.providerMetadata?.providerCallId
  return typeof value === 'string' && value.trim() ? value : call.callId
}

function providerThoughtSignature(
  call: NonNullable<CanonicalChatRequest['messages'][number]['toolCalls']>[number],
): string | undefined {
  const value = call.providerMetadata?.thoughtSignature
  return typeof value === 'string' && value.trim() ? value : undefined
}

function modelOperationProviderMetadata(call: {
  readonly id?: string
  readonly thoughtSignature?: string
  readonly index?: number
}): ChatToolCallProviderMetadata | undefined {
  const metadata: ChatToolCallProviderMetadata = {
    ...(call.id?.trim() ? { providerCallId: call.id } : {}),
    ...(call.thoughtSignature?.trim() ? { thoughtSignature: call.thoughtSignature } : {}),
    ...(typeof call.index === 'number' && Number.isSafeInteger(call.index) && call.index >= 0
      ? { providerCallIndex: call.index }
      : {}),
  }
  return Object.keys(metadata).length ? metadata : undefined
}

function providerReplayFields(
  replay: readonly ChatReasoningReplayPart[] | undefined,
): Pick<ProviderRuntimeChatMessage, 'reasoningContent' | 'responseItems' | 'providerContentBlocks'> {
  if (!replay?.length) return {}
  const reasoningContent = replay
    .filter((part): part is Extract<ChatReasoningReplayPart, { kind: 'text' | 'thinking' }> => (
      part.kind === 'text' || part.kind === 'thinking'
    ))
    .map((part) => part.text)
    .filter(Boolean)
    .join('')
  const responseItems: Record<string, unknown>[] = replay
    .flatMap((part) => part.kind === 'encrypted'
      ? [{
          type: 'reasoning',
          id: part.id,
          encrypted_content: part.data,
          summary: (part.summary ?? []).map((text) => ({ type: 'summary_text', text })),
        }]
      : [])
  const providerContentBlocks: Record<string, unknown>[] = []
  for (const part of replay) {
    if (part.kind === 'thinking') {
      providerContentBlocks.push({
        type: 'thinking',
        thinking: part.text,
        ...(part.signature ? { signature: part.signature } : {}),
      })
    }
    if (part.kind === 'redacted') providerContentBlocks.push({ type: 'redacted_thinking', data: part.data })
  }
  return {
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(responseItems.length ? { responseItems } : {}),
    ...(providerContentBlocks.length ? { providerContentBlocks } : {}),
  }
}

function toChatReasoningReplay(
  result: ProviderRuntimeCompletionResult,
): readonly ChatReasoningReplayPart[] {
  const replay: ChatReasoningReplayPart[] = []
  if (result.reasoningContent?.trim()) {
    replay.push({ kind: 'text', text: result.reasoningContent })
  }
  for (const item of result.responseItems ?? []) {
    if (item.type !== 'reasoning' || typeof item.id !== 'string' || typeof item.encrypted_content !== 'string') continue
    const summary = Array.isArray(item.summary)
      ? item.summary.flatMap((entry) => {
          if (typeof entry === 'string') return [entry]
          if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.text === 'string') return [entry.text]
          return []
        })
      : []
    replay.push({
      kind: 'encrypted',
      id: item.id,
      data: item.encrypted_content,
      ...(summary.length ? { summary } : {}),
    })
  }
  for (const block of result.providerContentBlocks ?? []) {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      replay.push({
        kind: 'thinking',
        text: block.thinking,
        ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
      })
    } else if (block.type === 'redacted_thinking' && typeof block.data === 'string') {
      replay.push({ kind: 'redacted', data: block.data })
    }
  }
  return replay.slice(0, 32)
}

function buildModelOperationDeclarations(
  provider: AIProvider,
  request: CanonicalChatRequest,
): readonly unknown[] {
  if (!request.toolDefinitions?.length || provider.capabilities?.nativeTools !== true) return []
  const model = getModelConfig(request.model, provider.type, provider.modelConfigs)
  if (model.supportsTools === false) return []
  const target = resolveProviderNativeToolDeclarationTarget(provider.type, {
    preferredEndpoint: model.preferredEndpoint === 'responses' ? 'responses' : 'chat',
    assumeOpenAICompatibleTools: true,
    wireProtocol: provider.wireProtocol,
  })
  if (!target) return []
  return buildProviderNativeToolDeclarations({
    manifests: request.toolDefinitions.map((definition) => ({
      id: definition.operationId,
      source: 'model-operation' as const,
      name: definition.name,
      description: definition.description,
      permission: definition.permission,
      inputSchema: definition.inputSchema,
      enabled: true,
    })),
    target,
    permissionCeiling: 'destructive',
    maxTools: 64,
  }).tools
}

function emitMissingFinalText(
  result: ProviderRuntimeCompletionResult,
  emittedText: string,
  emit: (event: StreamEvent) => void,
): void {
  if (!result.text || !result.text.startsWith(emittedText)) return
  const missingText = result.text.slice(emittedText.length)
  if (missingText) emit({ type: 'text-delta', text: missingText })
}

function emitCitation(
  citation: MessageCitation,
  seenCitations: Set<string>,
  emit: (event: StreamEvent) => void,
): void {
  if (!citation.id || seenCitations.has(citation.id)) return
  seenCitations.add(citation.id)
  emit({
    type: 'citation',
    citationId: citation.id,
    ...(citation.title ? { title: citation.title } : {}),
    ...(citation.url ? { url: citation.url } : {}),
  })
}
