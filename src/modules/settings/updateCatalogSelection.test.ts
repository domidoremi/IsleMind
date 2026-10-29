import { verifySignedUpdateCatalog } from '@/core/signedUpdateCatalog'
import {
  signedCatalogFixture, updateCatalogFixture, updateCatalogTrustFixture, CATALOG_TEST_RUNTIME, CATALOG_TEST_NOW_MS,
} from '@/core/__tests__/updateCatalogFixture'
import {
  selectUpdateCatalogArtifacts, collectUpdateCatalogChanges, acceptUpdateCatalogCheckpoint,
  type UpdateCatalogSelectionContext,
} from './updateCatalogSelection'

const { verifyEd25519CatalogSignature } = require('../../../scripts/update-catalog-crypto')
const context: UpdateCatalogSelectionContext = {
  platform: 'android', nowMs: CATALOG_TEST_NOW_MS, distribution: 'github', installedSourceVersion: '1.1.2', nativeBuildVersion: 128,
  runtimeVersion: CATALOG_TEST_RUNTIME, appliedOtaSequence: 0, otaEnabled: false,
  supportedAbis: ['arm64-v8a'], variant: 'no-model', allowedArtifactOrigins: ['https://example.test'],
}
const verified = (catalog = updateCatalogFixture()) => verifySignedUpdateCatalog(signedCatalogFixture(catalog), updateCatalogTrustFixture(), verifyEd25519CatalogSignature)

it('selects APKs by actual build/ABI/variant and never promotes source-only notes to an installer', async () => {
  const evidence = await verified()
  expect(selectUpdateCatalogArtifacts(evidence, context).apk?.id).toBe('apk:129')
  expect(selectUpdateCatalogArtifacts(evidence, context).ota).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...context, nativeBuildVersion: 129 }).apk).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...context, supportedAbis: ['x86_64'] }).apk).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...context, variant: 'with-model-small' }).apk).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...context, distribution: 'google-play', otaEnabled: true })).toEqual({ apk: undefined, ota: undefined })
  expect(selectUpdateCatalogArtifacts(evidence, { ...context, allowedArtifactOrigins: ['https://other.test'] }).apk).toBeUndefined()
})

it('requires explicit OTA opt-in and exact runtime/native/sequence compatibility', async () => {
  const evidence = await verified()
  const enabled = { ...context, otaEnabled: true }
  expect(selectUpdateCatalogArtifacts(evidence, enabled).ota?.id).toBe('ota:2')
  expect(selectUpdateCatalogArtifacts(evidence, { ...enabled, runtimeVersion: `sha256:${'d'.repeat(64)}` }).ota).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...enabled, nativeBuildVersion: 126 }).ota).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...enabled, nativeBuildVersion: 129 }).ota).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...enabled, appliedOtaSequence: 2 }).ota).toBeUndefined()
  expect(selectUpdateCatalogArtifacts(evidence, { ...enabled, installedSourceVersion: '1.1.5' })).toEqual({ apk: undefined, ota: undefined })
})

it('rejects unverified/copied objects and mixed platform identities', async () => {
  const evidence = await verified()
  expect(() => selectUpdateCatalogArtifacts({ ...evidence }, context)).toThrow(/decoded\/copied/)
  expect(() => selectUpdateCatalogArtifacts(evidence, { ...context, platform: 'web' })).toThrow(/identities/)
  expect(() => selectUpdateCatalogArtifacts(evidence, { ...context, allowedArtifactOrigins: ['http://example.test'] })).toThrow(/HTTPS/)
  expect(() => selectUpdateCatalogArtifacts(evidence, { ...context, nowMs: CATALOG_TEST_NOW_MS + 60_000 })).toThrow(/not current/)
})

it('quarantines artifacts without treating them as installed or suppressing unrelated candidates', async () => {
  const catalog = JSON.parse(JSON.stringify(updateCatalogFixture()))
  catalog.artifacts[0].status = 'quarantined'
  const evidence = await verified(catalog)
  expect(selectUpdateCatalogArtifacts(evidence, { ...context, otaEnabled: true })).toMatchObject({ apk: undefined, ota: { id: 'ota:2' } })
  expect(() => collectUpdateCatalogChanges(evidence, 'apk:129', { changeIds: [], releaseIds: [] }, 'en')).toThrow(/non-quarantined/)
  expect(context.nativeBuildVersion).toBe(128)
})

it('uses durable IDs and explicit receipts for cumulative counts, including empty delivered releases', async () => {
  const catalog = JSON.parse(JSON.stringify(updateCatalogFixture()))
  catalog.releases.unshift({
    id: 'release:112', version: '1.1.2', sourceCommit: '0'.repeat(40),
    publishedAtMs: catalog.issuedAtMs - 2000, changeIds: [], artifactIds: [],
  })
  catalog.artifacts[0].includedReleaseIds.unshift('release:112')
  const evidence = await verified(catalog)
  const notes = collectUpdateCatalogChanges(evidence, 'apk:129', { changeIds: [], releaseIds: [] }, 'zh-CN')
  expect(notes.releaseCount).toBe(3)
  expect(notes.changeCount).toBe(2)
  expect(notes.items[0]).toMatchObject({ id: 'change:prompt', language: 'zh-CN', fallback: false })
  expect(notes.items[1]).toMatchObject({ id: 'change:search', language: 'en', fallback: true })
  expect(collectUpdateCatalogChanges(evidence, 'apk:129', { changeIds: ['change:search'], releaseIds: ['release:112', 'release:113'] }, 'en'))
    .toMatchObject({ releaseCount: 1, changeCount: 1 })
  expect(Object.isFrozen(notes.items)).toBe(true)
})

it('requires checkpoint compare-and-set so out-of-order catalog verification cannot roll back acceptance', async () => {
  const older = await verified()
  const newer = await verified({ ...updateCatalogFixture(), sequence: 3 })
  let current: typeof older.checkpoint | undefined
  const requests: unknown[] = []
  const store = { compareAndSet: jest.fn(async (request: any) => {
    requests.push(request)
    if (request.expected !== current) return false
    current = request.next
    return true
  }) }
  expect(await acceptUpdateCatalogCheckpoint(newer, store)).toBe('accepted')
  expect(await acceptUpdateCatalogCheckpoint(older, store)).toBe('stale')
  expect(current?.sequence).toBe(3)
  expect(Object.isFrozen(requests[0])).toBe(true)
  const cancelled = new AbortController()
  cancelled.abort()
  expect(await acceptUpdateCatalogCheckpoint(older, store, cancelled.signal)).toBe('cancelled')
  expect(store.compareAndSet).toHaveBeenCalledTimes(2)
})
