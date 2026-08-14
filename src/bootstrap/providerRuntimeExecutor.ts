import type { AIProvider, ChatErrorCode, ProviderOperationCode, ProviderType } from '@/types/providerContracts'
import { st } from '@/i18n/service'
import type { MessageUsage } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'
import type { ProcessTrace } from '@/core'
import { fallbackProvidersForRequest, providerForRuntimeFallback, requiredFallbackCapabilities, retryAfterMsFromFailure, routeForRuntimeFallback, updateCredentialGroupHealth, type ProviderFallbackCandidateBuilder } from '@/modules/providers'
import type { ProviderFailureClassification } from '@/modules/providers'
import type {
  ProviderRuntimeChatRequest,
  ProviderRuntimeChunkCallback,
  ProviderRuntimeCitationCallback,
  ProviderRuntimeDoneCallback,
  ProviderRuntimeErrorCallback,
  ProviderRuntimeTraceCallback,
} from '@/modules/providers'
import { resolveFailoverDecision } from '@/modules/providers'
import {
  createProviderTextToolCallStreamFilter,
  dedupeCitations,
  executableProviderToolCalls,
  extractCitationsFromText,
  extractProviderCitationsFromSse,
  filterProviderStructuredOutputToolCalls,
  indexProviderHealthRecords,
  mergeProviderToolCallParts,
  mergeAnthropicReplayContentBlocks,
  mergeOpenAIResponseReplayItems,
  providerStructuredOutputToolCallText,
  sanitizeAnthropicReplayContentBlocks,
  type ProviderCitationSource,
  type ProviderRouteAssembly,
  type ProviderRouteAssemblyInput,
  type ProviderToolCall,
} from '@/modules/providers'
import { loadProviderHealthSnapshot } from '@/bootstrap/providerHealthRepository'
import { getProviderRequestHeaders as getHeaders } from '@/modules/providers'
import { usesOpenAIResponses } from '@/bootstrap/providerRequestPolicies'
import { rectifyAnthropicRequestBody } from '@/modules/providers'
import { optimizeRequestBody as optimizeProviderRequestBody } from '@/bootstrap/providerRequestPolicies'
import { providerRuntimeError, withCredentialGroup, type ProviderRuntimeError } from '@/modules/providers'
import { runStreamTask } from '@/bootstrap/providerRuntimeResults'
import {
  dedupeTraces,
  parseProviderBufferedStreamResponse,
  parseProviderNonStreamingResponse,
  parseProviderStreamChunk,
  parseProviderStreamEvent,
  providerReasoningResponseCanBeParsed,
  splitSseBuffer,
  withProviderTextToolCallFallback,
} from '@/bootstrap/providerResponsePolicies'
import { createProviderTrace } from '@/bootstrap/providerTracePolicy'
import { recordProviderRuntimeFailure, recordProviderRuntimeSuccess } from '@/bootstrap/providerRuntimeHealth'
import { createRuntimeFallbackTrace, createStreamModeTrace, describeRequestRectification, logProviderCompatibility, logProviderConformance, logProviderRouteDecision, runtimeLogOptions } from '@/bootstrap/providerRuntimeDiagnostics'
import type { ProviderRuntimeFallbackEffects, ProviderRuntimeFallbackPlan } from '@/bootstrap/providerRuntimeFallbackEffects'
import { assertProviderCircuitClosed, createProviderRetryAbortError, delayProviderRetry, isProviderRetryCancellation, logProviderRetryAttempt, providerCircuitKey, providerRetryDelayMs, recordProviderCircuitFailure, recordProviderCircuitSuccess, resolveProviderMaxRetries, resolveProviderRequestTimeoutMs, throwIfProviderRetryAborted } from '@/bootstrap/providerRetryRuntime'
import { isPerplexityProvider } from '@/modules/providers'
import { getWireProviderType, isAnthropicWireRequest } from '@/modules/providers'
import { clampMaxTokens } from '@/bootstrap/providerRequestPolicies'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/modules/providers'
import { resolveProviderContextManagement } from '@/modules/providers'
import { classifyHttpStatus } from '@/modules/providers'
import { formatProviderHttpError } from '@/bootstrap/providerResponsePolicies'
import { prepareHttpJsonRequest, type ProviderRuntimePipelineReady, type ProviderRuntimeRouteResolver } from '@/bootstrap/providerRuntimePipeline'
import { deriveSessionAffinityKey, invalidateSessionAffinityBinding, readSessionAffinityBinding, rotateSessionAffinityBinding, sessionAffinityFailureShouldInvalidate, type SessionAffinityBinding } from '@/modules/providers'
import { acquireProviderSessionLease } from '@/bootstrap/providerSessionLeasePool'
import type { ResponsesWebSocketTransport } from '@/modules/providers'
import { emitRuntimeEvent } from '@/services/runtimeEvents'
import { appendRuntimeLog } from '@/services/runtimeLog'
import { recordProviderUsageAttempt } from '@/bootstrap/usageStatisticsRuntime'

export type { ProviderRuntimeFallbackEffects } from '@/bootstrap/providerRuntimeFallbackEffects'

const CHAT_REQUEST_TIMEOUT_MS = 60000
const TERMINAL_READER_CLOSE_GRACE_MS = 50

type ProviderUsageAttemptReason = 'initial' | 'retry' | 'rectification' | 'fallback'

interface SuccessfulProviderUsageAttempt {
  startedAt: number
  attempt: number
  reason: ProviderUsageAttemptReason
  firstTokenAt?: number
}

const successfulProviderUsageAttempts = new WeakMap<Response, SuccessfulProviderUsageAttempt>()

