import type { AIProvider, ChatErrorCode, MessageCitation, MessageUsage, ProcessTrace, ProviderOperationCode, ProviderType } from '@/types'
import { st } from '@/i18n/service'
import type { ChatRequest, CitationCallback, DoneCallback, ErrorCallback, StreamCallback, TraceCallback } from '@/services/ai/base'
import { updateCredentialGroupHealth } from '@/services/ai/providerCredentials'
import { buildProviderFallbackCandidates } from '@/services/ai/providerFallbackCandidates'
import type { ProviderFailoverDecision, ProviderFailureClassification } from '@/services/ai/providerFailover'
import { resolveFailoverDecision } from '@/services/ai/providerFailover'
import { indexProviderHealthRecords } from '@/services/ai/providerHealth'
import { loadProviderHealthSnapshot } from '@/services/ai/providerHealthStore'
import { assembleProviderRoute } from '@/services/ai/providerRouteAssembly'
import { getHeaders } from '@/services/ai/providerHeaders'
import { usesOpenAIResponses } from '@/services/ai/providerOpenAIRequest'
import { dedupeCitations, extractCitationsFromText, extractProviderCitationsFromSse, type ProviderCitationSource } from '@/services/ai/providerCitations'
import { mergeAnthropicReplayContentBlocks, sanitizeAnthropicReplayContentBlocks } from '@/services/ai/providerAnthropicReplay'
import { rectifyAnthropicRequestBody } from '@/services/ai/providerAnthropicRectification'
import { optimizeRequestBody as optimizeProviderRequestBody } from '@/services/ai/providerRequestOptimization'
import { fallbackProvidersForRequest, providerForRuntimeFallback, requiredFallbackCapabilities, retryAfterMsFromFailure, routeForRuntimeFallback } from '@/services/ai/providerRuntimeFallback'
import { logRuntimeFallbackDecision, recordRuntimeFallbackFailure, recordRuntimeFallbackSuccess } from '@/services/ai/providerRuntimeFallbackLogging'
import { providerRuntimeError, runStreamTask, withCredentialGroup, type ProviderRuntimeError } from '@/services/ai/providerRuntimeResult'
import { dedupeTraces, splitSseBuffer } from '@/services/ai/providerStreamUtils'
import { fetchChatStreamWithTimeout, fetchWithTimeout, safeResponseText } from '@/services/ai/providerHttp'
import { parseProviderBufferedStreamResponse, parseProviderNonStreamingResponse, providerReasoningResponseCanBeParsed, withProviderTextToolCallFallback } from '@/services/ai/providerResponseParsing'
import { mergeOpenAIResponseReplayItems } from '@/services/ai/providerOpenAIReplay'
import { createProviderTrace } from '@/services/ai/providerTraceUtils'
import { createProviderTextToolCallStreamFilter, executableProviderToolCalls, mergeProviderToolCallParts, type ProviderToolCall } from '@/services/ai/providerToolCalls'
import { filterProviderStructuredOutputToolCalls, providerStructuredOutputToolCallText } from '@/services/ai/providerStructuredOutput'
import { parseProviderStreamChunk, parseProviderStreamEvent } from '@/services/ai/providerStreamParsing'
import { recordProviderRuntimeFailure, recordProviderRuntimeSuccess } from '@/services/ai/providerRuntimeHealth'
import { createRuntimeFallbackTrace, createStreamModeTrace, describeRequestRectification, logProviderCompatibility, logProviderConformance, logProviderRouteDecision, runtimeLogOptions } from '@/services/ai/providerRuntimeDiagnostics'
import { assertProviderCircuitClosed, delayProviderRetry, logProviderRetryAttempt, providerCircuitKey, providerRetryDelayMs, recordProviderCircuitFailure, recordProviderCircuitSuccess, resolveProviderMaxRetries, resolveProviderRequestTimeoutMs } from '@/services/ai/providerRuntimeRetry'
import { isPerplexityProvider } from '@/services/ai/providerIdentity'
import { endpointHost, resolveNonStreamingProviderEndpoint, toWebSocketUrl } from '@/services/ai/providerEndpointUtils'
import { getWireProviderType, isAnthropicWireRequest } from '@/services/ai/providerWireProtocol'
import { clampMaxTokens } from '@/services/ai/providerRequestParameters'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'
import { classifyHttpStatus, formatProviderHttpError } from '@/services/ai/providerOperationResult'
import { prepareHttpJsonRequest, type ProviderRuntimePipelineReady, type ProviderRuntimeRouteResolver } from '@/services/ai/providerRuntimePipeline'
import { deriveSessionAffinityKey, invalidateSessionAffinityBinding, readSessionAffinityBinding, rotateSessionAffinityBinding, sessionAffinityFailureShouldInvalidate, type SessionAffinityBinding } from '@/services/ai/providerSessionAffinity'
import { acquireSessionLease } from '@/services/ai/transport/sessionLeasePool'
import { runResponsesWebSocketTransport } from '@/services/ai/transport/responsesWebSocketTransport'
import { emitRuntimeEvent } from '@/services/runtimeEvents'
import { appendRuntimeLog } from '@/services/runtimeLog'

const CHAT_REQUEST_TIMEOUT_MS = 60000

export interface ProviderRuntimeChatExecutionInput {
  pipeline: ProviderRuntimePipelineReady
  controller: AbortController
  resolveRoute: ProviderRuntimeRouteResolver
  onChunk: StreamCallback
  onDone: DoneCallback
  onError: ErrorCallback
  onCitations?: CitationCallback
  onTrace?: TraceCallback
}

export interface HttpSseExecutionInput {
  req: ChatRequest
  url: string
  headers: Record<string, string>
  body: string
  stream: boolean
  controller: AbortController
  credentialGroupId?: string
  resolveRoute: ProviderRuntimeRouteResolver
  onChunk: StreamCallback
  onDone: DoneCallback
  onError: ErrorCallback
  onCitations?: CitationCallback
  onTrace?: TraceCallback
}

export interface FetchChatStreamWithRetryInput {
  req: ChatRequest
  url: string
  headers: Record<string, string>
  body: string
  stream: boolean
  controller: AbortController
  credentialGroupId?: string
  onTrace?: TraceCallback
}

export interface RuntimeFallbackPlanInput {
  req: ChatRequest
  status?: number
  error?: unknown
  responseText?: string
  credentialGroupId?: string
  streamStarted?: boolean
}

