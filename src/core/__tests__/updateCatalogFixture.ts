import { createPrivateKey, sign } from 'node:crypto'
import { canonicalCatalogJson, type UpdateCatalog } from '../updateCatalog'
import { catalogSigningMessage, SIGNED_UPDATE_CATALOG_SCHEMA, type UpdateCatalogTrust } from '../signedUpdateCatalog'

// Published RFC 8032 section 7.1 test material, never a deployment signing key.
export const TEST_ONLY_ED25519_PUBLIC_KEY = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
const TEST_ONLY_ED25519_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
export const CATALOG_TEST_NOW_MS = Date.UTC(2026, 9, 27)
export const CATALOG_TEST_RUNTIME = `sha256:${'b'.repeat(64)}`

export function updateCatalogFixture(): UpdateCatalog {
  return {
    schema: 'islemind.update-catalog.v1', repository: 'example/IsleMind', channel: 'stable', sequence: 2,
    issuedAtMs: CATALOG_TEST_NOW_MS - 1000, expiresAtMs: CATALOG_TEST_NOW_MS + 60_000,
    releases: [
      { id: 'release:113', version: '1.1.3', sourceCommit: '1'.repeat(40), publishedAtMs: CATALOG_TEST_NOW_MS - 2000,
        changeIds: ['change:search'], artifactIds: [] },
      { id: 'release:114', version: '1.1.4', sourceCommit: '2'.repeat(40), publishedAtMs: CATALOG_TEST_NOW_MS - 1000,
        changeIds: ['change:prompt'], artifactIds: ['apk:129', 'ota:2'] },
    ],
    changes: [
      { id: 'change:search', releaseId: 'release:113', sourceCommit: '1'.repeat(40), category: 'improvements',
        delivery: 'ota-compatible', platforms: ['android', 'web'], texts: { en: 'Remember the settings search.' } },
      { id: 'change:prompt', releaseId: 'release:114', sourceCommit: '2'.repeat(40), category: 'features',
        delivery: 'ota-compatible', platforms: ['android'], texts: { en: 'Offer updates at quiet time.', 'zh-CN': '\u95f2\u65f6\u63d0\u9192\u66f4\u65b0\u3002' } },
    ],
    artifacts: [
      { id: 'apk:129', releaseId: 'release:114', version: '1.1.4', sourceCommit: '2'.repeat(40),
        runtimeVersion: CATALOG_TEST_RUNTIME, url: 'https://example.test/app.apk', sha256: 'a'.repeat(64), sizeBytes: 100,
        includedReleaseIds: ['release:113', 'release:114'], changeIds: ['change:search', 'change:prompt'], status: 'active',
        kind: 'apk', platform: 'android', nativeBuildVersion: 129, abi: 'arm64-v8a', variant: 'no-model' },
      { id: 'ota:2', releaseId: 'release:114', version: '1.1.4', sourceCommit: '2'.repeat(40),
        runtimeVersion: CATALOG_TEST_RUNTIME, url: 'https://example.test/bundle.js', sha256: 'c'.repeat(64), sizeBytes: 100,
        includedReleaseIds: ['release:113', 'release:114'], changeIds: ['change:search', 'change:prompt'], status: 'active',
        kind: 'ota', platform: 'android', sequence: 2, minimumNativeBuildVersion: 127, maximumNativeBuildVersion: 128 },
    ],
  }
}

export function updateCatalogTrustFixture(): UpdateCatalogTrust {
  return {
    repository: 'example/IsleMind', channel: 'stable', nowMs: CATALOG_TEST_NOW_MS, minimumSequence: 1,
    keys: [{ id: 'test:rfc8032', publicKeyHex: TEST_ONLY_ED25519_PUBLIC_KEY,
      notBeforeMs: CATALOG_TEST_NOW_MS - 100_000, notAfterMs: CATALOG_TEST_NOW_MS + 100_000, revoked: false }],
  }
}

export function signedCatalogFixture(catalog: UpdateCatalog = updateCatalogFixture(), keyId = 'test:rfc8032'): string {
  const payload = canonicalCatalogJson(catalog)
  const key = createPrivateKey({
    format: 'der', type: 'pkcs8',
    key: Buffer.from(`302e020100300506032b657004220420${TEST_ONLY_ED25519_SEED}`, 'hex'),
  })
  const signature = sign(null, Buffer.from(catalogSigningMessage(keyId, payload), 'utf8'), key).toString('hex')
  return canonicalCatalogJson({ schema: SIGNED_UPDATE_CATALOG_SCHEMA, keyId, payload, signature })
}