export interface ProviderRuntimeTransport {
  assembleRoute(input: ProviderRouteAssemblyInput): ProviderRouteAssembly
  resolveEndpoint(input: ProviderRouteAssemblyInput): string
  endpointHost(url: string): string | undefined
  toWebSocketUrl(url: string): string
  request(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response>
  requestStream(input: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response>
  readResponseText(response: Response): Promise<string>
}

export interface ProviderRuntimeChatExecutionInput {
  pipeline: ProviderRuntimePipelineReady
  controller: AbortController
  resolveRoute: ProviderRuntimeRouteResolver
  onChunk: ProviderRuntimeChunkCallback
  onDone: ProviderRuntimeDoneCallback
  onError: ProviderRuntimeErrorCallback
  onCitations?: ProviderRuntimeCitationCallback
  onTrace?: ProviderRuntimeTraceCallback
  transport: ProviderRuntimeTransport
  responsesWebSocketTransport: ResponsesWebSocketTransport
  buildFallbackCandidates: ProviderFallbackCandidateBuilder
  fallbackEffects: ProviderRuntimeFallbackEffects
}

export interface HttpSseExecutionInput {
  req: ProviderRuntimeChatRequest
  url: string
  headers: Record<string, string>
  body: string
  stream: boolean
  controller: AbortController
  credentialGroupId?: string
  resolveRoute: ProviderRuntimeRouteResolver
  onChunk: ProviderRuntimeChunkCallback
  onDone: ProviderRuntimeDoneCallback
  onError: ProviderRuntimeErrorCallback
  onCitations?: ProviderRuntimeCitationCallback
  onTrace?: ProviderRuntimeTraceCallback
  transport: ProviderRuntimeTransport
  buildFallbackCandidates: ProviderFallbackCandidateBuilder
  fallbackEffects: ProviderRuntimeFallbackEffects
  initialAttemptReason?: ProviderUsageAttemptReason
}

export interface FetchChatStreamWithRetryInput {
  req: ProviderRuntimeChatRequest
  url: string
  headers: Record<string, string>
  body: string
  stream: boolean
  controller: AbortController
  credentialGroupId?: string
  onTrace?: ProviderRuntimeTraceCallback
  transport: ProviderRuntimeTransport
  initialAttemptReason?: ProviderUsageAttemptReason
}

export interface RuntimeFallbackPlanInput {
  req: ProviderRuntimeChatRequest
  status?: number
  error?: unknown
  responseText?: string
  emptyResponse?: boolean
  credentialGroupId?: string
  streamStarted?: boolean
  buildFallbackCandidates: ProviderFallbackCandidateBuilder
}

export type RuntimeFallbackPlan = ProviderRuntimeFallbackPlan

interface RuntimeFallbackExecutionInput {
  req: ProviderRuntimeChatRequest
  status: number
  responseText: string
  emptyResponse?: boolean
  credentialGroupId?: string
  resolveRoute: ProviderRuntimeRouteResolver
  onChunk: ProviderRuntimeChunkCallback
  onDone: ProviderRuntimeDoneCallback
  onCitations?: ProviderRuntimeCitationCallback
  onTrace?: ProviderRuntimeTraceCallback
  transport: ProviderRuntimeTransport
  buildFallbackCandidates: ProviderFallbackCandidateBuilder
  controller: AbortController
  fallbackEffects: ProviderRuntimeFallbackEffects
}

interface OpenAICompatibleRequestRectificationInput {
  req: ProviderRuntimeChatRequest
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
  req: ProviderRuntimeChatRequest
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
    transport: input.transport,
    buildFallbackCandidates: input.buildFallbackCandidates,
    fallbackEffects: input.fallbackEffects,
  }), input.onError, pipeline.credentialGroupId, input.controller.signal)
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
    const signal = input.controller.signal
    let emittedText = false
    const usageStartedAt = Date.now()
    let firstTokenAt: number | undefined
    let usageRecorded = false
    const recordWebSocketUsage = (
      status: 'success' | 'failed' | 'cancelled',
      usage?: MessageUsage,
      errorCode?: string,
    ) => {
      if (usageRecorded) return
      usageRecorded = true
      void recordProviderUsageAttempt({
        provider: runtimeReq.provider,
        credentialGroupId,
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        operationSource: providerUsageOperationSource(runtimeReq),
        status,
        ...(errorCode ? { errorCode } : {}),
        isStreaming: stream,
        startedAt: usageStartedAt,
        ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
        attempt: 0,
        attemptReason: 'initial',
        ...(runtimeReq.usageContext?.correlationId ? { correlationId: runtimeReq.usageContext.correlationId } : {}),
        ...(runtimeReq.conversationId ? { conversationId: runtimeReq.conversationId } : {}),
        ...(runtimeReq.usageContext?.runId ? { runId: runtimeReq.usageContext.runId } : {}),
        ...(usage ? { usage } : {}),
      })
    }
    try {
      await input.responsesWebSocketTransport.run({
        req: runtimeReq,
        url: input.transport.toWebSocketUrl(proxyPolicy.effectiveUrl),
        headers,
        body: rawBody as Record<string, unknown>,
        signal,
        parseEvent: parseProviderStreamEvent,
        wireProviderType: getWireProviderType(runtimeReq.provider),
        extractCitations: extractCitationsFromText,
        onChunk: (chunk) => {
          if (signal.aborted) return
          emittedText = emittedText || !!chunk
          if (chunk && firstTokenAt === undefined) firstTokenAt = Date.now()
          input.onChunk(chunk)
        },
        onDone: (result) => {
          if (signal.aborted) return
          if (!hasDeliverableProviderOutput(result)) {
            recordWebSocketUsage('failed', result.usage, 'empty_response')
            throw emptyProviderResponseError(credentialGroupId)
          }
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
          recordWebSocketUsage('success', result.usage)
          input.onDone(withCredentialGroup(result, credentialGroupId))
        },
        onError: (error) => {
          if (!signal.aborted) {
            recordWebSocketUsage('failed', undefined, error.name || 'websocket_error')
            input.onError(error)
          }
        },
        onCitations: (citations) => {
          if (!signal.aborted) input.onCitations?.(citations)
        },
        onTrace: (trace) => {
          if (!signal.aborted) input.onTrace?.(trace)
        },
      })
    } catch (error) {
      if (signal.aborted) {
        recordWebSocketUsage('cancelled', undefined, 'cancelled')
        throwProviderRuntimeCancellation(signal, error)
      }
      recordWebSocketUsage('failed', undefined, error instanceof Error ? error.name : 'websocket_error')
      if ((effectiveReq.settings?.transportMode ?? 'auto') === 'websocket' || emittedText) {
        void recordProviderRuntimeFailure({
          req: runtimeReq,
          credentialGroupId,
          error,
          streamStarted: emittedText,
          emptyResponse: isEmptyProviderResponseError(error),
        })
        throw error
      }
      input.onTrace?.(createStreamModeTrace('fallback', 'Responses WebSocket handshake failed; HTTP/SSE fallback is running.'))
      throwIfProviderRuntimeAborted(signal)
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
        transport: input.transport,
        buildFallbackCandidates: input.buildFallbackCandidates,
        fallbackEffects: input.fallbackEffects,
        initialAttemptReason: 'fallback',
      })
    } finally {
      lease.release()
    }
  }, input.onError, credentialGroupId, input.controller.signal)
}