export interface RuntimeFallbackPlan {
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
  candidates: ReturnType<typeof buildProviderFallbackCandidates>
}

interface RuntimeFallbackExecutionInput {
  req: ChatRequest
  status: number
  responseText: string
  credentialGroupId?: string
  resolveRoute: ProviderRuntimeRouteResolver
  onChunk: StreamCallback
  onDone: DoneCallback
  onCitations?: CitationCallback
  onTrace?: TraceCallback
}

interface OpenAICompatibleRequestRectificationInput {
  req: ChatRequest
  body: string
  status: number
  errorText: string
  rectified: boolean
}

export interface OpenAICompatibleRequestRectificationResult {
  kind: 'openai_compatible_minimal_chat'
  body: Record<string, unknown>
  failedFields: string[]
  removedFields: string[]
  retainedFields: string[]
}

interface RuntimeSessionAffinityFailureInput {
  req: ChatRequest
  credentialGroupId?: string
  status?: number
  responseText?: string
  classification: ProviderFailureClassification
}

export function executeProviderRuntimeChat(input: ProviderRuntimeChatExecutionInput): Promise<void> {
  const { pipeline } = input
  if (pipeline.transportSelection.transport === 'responses_websocket') {
    return executeResponsesWebSocketChat(input)
  }
  return runStreamTask(() => executeHttpSseChat({
    req: pipeline.runtimeReq,
    url: pipeline.preparedHttpRequest.url,
    headers: pipeline.preparedHttpRequest.headers,
    body: pipeline.preparedHttpRequest.body,
    stream: pipeline.stream,
    controller: input.controller,
    credentialGroupId: pipeline.credentialGroupId,
    resolveRoute: input.resolveRoute,
    onChunk: input.onChunk,
    onDone: input.onDone,
    onError: input.onError,
    onCitations: input.onCitations,
    onTrace: input.onTrace,
  }), input.onError, pipeline.credentialGroupId)
}

function executeResponsesWebSocketChat(input: ProviderRuntimeChatExecutionInput): Promise<void> {
  const {
    effectiveReq,
    runtimeReq,
    stream,
    headers,
    rawBody,
    proxyPolicy,
    preparedHttpRequest,
    credentialGroupId,
  } = input.pipeline
  return runStreamTask(async () => {
    const lease = await acquireWebSocketLease(input)
    if (!lease) return
    let emittedText = false
    try {
      await runResponsesWebSocketTransport({
        req: runtimeReq,
        url: toWebSocketUrl(proxyPolicy.effectiveUrl),
        headers,
        body: rawBody as Record<string, unknown>,
        signal: input.controller.signal,
        parseEvent: parseProviderStreamEvent,
        wireProviderType: getWireProviderType(runtimeReq.provider),
        extractCitations: extractCitationsFromText,
        onChunk: (chunk) => {
          emittedText = emittedText || !!chunk
          input.onChunk(chunk)
        },
        onDone: (result) => {
          void recordProviderRuntimeSuccess({
            req: runtimeReq,
            credentialGroupId,
          })
          void appendRuntimeLog('upstream.response', {
            conversationId: runtimeReq.conversationId,
            providerId: runtimeReq.provider.id,
            model: runtimeReq.model,
            requestedModel: runtimeReq.requestedModel,
            upstreamModel: runtimeReq.model,
            transport: 'responses_websocket',
            usage: result.usage,
            textLength: result.text.length,
            responseId: result.responseId,
          }, runtimeLogOptions(runtimeReq))
          input.onDone(withCredentialGroup(result, credentialGroupId))
        },
        onError: input.onError,
        onCitations: input.onCitations,
        onTrace: input.onTrace,
      })
    } catch (error) {
      if ((effectiveReq.settings?.transportMode ?? 'auto') === 'websocket' || emittedText) {
        void recordProviderRuntimeFailure({
          req: runtimeReq,
          credentialGroupId,
          error,
          streamStarted: emittedText,
        })
        throw error
      }
      input.onTrace?.(createStreamModeTrace('fallback', 'Responses WebSocket handshake failed; HTTP/SSE fallback is running.'))
      void appendRuntimeLog('transport.fallback', {
        conversationId: effectiveReq.conversationId,
        providerId: runtimeReq.provider.id,
        model: runtimeReq.model,
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        from: 'responses_websocket',
        to: 'http_sse',
        reason: error instanceof Error ? error.message : 'websocket_transport_error',
      }, runtimeLogOptions(effectiveReq))
      await executeHttpSseChat({
        req: runtimeReq,
        url: preparedHttpRequest.url,
        headers: preparedHttpRequest.headers,
        body: preparedHttpRequest.body,
        stream,
        controller: input.controller,
        credentialGroupId,
        resolveRoute: input.resolveRoute,
        onChunk: input.onChunk,
        onDone: input.onDone,
        onError: input.onError,
        onCitations: input.onCitations,
        onTrace: input.onTrace,
      })
    } finally {
      lease.release()
    }
  }, input.onError, credentialGroupId)
}

async function acquireWebSocketLease(input: ProviderRuntimeChatExecutionInput): Promise<Awaited<ReturnType<typeof acquireSessionLease>> | null> {
  const { effectiveReq, runtimeReq, credentialGroupId } = input.pipeline
  try {
    const lease = await acquireSessionLease({
      key: `${runtimeReq.provider.id}:${runtimeReq.model}:${effectiveReq.conversationId ?? 'global'}:${effectiveReq.sessionId ?? 'default'}`,
      limit: effectiveReq.settings?.sessionConcurrencyLimit,
      timeoutMs: effectiveReq.settings?.sessionQueueTimeoutMs,
    })
    void emitRuntimeEvent({
      event: 'session.lease.acquired',
      conversationId: effectiveReq.conversationId,
      providerId: runtimeReq.provider.id,
      model: runtimeReq.model,
      credentialGroupId,
      data: {
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        status: 'acquired',
        key: lease.key,
      },
      legacyEvent: 'session.lease',
      legacyData: {
        conversationId: effectiveReq.conversationId,
        providerId: runtimeReq.provider.id,
        model: runtimeReq.model,
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        status: 'acquired',
        key: lease.key,
      },
      options: runtimeLogOptions(effectiveReq),
    })
    return lease
  } catch {
    input.onError(providerRuntimeError('session_queue_timeout', credentialGroupId))
    void emitRuntimeEvent({
      event: 'session.lease.rejected',
      conversationId: effectiveReq.conversationId,
      providerId: runtimeReq.provider.id,
      model: runtimeReq.model,
      credentialGroupId,
      data: {
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        status: 'timeout',
      },
      legacyEvent: 'session.lease',
      legacyData: {
        conversationId: effectiveReq.conversationId,
        providerId: runtimeReq.provider.id,
        model: runtimeReq.model,
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        status: 'timeout',
      },
      options: runtimeLogOptions(effectiveReq),
    })
    return null
  }
}

