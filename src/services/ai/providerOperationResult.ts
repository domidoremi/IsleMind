import { st } from '@/i18n/service'
import type { AIProvider, ProviderOperationCode } from '@/types'

export interface ProviderOperationResult<T = undefined> {
  ok: boolean
  code: ProviderOperationCode
  message: string
  data?: T
  credentialGroupId?: string
}

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public responseText: string
  ) {
    super(responseText)
    this.name = 'ProviderHttpError'
  }
}

export function success<T>(message: string, data?: T, credentialGroupId?: string): ProviderOperationResult<T> {
  return { ok: true, code: 'ok', message, data, credentialGroupId }
}

export function failure<T>(code: ProviderOperationCode, message: string, data?: T, credentialGroupId?: string): ProviderOperationResult<T> {
  return { ok: false, code, message, data, credentialGroupId }
}

export function providerFetchFailure<T>(error: unknown, credentialGroupId?: string): ProviderOperationResult<T> {
  if (error instanceof ProviderHttpError) {
    return failure<T>(classifyHttpStatus(error.status, error.responseText), formatProviderHttpError(error.status, error.responseText), undefined, credentialGroupId)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return failure<T>('timeout', st('providerOperation.timeout'), undefined, credentialGroupId)
  }
  const message = error instanceof Error ? error.message : ''
  if (/failed to fetch|network|network request failed/i.test(message)) {
    return failure<T>('network_error', st('providerOperation.networkError'), undefined, credentialGroupId)
  }
  return failure<T>('unknown', message || st('providerOperation.requestFailed'), undefined, credentialGroupId)
}

export function classifyHttpStatus(status: number, responseText = '', model = ''): ProviderOperationCode {
  const text = responseText.toLowerCase()
  if (status === 401 || status === 403 || text.includes('invalid api key') || text.includes('unauthorized') || text.includes('permission')) return 'bad_auth'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429 || text.includes('rate limit') || text.includes('too many requests') || text.includes('quota')) return 'rate_limited'
  if (text.includes('max_tokens') || text.includes('max_completion_tokens') || text.includes('maximum context') || text.includes('context length') || text.includes('too many tokens')) return 'max_tokens_exceeded'
  if (status === 404 && (model || text.includes('model'))) return 'model_unavailable'
  if (status === 404) return 'models_endpoint_unavailable'
  if (status === 400 && (text.includes('model') || text.includes('not found') || text.includes('not exist'))) return 'model_unavailable'
  if (status === 400) return 'bad_base_url'
  if (status >= 500) return 'network_error'
  return 'unknown'
}

export function formatProviderHttpError(status: number, responseText = '', provider?: AIProvider, model = ''): string {
  const code = classifyHttpStatus(status, responseText, model)
  const providerName = provider?.name ?? st('providerOperation.provider')
  const detail = extractProviderErrorDetail(responseText)
  switch (code) {
    case 'bad_auth':
      return st('providerOperation.http.badAuth', { provider: providerName })
    case 'model_unavailable':
      return st('providerOperation.http.modelUnavailable', { model: model || st('providerOperation.currentModel') })
    case 'models_endpoint_unavailable':
      return st('providerOperation.http.modelsEndpointUnavailable', { provider: providerName })
    case 'rate_limited':
      return st('providerOperation.http.rateLimited', { provider: providerName })
    case 'max_tokens_exceeded':
      return st('providerOperation.http.maxTokensExceeded', { provider: providerName })
    case 'timeout':
      return st('providerOperation.http.timeout', { provider: providerName })
    case 'bad_base_url':
      return st('providerOperation.http.badBaseUrl', { provider: providerName })
    case 'network_error':
      return detail ? st('providerOperation.http.errorWithSummary', { provider: providerName, status, detail }) : st('providerOperation.http.network', { provider: providerName })
    default:
      return detail ? st('providerOperation.http.errorWithSummary', { provider: providerName, status, detail }) : st('providerOperation.http.error', { provider: providerName, status })
  }
}

export function extractProviderErrorDetail(responseText = ''): string {
  const trimmed = responseText.trim()
  if (!trimmed) return ''
  if (/^\s*</.test(trimmed)) return st('providerOperation.http.htmlResponse')
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const error = typeof parsed.error === 'object' && parsed.error ? errorObject(parsed.error) : parsed
    const type = stringFromUnknown(error.type) || stringFromUnknown(error.code) || stringFromUnknown(parsed.code)
    const message = stringFromUnknown(error.message) || stringFromUnknown(parsed.message)
    const requestId = stringFromUnknown(error.request_id) || stringFromUnknown(error.requestId) || stringFromUnknown(parsed.request_id) || stringFromUnknown(parsed.requestId) || findRequestId(trimmed)
    return [
      type ? st('providerOperation.http.errorType', { type }) : '',
      message ? st('providerOperation.http.errorMessage', { message: message.slice(0, 140) }) : '',
      requestId ? st('providerOperation.http.requestId', { requestId }) : '',
      st('providerOperation.http.suggestion'),
    ].filter(Boolean).join(' · ')
  } catch {
    const plain = trimmed.replace(/\s+/g, ' ').slice(0, 180)
    const requestId = findRequestId(trimmed)
    return [
      plain,
      requestId ? st('providerOperation.http.requestId', { requestId }) : '',
      st('providerOperation.http.suggestion'),
    ].filter(Boolean).join(' · ')
  }
}

function errorObject(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function findRequestId(text: string): string {
  return text.match(/(?:request[_ -]?id|req[_ -]?id)["':=\s]+([a-z0-9._:-]+)/i)?.[1] ?? ''
}