async function acquireWebSocketLease(input: ProviderRuntimeChatExecutionInput): Promise<Awaited<ReturnType<typeof acquireProviderSessionLease>> | null> {
  const { effectiveReq, runtimeReq, credentialGroupId } = input.pipeline
  try {
    const lease = await acquireProviderSessionLease({
      key: `${runtimeReq.provider.id}:${runtimeReq.model}:${effectiveReq.conversationId ?? 'global'}:${effectiveReq.sessionId ?? 'default'}`,
      limit: effectiveReq.settings?.sessionConcurrencyLimit,
      timeoutMs: effectiveReq.settings?.sessionQueueTimeoutMs,
      signal: input.controller.signal,
    })
    if (input.controller.signal.aborted) {
      lease.release()
      throwProviderRuntimeCancellation(input.controller.signal)
    }
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
  } catch (error) {
    if (input.controller.signal.aborted) throwProviderRuntimeCancellation(input.controller.signal, error)
    if (error instanceof Error && error.name === 'AbortError') throw error
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
    if (input.controller.signal.aborted) {
      throwProviderRuntimeCancellation(input.controller.signal, error)
    }
    void recordProviderRuntimeFailure({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      error,
      streamStarted,
      latencyMs: Date.now() - startedAt,
    })
    throw error
  }
  if (input.controller.signal.aborted) {
    recordSuccessfulProviderUsageAttempt(response, input, undefined, 'cancelled', 'cancelled')
  }
  throwIfProviderRuntimeAborted(input.controller.signal)

  if (!response.ok) {
    const errorText = await input.transport.readResponseText(response)
    throwIfProviderRuntimeAborted(input.controller.signal)
    const compactFallbackAttempted = await tryRemoteCompactLocalFallback({
      ...input,
      status: response.status,
      responseText: errorText,
      startedAt,
    })
    throwIfProviderRuntimeAborted(input.controller.signal)
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
      transport: input.transport,
      buildFallbackCandidates: input.buildFallbackCandidates,
      controller: input.controller,
      fallbackEffects: input.fallbackEffects,
    })
    throwIfProviderRuntimeAborted(input.controller.signal)
    if (recovered) return
    input.req.provider = updateCredentialGroupHealth(input.req.provider, input.credentialGroupId, false)
    void appendRuntimeLog('upstream.error', {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      upstreamModel: input.req.model,
      status: response.status,
      endpointHost: input.transport.endpointHost(input.url),
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
    const result = await parseProviderNonStreamingResponse(response, input.req).catch((error) => {
      recordSuccessfulProviderUsageAttempt(response, input, undefined, 'failed', error instanceof Error ? error.name : 'parse_failed')
      throw error
    })
    throwIfProviderRuntimeAborted(input.controller.signal)
    if (!hasDeliverableProviderOutput(result)) {
      recordSuccessfulProviderUsageAttempt(response, input, result.usage, 'failed', 'empty_response')
      const recovered = await tryRuntimeFallback({
        req: input.req,
        status: response.status,
        responseText: '',
        emptyResponse: true,
        credentialGroupId: input.credentialGroupId,
        resolveRoute: input.resolveRoute,
        onChunk: input.onChunk,
        onDone: input.onDone,
        onCitations: input.onCitations,
        onTrace: input.onTrace,
        transport: input.transport,
        buildFallbackCandidates: input.buildFallbackCandidates,
        controller: input.controller,
        fallbackEffects: input.fallbackEffects,
      })
      if (!recovered) input.onError(emptyProviderResponseError(input.credentialGroupId))
      return
    }
    if (result.text) {
      input.onChunk(result.text)
      throwIfProviderRuntimeAborted(input.controller.signal)
    }
    if (result.citations?.length) {
      input.onCitations?.(result.citations)
      throwIfProviderRuntimeAborted(input.controller.signal)
    }
    for (const trace of result.traces ?? []) {
      input.onTrace?.(trace)
      throwIfProviderRuntimeAborted(input.controller.signal)
    }
    void recordProviderRuntimeSuccess({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      latencyMs: Date.now() - startedAt,
    })
    recordSuccessfulProviderUsageAttempt(response, input, result.usage)
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
    throwIfProviderRuntimeAborted(input.controller.signal)
    const raw = await input.transport.readResponseText(response)
    throwIfProviderRuntimeAborted(input.controller.signal)
    let result: ReturnType<typeof parseProviderBufferedStreamResponse>
    try {
      result = parseProviderBufferedStreamResponse(raw, input.req, getWireProviderType(input.req.provider))
    } catch (error) {
      recordSuccessfulProviderUsageAttempt(response, input, undefined, 'failed', error instanceof Error ? error.name : 'parse_failed')
      throw error
    }
    if (result.text || result.providerToolCalls?.length) {
      input.onChunk(result.text)
      throwIfProviderRuntimeAborted(input.controller.signal)
      if (result.citations?.length) {
        input.onCitations?.(result.citations)
        throwIfProviderRuntimeAborted(input.controller.signal)
      }
      for (const trace of result.traces ?? []) {
        input.onTrace?.(trace)
        throwIfProviderRuntimeAborted(input.controller.signal)
      }
      void recordProviderRuntimeSuccess({
        req: input.req,
        credentialGroupId: input.credentialGroupId,
        latencyMs: Date.now() - startedAt,
      })
      recordSuccessfulProviderUsageAttempt(response, input, result.usage)
      input.onDone(withCredentialGroup(result, input.credentialGroupId))
    } else {
      recordSuccessfulProviderUsageAttempt(response, input, result.usage, 'partial')
      input.onTrace?.(createStreamModeTrace('buffered', st('providerTrace.streamBufferedFallback')))
      await retryWithoutStreaming(
        input.req,
        input.resolveRoute,
        input.onChunk,
        input.onDone,
        input.onError,
        input.transport,
        input.buildFallbackCandidates,
        input.fallbackEffects,
        input.controller,
        input.onCitations,
        input.onTrace,
        input.credentialGroupId,
      )
    }
    return
  }

  input.onTrace?.(createStreamModeTrace('reader', st('providerTrace.streamReader')))
  throwIfProviderRuntimeAborted(input.controller.signal)

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
  let completionDelivered = false

  async function completeStream(): Promise<void> {
    if (completionDelivered) return
    completionDelivered = true

    const finalParsed = parseProviderStreamChunk(buffer, wireProviderType, streamParseOptions)
    buffer = ''
    if (finalParsed.text) {
      fullText += finalParsed.text
      const visibleText = textToolCallFilter.push(finalParsed.text)
      if (visibleText) {
        markProviderUsageFirstToken(response)
        input.onChunk(visibleText)
        throwIfProviderRuntimeAborted(input.controller.signal)
      }
    }
    const filterRemainder = textToolCallFilter.finish()
    if (filterRemainder) {
      markProviderUsageFirstToken(response)
      input.onChunk(filterRemainder)
      throwIfProviderRuntimeAborted(input.controller.signal)
    }
    providerTraces = dedupeTraces([...providerTraces, ...finalParsed.traces])
    providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(finalParsed.providerToolCalls ?? [])])
    providerReasoningContent += finalParsed.reasoningContent ?? ''
    providerResponseItems = mergeOpenAIResponseReplayItems([...providerResponseItems, ...(finalParsed.responseItems ?? [])])
    providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(finalParsed.providerContentBlocks ?? [])])
    for (const trace of finalParsed.traces) {
      input.onTrace?.(trace)
      throwIfProviderRuntimeAborted(input.controller.signal)
    }
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
    if (!hasDeliverableProviderOutput(finalResult)) {
      recordSuccessfulProviderUsageAttempt(response, input, providerUsage, 'failed', 'empty_response')
      const recovered = await tryRuntimeFallback({
        req: input.req,
        status: response.status,
        responseText: '',
        emptyResponse: true,
        credentialGroupId: input.credentialGroupId,
        resolveRoute: input.resolveRoute,
        onChunk: input.onChunk,
        onDone: input.onDone,
        onCitations: input.onCitations,
        onTrace: input.onTrace,
        transport: input.transport,
        buildFallbackCandidates: input.buildFallbackCandidates,
        controller: input.controller,
        fallbackEffects: input.fallbackEffects,
      })
      if (!recovered) input.onError(emptyProviderResponseError(input.credentialGroupId))
      return
    }
    if (citations.length) {
      input.onCitations?.(citations)
      throwIfProviderRuntimeAborted(input.controller.signal)
    }
    void recordProviderRuntimeSuccess({
      req: input.req,
      credentialGroupId: input.credentialGroupId,
      latencyMs: Date.now() - startedAt,
    })
    recordSuccessfulProviderUsageAttempt(response, input, providerUsage)
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
  }

  function cancelReaderAfterTerminal(): void {
    const terminalReader = reader!
    const cancel = () => {
      try {
        void Promise.resolve(terminalReader.cancel()).catch(() => undefined)
      } catch {}
    }

    const closed = terminalReader.closed
    if (!closed || typeof closed.then !== 'function') {
      cancel()
      return
    }

    let settled = false
    const cancelTimer = setTimeout(() => {
      if (settled) return
      settled = true
      cancel()
    }, TERMINAL_READER_CLOSE_GRACE_MS)
    void closed.then(
      () => {
        if (settled) return
        settled = true
        clearTimeout(cancelTimer)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(cancelTimer)
      },
    )
  }

  async function readStream() {
    while (true) {
      const { done, value } = await reader!.read()
      throwIfProviderRuntimeAborted(input.controller.signal)
      if (value) {
        buffer += decoder.decode(value, { stream: !done })
        const { events, remainder } = splitSseBuffer(buffer)
        buffer = remainder
        for (const event of events) {
          throwIfProviderRuntimeAborted(input.controller.signal)
          const parsed = parseProviderStreamChunk(event, wireProviderType, streamParseOptions)
          if (parsed.text) {
            streamStarted = true
            fullText += parsed.text
            const visibleText = textToolCallFilter.push(parsed.text)
            if (visibleText) {
              markProviderUsageFirstToken(response)
              input.onChunk(visibleText)
              throwIfProviderRuntimeAborted(input.controller.signal)
            }
          }
          providerTraces = dedupeTraces([...providerTraces, ...parsed.traces])
          providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(parsed.providerToolCalls ?? [])])
          providerReasoningContent += parsed.reasoningContent ?? ''
          providerResponseItems = mergeOpenAIResponseReplayItems([...providerResponseItems, ...(parsed.responseItems ?? [])])
          providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(parsed.providerContentBlocks ?? [])])
          for (const trace of parsed.traces) {
            input.onTrace?.(trace)
            throwIfProviderRuntimeAborted(input.controller.signal)
          }
          providerUsage = parsed.usage ?? providerUsage
          if (providerCitationSource) {
            providerCitations = dedupeCitations([...providerCitations, ...extractProviderCitationsFromSse(event, providerCitationSource)])
          }
          if (parsed.terminal) {
            try {
              await completeStream()
            } finally {
              cancelReaderAfterTerminal()
            }
            return
          }
        }
      }
      if (done) {
        await completeStream()
        return
      }
    }
  }

  try {
    await readStream()
  } catch (error) {
    if (input.controller.signal.aborted) {
      recordSuccessfulProviderUsageAttempt(response, input, providerUsage, 'cancelled', 'cancelled')
      throwProviderRuntimeCancellation(input.controller.signal, error)
    }
    recordSuccessfulProviderUsageAttempt(
      response,
      input,
      providerUsage,
      'failed',
      error instanceof Error ? error.name : 'stream_failed',
    )
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
  throwIfProviderRuntimeAborted(input.controller.signal)
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
  throwIfProviderRuntimeAborted(input.controller.signal)
  recordRuntimeSessionAffinityInvalidation({
    req: input.req,
    credentialGroupId: input.credentialGroupId,
    status: input.status,
    responseText: input.responseText,
    classification,
  })
  const fallbackReq: ProviderRuntimeChatRequest = {
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
    initialAttemptReason: 'fallback',
    onDone: (result) => input.onDone({
      ...result,
      remoteCompactFallbackUsed: true,
      remoteCompactFallbackReason: fallbackReason,
    }),
  })
  return true
}

