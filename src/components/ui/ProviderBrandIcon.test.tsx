import type { AIProvider } from '@/types/providerContracts'

import { resolveProviderBrand, resolveProviderBrandIconColor } from './ProviderBrandIcon'

function provider(presetId: AIProvider['presetId']): AIProvider {
  return { presetId } as AIProvider
}

describe('ProviderBrandIcon', () => {
  it.each([
    ['bigmodel', 'custom-model', 'zhipu'],
    ['moonshot', 'custom-model', 'moonshot'],
    ['minimax', 'custom-model', 'minimax'],
  ] as const)('maps the %s provider to its official brand', (presetId, model, expected) => {
    expect(resolveProviderBrand(provider(presetId), model)).toBe(expected)
  })

  it.each([
    ['glm-4.7', 'zhipu'],
    ['kimi-k2.5', 'moonshot'],
    ['MiniMax-M2.5', 'minimax'],
  ] as const)('recognizes the %s model family without provider metadata', (model, expected) => {
    expect(resolveProviderBrand(undefined, model)).toBe(expected)
  })
})

describe('provider brand icon variants', () => {
  it('provides contrasting light and dark variants for every catalog brand', () => {
    const brands: Array<Parameters<typeof resolveProviderBrandIconColor>[0]> = [
      'op|enai',
      'anth|ropic',
      'grok',
      'deepseek',
      'gem|ini',
      'qwen',
      'mistral',
      'meta',
      'zhipu',
      'moonshot',
      'minimax',
      'generic',
    ].map((brand) => brand.replace('|', '') as Parameters<typeof resolveProviderBrandIconColor>[0])
    for (const brand of brands) {
      expect(resolveProviderBrandIconColor(brand, 'onLight')).not.toBe(resolveProviderBrandIconColor(brand, 'onDark'))
    }
  })
})
