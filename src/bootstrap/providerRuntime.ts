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

const PROVIDER_REQUEST_TIMEOUT_MS = 18000
const MODEL_TEST_TIMEOUT_MS = 22000
let providerEmbeddingAdapterPromise: Promise<ProviderEmbeddingAdapter> | undefined
let providerCredentialSynchronizationPromise: Promise<ProviderCredentialSynchronization> | undefined
let providerMediaAdapterPromise: Promise<ProviderMediaAdapter> | undefined
let providerModelListPromise: Promise<ProviderModelList> | undefined
let providerModelDiscoveryAdapterPromise: Promise<ProviderModelDiscoveryAdapter> | undefined
let providerModelTestPromise: Promise<ProviderModelTest> | undefined
let providerStreamRuntimePromise: Promise<ProviderRuntimeChatStreamRuntime> | undefined

export interface ProviderRuntimeAdapterOptions {
  provider: AIProvider
  settings?: ProviderRuntimeChatRequest['settings']
  streamChat?: ProviderStreamChat
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
  const queue = new ProviderRuntimeEventQueue<StreamEvent>()
  let handle: ProviderRuntimeStreamHandle | undefined
  let producerSettled = false
  let emittedText = ''
  const seenCitations = new Set<string>()
  const streamChat = options.streamChat ?? streamProviderChat
  const runtimeRequest = toRuntimeChatRequest(options, request)
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
              binding: { providerId: options.provider.id, model: request.model },
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

class ProviderRuntimeEventQueue<Value> implements AsyncIterable<Value> {
  private readonly values: Value[] = []
  private completion: { error?: unknown } | undefined
  private wake?: () => void

  push(value: Value): void {
    if (this.completion) return
    this.values.push(value)
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

  async *[Symbol.asyncIterator](): AsyncIterator<Value> {
    while (true) {
      const value = this.values.shift()
      if (value !== undefined) {
        yield value
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
  return (await resolveProviderStreamRuntime()).start(request, {
    onChunk,
    onDone,
    onError,
    ...(onCitations ? { onCitations } : {}),
    ...(onTrace ? { onTrace } : {}),
  })
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
  options: { checkParameters?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
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
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProviderOperationResult<AIModel[]>> {
  return (await resolveProviderModelList()).listDetailed(provider, apiKey, options)
}

export async function listProviderModelConfigs(
  provider: AIProvider,
  apiKey: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
) {
  return (await resolveProviderModelList()).list(provider, apiKey, options)
}

export async function listProviderModelIds(
  provider: AIProvider,
  apiKey: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  return (await resolveProviderModelList()).listIds(provider, apiKey, options)
}

export async function discoverProviderModels(
  provider: AIProvider,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AIModel[]> {
  return (await resolveProviderModelDiscoveryAdapter()).discover(provider, {
    timeoutMs,
    ...(signal ? { signal } : {}),
  })
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
    probe,
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
