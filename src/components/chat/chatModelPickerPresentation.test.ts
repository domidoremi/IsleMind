import {
  buildChatModelPickerCandidates,
  filterChatModelPickerCandidates,
  sortChatModelPickerProviders,
} from './chatModelPickerPresentation'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'

function provider(id: string, overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id, name: 'Team gateway', type: 'openai-compatible', presetId: 'custom-endpoint', wireProtocol: 'openai-compatible',
    apiKey: '', enabled: true, baseUrl: `https://${id}.example.invalid/v1`,
    models: ['upstream-shared'], manualModels: ['upstream-shared'], lastModelSyncStatus: 'ok',
    modelAliases: [{ alias: 'routing-alias', model: 'upstream-shared' }],
    modelConfigs: [{ ...getModelConfig('upstream-shared', 'openai-compatible'), name: 'Shared model',
      upstreamProvider: { id: 'upstream-vendor', name: 'Upstream Vendor' } }],
    ...overrides,
  }
}

const build = (providers: AIProvider[], overrides: Partial<Parameters<typeof buildChatModelPickerCandidates>[0]> = {}) =>
  buildChatModelPickerCandidates({ providers, currentProviderId: null, currentModel: null, providerFallbackName: 'Custom connection', ...overrides })

it('retains identical model names and routing aliases on different connections', () => {
  const candidates = build([provider('a'), provider('b')])
  expect(candidates.map((item) => [item.provider.id, item.id])).toEqual([
    ['a', 'upstream-shared'], ['a', 'routing-alias'], ['b', 'upstream-shared'], ['b', 'routing-alias'],
  ])
  expect(new Set(candidates.map((item) => item.key)).size).toBe(4)
  expect(candidates.filter((item) => item.id === 'routing-alias').map((item) => item.upstreamModel)).toEqual(['upstream-shared', 'upstream-shared'])
})

it('recognizes an explicit current model even after its catalog entry disappears, only in its original connection', () => {
  const a = provider('a')
  const candidates = build([a, provider('b')], { currentProviderId: 'a', currentModel: 'missing-current' })
  expect(candidates[0]).toMatchObject({ id: 'missing-current', provider: a })
  expect(candidates.filter((item) => item.id === 'missing-current')).toHaveLength(1)
  expect(a.models).toEqual(['upstream-shared'])
})

it('puts a current routing alias first without merging it with its upstream entry', () => {
  const candidates = build([provider('a')], { currentProviderId: 'a', currentModel: 'routing-alias' })
  expect(candidates.map((item) => item.id)).toEqual(['routing-alias', 'upstream-shared'])
})

it.each(['b shared', 'B ROUTING-ALIAS', 'b upstream-shared', 'b friendly label', 'b upstream vendor', 'b b.example.invalid'])(
  'searches connection, requested/upstream IDs, names, display aliases, and source metadata together: %s', (query) => {
    const candidates = build([provider('a'), provider('b')], {
      displayAliases: [{ providerId: 'b', modelId: 'routing-alias', displayName: 'Friendly label' }],
    })
    const matches = filterChatModelPickerCandidates({ candidates, scope: { kind: 'all' }, query })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((item) => item.provider.id === 'b')).toBe(true)
  },
)

it('finds models past the old sample limits and retains the complete local catalog for pagination', () => {
  const models = Array.from({ length: 400 }, (_, index) => `catalog-model-${index}`)
  const candidates = build([provider('large', { models, manualModels: [], modelAliases: [], modelConfigs: [] })])
  expect(candidates).toHaveLength(400)
  expect(filterChatModelPickerCandidates({ candidates, scope: { kind: 'all' }, query: 'catalog-model-399' }).map((item) => item.id)).toEqual(['catalog-model-399'])
})

it('favorites filter by the connection and requested ID, preserving aliases and hiding unrelated upstream entries', () => {
  const candidates = build([provider('a'), provider('b')])
  const favorites = [{ providerId: 'b', modelId: 'routing-alias' }, { providerId: 'absent', modelId: 'upstream-shared' }]
  expect(filterChatModelPickerCandidates({ candidates, scope: { kind: 'favorites' }, query: '', favorites }).map((item) => [item.provider.id, item.id])).toEqual([['b', 'routing-alias']])
  expect(filterChatModelPickerCandidates({ candidates, scope: { kind: 'favorites' }, query: 'no-match', favorites })).toEqual([])
})

it('searches normalized display aliases while retaining exact Unicode requested IDs for favorites', () => {
  const requested = 'cafe\u0301'
  const candidates = build([provider('p', { models: [requested], manualModels: [requested], modelAliases: [], modelConfigs: [] })], {
    displayAliases: [{ providerId: 'p', modelId: 'café', displayName: 'Friendly alias' }],
  })
  const matches = filterChatModelPickerCandidates({
    candidates, scope: { kind: 'favorites' }, query: 'friendly alias', favorites: [{ providerId: 'p', modelId: requested }],
  })
  expect(matches.map((item) => item.id)).toEqual([requested])
})

it('scopes a source filter to its connection and clears it for all/favorites results', () => {
  const a = provider('a', { manualModels: ['upstream-shared', 'no-source'] })
  const candidates = build([a, provider('b')])
  expect(filterChatModelPickerCandidates({ candidates, scope: { kind: 'provider', providerId: 'a' }, sourceId: 'upstream-vendor', query: '' }).map((item) => item.id)).toEqual(['upstream-shared', 'routing-alias'])
  expect(filterChatModelPickerCandidates({ candidates, scope: { kind: 'all' }, sourceId: 'missing-source', query: '' })).toEqual(candidates)
})

it('shows cached disabled connections and never fabricates favorite-only model entries', () => {
  const candidates = build([provider('disabled', { enabled: false })])
  expect(candidates).toHaveLength(2)
  expect(filterChatModelPickerCandidates({ candidates, scope: { kind: 'favorites' }, query: '', favorites: [{ providerId: 'disabled', modelId: 'not-in-catalog' }] })).toEqual([])
})

it('keeps the current connection first and gives duplicate connection names stable ordering', () => {
  const providers = [provider('z'), provider('a'), provider('current', { enabled: false }), provider('disabled', { enabled: false })]
  expect(sortChatModelPickerProviders(providers, 'current').map((item) => item.id)).toEqual(['current', 'a', 'z', 'disabled'])
  expect(providers.map((item) => item.id)).toEqual(['z', 'a', 'current', 'disabled'])
})