function shouldUseRemoteCompactLocalFallback(req: ProviderRuntimeChatRequest, status: number, responseText: string): boolean {
  if (!req.remoteCompactEligible || !req.remoteCompactFallback) return false
  if (![400, 404, 409, 413, 422].includes(status)) return false
  const text = responseText.toLowerCase()
  if (!text.trim()) return status === 400 || status === 413 || status === 422
  return /compact|compaction|context_management|previous_response_id|context[_ -]?length|context window|maximum context|unsupported.*context|unknown parameter/.test(text)
}

/**
 * A retry may select a different model or provider than the original request.
 * Native compaction is route- and identity-bound, so the original eligibility
 * bit must not leak into that request.  If the selected route is not natively
 * eligible, use the already prepared bounded local fallback when available.
 */
function normalizeRemoteCompactRoute(
  req: ProviderRuntimeChatRequest,
  localFallback: ProviderRuntimeChatRequest['remoteCompactFallback'] | undefined,
): ProviderRuntimeChatRequest {
  if (req.remoteCompactEligible !== true) return req
  const nativeEligible = resolveProviderContextManagement({
    provider: req.provider,
    settings: req.settings,
    usesOpenAIResponses: usesOpenAIResponses(req),
  }).nativeSupported
  if (nativeEligible) return req
  return {
    ...req,
    ...(localFallback
      ? {
          messages: localFallback.messages,
          contextPrompt: localFallback.contextPrompt,
        }
      : {}),
    remoteCompactEligible: false,
    remoteCompactFallback: undefined,
    previousResponseId: undefined,
  }
}

function resolveStreamProviderCitationSource(provider: AIProvider, providerType: ProviderType): ProviderCitationSource | undefined {
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'citations')) return undefined
  if (providerType === 'openai-compatible' && isPerplexityProvider(provider)) return 'perplexity'
  if (providerType === 'anthropic' || providerType === 'google' || providerType === 'xiaomi-mimo') return providerType
  return undefined
}

