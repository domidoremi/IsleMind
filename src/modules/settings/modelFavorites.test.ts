import {
  getSettingsModelIdentityKey,
  normalizeSettingsIdentityPreferences,
  normalizeSettingsModelFavorites,
  removeSettingsModelFavoritesForProviders,
  SETTINGS_MODEL_FAVORITE_LIMIT,
  setSettingsModelFavorite,
  SettingsModelFavoriteLimitError,
} from './identity'
import { sanitizeSettingsForPortableExport } from './settingsPortableExportPolicy'
import type { Settings, SettingsModelFavorite } from '@/types/settingsContracts'

const favorite = (providerId = 'connection-a', modelId = 'requested-alias'): SettingsModelFavorite => ({ providerId, modelId })

it('keeps connection, requested alias, and case as distinct favorite identities', () => {
  const entries = [favorite(), favorite('connection-b'), favorite('connection-a', 'upstream-id'), favorite('connection-a', 'Requested-alias')]
  expect(normalizeSettingsModelFavorites([...entries, favorite()])).toEqual(entries)
  expect(new Set(entries.map((item) => getSettingsModelIdentityKey(item.providerId, item.modelId))).size).toBe(4)
  expect(getSettingsModelIdentityKey('a:b', 'c')).not.toBe(getSettingsModelIdentityKey('a', 'b:c'))
})

it('preserves Unicode code points in opaque requested IDs instead of rewriting an alias', () => {
  const entries = [favorite('p', 'cafe\u0301'), favorite('p', 'café')]
  expect(normalizeSettingsModelFavorites(entries)).toEqual(entries)
  expect(setSettingsModelFavorite(entries, { ...entries[0], favorite: false })).toEqual([entries[1]])
})

it('normalizes persisted IDs and drops malformed entries and unrelated fields', () => {
  expect(normalizeSettingsModelFavorites([
    null, [], 'bad', { modelId: 'missing-connection' }, { providerId: 'p', modelId: '\u0000bad' },
    { providerId: 'p', modelId: 'x'.repeat(201) },
    { providerId: ' connection-a ', modelId: ' requested-alias ', apiKey: 'discarded-extra-field' },
    favorite(),
  ])).toEqual([favorite()])
  expect(normalizeSettingsModelFavorites('not-an-array')).toBeUndefined()
})

it('distinguishes a legacy absent collection from an explicitly cleared list', () => {
  expect(normalizeSettingsModelFavorites(undefined)).toBeUndefined()
  expect(normalizeSettingsModelFavorites([])).toEqual([])
  expect(setSettingsModelFavorite([favorite()], { ...favorite(), favorite: false })).toEqual([])
  expect(normalizeSettingsIdentityPreferences({ modelFavorites: [] } as unknown as Settings)).toEqual({ modelFavorites: [] })
})

it('adds, retries, and removes only the requested connection/model pair', () => {
  const first = setSettingsModelFavorite(undefined, { ...favorite(), favorite: true })
  const two = setSettingsModelFavorite(first, { ...favorite('connection-b'), favorite: true })
  expect(setSettingsModelFavorite(two, { ...favorite(), favorite: true })).toEqual(two)
  expect(setSettingsModelFavorite(two, { ...favorite(), favorite: false })).toEqual([favorite('connection-b')])
  expect(first).toEqual([favorite()])
})

it.each([{ providerId: '', modelId: 'm' }, { providerId: 'p', modelId: '\n' }, { providerId: 'p', modelId: 'm'.repeat(201) }])(
  'rejects an incomplete or unsafe explicit identity: %o', (identity) => {
    expect(() => setSettingsModelFavorite([favorite()], { ...identity, favorite: true })).toThrow(TypeError)
  },
)

it('bounds stored collections and rejects an extra explicit favorite without evicting existing choices', () => {
  const full = Array.from({ length: SETTINGS_MODEL_FAVORITE_LIMIT }, (_, index) => favorite('p', `model-${index}`))
  expect(normalizeSettingsModelFavorites([...full, favorite('p', 'overflow')])).toEqual(full)
  expect(() => setSettingsModelFavorite(full, { ...favorite('p', 'overflow'), favorite: true })).toThrow(SettingsModelFavoriteLimitError)
  const remaining = setSettingsModelFavorite(full, { ...full[0], favorite: false })
  expect(setSettingsModelFavorite(remaining, { ...favorite('p', 'overflow'), favorite: true })).toHaveLength(SETTINGS_MODEL_FAVORITE_LIMIT)
})

it('normalizes favorites independently of the default, explicit preference, and display aliases', () => {
  const settings = {
    defaultProvider: 'different-default',
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'preferred', model: 'different-alias' },
    modelDisplayAliases: [{ ...favorite(), displayName: 'My label' }],
    modelFavorites: [favorite(), { providerId: 'bad', modelId: '' }],
  } as unknown as Settings
  const normalized = normalizeSettingsIdentityPreferences(settings)
  expect(normalized).toEqual({ ...settings, modelFavorites: [favorite()] })
  expect(normalizeSettingsIdentityPreferences(normalized)).toBe(normalized)
})

it('cleans only favorites belonging to explicitly deleted connections', () => {
  const entries = [favorite(), favorite('connection-b'), favorite('temporarily-absent')]
  expect(removeSettingsModelFavoritesForProviders(entries, ['connection-a'])).toEqual(entries.slice(1))
  expect(removeSettingsModelFavoritesForProviders(entries, ['connection-a', 'connection-b', 'temporarily-absent'])).toEqual([])
  expect(entries).toHaveLength(3)
})

it('exports an explicit empty collection and only normalized favorite identities', () => {
  expect(sanitizeSettingsForPortableExport({ defaultProvider: null } as Settings).modelFavorites).toEqual([])
  expect(sanitizeSettingsForPortableExport({ modelFavorites: [favorite(), favorite()] } as Settings).modelFavorites).toEqual([favorite()])
})