export async function executeHttpSseChat(input: HttpSseExecutionInput): Promise<void> {
  const startedAt = Date.now()
  let streamStarted = false
  let response: Response
  try {
    response = await fetchChatStreamWithRetry(input)
  } catch (error) {
    void recordProviderRuntimeFailure({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      error,
      streamStarted,
      latencyMs: Date.now() - startedAt,
    })
    throw error
  }

  if (!response.ok) {
    const errorText = await safeResponseText(response)
    const compactFallbackAttempted = await tryRemoteCompactLocalFallback({
      ...input,
      status: response.status,
      responseText: errorText,
      startedAt,
    })
    if (compactFallbackAttempted) return
    const recovered = await tryRuntimeFallback({
      req: input.req,
      status: response.status,
      responseText: errorText,
      credentialGroupId: input.credentialGroupId,
      resolveRoute: input.resolveRoute,
      onChunk: input.onChunk,
      onDone: input.onDone,
      onCitations: input.onCitations,
      onTrace: input.onTrace,
    })
    if (recovered) return
    input.req.provider = updateCredentialGroupHealth(input.req.provider, input.credentialGroupId, false)
    void appendRuntimeLog('upstream.error', {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      upstreamModel: input.req.model,
      status: response.status,
      endpointHost: endpointHost(input.url),
    }, runtimeLogOptions(input.req))
    const errorCode = classifyHttpStatus(response.status, errorText, input.req.model, input.req.provider)
    input.onError(providerRuntimeError(
      formatProviderHttpError(response.status, errorText, input.req.provider, input.req.model),
      input.credentialGroupId,
      providerOperationCodeToChatErrorCode(errorCode)
    ))
    return
  }

  if (!input.stream) {
    const result = await parseProviderNonStreamingResponse(response, input.req)
    if (result.text) input.onChunk(result.text)
    if (result.citations?.length) input.onCitations?.(result.citations)
    result.traces?.forEach(input.onTrace ?? (() => undefined))
    void recordProviderRuntimeSuccess({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      latencyMs: Date.now() - startedAt,
    })
    void appendRuntimeLog('upstream.response', {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      upstreamModel: input.req.model,
      transport: 'http_sse',
      usage: result.usage,
      textLength: result.text.length,
    }, runtimeLogOptions(input.req))
    input.onDone(withCredentialGroup(result, input.credentialGroupId))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    input.onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackNoReader')))
    const raw = await safeResponseText(response)
    const result = parseProviderBufferedStreamResponse(raw, input.req, getWireProviderType(input.req.provider))
    if (result.text || result.providerToolCalls?.length) {
      input.onChunk(result.text)
      if (result.citations?.length) input.onCitations?.(result.citations)
      result.traces?.forEach(input.onTrace ?? (() => undefined))
      void recordProviderRuntimeSuccess({
        req: input.req,
        credentialGroupId: input.credentialGroupId,
        latencyMs: Date.now() - startedAt,
      })
      input.onDone(withCredentialGroup(result, input.credentialGroupId))
    } else {
      input.onTrace?.(createStreamModeTrace('buffered', st('providerTrace.streamBufferedFallback')))
      await retryWithoutStreaming(input.req, input.resolveRoute, input.onChunk, input.onDone, input.onError, input.onCitations, input.onTrace, input.credentialGroupId, input.controller)
    }
    return
  }

  input.onTrace?.(createStreamModeTrace('reader', st('providerTrace.streamReader')))

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  let providerCitations: MessageCitation[] = []
  let providerTraces: ProcessTrace[] = []
  let providerToolCalls: ProviderToolCall[] = []
  let providerUsage: MessageUsage | undefined
  let providerReasoningContent = ''
  let providerResponseItems: Record<string, unknown>[] = []
  let providerContentBlocks: Record<string, unknown>[] = []
  const textToolCallFilter = createProviderTextToolCallStreamFilter()
  const wireProviderType = getWireProviderType(input.req.provider)
  const streamParseOptions = { includeReasoning: providerReasoningResponseCanBeParsed(input.req) }
  const providerCitationSource = resolveStreamProviderCitationSource(input.req.provider, wireProviderType)

  async function readStream() {
    while (true) {
      const { done, value } = await reader!.read()
      if (done) {
        const finalParsed = parseProviderStreamChunk(buffer, wireProviderType, streamParseOptions)
        if (finalParsed.text) {
          fullText += finalParsed.text
          const visibleText = textToolCallFilter.push(finalParsed.text)
          if (visibleText) input.onChunk(visibleText)
        }
        const filterRemainder = textToolCallFilter.finish()
        if (filterRemainder) input.onChunk(filterRemainder)
        providerTraces = dedupeTraces([...providerTraces, ...finalParsed.traces])
        providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(finalParsed.providerToolCalls ?? [])])
        providerReasoningContent += finalParsed.reasoningContent ?? ''
        providerResponseItems = mergeOpenAIResponseReplayItems([...providerResponseItems, ...(finalParsed.responseItems ?? [])])
        providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(finalParsed.providerContentBlocks ?? [])])
        finalParsed.traces.forEach(input.onTrace ?? (() => undefined))
        providerUsage = finalParsed.usage ?? providerUsage
        const structuredOutputText = providerStructuredOutputToolCallText(providerToolCalls, input.req.structuredOutput)
        const finalText = structuredOutputText ?? fullText
        const finalResult = withProviderTextToolCallFallback({
          text: finalText,
          citations: dedupeCitations([...extractCitationsFromText(finalText, input.req.retrievalSources), ...providerCitations]),
          traces: providerTraces,
          usage: providerUsage,
          providerToolCalls: executableProviderToolCalls(filterProviderStructuredOutputToolCalls(providerToolCalls, input.req.structuredOutput)),
          ...(providerReasoningContent ? { reasoningContent: providerReasoningContent } : {}),
          ...(providerResponseItems.length ? { responseItems: providerResponseItems } : {}),
          ...(providerContentBlocks.length ? { providerContentBlocks: sanitizeAnthropicReplayContentBlocks(providerContentBlocks) } : {}),
        }, finalText)
        const citations = finalResult.citations ?? []
        if (citations.length) input.onCitations?.(citations)
        void recordProviderRuntimeSuccess({
          req: input.req,
          credentialGroupId: input.credentialGroupId,
          latencyMs: Date.now() - startedAt,
        })
        void appendRuntimeLog('upstream.response', {
          conversationId: input.req.conversationId,
          providerId: input.req.provider.id,
          model: input.req.model,
          requestedModel: input.req.requestedModel,
          upstreamModel: input.req.model,
          transport: 'http_sse',
          usage: providerUsage,
          textLength: fullText.length,
        }, runtimeLogOptions(input.req))
        input.onDone(withCredentialGroup(finalResult, input.credentialGroupId))
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const { events, remainder } = splitSseBuffer(buffer)
      buffer = remainder
      for (const event of events) {
        const parsed = parseProviderStreamChunk(event, wireProviderType, streamParseOptions)
        if (parsed.text) {
          streamStarted = true
          fullText += parsed.text
          const visibleText = textToolCallFilter.push(parsed.text)
          if (visibleText) input.onChunk(visibleText)
        }
        providerTraces = dedupeTraces([...providerTraces, ...parsed.traces])
        providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(parsed.providerToolCalls ?? [])])
        providerReasoningContent += parsed.reasoningContent ?? ''
        providerResponseItems = mergeOpenAIResponseReplayItems([...providerResponseItems, ...(parsed.responseItems ?? [])])
        providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(parsed.providerContentBlocks ?? [])])
        parsed.traces.forEach(input.onTrace ?? (() => undefined))
        providerUsage = parsed.usage ?? providerUsage
        if (providerCitationSource) {
          providerCitations = dedupeCitations([...providerCitations, ...extractProviderCitationsFromSse(event, providerCitationSource)])
        }
      }
    }
  }

  try {
    await readStream()
  } catch (error) {
    void recordProviderRuntimeFailure({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      error,
      streamStarted,
      latencyMs: Date.now() - startedAt,
    })
    throw error
  }
}