export async function fetchChatStreamWithRetry(input: FetchChatStreamWithRetryInput): Promise<Response> {
  throwIfProviderRetryAborted(input.controller.signal)
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
  let wireAttempt = 0
  let nextAttemptReason: ProviderUsageAttemptReason = input.initialAttemptReason ?? 'initial'

  while (true) {
    const attempt = wireAttempt
    wireAttempt += 1
    const attemptReason = nextAttemptReason
    nextAttemptReason = 'retry'
    const attemptStartedAt = Date.now()
    let attemptObserved = false
    try {
      throwIfProviderRetryAborted(input.controller.signal)
      const response = await input.transport.requestStream(input.url, {
        method: 'POST',
        headers: input.headers,
        body,
        signal: input.controller.signal,
      }, timeoutMs)
      throwIfProviderRetryAborted(input.controller.signal)

      if (response.ok) {
        successfulProviderUsageAttempts.set(response, {
          startedAt: attemptStartedAt,
          attempt,
          reason: attemptReason,
        })
        recordProviderCircuitSuccess(circuitKey, input.controller.signal)
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

      observeFailedProviderUsageAttempt(input, {
        startedAt: attemptStartedAt,
        attempt,
        reason: attemptReason,
        statusCode: response.status,
      })
      attemptObserved = true

      const canRetryStatus = response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500
      if (isAnthropicWireRequest(input.req)) {
        const errorText = await input.transport.readResponseText(response)
        throwIfProviderRetryAborted(input.controller.signal)
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
          nextAttemptReason = 'rectification'
          continue
        }
        if (canRetryStatus && retryCount < maxRetries) {
          logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
          retryCount += 1
          await delayProviderRetry(providerRetryDelayMs(retryCount - 1), input.controller.signal)
          continue
        }
        recordProviderCircuitFailure(input.req, circuitKey, input.controller.signal)
        return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
      }

      if (input.req.provider.type === 'xiaomi-mimo' && input.req.provider.wireProtocol !== 'anthropic-compatible' && response.status === 400) {
        const errorText = await input.transport.readResponseText(response)
        throwIfProviderRetryAborted(input.controller.signal)
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
          nextAttemptReason = 'rectification'
          continue
        }
        if (!canRetryStatus || retryCount >= maxRetries) {
          recordProviderCircuitFailure(input.req, circuitKey, input.controller.signal)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
      }

      if (input.req.provider.type === 'openai-compatible' && input.req.provider.wireProtocol !== 'anthropic-compatible' && (response.status === 400 || response.status === 422)) {
        const errorText = await input.transport.readResponseText(response)
        throwIfProviderRetryAborted(input.controller.signal)
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
          nextAttemptReason = 'rectification'
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
          recordProviderCircuitFailure(input.req, circuitKey, input.controller.signal)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
        if (!canRetryStatus || retryCount >= maxRetries) {
          recordProviderCircuitFailure(input.req, circuitKey, input.controller.signal)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
      }

      if (!canRetryStatus || retryCount >= maxRetries) {
        recordProviderCircuitFailure(input.req, circuitKey, input.controller.signal)
        return response
      }
      logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
      retryCount += 1
      await delayProviderRetry(providerRetryDelayMs(retryCount - 1), input.controller.signal)
    } catch (error) {
      if (isProviderRetryCancellation(input.controller.signal)) {
        if (!attemptObserved) {
          observeFailedProviderUsageAttempt(input, {
            startedAt: attemptStartedAt,
            attempt,
            reason: attemptReason,
            cancelled: true,
          })
        }
        throwProviderRuntimeCancellation(input.controller.signal, error)
      }
      if (!attemptObserved) {
        observeFailedProviderUsageAttempt(input, {
          startedAt: attemptStartedAt,
          attempt,
          reason: attemptReason,
          errorCode: error instanceof Error ? error.name : 'request_failed',
        })
      }
      if (retryCount >= maxRetries) {
        recordProviderCircuitFailure(input.req, circuitKey, input.controller.signal)
        throw error
      }
      logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { error: error instanceof Error ? error.message : 'request_failed' })
      retryCount += 1
      await delayProviderRetry(providerRetryDelayMs(retryCount - 1), input.controller.signal)
    }
  }
}

function observeFailedProviderUsageAttempt(
  input: Pick<FetchChatStreamWithRetryInput, 'req' | 'credentialGroupId' | 'stream'>,
  attempt: {
    startedAt: number
    attempt: number
    reason: ProviderUsageAttemptReason
    statusCode?: number
    errorCode?: string
    cancelled?: boolean
  },
): void {
  const status = attempt.cancelled
    ? 'cancelled'
    : attempt.statusCode === 429
      ? 'limited'
      : 'failed'
  void recordProviderUsageAttempt({
    provider: input.req.provider,
    credentialGroupId: input.credentialGroupId,
    requestedModel: input.req.requestedModel,
    upstreamModel: input.req.model,
    operationSource: providerUsageOperationSource(input.req),
    status,
    ...(attempt.statusCode === undefined ? {} : { statusCode: attempt.statusCode }),
    errorCode: attempt.cancelled
      ? 'cancelled'
      : attempt.errorCode ?? (attempt.statusCode === undefined ? 'network_error' : `http_${attempt.statusCode}`),
    isStreaming: input.stream,
    startedAt: attempt.startedAt,
    attempt: attempt.attempt,
    attemptReason: attempt.reason,
    ...(input.req.usageContext?.correlationId ? { correlationId: input.req.usageContext.correlationId } : {}),
    ...(input.req.conversationId ? { conversationId: input.req.conversationId } : {}),
    ...(input.req.usageContext?.runId ? { runId: input.req.usageContext.runId } : {}),
  })
}

function recordSuccessfulProviderUsageAttempt(
  response: Response,
  input: Pick<HttpSseExecutionInput, 'req' | 'credentialGroupId' | 'stream'>,
  usage: MessageUsage | undefined,
  status: 'success' | 'partial' | 'failed' | 'cancelled' = 'success',
  errorCode?: string,
): void {
  const attempt = successfulProviderUsageAttempts.get(response)
  if (!attempt) return
  successfulProviderUsageAttempts.delete(response)
  void recordProviderUsageAttempt({
    provider: input.req.provider,
    credentialGroupId: input.credentialGroupId,
    requestedModel: input.req.requestedModel,
    upstreamModel: input.req.model,
    operationSource: providerUsageOperationSource(input.req),
    status,
    statusCode: response.status,
    ...(errorCode ? { errorCode } : {}),
    isStreaming: input.stream,
    startedAt: attempt.startedAt,
    completedAt: Date.now(),
    ...(attempt.firstTokenAt === undefined ? {} : { firstTokenAt: attempt.firstTokenAt }),
    attempt: attempt.attempt,
    attemptReason: attempt.reason,
    ...(input.req.usageContext?.correlationId ? { correlationId: input.req.usageContext.correlationId } : {}),
    ...(input.req.conversationId ? { conversationId: input.req.conversationId } : {}),
    ...(input.req.usageContext?.runId ? { runId: input.req.usageContext.runId } : {}),
    ...(usage ? { usage } : {}),
  })
}

