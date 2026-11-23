import { resolveProviderConnectionLabel } from './providerPresentation'
import type { AIProvider } from '@/types/providerContracts'

const provider = (id: string, name: string, baseUrl = ''): AIProvider => ({
  id, name, baseUrl, type: 'openai-compatible', apiKey: '', enabled: true, models: [], modelCatalogKnown: true,
})
const cases = [
  { name: 'keeps a unique explicit name', providers: [provider('p-a', 'Solo', 'https://api.example/v1')], fallback: 'Custom', expected: ['Solo'] },
  { name: 'adds hosts to duplicate names', providers: [provider('p-a', 'Same', 'https://alpha.example/v1'), provider('p-b', 'Same', 'https://beta.example/v1')], fallback: 'Custom', expected: ['Same · alpha.example', 'Same · beta.example'] },
  { name: 'orders same-host ordinals by stable IDs', providers: [provider('p-z', 'Same', 'https://api.example:8443/z'), provider('p-a', 'Same', 'https://api.example:8443/a')], fallback: 'Custom', expected: ['Same · api.example:8443 · 2', 'Same · api.example:8443 · 1'] },
  { name: 'keeps ordinals after provider reorder', providers: [provider('p-a', 'Same', 'https://api.example:8443/a'), provider('p-z', 'Same', 'https://api.example:8443/z')], fallback: 'Custom', expected: ['Same · api.example:8443 · 1', 'Same · api.example:8443 · 2'] },
  { name: 'disambiguates empty endpoint fallback names', providers: [provider('p-z', ''), provider('p-a', '')], fallback: '自定义供应商', expected: ['自定义供应商 · 2', '自定义供应商 · 1'] },
  { name: 'compares duplicate names without case or boundary whitespace', providers: [provider('p-a', ' SAME ', 'https://api.example'), provider('p-z', 'Same', 'https://api.example')], fallback: 'Custom', expected: ['SAME · api.example · 1', 'Same · api.example · 2'] },
  { name: 'shows only host and port from sensitive URLs', providers: [provider('p-a', 'Same', 'https://user:fixture-secret@alpha.example:8443/private?key=fixture#hidden'), provider('p-b', 'Same', 'https://beta.example:8443/v1')], fallback: 'Custom', expected: ['Same · alpha.example:8443', 'Same · beta.example:8443'] },
]

it.each(cases)('$name without mutating provider values', ({ providers, fallback, expected }) => {
  const original = JSON.stringify(providers)
  expect(typeof resolveProviderConnectionLabel).toBe('function')
  expect(providers.map(item => resolveProviderConnectionLabel(item, providers, fallback))).toEqual(expected)
  expect(JSON.stringify(providers)).toBe(original)
})
