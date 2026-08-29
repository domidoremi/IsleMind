import type { AIProvider, ProviderOperationCode } from '@/types/providerContracts'

export const PROVIDER_OPERATION_RESULT_SCHEMA = 'islemind.provider-operation-result.v1'

export interface ProviderOperationResult<T = undefined> {
  ok: boolean
  code: ProviderOperationCode
  message: string
  data?: T
  credentialGroupId?: string
}

export interface ProviderOperationResultMessages {
  translate(key: string, values?: Record<string, unknown>): string
  redact(value: string): string
}

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public responseText: string,
    public retryAfterMs?: number,
  ) {
    super(responseText)
    this.name = 'ProviderHttpError'
  }
}

/**
 * Codes whose HTTP failure message is pure localized copy.
 *
 * `formatProviderHttpError` resolves these straight from the bundle and drops the
 * upstream detail, so a stored message for one of them restates its own headline in
 * whatever language was selected when the request failed. Replaying it later would
 * leak that language, so display paths rebuild the copy from the code instead. Codes
 * outside this map fall through to the summary branches, whose message embeds the
 * upstream payload and stays worth keeping as technical detail.
 */
export const PROVIDER_HTTP_COPY_ONLY_CODE_KEYS = {
  bad_auth: 'badAuth',
  model_unavailable: 'modelUnavailable',
  models_endpoint_unavailable: 'modelsEndpointUnavailable',
  rate_limited: 'rateLimited',
  max_tokens_exceeded: 'maxTokensExceeded',
  timeout: 'timeout',
  bad_base_url: 'badBaseUrl',
} as const satisfies Partial<Record<ProviderOperationCode, string>>

export function isProviderHttpCopyOnlyCode(code: unknown): boolean {
  return typeof code === 'string' && Object.hasOwn(PROVIDER_HTTP_COPY_ONLY_CODE_KEYS, code)
}

export function success<T>(message: string, data?: T, credentialGroupId?: string): ProviderOperationResult<T> {
  return { ok: true, code: 'ok', message, data, credentialGroupId }
}

export function failure<T>(code: ProviderOperationCode, message: string, data?: T, credentialGroupId?: string): ProviderOperationResult<T> {
  return { ok: false, code, message, data, credentialGroupId }
}

export function createProviderOperationResultPolicy(messages: ProviderOperationResultMessages) {
  const t = messages.translate
  function extractProviderErrorDetail(responseText = ''): string {
    const trimmed = responseText.trim()
    if (!trimmed) return ''
    if (/^\s*</.test(trimmed)) return t('providerOperation.http.htmlResponse')
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const error = typeof parsed.error === 'object' && parsed.error ? parsed.error as Record<string, unknown> : parsed
      const type = messages.redact(stringValue(error.type) || stringValue(error.code) || stringValue(parsed.code))
      const message = messages.redact(stringValue(error.message) || stringValue(parsed.message))
      const requestId = stringValue(error.request_id) || stringValue(error.requestId) || stringValue(parsed.request_id) || stringValue(parsed.requestId) || findRequestId(trimmed)
      return [
        type ? t('providerOperation.http.errorType', { type }) : '',
        message ? t('providerOperation.http.errorMessage', { message: message.slice(0, 140) }) : '',
        requestId ? t('providerOperation.http.requestId', { requestId }) : '',
        t('providerOperation.http.suggestion'),
      ].filter(Boolean).join(' · ')
    } catch {
      const plain = messages.redact(trimmed.replace(/\s+/g, ' ')).slice(0, 180)
      const requestId = findRequestId(trimmed)
      return [plain, requestId ? t('providerOperation.http.requestId', { requestId }) : '', t('providerOperation.http.suggestion')].filter(Boolean).join(' · ')
    }
  }

  function formatProviderHttpError(status: number, responseText = '', provider?: AIProvider, model = ''): string {
    const code = classifyHttpStatus(status, responseText, model, provider)
    const providerName = provider?.name ?? t('providerOperation.provider')
    const detail = extractProviderErrorDetail(responseText)
    const key = (PROVIDER_HTTP_COPY_ONLY_CODE_KEYS as Partial<Record<ProviderOperationCode, string>>)[code]
    if (key === 'modelUnavailable') return t(`providerOperation.http.${key}`, { model: model || t('providerOperation.currentModel') })
    if (key) return t(`providerOperation.http.${key}`, { provider: providerName })
    if (code === 'network_error') return detail ? t('providerOperation.http.errorWithSummary', { provider: providerName, status, detail }) : t('providerOperation.http.network', { provider: providerName })
    return detail ? t('providerOperation.http.errorWithSummary', { provider: providerName, status, detail }) : t('providerOperation.http.error', { provider: providerName, status })
  }

  function providerFetchFailure<T>(error: unknown, credentialGroupId?: string): ProviderOperationResult<T> {
    if (error instanceof ProviderHttpError) return failure<T>(classifyHttpStatus(error.status, error.responseText), formatProviderHttpError(error.status, error.responseText), undefined, credentialGroupId)
    if (error instanceof Error && error.name === 'AbortError') return failure<T>('timeout', t('providerOperation.timeout'), undefined, credentialGroupId)
    const message = error instanceof Error ? error.message : ''
    if (/failed to fetch|network|network request failed/i.test(message)) return failure<T>('network_error', t('providerOperation.networkError'), undefined, credentialGroupId)
    return failure<T>('unknown', messages.redact(message) || t('providerOperation.requestFailed'), undefined, credentialGroupId)
  }

  return { extractProviderErrorDetail, formatProviderHttpError, providerFetchFailure }
}

export function classifyHttpStatus(status: number, responseText = '', model = '', provider?: Pick<AIProvider, 'type'>): ProviderOperationCode {
  const text = responseText.toLowerCase()
  if (/model[_ -]?not[_ -]?found|no available channel|无可用渠道|模型[^。.,，]*无可用|model[^。.,]*unavailable|model[^。.,]*(not found|not exist|does not exist)/i.test(text)) return 'model_unavailable'
  if (status === 401 || status === 403 || /invalid api key|unauthorized|permission/.test(text)) return 'bad_auth'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429 || /rate limit|too many requests|quota/.test(text)) return 'rate_limited'
  if (/max_tokens|max_completion_tokens|maximum context|context length|too many tokens/.test(text)) return 'max_tokens_exceeded'
  if (status === 404 && (model || text.includes('model'))) return 'model_unavailable'
  if (status === 404) return 'models_endpoint_unavailable'
  if (status === 400 && /model|not found|not exist/.test(text)) return 'model_unavailable'
  if (status === 400 && provider?.type === 'xiaomi-mimo' && !/base[\s_-]?url|endpoint|unsupported url|invalid url|not found|route|path|html|404/.test(text)) return 'unknown'
  if (status === 400) return 'bad_base_url'
  if (status >= 500) return 'network_error'
  return 'unknown'
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function findRequestId(text: string): string { return text.match(/(?:request[_ -]?id|req[_ -]?id)["':=\s]+([a-z0-9._:-]+)/i)?.[1] ?? '' }
