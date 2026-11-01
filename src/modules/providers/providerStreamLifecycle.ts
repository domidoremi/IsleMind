import type { ChatErrorCode } from '@/types/providerContracts'
import type { ProviderResponseParsingResult, ProviderStreamOutcome, ProviderStreamProtocol } from './providerResponseContracts'
import { classifyHttpStatus } from './providerOperationResult'

export type { ProviderStreamOutcome, ProviderStreamProtocol } from './providerResponseContracts'

export interface ProviderStreamLifecycleObservation {
  streamProtocol?: ProviderStreamProtocol
  streamOutcome?: ProviderStreamOutcome
  terminal?: boolean
}

export class ProviderStreamLifecycleError extends Error {
  readonly chatErrorCode: ChatErrorCode
  readonly code: string
  readonly status?: number

  constructor(
    readonly streamOutcome: ProviderStreamOutcome,
    readonly partialResult?: ProviderResponseParsingResult,
  ) {
    super(streamOutcome.message ?? `Provider response ${streamOutcome.status}: ${streamOutcome.reason}. Partial output was retained.`)
    this.name = `ProviderStream${streamOutcome.status[0]!.toUpperCase()}${streamOutcome.status.slice(1)}Error`
    this.chatErrorCode = streamOutcome.status === 'interrupted' ? 'network_error' : streamOutcome.code ?? 'upstream_error'
    this.code = streamOutcome.code ?? streamOutcome.reason
    this.status = streamOutcome.httpStatus
  }
}

export function observeProviderStreamLifecycle(json: any, defaultProtocol: ProviderStreamProtocol): ProviderStreamLifecycleObservation {
  const type = typeof json?.type === 'string' ? json.type : ''
  const protocol = type.startsWith('response.') ? 'openai-responses'
    : Array.isArray(json?.choices) ? 'openai-chat' : defaultProtocol
  const error = json?.error ?? json?.response?.error
  if (type === 'error' || type === 'response.failed' || (error && typeof error === 'object')) {
    const detail = error && typeof error === 'object' ? error : json
    const numericStatus = Number(detail?.code)
    const errorType = [detail?.type, detail?.code, detail?.status]
      .filter(value => typeof value === 'string').join(' ').toLowerCase()
    const httpStatus = numericStatus >= 400 && numericStatus <= 599 ? numericStatus
      : /authentication|invalid_api_key/.test(errorType) ? 401
        : /permission/.test(errorType) ? 403
          : /rate_limit|resource_exhausted/.test(errorType) ? 429
            : /overloaded/.test(errorType) ? 529 : 502
    const operationCode = classifyHttpStatus(httpStatus, JSON.stringify({ error: detail }))
    const code = operationCode === 'models_endpoint_unavailable' ? 'endpoint_unavailable'
      : operationCode === 'ok' || operationCode === 'empty_models' ? 'upstream_error' : operationCode
    return {
      streamProtocol: protocol, terminal: true,
      streamOutcome: {
        status: 'failed', protocol, reason: errorType || type || 'upstream_error',
        message: typeof detail?.message === 'string' ? detail.message.slice(0, 512) : 'Provider reported a streaming failure.',
        code, httpStatus,
      },
    }
  }
  if (type === 'response.incomplete') {
    return observation('openai-responses', 'incomplete', String(json?.response?.incomplete_details?.reason ?? 'response_incomplete'), true)
  }
  if (type === 'response.completed') {
    if (json?.response?.status && json.response.status !== 'completed') {
      return observation('openai-responses', 'incomplete', String(json.response.status), true)
    }
    return observation('openai-responses', 'completed', 'response.completed', true)
  }
  if (protocol === 'anthropic') {
    if (type === 'message_stop') return observation(protocol, 'completed', 'message_stop', true)
    const reason = json?.delta?.stop_reason
    if (typeof reason === 'string' && reason) {
      return observation(protocol, ['end_turn', 'tool_use', 'stop_sequence', 'refusal'].includes(reason) ? 'completed' : 'incomplete', reason, false)
    }
  }
  if (protocol === 'google') {
    const reason = json?.candidates?.[0]?.finishReason
    if (typeof reason === 'string' && reason && reason !== 'FINISH_REASON_UNSPECIFIED') {
      return observation(protocol, reason === 'STOP' ? 'completed' : 'incomplete', reason, true)
    }
    const blocked = json?.promptFeedback?.blockReason
    if (typeof blocked === 'string' && blocked && blocked !== 'BLOCK_REASON_UNSPECIFIED') {
      return observation(protocol, 'incomplete', blocked, true)
    }
  }
  const reason = json?.choices?.[0]?.finish_reason
  if (typeof reason === 'string' && reason) {
    // Chat finish_reason precedes a possible usage-only chunk and [DONE].
    return observation('openai-chat', ['stop', 'tool_calls', 'function_call'].includes(reason) ? 'completed' : 'incomplete', reason, false)
  }
  return type.startsWith('response.') || Array.isArray(json?.choices) ? { streamProtocol: protocol } : {}
}

function observation(
  protocol: ProviderStreamProtocol,
  status: 'completed' | 'incomplete',
  reason: string,
  terminal: boolean,
): ProviderStreamLifecycleObservation {
  return {
    streamProtocol: protocol, terminal,
    streamOutcome: {
      status, protocol, reason,
      ...(status === 'incomplete' ? {
        code: /max.*tokens|length/i.test(reason) ? 'max_tokens_exceeded' as const : 'upstream_error' as const,
      } : {}),
    },
  }
}

export function mergeProviderStreamOutcome(
  previous: ProviderStreamOutcome | undefined,
  next: ProviderStreamOutcome | undefined,
): ProviderStreamOutcome | undefined {
  if (!next) return previous
  if (!previous) return next
  const rank = { completed: 0, incomplete: 1, interrupted: 2, failed: 3 }
  return rank[next.status] >= rank[previous.status] ? next : previous
}

export function finishProviderStream(
  protocol: ProviderStreamProtocol,
  outcome: ProviderStreamOutcome | undefined,
  terminal: boolean,
): ProviderStreamOutcome {
  if (outcome?.status === 'failed' || outcome?.status === 'interrupted') return outcome
  const observedProtocol = outcome?.protocol ?? protocol
  if (observedProtocol === 'openai-chat' && protocol === 'openai-chat' && (outcome || terminal)) {
    return outcome ?? { status: 'completed', protocol, reason: '[DONE]' }
  }
  if (outcome?.protocol === protocol && terminal) return outcome
  return { status: 'interrupted', protocol, reason: 'missing_protocol_completion' }
}
