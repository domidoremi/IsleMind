import { renderHook } from '@testing-library/react-native'
import { mapOpenAICompatibleModels } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import { useComposerReasoningControl } from './useComposerReasoningControl'

const model = 'supplier/shared-reasoner'
type ControlState = ReturnType<typeof useComposerReasoningControl>
function gateway(levels: string[] | false): AIProvider {
  return {
    id: 'gateway', name: 'Gateway', type: 'openai-compatible', presetId: 'custom-endpoint',
    baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic-only', enabled: true, models: [model],
    modelAliases: [{ alias: 'shortcut', model }],
    modelConfigs: mapOpenAICompatibleModels({ data: [{
      id: model, magpie_label: 'Shared Reasoner · Supplier', reasoning: levels !== false, reasoning_levels: levels || [],
      supported_parameters: levels === false ? [] : ['reasoning'],
    }] }, 'openai-compatible', { providerPresetId: 'custom-endpoint' }),
  }
}

it('reads advertised supplier levels through model aliases and preserves a supported choice', async () => {
  const onChange = jest.fn()
  const view = await renderHook(() => useComposerReasoningControl({
    provider: gateway(['low', 'high', 'max']), model: 'shortcut', value: 'high', disabled: false, onChange,
  }))
  expect(view.result.current.options).toEqual(['low', 'high', 'max'])
  expect(view.result.current.value).toBe('high')
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})

it('normalizes an obsolete choice after a capability refresh of the same supplier and model', async () => {
  const onChange = jest.fn()
  const view = await renderHook<ControlState, { provider: AIProvider }>(({ provider }) => useComposerReasoningControl({
    provider, model, value: 'max', disabled: false, onChange,
  }), { initialProps: { provider: gateway(['low', 'high', 'max']) } })
  expect(view.result.current.value).toBe('max')
  await view.rerender({ provider: gateway(['low']) })
  expect(view.result.current.options).toEqual(['low'])
  expect(view.result.current.value).toBe('low')
  expect(onChange).toHaveBeenLastCalledWith('low')
  await view.unmount()
})

it('clears the choice when the supplier disables request controls even with remote reasoning metadata', async () => {
  const onChange = jest.fn()
  const provider = gateway(['low', 'high'])
  provider.capabilities = { reasoningEffort: false } as NonNullable<AIProvider['capabilities']>
  const view = await renderHook(() => useComposerReasoningControl({
    provider, model, value: 'high', disabled: false, onChange,
  }))
  expect(view.result.current.options).toEqual([])
  expect(view.result.current.value).toBeUndefined()
  expect(onChange).toHaveBeenCalledWith(undefined)
  await view.unmount()
})

it('waits until sending ends before persisting a choice invalidated by a catalog refresh', async () => {
  const onChange = jest.fn()
  const view = await renderHook<ControlState, { disabled: boolean; provider: AIProvider }>(({ disabled, provider }) => useComposerReasoningControl({
    provider, model, value: 'max', disabled, onChange,
  }), { initialProps: { disabled: true, provider: gateway(['low', 'high', 'max']) } })
  await view.rerender({ disabled: true, provider: gateway(['low', 'high']) })
  expect(view.result.current.options).toEqual(['low', 'high'])
  expect(onChange).not.toHaveBeenCalled()
  await view.rerender({ disabled: false, provider: gateway(['low', 'high']) })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith(view.result.current.value)
  await view.unmount()
})

it('preserves a saved choice during provider hydration and model loading', async () => {
  const onChange = jest.fn()
  const view = await renderHook<ControlState, { provider: AIProvider | undefined; selectedModel: string }>(({ provider, selectedModel }) => useComposerReasoningControl({
    provider, model: selectedModel, value: 'high', disabled: false, onChange,
  }), { initialProps: { provider: undefined as AIProvider | undefined, selectedModel: model } })
  expect(onChange).not.toHaveBeenCalled()
  await view.rerender({ provider: gateway(['low', 'high']), selectedModel: '' })
  expect(onChange).not.toHaveBeenCalled()
  await view.rerender({ provider: gateway(['low', 'high']), selectedModel: model })
  expect(view.result.current.value).toBe('high')
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})

it('keeps model default unset and removes all levels for an unsupported model', async () => {
  const onChange = jest.fn()
  const view = await renderHook<ControlState, { provider: AIProvider }>(({ provider }) => useComposerReasoningControl({
    provider, model, value: undefined, disabled: false, onChange,
  }), { initialProps: { provider: gateway(['low', 'high']) } })
  expect(view.result.current.value).toBeUndefined()
  await view.rerender({ provider: gateway(false) })
  expect(view.result.current.options).toEqual([])
  expect(view.result.current.value).toBeUndefined()
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})