async function tryRemoteCompactLocalFallback(input: HttpSseExecutionInput & {
  status: number
  responseText: string
  startedAt: number
}): Promise<boolean> {
  if (!shouldUseRemoteCompactLocalFallback(input.req, input.status, input.responseText)) return false
  const fallback = input.req.remoteCompactFallback!
  const fallbackReason = `remote_compact_http_${input.status}`
  const classification = await recordProviderRuntimeFailure({
    req: input.req,
    credentialGroupId: input.credentialGroupId,
    status: input.status,
    responseText: input.responseText,
    latencyMs: Date.now() - input.startedAt,
  })
  recordRuntimeSessionAffinityInvalidation({
    req: input.req,
    credentialGroupId: input.credentialGroupId,
    status: input.status,
    responseText: input.responseText,
    classification,
  })
  const fallbackReq: ChatRequest = {
    ...input.req,
    messages: fallback.messages,
    contextPrompt: fallback.contextPrompt,
    remoteCompactEligible: false,
    remoteCompactFallback: undefined,
    previousResponseId: undefined,
  }
  input.onTrace?.(createStreamModeTrace('fallback', 'Remote compact failed; local structured compression fallback is running.'))
  const compactUsageLogData = {
    conversationId: input.req.conversationId,
    providerId: input.req.provider.id,
    model: input.req.model,
    requestedModel: input.req.requestedModel,
    upstreamModel: input.req.model,
    status: 'fallback_local',
    upstreamStatus: input.status,
    failureCode: fallbackReason,
    fallbackLocal: true,
    fallbackTrace: fallback.trace,
  }
  void emitRuntimeEvent({
    event: 'context.compact.completed',
    conversationId: input.req.conversationId,
    providerId: input.req.provider.id,
    credentialGroupId: input.credentialGroupId,
    model: input.req.model,
    data: compactUsageLogData,
    legacyEvent: 'compact.usage',
    legacyData: compactUsageLogData,
    options: runtimeLogOptions(input.req),
  })
  const fallbackPreparedRequest = prepareHttpJsonRequest({
    provider: fallbackReq.provider,
    model: fallbackReq.model,
    url: input.url,
    headers: input.headers,
    body: optimizeRouteBody(input.resolveRoute(fallbackReq).body, fallbackReq),
  })
  await executeHttpSseChat({
    ...input,
    req: fallbackReq,
    url: fallbackPreparedRequest.url,
    headers: fallbackPreparedRequest.headers,
    body: fallbackPreparedRequest.body,
    onDone: (result) => input.onDone({
      ...result,
      remoteCompactFallbackUsed: true,
      remoteCompactFallbackReason: fallbackReason,
    }),
  })
  return true
}

function shouldUseRemoteCompactLocalFallback(req: ChatRequest, status: number, responseText: string): boolean {
  if (!req.remoteCompactEligible || !req.remoteCompactFallback) return false
  if (![400, 404, 409, 413, 422].includes(status)) return false
  const text = responseText.toLowerCase()
  if (!text.trim()) return status === 400 || status === 413 || status === 422
  return /compact|compaction|context_management|previous_response_id|context[_ -]?length|context window|maximum context|unsupported.*context|unknown parameter/.test(text)
}

function resolveStreamProviderCitationSource(provider: AIProvider, providerType: ProviderType): ProviderCitationSource | undefined {
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'citations')) return undefined
  if (providerType === 'openai-compatible' && isPerplexityProvider(provider)) return 'perplexity'
  if (providerType === 'anthropic' || providerType === 'google' || providerType === 'xiaomi-mimo') return providerType
  return undefined
}

