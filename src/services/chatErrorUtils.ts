import type { ChatErrorCode } from '@/types'
import { st } from '@/i18n/service'

export function buildSetupGuide(): string {
  return [
    st('chatRunner.setup.noProvider'),
    '',
    st('chatRunner.setup.stepProvider'),
    st('chatRunner.setup.stepKey'),
    st('chatRunner.setup.stepModel'),
  ].join('\n')
}

export function classifyChatError(message: string): ChatErrorCode {
  const text = message.toLowerCase()
  if (text.includes('401') || text.includes('403') || text.includes('unauthorized') || text.includes('invalid api key') || text.includes('permission')) {
    return 'bad_auth'
  }
  if (text.includes('credential_mismatch') || text.includes('token plan') || text.includes('tp-') || text.includes('sk-')) {
    return 'credential_mismatch'
  }
  if (text.includes('provider_conformance_blocked')) {
    return 'provider_conformance_blocked'
  }
  if (text.includes('aborterror') || text.includes('timeout') || text.includes('timed out') || text.includes('超时')) {
    return 'timeout'
  }
  if (text.includes('no response body') || text.includes('empty response') || text.includes('模型返回为空')) {
    return 'network_error'
  }
  if (text.includes('rate limit') || text.includes('too many requests') || text.includes('429') || text.includes('quota') || text.includes('额度')) return 'rate_limited'
  if (text.includes('max_tokens') || text.includes('max_completion_tokens') || text.includes('too many tokens') || text.includes('context length') || text.includes('输出上限')) return 'max_tokens_exceeded'
  if (text.includes('404') || text.includes('model') || text.includes('not found')) {
    return 'model_unavailable'
  }
  if (text.includes('failed to fetch') || text.includes('network') || text.includes('timeout')) {
    return 'network_error'
  }
  if (text.includes('api error 400') || text.includes('base url') || text.includes('unsupported url')) {
    return 'bad_base_url'
  }
  return 'unknown'
}

export function toUserFacingError(message: string): string {
  const code = classifyChatError(message)
  switch (code) {
    case 'bad_auth':
      return st('chatRunner.userError.badAuth')
    case 'credential_mismatch':
      return message || st('chatRunner.userError.credentialMismatch')
    case 'model_unavailable':
      return st('chatRunner.userError.modelUnavailable')
    case 'network_error':
      return message.toLowerCase().includes('no response body') || message.toLowerCase().includes('empty response')
        ? st('chatRunner.userError.emptyResponse')
        : st('chatRunner.userError.network')
    case 'timeout':
      return st('chatRunner.userError.timeout')
    case 'rate_limited':
      return st('chatRunner.userError.rateLimited')
    case 'max_tokens_exceeded':
      return message || st('chatRunner.userError.maxTokens')
    case 'bad_base_url':
      return st('chatRunner.userError.badBaseUrl')
    case 'provider_conformance_blocked':
      return st('chatRunner.userError.providerConformanceBlocked')
    case 'missing_key':
    case 'disabled_provider':
    case 'unknown':
      return message || st('chatRunner.error.sendFailed')
  }
}