function markProviderUsageFirstToken(response: Response): void {
  const attempt = successfulProviderUsageAttempts.get(response)
  if (attempt && attempt.firstTokenAt === undefined) attempt.firstTokenAt = Date.now()
}

function providerUsageOperationSource(req: ProviderRuntimeChatRequest) {
  return req.usageContext?.source ?? (req.conversationId ? 'chat' : 'other')
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
  if (input.req.provider.type !== 'openai-compatible' || input.req.provider.wireProtocol === 'anthropic-compatible') return undefined
  if (input.status !== 400 && input.status !== 422) return undefined
  if (!isOpenAICompatibleParameterError(input.errorText)) return undefined

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body)
  } catch {
    return undefined
  }

  const parsedKeys = Object.keys(parsed)
  if (!input.rectified) {
    const failedFields = inferOpenAICompatibleFailedFields(input.errorText, parsedKeys, [])
    const selective = selectivelyRemoveOpenAICompatibleFields(parsed, failedFields)
    if (selective.removedFields.length) {
      return {
        kind: 'openai_compatible_minimal_chat',
        body: selective.body,
        failedFields,
        removedFields: selective.removedFields,
        retainedFields: Object.keys(selective.body),
      }
    }
  }

  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : input.req.model
  const messages = minimalOpenAICompatibleMessages(parsed.messages)
  if (!messages.length) return undefined

  const next: Record<string, unknown> = { model, messages }
  if (typeof parsed.stream === 'boolean') next.stream = parsed.stream

  const messagesChanged = JSON.stringify(parsed.messages) !== JSON.stringify(messages)
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

function selectivelyRemoveOpenAICompatibleFields(
  body: Record<string, unknown>,
  failedFields: string[],
): { body: Record<string, unknown>; removedFields: string[] } {
  const next = { ...body }
  const removedFields: string[] = []
  for (const failedField of failedFields) {
    for (const key of openAICompatibleRemovalKeys(failedField)) {
      if (!(key in next)) continue
      delete next[key]
      if (!removedFields.includes(key)) removedFields.push(key)
    }
  }
  return { body: next, removedFields }
}