export async function fetchChatStreamWithRetry(input: FetchChatStreamWithRetryInput): Promise<Response> {
  const timeoutMs = resolveProviderRequestTimeoutMs(input.req, CHAT_REQUEST_TIMEOUT_MS)
  const maxRetries = resolveProviderMaxRetries(input.req)
  const circuitKey = providerCircuitKey(input.req)
  assertProviderCircuitClosed(input.req, circuitKey)
  let body = input.body
  let rectifiedRequest = false
  let mimoThinkingRectified = false
  let mimoWebSearchRectified = false
  let openAICompatibleMinimalRectification: Pick<OpenAICompatibleRequestRectificationResult, 'kind' | 'failedFields' | 'removedFields' | 'retainedFields'> | undefined
  let retryCount = 0

  while (true) {
    try {
      const response = await fetchChatStreamWithTimeout(input.url, {
        method: 'POST',
        headers: input.headers,
        body,
        signal: input.controller.signal,
      }, timeoutMs)

      if (response.ok) {
        recordProviderCircuitSuccess(circuitKey)
        if (openAICompatibleMinimalRectification) {
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: openAICompatibleMinimalRectification.kind,
            failedFields: openAICompatibleMinimalRectification.failedFields,
            removedFields: openAICompatibleMinimalRectification.removedFields,
            retainedFields: openAICompatibleMinimalRectification.retainedFields,
            result: 'success',
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
        }
        return response
      }

      const canRetryStatus = response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500
      if (isAnthropicWireRequest(input.req)) {
        const errorText = await safeResponseText(response)
        const rectified = rectifyAnthropicRequestBody({ req: input.req, body, errorText, rectified: rectifiedRequest })
        if (rectified) {
          body = JSON.stringify(rectified.body)
          rectifiedRequest = true
          input.onTrace?.(createProviderTrace('system', getWireProviderType(input.req.provider), st('providerTrace.requestRectified'), describeRequestRectification(rectified.kind), 'done', `rectify-${rectified.kind}`, { rectificationKind: rectified.kind }))
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: rectified.kind,
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
          continue
        }
        if (canRetryStatus && retryCount < maxRetries) {
          logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
          retryCount += 1
          await delayProviderRetry(providerRetryDelayMs(retryCount - 1))
          continue
        }
        recordProviderCircuitFailure(input.req, circuitKey)
        return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
      }

      if (input.req.provider.type === 'xiaomi-mimo' && input.req.provider.wireProtocol !== 'anthropic-compatible' && response.status === 400) {
        const errorText = await safeResponseText(response)
        const rectified = rectifyXiaomiMimoThinkingRequestBody({
          req: input.req,
          body,
          status: response.status,
          errorText,
          rectified: mimoThinkingRectified,
        }) ?? rectifyXiaomiMimoWebSearchRequestBody({
          req: input.req,
          body,
          status: response.status,
          errorText,
          rectified: mimoWebSearchRectified,
        })
        if (rectified) {
          body = JSON.stringify(rectified.body)
          if (rectified.kind === 'xiaomi_mimo_thinking_disabled') mimoThinkingRectified = true
          if (rectified.kind === 'xiaomi_mimo_web_search_removed') mimoWebSearchRectified = true
          input.onTrace?.(createProviderTrace('system', getWireProviderType(input.req.provider), st('providerTrace.requestRectified'), describeRequestRectification(rectified.kind), 'done', `rectify-${rectified.kind}`, { rectificationKind: rectified.kind }))
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: rectified.kind,
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
          continue
        }
        if (!canRetryStatus || retryCount >= maxRetries) {
          recordProviderCircuitFailure(input.req, circuitKey)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
      }

      if (input.req.provider.type === 'openai-compatible' && input.req.provider.wireProtocol !== 'anthropic-compatible' && (response.status === 400 || response.status === 422)) {
        const errorText = await safeResponseText(response)
        const rectified = rectifyOpenAICompatibleRequestBody({
          req: input.req,
          body,
          status: response.status,
          errorText,
          rectified: openAICompatibleMinimalRectification !== undefined,
        })
        if (rectified) {
          body = JSON.stringify(rectified.body)
          openAICompatibleMinimalRectification = {
            kind: rectified.kind,
            failedFields: rectified.failedFields,
            removedFields: rectified.removedFields,
            retainedFields: rectified.retainedFields,
          }
          input.onTrace?.(createProviderTrace('system', getWireProviderType(input.req.provider), st('providerTrace.requestRectified'), describeRequestRectification(rectified.kind), 'done', `rectify-${rectified.kind}`, {
            rectificationKind: rectified.kind,
            failedFields: rectified.failedFields,
            removedFields: rectified.removedFields,
            retainedFields: rectified.retainedFields,
          }))
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: rectified.kind,
            failedFields: rectified.failedFields,
            removedFields: rectified.removedFields,
            retainedFields: rectified.retainedFields,
            result: 'retrying',
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
          continue
        }
        if (openAICompatibleMinimalRectification) {
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: openAICompatibleMinimalRectification.kind,
            failedFields: openAICompatibleMinimalRectification.failedFields,
            removedFields: openAICompatibleMinimalRectification.removedFields,
            retainedFields: openAICompatibleMinimalRectification.retainedFields,
            result: 'failed',
            status: response.status,
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
          recordProviderCircuitFailure(input.req, circuitKey)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
        if (!canRetryStatus || retryCount >= maxRetries) {
          recordProviderCircuitFailure(input.req, circuitKey)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
      }

      if (!canRetryStatus || retryCount >= maxRetries) {
        recordProviderCircuitFailure(input.req, circuitKey)
        return response
      }
      logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
      retryCount += 1
      await delayProviderRetry(providerRetryDelayMs(retryCount - 1))
    } catch (error) {
      if (retryCount >= maxRetries || input.controller.signal.aborted) {
        recordProviderCircuitFailure(input.req, circuitKey)
        throw error
      }
      logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { error: error instanceof Error ? error.message : 'request_failed' })
      retryCount += 1
      await delayProviderRetry(providerRetryDelayMs(retryCount - 1))
    }
  }
}

const OPENAI_COMPATIBLE_MINIMAL_CHAT_KEYS = new Set(['model', 'messages', 'stream'])
const OPENAI_COMPATIBLE_PARAMETER_ERROR_FIELDS = [
  'tools',
  'tool_choice',
  'response_format',
  'reasoning',
  'reasoning_effort',
  'thinking',
  'enable_thinking',
  'thinking_budget',
  'reasoning_split',
  'stream_options',
  'parallel_tool_calls',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'top_k',
  'topK',
  'messages',
  'content',
]

export function rectifyOpenAICompatibleRequestBody(input: OpenAICompatibleRequestRectificationInput): OpenAICompatibleRequestRectificationResult | undefined {
  if (input.rectified) return undefined
  if (input.req.provider.type !== 'openai-compatible' || input.req.provider.wireProtocol === 'anthropic-compatible') return undefined
  if (input.status !== 400 && input.status !== 422) return undefined
  if (!isOpenAICompatibleParameterError(input.errorText)) return undefined

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body)
  } catch {
    return undefined
  }

  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : input.req.model
  const messages = minimalOpenAICompatibleMessages(parsed.messages)
  if (!messages.length) return undefined

  const next: Record<string, unknown> = { model, messages }
  if (typeof parsed.stream === 'boolean') next.stream = parsed.stream

  const messagesChanged = JSON.stringify(parsed.messages) !== JSON.stringify(messages)
  const parsedKeys = Object.keys(parsed)
  const removedFields = parsedKeys.filter((key) => !OPENAI_COMPATIBLE_MINIMAL_CHAT_KEYS.has(key) || (key === 'messages' && messagesChanged))
  const retainedFields = Object.keys(next)
  const failedFields = inferOpenAICompatibleFailedFields(input.errorText, parsedKeys, removedFields)
  if (!removedFields.length && !messagesChanged) return undefined

  return {
    kind: 'openai_compatible_minimal_chat',
    body: next,
    failedFields,
    removedFields,
    retainedFields,
  }
}

