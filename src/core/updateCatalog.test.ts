import { canonicalCatalogJson, decodeUpdateCatalog, parseUpdateCatalog, catalogUtf8ByteLength } from './updateCatalog'
import { updateCatalogFixture } from './__tests__/updateCatalogFixture'

it('preserves durable IDs, localized source text, explicit inclusion and source-only releases', () => {
  const input = updateCatalogFixture()
  const decoded = decodeUpdateCatalog(canonicalCatalogJson(input))
  expect(decoded).toEqual(input)
  expect(decoded.releases[0].artifactIds).toEqual([])
  expect(Object.isFrozen(decoded.artifacts[0].changeIds)).toBe(true)
  expect(Object.isFrozen(decoded.changes[1].texts)).toBe(true)
})

it('canonicalizes object keys without normalizing Unicode or reordering arrays', () => {
  expect(canonicalCatalogJson({ b: ['e\u0301', '\u00e9'], a: 1 })).toBe('{"a":1,"b":["e\u0301","\u00e9"]}')
  expect(catalogUtf8ByteLength('\u4e2d\ud83c\udfdd')).toBe(7)
})

it.each([
  ['unknown schema', (value: any) => { value.schema = 'v2' }],
  ['unknown field', (value: any) => { value.unknown = true }],
  ['unsafe sequence', (value: any) => { value.sequence = Number.MAX_SAFE_INTEGER + 1 }],
  ['invalid expiration', (value: any) => { value.expiresAtMs = value.issuedAtMs }],
  ['overlong lifetime', (value: any) => { value.expiresAtMs = value.issuedAtMs + 8 * 86400_000 }],
  ['ambiguous version', (value: any) => { value.releases[0].version = 'v1.1.3' }],
  ['short commit', (value: any) => { value.releases[0].sourceCommit = '123' }],
  ['duplicate release ID', (value: any) => { value.releases.push(value.releases[0]) }],
  ['duplicate change ID', (value: any) => { value.changes.push(value.changes[0]) }],
  ['duplicate artifact ID', (value: any) => { value.artifacts.push(value.artifacts[0]) }],
  ['duplicate inclusion', (value: any) => { value.artifacts[0].changeIds.push(value.artifacts[0].changeIds[0]) }],
  ['missing release', (value: any) => { value.changes[0].releaseId = 'missing' }],
  ['wrong release membership', (value: any) => { value.releases[1].changeIds.push('change:search') }],
  ['missing included release', (value: any) => { value.artifacts[0].includedReleaseIds = ['release:114'] }],
  ['missing artifact membership', (value: any) => { value.releases[1].artifactIds = ['ota:2'] }],
  ['wrong artifact source', (value: any) => { value.artifacts[0].sourceCommit = '3'.repeat(40) }],
  ['missing hash', (value: any) => { delete value.artifacts[0].sha256 }],
  ['credential URL', (value: any) => { value.artifacts[0].url = 'https://user:password@example.test/app.apk' }],
  ['HTTP URL', (value: any) => { value.artifacts[0].url = 'http://example.test/app.apk' }],
  ['query URL', (value: any) => { value.artifacts[0].url = 'https://example.test/app.apk?token=x' }],
  ['native-only OTA change', (value: any) => { value.changes[0].delivery = 'native' }],
  ['out-of-platform change', (value: any) => { value.changes[0].platforms = ['web'] }],
  ['unknown language', (value: any) => { value.changes[0].texts.fr = 'Bonjour' }],
  ['missing text', (value: any) => { value.changes[0].texts = {} }],
  ['unpaired surrogate', (value: any) => { value.changes[0].texts.en = '\ud800' }],
  ['invalid OTA bounds', (value: any) => { value.artifacts[1].maximumNativeBuildVersion = 1 }],
])('rejects %s rather than dropping malformed metadata', (_name, edit) => {
  const value = JSON.parse(JSON.stringify(updateCatalogFixture()))
  edit(value)
  expect(() => parseUpdateCatalog(value)).toThrow()
})

it('rejects duplicate JSON properties even when a normal parser would keep the last value', () => {
  const payload = canonicalCatalogJson(updateCatalogFixture())
  expect(() => decodeUpdateCatalog(payload.replace('"sequence":2', '"sequence":1,"sequence":2'))).toThrow(/canonical/)
  expect(() => decodeUpdateCatalog(` ${payload}`)).toThrow(/canonical/)
})

it('bounds strings, totals, nesting, sparse arrays, cycles and accessors without executing them', () => {
  expect(() => canonicalCatalogJson('x'.repeat(1_048_577))).toThrow(/budget/)
  expect(() => canonicalCatalogJson(['x'.repeat(600_000), 'y'.repeat(600_000)])).toThrow(/budget/)
  let nested: unknown = null
  for (let index = 0; index < 26; index++) nested = [nested]
  expect(() => canonicalCatalogJson(nested)).toThrow(/structural/)
  expect(() => canonicalCatalogJson(new Array(2))).toThrow(/dense/)
  const circular: unknown[] = []
  circular.push(circular)
  expect(() => canonicalCatalogJson(circular)).toThrow(/cycles/)
  const getter = jest.fn()
  expect(() => canonicalCatalogJson(Object.defineProperty({}, 'value', { get: getter, enumerable: true }))).toThrow(/accessors/)
  expect(getter).not.toHaveBeenCalled()
})