function openAICompatibleRemovalKeys(field: string): string[] {
  switch (field.toLowerCase()) {
    case 'tools':
      return ['tools', 'tool_choice', 'parallel_tool_calls']
    case 'tool_choice':
      return ['tool_choice']
    case 'parallel_tool_calls':
      return ['parallel_tool_calls']
    case 'reasoning':
      return ['reasoning', 'reasoning_effort']
    case 'reasoning_effort':
      return ['reasoning_effort']
    case 'thinking':
      return ['thinking', 'enable_thinking', 'thinking_budget', 'reasoning_split']
    case 'enable_thinking':
    case 'thinking_budget':
    case 'reasoning_split':
      return [field]
    case 'top_k':
    case 'topk':
      return ['top_k', 'topK']
    case 'messages':
    case 'content':
      return []
    default:
      return [field]
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
  req: ProviderRuntimeChatRequest
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
  req: ProviderRuntimeChatRequest
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
    emptyResponse: input.emptyResponse,
    streamStarted: input.streamStarted,
    retryAfterMs: retryAfterMsFromFailure(input.status),
    nowMs,
  })
  const snapshot = await loadProviderHealthSnapshot({ nowMs })
  const healthRecords = indexProviderHealthRecords(snapshot.records)
  const requiredCapabilities = requiredFallbackCapabilities(input.req)
  const candidates = input.buildFallbackCandidates({
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
  throwIfProviderRetryAborted(input.controller.signal)
  const plan = await resolveRuntimeFallbackPlan({
    req: input.req,
    status: input.status,
    responseText: input.responseText,
    emptyResponse: input.emptyResponse,
    credentialGroupId: input.credentialGroupId,
    buildFallbackCandidates: input.buildFallbackCandidates,
  })
  throwIfProviderRetryAborted(input.controller.signal)
  await input.fallbackEffects.logDecision(input.req, plan)
  throwIfProviderRetryAborted(input.controller.signal)
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
  const selectedReqBase: ProviderRuntimeChatRequest = {
    ...input.req,
    provider: selectedProvider,
    model: selectedRoute.model,
    requestedModel: selectedRoute.model,
    stream: false,
    signal: input.controller.signal,
  }
  const selectedReq = normalizeRemoteCompactRoute(selectedReqBase, input.req.remoteCompactFallback)
  const selectedAssembly = input.transport.assembleRoute({
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
  throwIfProviderRetryAborted(input.controller.signal)
  await logProviderCompatibility(selectedReq)
  throwIfProviderRetryAborted(input.controller.signal)
  await logProviderConformance(selectedReq, selectedRouteResult.conformance)
  throwIfProviderRetryAborted(input.controller.signal)
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
    headers: getHeaders(selectedReq.provider, {
      remoteCompactEligible: selectedReq.remoteCompactEligible === true,
      model: selectedReq.model,
    }),
    body: selectedRouteResult.body,
  })
  throwIfProviderRetryAborted(input.controller.signal)
  const selectedAttemptStartedAt = Date.now()
  let selectedResponse: Response
  try {
    selectedResponse = await input.transport.request(
      selectedPreparedRequest.url,
      {
        method: 'POST',
        headers: selectedPreparedRequest.headers,
        body: selectedPreparedRequest.body,
        signal: input.controller.signal,
      },
      CHAT_REQUEST_TIMEOUT_MS,
    )
  } catch (error) {
    void recordProviderUsageAttempt({
      provider: selectedReq.provider,
      credentialGroupId: selectedRoute.credentialGroupId,
      requestedModel: selectedReq.requestedModel,
      upstreamModel: selectedReq.model,
      operationSource: providerUsageOperationSource(selectedReq),
      status: input.controller.signal.aborted ? 'cancelled' : 'failed',
      errorCode: input.controller.signal.aborted
        ? 'cancelled'
        : error instanceof Error ? error.name : 'request_failed',
      isStreaming: false,
      startedAt: selectedAttemptStartedAt,
      attempt: 0,
      attemptReason: 'fallback',
      ...(selectedReq.usageContext?.correlationId ? { correlationId: selectedReq.usageContext.correlationId } : {}),
      ...(selectedReq.conversationId ? { conversationId: selectedReq.conversationId } : {}),
      ...(selectedReq.usageContext?.runId ? { runId: selectedReq.usageContext.runId } : {}),
    })
    if (input.controller.signal.aborted) {
      throwProviderRuntimeCancellation(input.controller.signal, error)
    }
    throw error
  }
  if (input.controller.signal.aborted) {
    void recordProviderUsageAttempt({
      provider: selectedReq.provider,
      credentialGroupId: selectedRoute.credentialGroupId,
      requestedModel: selectedReq.requestedModel,
      upstreamModel: selectedReq.model,
      operationSource: providerUsageOperationSource(selectedReq),
      status: 'cancelled',
      statusCode: selectedResponse.status,
      errorCode: 'cancelled',
      isStreaming: false,
      startedAt: selectedAttemptStartedAt,
      attempt: 0,
      attemptReason: 'fallback',
      ...(selectedReq.usageContext?.correlationId ? { correlationId: selectedReq.usageContext.correlationId } : {}),
      ...(selectedReq.conversationId ? { conversationId: selectedReq.conversationId } : {}),
      ...(selectedReq.usageContext?.runId ? { runId: selectedReq.usageContext.runId } : {}),
    })
    throwIfProviderRetryAborted(input.controller.signal)
  }
  if (!selectedResponse.ok) {
    void recordProviderUsageAttempt({
      provider: selectedReq.provider,
      credentialGroupId: selectedRoute.credentialGroupId,
      requestedModel: selectedReq.requestedModel,
      upstreamModel: selectedReq.model,
      operationSource: providerUsageOperationSource(selectedReq),
      status: selectedResponse.status === 429 ? 'limited' : 'failed',
      statusCode: selectedResponse.status,
      errorCode: `http_${selectedResponse.status}`,
      isStreaming: false,
      startedAt: selectedAttemptStartedAt,
      attempt: 0,
      attemptReason: 'fallback',
      ...(selectedReq.usageContext?.correlationId ? { correlationId: selectedReq.usageContext.correlationId } : {}),
      ...(selectedReq.conversationId ? { conversationId: selectedReq.conversationId } : {}),
      ...(selectedReq.usageContext?.runId ? { runId: selectedReq.usageContext.runId } : {}),
    })
    const selectedResponseText = await input.transport.readResponseText(selectedResponse)
    throwIfProviderRetryAborted(input.controller.signal)
    await input.fallbackEffects.recordRouteFailure(
      selectedRoute,
      selectedResponse.status,
      selectedResponseText,
      input.controller.signal,
    )
    throwIfProviderRetryAborted(input.controller.signal)
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

  const selectedResult = await parseProviderNonStreamingResponse(selectedResponse, selectedReq).catch((error) => {
    void recordProviderUsageAttempt({
      provider: selectedReq.provider,
      credentialGroupId: selectedRoute.credentialGroupId,
      requestedModel: selectedReq.requestedModel,
      upstreamModel: selectedReq.model,
      operationSource: providerUsageOperationSource(selectedReq),
      status: input.controller.signal.aborted ? 'cancelled' : 'failed',
      statusCode: selectedResponse.status,
      errorCode: input.controller.signal.aborted
        ? 'cancelled'
        : error instanceof Error ? error.name : 'parse_failed',
      isStreaming: false,
      startedAt: selectedAttemptStartedAt,
      attempt: 0,
      attemptReason: 'fallback',
      ...(selectedReq.usageContext?.correlationId ? { correlationId: selectedReq.usageContext.correlationId } : {}),
      ...(selectedReq.conversationId ? { conversationId: selectedReq.conversationId } : {}),
      ...(selectedReq.usageContext?.runId ? { runId: selectedReq.usageContext.runId } : {}),
    })
    if (input.controller.signal.aborted) {
      throwProviderRuntimeCancellation(input.controller.signal, error)
    }
    throw error
  })
  if (!hasDeliverableProviderOutput(selectedResult)) {
    void recordProviderUsageAttempt({
      provider: selectedReq.provider,
      credentialGroupId: selectedRoute.credentialGroupId,
      requestedModel: selectedReq.requestedModel,
      upstreamModel: selectedReq.model,
      operationSource: providerUsageOperationSource(selectedReq),
      status: 'failed',
      statusCode: selectedResponse.status,
      errorCode: 'empty_response',
      isStreaming: false,
      startedAt: selectedAttemptStartedAt,
      attempt: 0,
      attemptReason: 'fallback',
      ...(selectedReq.usageContext?.correlationId ? { correlationId: selectedReq.usageContext.correlationId } : {}),
      ...(selectedReq.conversationId ? { conversationId: selectedReq.conversationId } : {}),
      ...(selectedReq.usageContext?.runId ? { runId: selectedReq.usageContext.runId } : {}),
      ...(selectedResult.usage ? { usage: selectedResult.usage } : {}),
    })
    await input.fallbackEffects.recordRouteFailure(
      selectedRoute,
      selectedResponse.status,
      '',
      input.controller.signal,
      true,
    )
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', 'empty_response'))
    return false
  }
  void recordProviderUsageAttempt({
    provider: selectedReq.provider,
    credentialGroupId: selectedRoute.credentialGroupId,
    requestedModel: selectedReq.requestedModel,
    upstreamModel: selectedReq.model,
    operationSource: providerUsageOperationSource(selectedReq),
    status: 'success',
    statusCode: selectedResponse.status,
    isStreaming: false,
    startedAt: selectedAttemptStartedAt,
    attempt: 0,
    attemptReason: 'fallback',
    ...(selectedReq.usageContext?.correlationId ? { correlationId: selectedReq.usageContext.correlationId } : {}),
    ...(selectedReq.conversationId ? { conversationId: selectedReq.conversationId } : {}),
    ...(selectedReq.usageContext?.runId ? { runId: selectedReq.usageContext.runId } : {}),
    ...(selectedResult.usage ? { usage: selectedResult.usage } : {}),
  })
  throwIfProviderRetryAborted(input.controller.signal)
  input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'done'))
  throwIfProviderRetryAborted(input.controller.signal)
  input.onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
  throwIfProviderRetryAborted(input.controller.signal)
  if (selectedResult.text) input.onChunk(selectedResult.text)
  throwIfProviderRetryAborted(input.controller.signal)
  if (selectedResult.citations?.length) input.onCitations?.(selectedResult.citations)
  throwIfProviderRetryAborted(input.controller.signal)
  for (const trace of selectedResult.traces ?? []) {
    input.onTrace?.(trace)
    throwIfProviderRetryAborted(input.controller.signal)
  }
  await input.fallbackEffects.recordRouteSuccess(selectedRoute, input.controller.signal)
  throwIfProviderRetryAborted(input.controller.signal)
  recordRuntimeSessionAffinityRotation({
    req: input.req,
    originalCredentialGroupId: input.credentialGroupId,
    selectedCredentialGroupId: selectedRoute.credentialGroupId,
    selectedProviderId: selectedRoute.providerId,
    status: input.status,
    responseText: input.responseText,
    classification: plan.classification,
  })
  throwIfProviderRetryAborted(input.controller.signal)
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
  throwIfProviderRetryAborted(input.controller.signal)
  input.onDone(withCredentialGroup(selectedResult, selectedRoute.credentialGroupId))
  return true
}