function isOpenAICompatibleParameterError(errorText: string): boolean {
  const text = errorText.toLowerCase()
  if (/api[_ -]?key|authentication|authorization|permission|quota|billing|rate[_ -]?limit|model\s+(?:not\s+found|not\s+available|does\s+not\s+exist|invalid)/.test(text)) return false
  return /unsupported|not\s+support(?:ed)?|unknown\s+(?:parameter|param|field)|unrecognized\s+(?:parameter|param|field)|invalid[_ -]?request|invalid\s+(?:request|parameter|param|field|schema)|bad\s+(?:request|schema)|schema|parameter|param|field|tool|response[_ -]?format|reasoning|thinking/.test(text)
}

function inferOpenAICompatibleFailedFields(errorText: string, bodyKeys: string[], removedFields: string[]): string[] {
  const text = errorText.toLowerCase()
  const candidates = [...bodyKeys, ...OPENAI_COMPATIBLE_PARAMETER_ERROR_FIELDS]
  const matched: string[] = []
  for (const field of candidates) {
    if (openAICompatibleErrorMentionsField(text, field) && !matched.includes(field)) matched.push(field)
  }
  if (matched.length) return matched
  return removedFields
}

function openAICompatibleErrorMentionsField(text: string, field: string): boolean {
  const normalized = field.toLowerCase()
  return text.includes(normalized) ||
    text.includes(normalized.replace(/_/g, ' ')) ||
    text.includes(normalized.replace(/_/g, '-'))
}

function minimalOpenAICompatibleMessages(value: unknown): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(value)) return []
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  for (const item of value) {
    if (!isOpenAICompatibleRecord(item)) continue
    const role = item.role === 'system' || item.role === 'user' || item.role === 'assistant' ? item.role : undefined
    if (!role) continue
    const content = minimalOpenAICompatibleTextContent(item.content)
    if (!content.trim()) continue
    messages.push({ role, content })
  }
  return messages
}

function minimalOpenAICompatibleTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (!isOpenAICompatibleRecord(part)) return ''
        if (typeof part.text === 'string') return part.text
        if (part.type === 'text' && typeof part.content === 'string') return part.content
        return ''
      })
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n')
  }
  if (isOpenAICompatibleRecord(value) && typeof value.text === 'string') return value.text
  return ''
}

function isOpenAICompatibleRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function rectifyXiaomiMimoThinkingRequestBody(input: {
  req: ChatRequest
  body: string
  status: number
  errorText: string
  rectified: boolean
}): { kind: 'xiaomi_mimo_thinking_disabled'; body: Record<string, unknown> } | undefined {
  if (input.rectified) return undefined
  if (input.req.provider.type !== 'xiaomi-mimo' || input.req.provider.wireProtocol === 'anthropic-compatible') return undefined
  if (input.status !== 400) return undefined
  if (!/\bparam\s+incorrect\b|invalid\s+(?:request\s+)?format|invalid_request/i.test(input.errorText)) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body)
  } catch {
    return undefined
  }
  const thinking = parsed.thinking
  if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking)) return undefined
  if ((thinking as Record<string, unknown>).type !== 'enabled') return undefined
  return {
    kind: 'xiaomi_mimo_thinking_disabled',
    body: {
      ...parsed,
      thinking: { type: 'disabled' },
    },
  }
}

export function rectifyXiaomiMimoWebSearchRequestBody(input: {
  req: ChatRequest
  body: string
  status: number
  errorText: string
  rectified: boolean
}): { kind: 'xiaomi_mimo_web_search_removed'; body: Record<string, unknown> } | undefined {
  if (input.rectified) return undefined
  if (input.req.provider.type !== 'xiaomi-mimo' || input.req.provider.wireProtocol === 'anthropic-compatible') return undefined
  if (input.status !== 400) return undefined
  if (!/\bparam\s+incorrect\b|invalid\s+(?:request\s+)?format|unsupported\s+web[_ -]?search|web[_ -]?search/i.test(input.errorText)) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed.tools)) return undefined
  const tools = parsed.tools.filter((tool) => !(tool && typeof tool === 'object' && !Array.isArray(tool) && (tool as Record<string, unknown>).type === 'web_search'))
  if (tools.length === parsed.tools.length) return undefined
  const next: Record<string, unknown> = { ...parsed }
  if (tools.length) next.tools = tools
  else delete next.tools
  if (!tools.length && next.tool_choice === 'auto') delete next.tool_choice
  return {
    kind: 'xiaomi_mimo_web_search_removed',
    body: next,
  }
}

export async function resolveRuntimeFallbackPlan(input: RuntimeFallbackPlanInput): Promise<RuntimeFallbackPlan> {
  const nowMs = Date.now()
  const original = routeForRuntimeFallback(input.req, input.credentialGroupId)
  const classification = await recordProviderRuntimeFailure({
    req: input.req,
    credentialGroupId: input.credentialGroupId,
    status: input.status,
    error: input.error,
    responseText: input.responseText,
    streamStarted: input.streamStarted,
    retryAfterMs: retryAfterMsFromFailure(input.status),
    nowMs,
  })
  const snapshot = await loadProviderHealthSnapshot({ nowMs })
  const healthRecords = indexProviderHealthRecords(snapshot.records)
  const requiredCapabilities = requiredFallbackCapabilities(input.req)
  const candidates = buildProviderFallbackCandidates({
    providers: fallbackProvidersForRequest(input.req),
    original,
    requiredCapabilities,
    healthRecords,
    nowMs,
  })
  const decision = resolveFailoverDecision({
    policy: { mode: 'same-provider' },
    trigger: classification.trigger,
    original,
    candidates: candidates.candidates,
    requiredCapabilities,
    streamStarted: input.streamStarted,
  })
  return { classification, decision, candidates }
}

