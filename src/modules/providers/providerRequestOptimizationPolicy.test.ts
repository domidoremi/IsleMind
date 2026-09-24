import { describe, expect, it } from '@jest/globals'

import {
  createProviderRequestOptimizationPolicy,
  injectBedrockCache,
} from './providerRequestOptimizationPolicy'

describe('provider request cache optimization', () => {
  it.each(['us.anthropic.claude-opus-5-v1:0', 'us.anthropic.claude-sonnet-5-v1:0'])('keeps %s on adaptive thinking without re-enabling an explicit none', (model) => {
    const policy = createProviderRequestOptimizationPolicy({
      isAwsBedrockProvider: () => true,
      isBedrockRuntimeProvider: () => true,
      providerReasoningCanBeSent: () => true,
    })
    const request = {
      provider: { id: 'bedrock', name: 'Bedrock', type: 'anthropic' as const }, model,
      settings: { bedrockRequestOptimizerEnabled: true, thinkingOptimizerEnabled: true },
    }
    const body = { max_tokens: 16384, output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } }
    expect(policy.optimizeRequestBody(body, { ...request, reasoningEffort: 'xhigh' })).toMatchObject({
      thinking: { type: 'adaptive', display: 'summarized' }, output_config: { ...body.output_config, effort: 'xhigh' },
    })
    expect(policy.optimizeRequestBody(body, { ...request, reasoningEffort: 'none' })).toMatchObject({
      thinking: { type: 'disabled' }, output_config: body.output_config,
    })
  })

  it('preserves existing cache breakpoints and adds only missing text breakpoints', () => {
    const body = {
      system: 'stable system prefix',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'already cached', cache_control: { type: 'ephemeral', ttl: '1h' } }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'new suffix' }],
        },
      ],
    }

    const result = injectBedrockCache(body, '5m') as {
      system: Array<Record<string, unknown>>
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }

    expect(result.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' })
    expect(result.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(result.messages[1].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' })
    expect(body.system).toBe('stable system prefix')
    expect((body.messages[1].content as Array<Record<string, unknown>>)[0].cache_control).toBeUndefined()
  })

  it('does not add a fifth breakpoint when the request already has four', () => {
    const body = {
      system: [{ type: 'text', text: 'system', cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'one', cache_control: { type: 'ephemeral' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'two', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: [{ type: 'text', text: 'three', cache_control: { type: 'ephemeral' } }] },
      ],
    }

    const result = injectBedrockCache(body, 'default') as typeof body
    expect(result.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(result.messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(result.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('gates cache injection to direct Anthropic or Bedrock routes', () => {
    const policy = createProviderRequestOptimizationPolicy({
      isAwsBedrockProvider: () => false,
      isBedrockRuntimeProvider: () => false,
      providerReasoningCanBeSent: () => false,
    })
    const body = { system: 'prefix', messages: [{ role: 'user', content: 'hello' }] }

    expect(policy.optimizeRequestBody(body, {
      provider: { id: 'anthropic', name: 'Anthropic', type: 'anthropic' },
      model: 'claude-sonnet',
      settings: { cacheInjectionEnabled: true, cacheTtl: '1h' },
    }).system).toEqual([{ type: 'text', text: 'prefix', cache_control: { type: 'ephemeral', ttl: '1h' } }])
    expect(policy.optimizeRequestBody(body, {
      provider: { id: 'relay', name: 'Anthropic relay', type: 'openai-compatible', wireProtocol: 'anthropic-compatible' },
      model: 'claude-sonnet',
      settings: { cacheInjectionEnabled: true, cacheTtl: '1h' },
    })).toBe(body)
  })
})
