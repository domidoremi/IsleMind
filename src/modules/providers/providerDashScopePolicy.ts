import type { AIProvider } from '@/types/providerContracts'

// Reviewed 2026-10-31: qwen-api-via-openai-chat-completions on help.aliyun.com.
export function isDashScopeChatContract(provider: AIProvider): boolean {
  if (provider.type !== 'openai-compatible' || provider.wireProtocol === 'anthropic-compatible') return false
  const preset = provider.presetId ?? provider.detectedPresetId
  if (preset && preset !== 'custom-endpoint') return preset === 'dashscope'
  try {
    const url = new URL(provider.baseUrl ?? '')
    return ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'].includes(url.hostname.toLowerCase())
      && /^\/compatible-mode\/v1(?:\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

export function dashScopeSupportsMaxCompletionTokens(provider: AIProvider, model: string): boolean {
  if (!isDashScopeChatContract(provider)) return false
  const normalized = model.toLowerCase()
  const qwen = /^qwen3\.(\d+)-(max|plus|flash)(?:-\d{4}(?:-\d{2}-\d{2})?)?$/.exec(normalized)
  if (qwen) return Number(qwen[1]) >= (qwen[2] === 'max' ? 7 : 5)
  const kimi = /^kimi-k(\d+)\.(\d+)(?:-code)?(?:-\d{4}(?:-\d{2}-\d{2})?)?$/.exec(normalized)
  if (kimi) return Number(kimi[1]) > 2 || (Number(kimi[1]) === 2 && Number(kimi[2]) >= 5)
  if (/^kimi-k3(?:-\d{4}(?:-\d{2}-\d{2})?)?$/.test(normalized)) return true
  if (/^glm-5(?:\.[123])?$/.test(normalized) || normalized === 'glm-5.2-fast-preview') return true
  if (/^zhipu\/glm-5(?:\.[123])?$/.test(normalized) || /^zhipu\/glm-5\.3-flashx?$/.test(normalized)) return true
  const minimax = /^minimax-m(\d+)(?:\.(\d+))?(?:-flash)?(?:-\d{4}(?:-\d{2}-\d{2})?)?$/.exec(normalized)
  if (minimax) return Number(minimax[1]) > 2 || (Number(minimax[1]) === 2 && Number(minimax[2] ?? 0) >= 5)
  return /^deepseek-v4-pro(?:-\d{4})?$/.test(normalized) || /^deepseek-v4\.1-flash(?:-\d{4})?$/.test(normalized)
}

export function dashScopePreservesThinkingByDefault(provider: AIProvider, model: string): boolean {
  if (!isDashScopeChatContract(provider)) return false
  return [
    'qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.8-flash', 'qwen3.8-omni-flash',
    'kimi-k2.7-code', 'kimi/kimi-k2.7-code', 'kimi/kimi-k2.7-code-highspeed',
  ].includes(model.toLowerCase())
}

/** Undefined means the legacy answer cap cannot bound the documented thinking output. */
export function dashScopeAdditionalOutputReservation(
  provider: AIProvider,
  model: string,
  body: Readonly<Record<string, unknown>>,
): number | undefined {
  if (!isDashScopeChatContract(provider)) return 0
  const normalized = model.toLowerCase()
  if (body.max_completion_tokens !== undefined) {
    return dashScopeSupportsMaxCompletionTokens(provider, model) ? 10 : undefined
  }
  if (/^deepseek-v4(?:\.1)?-(?:pro|flash)(?:-\d{4})?$/.test(normalized) || normalized === 'glm-5.3') return 0
  if (/^glm-5\.2(?:-fast-preview)?$/.test(normalized) && body.thinking_budget === undefined) return 0

  const mandatory = ['qwen3.8-2.4t-a95b', 'qwen3.7-max-preview', 'qwen3.7-max-2026-05-17', 'glm-5.3', 'minimax-m2.5'].includes(normalized)
    || /^(?:qwq|qvq)(?:-|$)/.test(normalized)
    || /(?:^|\/)deepseek-r1(?:-|$)/.test(normalized)
    || /^(?:kimi\/)?kimi-k(?:3(?:\.|$|-)|2\.7(?:-|$))/.test(normalized)
    || /^minimax\/minimax-m(?:2(?:\.|$)|3\.1-flash)/.test(normalized)
    || /^stepfun\/(?:step-3\.7-flash|step-5-preview)$/.test(normalized)
  const qwenHybrid = /^qwen3(?:\.|-)/.test(normalized) && !/coder|instruct/.test(normalized)
  if (body.enable_thinking === false && qwenHybrid && !mandatory) return 0
  if (body.enable_thinking === false && /^glm-5(?:\.[12])?(?:-fast-preview)?$/.test(normalized)) return 0
  if (body.enable_thinking === false && /^(?:kimi\/)?kimi-k2\.[56](?:-|$)/.test(normalized)) return 0
  const thinking = body.thinking as { type?: unknown } | undefined
  if (normalized === 'minimax/minimax-m3' && thinking?.type === 'disabled') return 0
  const defaultsToThinking = /^qwen3\.[5678](?:-|$)/.test(normalized) && !/coder|instruct/.test(normalized)
    || /^glm-5(?:\.[12])?(?:-fast-preview)?$/.test(normalized)
    || /^kimi\/kimi-k2\.[56](?:-|$)/.test(normalized)
    || normalized === 'minimax/minimax-m3'
    || normalized === 'antdigital/ling-3.1-flash'
  if (!mandatory && !defaultsToThinking && body.enable_thinking !== true && body.thinking_budget === undefined) return 0

  // Do not trust a third-party/Omni parameter that its route may ignore.
  const budgetSupported = qwenHybrid && !/omni/.test(normalized)
    || /^glm-5(?:\.[12])?(?:-fast-preview)?$/.test(normalized)
    || /^kimi-k2\.[567](?:-|$)/.test(normalized)
  const budget = body.thinking_budget
  return budgetSupported && typeof budget === 'number' && Number.isSafeInteger(budget) && budget > 0 ? budget : undefined
}