function throwIfProviderRuntimeAborted(signal: AbortSignal): void {
  if (signal.aborted) throwProviderRuntimeCancellation(signal)
}

function throwProviderRuntimeCancellation(signal: AbortSignal, error?: unknown): never {
  if (signal.aborted && signal.reason !== undefined) throw signal.reason
  throw createProviderRetryAbortError(error)
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

function readRuntimeSessionAffinityBinding(req: ProviderRuntimeChatRequest): SessionAffinityBinding | undefined {
  const sessionKey = deriveSessionAffinityKey({
    conversationId: req.conversationId,
    sessionId: req.sessionId,
    providerId: req.provider.id,
    model: runtimeSessionAffinityModel(req),
  })
  return readSessionAffinityBinding(sessionKey)
}

function runtimeSessionAffinityModel(req: ProviderRuntimeChatRequest): string {
  return req.requestedModel ?? req.model
}

async function retryWithoutStreaming(
  req: ProviderRuntimeChatRequest,
  resolveRoute: ProviderRuntimeRouteResolver,
  onChunk: ProviderRuntimeChunkCallback,
  onDone: ProviderRuntimeDoneCallback,
  onError: ProviderRuntimeErrorCallback,
  transport: ProviderRuntimeTransport,
  buildFallbackCandidates: ProviderFallbackCandidateBuilder,
  fallbackEffects: ProviderRuntimeFallbackEffects,
  controller: AbortController,
  onCitations?: ProviderRuntimeCitationCallback,
  onTrace?: ProviderRuntimeTraceCallback,
  credentialGroupId?: string,
): Promise<void> {
  const startedAt = Date.now()
  try {
    throwIfProviderRetryAborted(controller.signal)
    const fallbackReq = normalizeRemoteCompactRoute(
      { ...req, stream: false, signal: controller.signal },
      req.remoteCompactFallback,
    )
    const url = transport.resolveEndpoint({
      provider: fallbackReq.provider,
      model: fallbackReq.model,
      stream: false,
      usesResponsesApi: usesOpenAIResponses(fallbackReq),
    })
    const fallbackPreparedRequest = prepareHttpJsonRequest({
      provider: fallbackReq.provider,
      model: fallbackReq.model,
      url,
      headers: getHeaders(fallbackReq.provider, {
        remoteCompactEligible: fallbackReq.remoteCompactEligible === true,
        model: fallbackReq.model,
      }),
      body: resolveRoute(fallbackReq).body,
    })
    const response = await fetchChatStreamWithRetry({
      req: fallbackReq,
      url: fallbackPreparedRequest.url,
      headers: fallbackPreparedRequest.headers,
      body: fallbackPreparedRequest.body,
      stream: false,
      controller,
      credentialGroupId,
      onTrace,
      transport,
      initialAttemptReason: 'fallback',
    })
    throwIfProviderRetryAborted(controller.signal)
    if (!response.ok) {
      const errorText = await transport.readResponseText(response)
      throwIfProviderRetryAborted(controller.signal)
      const recovered = await tryRuntimeFallback({
        req: fallbackReq,
        status: response.status,
        responseText: errorText,
        credentialGroupId,
        resolveRoute,
        onChunk,
        onDone,
        onCitations,
        onTrace,
        transport,
        buildFallbackCandidates,
        controller,
        fallbackEffects,
      })
      if (recovered) return
      throwIfProviderRetryAborted(controller.signal)
      const errorCode = classifyHttpStatus(response.status, errorText, fallbackReq.model, fallbackReq.provider)
      onError(providerRuntimeError(
        formatProviderHttpError(response.status, errorText, fallbackReq.provider, fallbackReq.model),
        credentialGroupId,
        providerOperationCodeToChatErrorCode(errorCode)
      ))
      return
    }
    const result = await parseProviderNonStreamingResponse(response, fallbackReq).catch((error) => {
      recordSuccessfulProviderUsageAttempt(response, {
        req: fallbackReq,
        credentialGroupId,
        stream: false,
      }, undefined, 'failed', error instanceof Error ? error.name : 'parse_failed')
      throw error
    })
    throwIfProviderRetryAborted(controller.signal)
    if (!hasDeliverableProviderOutput(result)) {
      recordSuccessfulProviderUsageAttempt(response, {
        req: fallbackReq,
        credentialGroupId,
        stream: false,
      }, result.usage, 'failed', 'empty_response')
      const recovered = await tryRuntimeFallback({
        req: fallbackReq,
        status: response.status,
        responseText: '',
        emptyResponse: true,
        credentialGroupId,
        resolveRoute,
        onChunk,
        onDone,
        onCitations,
        onTrace,
        transport,
        buildFallbackCandidates,
        controller,
        fallbackEffects,
      })
      if (!recovered) onError(emptyProviderResponseError(credentialGroupId))
      return
    }
    onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
    throwIfProviderRetryAborted(controller.signal)
    if (result.text) onChunk(result.text)
    throwIfProviderRetryAborted(controller.signal)
    if (result.citations?.length) onCitations?.(result.citations)
    throwIfProviderRetryAborted(controller.signal)
    for (const trace of result.traces ?? []) {
      throwIfProviderRetryAborted(controller.signal)
      onTrace?.(trace)
    }
    throwIfProviderRetryAborted(controller.signal)
    void recordProviderRuntimeSuccess({
      req,
      credentialGroupId,
      latencyMs: Date.now() - startedAt,
    })
    recordSuccessfulProviderUsageAttempt(response, {
      req: fallbackReq,
      credentialGroupId,
      stream: false,
    }, result.usage)
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
    throwIfProviderRetryAborted(controller.signal)
    onDone(withCredentialGroup(result, credentialGroupId))
  } catch (error) {
    if (isProviderRetryCancellation(controller.signal)) {
      throwProviderRuntimeCancellation(controller.signal, error)
    }
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

const EMPTY_PROVIDER_RESPONSE_ERROR_NAME = 'EmptyProviderResponseError'

function hasDeliverableProviderOutput(result: {
  text?: string
  providerToolCalls?: readonly unknown[]
}): boolean {
  return Boolean(result.text?.trim()) || Boolean(result.providerToolCalls?.length)
}

function emptyProviderResponseError(credentialGroupId?: string): ProviderRuntimeError {
  const error = providerRuntimeError(
    st('chatRunner.userError.emptyResponse'),
    credentialGroupId,
    'unknown',
  )
  error.name = EMPTY_PROVIDER_RESPONSE_ERROR_NAME
  return error
}

function isEmptyProviderResponseError(error: unknown): boolean {
  return error instanceof Error && error.name === EMPTY_PROVIDER_RESPONSE_ERROR_NAME
}

function optimizeRouteBody(body: Record<string, unknown>, req: ProviderRuntimeChatRequest): Record<string, unknown> {
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