async function tryRuntimeFallback(input: RuntimeFallbackExecutionInput): Promise<boolean> {
  const plan = await resolveRuntimeFallbackPlan({
    req: input.req,
    status: input.status,
    responseText: input.responseText,
    credentialGroupId: input.credentialGroupId,
  })
  await logRuntimeFallbackDecision(input.req, plan)
  if (!plan.decision.eligible || !plan.decision.selected) {
    recordRuntimeSessionAffinityInvalidation({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      status: input.status,
      responseText: input.responseText,
      classification: plan.classification,
    })
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'skipped'))
    return false
  }

  const selectedRoute = plan.decision.selected
  const selectedProvider = providerForRuntimeFallback(input.req, selectedRoute)
  const selectedReq: ChatRequest = {
    ...input.req,
    provider: selectedProvider,
    model: selectedRoute.model,
    requestedModel: selectedRoute.model,
    stream: false,
  }
  const selectedAssembly = assembleProviderRoute({
    provider: selectedReq.provider,
    model: selectedReq.model,
    stream: false,
    usesResponsesApi: usesOpenAIResponses(selectedReq),
    settings: selectedReq.settings,
    hasWebSocketRuntime: typeof WebSocket !== 'undefined',
  })
  const selectedRouteResult = input.resolveRoute(selectedReq, {
    endpoint: selectedAssembly.endpoint,
    transport: selectedAssembly.transportSelection.transport,
    requestedTransportMode: selectedAssembly.transportSelection.requestedMode,
    transportFallbackReason: selectedAssembly.transportSelection.fallbackReason,
  }, {
    policy: { mode: 'same-provider' },
    trigger: plan.classification.trigger,
    original: routeForRuntimeFallback(input.req, input.credentialGroupId),
    candidates: plan.candidates.candidates,
    requiredCapabilities: requiredFallbackCapabilities(input.req),
  })
  await logProviderRouteDecision(selectedReq, selectedRouteResult.decision)
  await logProviderCompatibility(selectedReq)
  await logProviderConformance(selectedReq, selectedRouteResult.conformance)
  if (selectedRouteResult.decision.blocked) {
    recordRuntimeSessionAffinityInvalidation({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      status: input.status,
      responseText: input.responseText,
      classification: plan.classification,
    })
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', 'route_blocked'))
    return false
  }
  const selectedPreparedRequest = prepareHttpJsonRequest({
    provider: selectedReq.provider,
    model: selectedReq.model,
    url: selectedAssembly.endpoint,
    headers: getHeaders(selectedReq.provider),
    body: selectedRouteResult.body,
  })
  const selectedResponse = await fetchWithTimeout(
    selectedPreparedRequest.url,
    {
      method: 'POST',
      headers: selectedPreparedRequest.headers,
      body: selectedPreparedRequest.body,
    },
    CHAT_REQUEST_TIMEOUT_MS
  )
  if (!selectedResponse.ok) {
    await recordRuntimeFallbackFailure(selectedRoute, selectedResponse.status, await safeResponseText(selectedResponse))
    recordRuntimeSessionAffinityInvalidation({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      status: input.status,
      responseText: input.responseText,
      classification: plan.classification,
    })
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', `upstream_${selectedResponse.status}`))
    return false
  }

  await recordRuntimeFallbackSuccess(selectedRoute)
  recordRuntimeSessionAffinityRotation({
    req: input.req,
    originalCredentialGroupId: input.credentialGroupId,
    selectedCredentialGroupId: selectedRoute.credentialGroupId,
    selectedProviderId: selectedRoute.providerId,
    status: input.status,
    responseText: input.responseText,
    classification: plan.classification,
  })
  const selectedResult = await parseProviderNonStreamingResponse(selectedResponse, selectedReq)
  input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'done'))
  input.onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
  if (selectedResult.text) input.onChunk(selectedResult.text)
  if (selectedResult.citations?.length) input.onCitations?.(selectedResult.citations)
  selectedResult.traces?.forEach(input.onTrace ?? (() => undefined))
  void appendRuntimeLog('upstream.response', {
    conversationId: input.req.conversationId,
    providerId: selectedReq.provider.id,
    model: selectedReq.model,
    requestedModel: selectedReq.requestedModel,
    upstreamModel: selectedReq.model,
    transport: 'http_sse',
    fallback: true,
    usage: selectedResult.usage,
    textLength: selectedResult.text.length,
  }, runtimeLogOptions(input.req))
  input.onDone(withCredentialGroup(selectedResult, selectedRoute.credentialGroupId))
  return true
}

function recordRuntimeSessionAffinityInvalidation(input: RuntimeSessionAffinityFailureInput): SessionAffinityBinding | undefined {
  if (!sessionAffinityFailureShouldInvalidate({
    status: input.status,
    trigger: input.classification.trigger,
    responseText: input.responseText,
  })) {
    return undefined
  }
  const model = runtimeSessionAffinityModel(input.req)
  const binding = invalidateSessionAffinityBinding({
    enabled: input.req.settings?.sessionAffinityEnabled === true,
    providerId: input.req.provider.id,
    model,
    conversationId: input.req.conversationId,
    sessionId: input.req.sessionId,
    credentialGroupId: input.credentialGroupId,
  })
  if (!binding) return undefined
  void emitRuntimeEvent({
    event: 'session.affinity.invalidated',
    conversationId: input.req.conversationId,
    providerId: input.req.provider.id,
    credentialGroupId: binding.credentialGroupId,
    model: input.req.model,
    data: {
      status: input.status,
      trigger: input.classification.trigger,
      fromGroupId: binding.credentialGroupId,
      sessionKeyAvailable: true,
      bindingExpiresAt: binding.expiresAt,
      failoverCount: binding.failoverCount,
    },
    legacyData: {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      credentialGroupId: binding.credentialGroupId,
      status: 'invalidated',
      upstreamStatus: input.status,
      trigger: input.classification.trigger,
      fromGroupId: binding.credentialGroupId,
      expiresAt: binding.expiresAt,
      failoverCount: binding.failoverCount,
    },
    options: runtimeLogOptions(input.req),
  })
  return binding
}

