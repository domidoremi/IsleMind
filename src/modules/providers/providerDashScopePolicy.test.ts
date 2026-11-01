import type { AIProvider } from '@/types/providerContracts'
import { dashScopeAdditionalOutputReservation } from './providerDashScopePolicy'

const provider: AIProvider = {
  id: 'official-output-reservation', type: 'openai-compatible', name: 'Alibaba Model Studio',
  presetId: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '', enabled: true, models: [],
}

// The dated primary page distinguishes answer-only caps from combined caps.
// These are route contracts, not properties inherited by a model on any host.
describe('documented DashScope output reservation boundaries', () => {
  it.each(['qwen3.8-27b', 'qwen3.7-max', 'glm-5.2', 'kimi-k2.6'])(
    'reserves separate, supported thinking output for legacy %s', (model) => {
      const body = { max_tokens: 100, enable_thinking: true, thinking_budget: 500 }
      expect(dashScopeAdditionalOutputReservation(provider, model, body)).toBe(500)
      expect(body).toEqual({ max_tokens: 100, enable_thinking: true, thinking_budget: 500 })
    },
  )

  it.each(['qwen3.8-max', 'glm-5.2', 'deepseek-v4-pro', 'ZHIPU/GLM-5.3-FlashX'])(
    'counts only the documented tolerance beyond a combined cap for %s', (model) => {
      expect(dashScopeAdditionalOutputReservation(provider, model, {
        max_completion_tokens: 100, enable_thinking: true, thinking_budget: 500,
      })).toBe(10)
    },
  )

  it('does not trust an unsupported combined cap as a bound', () => {
    expect(dashScopeAdditionalOutputReservation(provider, 'qwen3.8-27b', {
      max_completion_tokens: 100, enable_thinking: false,
    })).toBeUndefined()
  })

  it('keeps the GLM-5.2 legacy cap conditional on the presence of thinking_budget', () => {
    expect(dashScopeAdditionalOutputReservation(provider, 'glm-5.2', { max_tokens: 100 })).toBe(0)
    expect(dashScopeAdditionalOutputReservation(provider, 'glm-5.2', {
      max_tokens: 100, thinking_budget: 500,
    })).toBe(500)
  })

  it.each(['glm-5.3', 'deepseek-v4-pro', 'deepseek-v4.1-flash-1017'])(
    'does not double count already combined legacy output for %s', (model) => {
      expect(dashScopeAdditionalOutputReservation(provider, model, {
        max_tokens: 100, thinking_budget: 500,
      })).toBe(0)
    },
  )

  it.each(['qwen3.8-27b', 'qwen3.7-max-preview', 'kimi/kimi-k2.7-code', 'MiniMax/MiniMax-M2.7'])(
    'cannot bound default or mandatory thinking in %s from an answer cap alone', (model) => {
      expect(dashScopeAdditionalOutputReservation(provider, model, { max_tokens: 100 })).toBeUndefined()
    },
  )

  it.each(['MiniMax/MiniMax-M2.7', 'kimi/kimi-k2.7-code', 'stepfun/step-5-preview', 'qwen3.8-omni-flash'])(
    'does not treat an unproven or ignored thinking_budget as a bound for %s', (model) => {
      expect(dashScopeAdditionalOutputReservation(provider, model, {
        max_tokens: 100, thinking_budget: 500,
      })).toBeUndefined()
    },
  )

  it.each([undefined, null, 0, -1, 1.5, '500', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'does not turn an invalid thinking budget %j into an output bound', (thinking_budget) => {
      expect(dashScopeAdditionalOutputReservation(provider, 'qwen3.8-27b', {
        max_tokens: 100, enable_thinking: true, thinking_budget,
      })).toBeUndefined()
    },
  )

  it('only permits disabling thinking when the documented model can disable it', () => {
    expect(dashScopeAdditionalOutputReservation(provider, 'qwen3.8-27b', {
      max_tokens: 100, enable_thinking: false,
    })).toBe(0)
    expect(dashScopeAdditionalOutputReservation(provider, 'qwen3.8-2.4t-a95b', {
      max_tokens: 100, enable_thinking: false,
    })).toBeUndefined()
    expect(dashScopeAdditionalOutputReservation(provider, 'MiniMax/MiniMax-M3', {
      max_tokens: 100, thinking: { type: 'disabled' },
    })).toBe(0)
  })

  it.each([
    { ...provider, presetId: 'custom-endpoint' as const, baseUrl: 'https://relay.example.test/v1' },
    { ...provider, presetId: 'siliconflow' as const, baseUrl: 'https://api.siliconflow.cn/v1' },
    { ...provider, wireProtocol: 'anthropic-compatible' as const },
    { ...provider, presetId: 'custom-endpoint' as const, baseUrl: 'https://dashscope.aliyuncs.com.example.test/compatible-mode/v1' },
  ])('does not impose vendor output semantics on an unrelated wire contract', (otherProvider) => {
    expect(dashScopeAdditionalOutputReservation(otherProvider, 'qwen3.8-27b', {
      max_tokens: 100, enable_thinking: true,
    })).toBe(0)
  })
})