function recordRuntimeSessionAffinityRotation(input: RuntimeSessionAffinityFailureInput & {
  originalCredentialGroupId?: string
  selectedCredentialGroupId?: string
  selectedProviderId?: string
}): SessionAffinityBinding | undefined {
  if (!input.selectedCredentialGroupId) return undefined
  if (input.selectedProviderId && input.selectedProviderId !== input.req.provider.id) return undefined
  if (input.selectedCredentialGroupId === input.originalCredentialGroupId) return undefined
  if (!sessionAffinityFailureShouldInvalidate({
    status: input.status,
    trigger: input.classification.trigger,
    responseText: input.responseText,
  })) {
    return undefined
  }
  const model = runtimeSessionAffinityModel(input.req)
  const previousBinding = readRuntimeSessionAffinityBinding(input.req)
  const binding = rotateSessionAffinityBinding({
    enabled: input.req.settings?.sessionAffinityEnabled === true,
    providerId: input.req.provider.id,
    model,
    conversationId: input.req.conversationId,
    sessionId: input.req.sessionId,
    credentialGroupId: input.selectedCredentialGroupId,
    ttlMs: input.req.settings?.sessionAffinityTtlMs,
    reason: 'failover',
    previousBinding,
  })
  if (!binding) return undefined
  void emitRuntimeEvent({
    event: 'session.affinity.rotated',
    conversationId: input.req.conversationId,
    providerId: input.req.provider.id,
    credentialGroupId: binding.credentialGroupId,
    model: input.req.model,
    data: {
      status: input.status,
      trigger: input.classification.trigger,
      fromGroupId: previousBinding?.credentialGroupId ?? input.originalCredentialGroupId,
      toGroupId: binding.credentialGroupId,
      sessionKeyAvailable: true,
      bindingExpiresAt: binding.expiresAt,
      failoverCount: binding.failoverCount,
    },
    legacyData: {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      credentialGroupId: binding.credentialGroupId,
      status: 'rotated',
      upstreamStatus: input.status,
      trigger: input.classification.trigger,
      fromGroupId: previousBinding?.credentialGroupId ?? input.originalCredentialGroupId,
      toGroupId: binding.credentialGroupId,
      expiresAt: binding.expiresAt,
      failoverCount: binding.failoverCount,
    },
    options: runtimeLogOptions(input.req),
  })
  return binding
}

function readRuntimeSessionAffinityBinding(req: ChatRequest): SessionAffinityBinding | undefined {
  const sessionKey = deriveSessionAffinityKey({
    conversationId: req.conversationId,
    sessionId: req.sessionId,
    providerId: req.provider.id,
    model: runtimeSessionAffinityModel(req),
  })
  return readSessionAffinityBinding(sessionKey)
}

function runtimeSessionAffinityModel(req: ChatRequest): string {
  return req.requestedModel ?? req.model
}

async function retryWithoutStreaming(
  req: ChatRequest,
  resolveRoute: ProviderRuntimeRouteResolver,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onCitations?: CitationCallback,
  onTrace?: TraceCallback,
  credentialGroupId?: string,
  controller?: AbortController
): Promise<void> {
  const startedAt = Date.now()
  try {
    const fallbackReq = { ...req, stream: false }
    const url = resolveNonStreamingProviderEndpoint(fallbackReq)
    const fallbackPreparedRequest = prepareHttpJsonRequest({
      provider: fallbackReq.provider,
      model: fallbackReq.model,
      url,
      headers: getHeaders(fallbackReq.provider),
      body: resolveRoute(fallbackReq).body,
    })
    const response = await fetchChatStreamWithRetry({
      req: fallbackReq,
      url: fallbackPreparedRequest.url,
      headers: fallbackPreparedRequest.headers,
      body: fallbackPreparedRequest.body,
      stream: false,
      controller: controller ?? new AbortController(),
      credentialGroupId,
      onTrace,
    })
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      const recovered = await tryRuntimeFallback({ req: fallbackReq, status: response.status, responseText: errorText, credentialGroupId, resolveRoute, onChunk, onDone, onCitations, onTrace })
      if (recovered) return
      const errorCode = classifyHttpStatus(response.status, errorText, fallbackReq.model, fallbackReq.provider)
      onError(providerRuntimeError(
        formatProviderHttpError(response.status, errorText, fallbackReq.provider, fallbackReq.model),
        credentialGroupId,
        providerOperationCodeToChatErrorCode(errorCode)
      ))
      return
    }
    const result = await parseProviderNonStreamingResponse(response, fallbackReq)
    onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
    if (result.text) onChunk(result.text)
    if (result.citations?.length) onCitations?.(result.citations)
    result.traces?.forEach(onTrace ?? (() => undefined))
    void recordProviderRuntimeSuccess({
      req,
      credentialGroupId,
      latencyMs: Date.now() - startedAt,
    })
    void appendRuntimeLog('upstream.response', {
      conversationId: req.conversationId,
      providerId: req.provider.id,
      model: req.model,
      requestedModel: req.requestedModel,
      upstreamModel: req.model,
      transport: 'http_sse',
      fallback: true,
      usage: result.usage,
      textLength: result.text.length,
    }, runtimeLogOptions(req))
    onDone(withCredentialGroup(result, credentialGroupId))
  } catch (error) {
    void recordProviderRuntimeFailure({
      req,
      credentialGroupId,
      error,
      latencyMs: Date.now() - startedAt,
    })
    const runtimeError = error instanceof Error ? error as ProviderRuntimeError : providerRuntimeError(st('providerOperation.requestFailed'))
    runtimeError.credentialGroupId = runtimeError.credentialGroupId ?? credentialGroupId
    onError(runtimeError)
  }
}

function optimizeRouteBody(body: Record<string, unknown>, req: ChatRequest): Record<string, unknown> {
  return optimizeProviderRequestBody(body, {
    provider: req.provider,
    model: req.model,
    reasoningEffort: req.reasoningEffort,
    settings: req.settings,
    fallbackMaxTokens: clampMaxTokens(req),
  })
}

function providerOperationCodeToChatErrorCode(code: ProviderOperationCode): ChatErrorCode {
  switch (code) {
    case 'missing_key':
    case 'credential_mismatch':
    case 'bad_auth':
    case 'bad_base_url':
    case 'model_unavailable':
    case 'network_error':
    case 'timeout':
    case 'rate_limited':
    case 'max_tokens_exceeded':
      return code
    case 'models_endpoint_unavailable':
      return 'model_unavailable'
    case 'ok':
    case 'empty_models':
    case 'unknown':
      return 'unknown'
  }
}
