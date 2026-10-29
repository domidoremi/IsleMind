import { sha256Hex } from './contentDigest'
import { canonicalCatalogJson } from './updateCatalog'
import {
  verifySignedUpdateCatalog, decodeSignedUpdateCatalog, parseUpdateCatalogCheckpoint,
  assertVerifiedUpdateCatalog, catalogSigningMessage,
  type UpdateCatalogSignatureVerifier,
} from './signedUpdateCatalog'
import {
  signedCatalogFixture, updateCatalogFixture, updateCatalogTrustFixture,
  TEST_ONLY_ED25519_PUBLIC_KEY, CATALOG_TEST_NOW_MS,
} from './__tests__/updateCatalogFixture'

const { verifyEd25519CatalogSignature } = require('../../scripts/update-catalog-crypto')
const { createHash } = require('node:crypto')

it('verifies the published RFC 8032 empty-message Ed25519 vector with native cryptography', () => {
  const signatureHex = 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155'
    + '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
  expect(verifyEd25519CatalogSignature({ message: '', signatureHex, publicKeyHex: TEST_ONLY_ED25519_PUBLIC_KEY })).toBe(true)
  expect(verifyEd25519CatalogSignature({ message: 'changed', signatureHex, publicKeyHex: TEST_ONLY_ED25519_PUBLIC_KEY })).toBe(false)
})

it('verifies exact catalog bytes and returns frozen, CAS-bound metadata evidence', async () => {
  const text = signedCatalogFixture()
  const trust = updateCatalogTrustFixture()
  const verified = await verifySignedUpdateCatalog(text, trust, verifyEd25519CatalogSignature)
  expect(verified.catalog).toEqual(updateCatalogFixture())
  expect(verified.checkpoint.sequence).toBe(2)
  const payload = decodeSignedUpdateCatalog(text).payload
  expect(verified.checkpoint.payloadSha256).toBe(createHash('sha256').update(payload).digest('hex'))
  expect(verified.checkpoint.payloadSha256).toBe(sha256Hex(payload))
  expect(Object.isFrozen(verified.catalog.artifacts[0])).toBe(true)
  expect(Object.isFrozen(verified.checkpoint)).toBe(true)
  expect(() => assertVerifiedUpdateCatalog(verified)).not.toThrow()
  expect(() => assertVerifiedUpdateCatalog({ ...verified })).toThrow(/decoded\/copied/)
  expect((verified as any).applied).toBeUndefined()
})

it('does not accept a changed payload, signature, key identity or signature domain', async () => {
  const envelope = JSON.parse(signedCatalogFixture())
  const changed = JSON.parse(envelope.payload)
  changed.changes[0].texts.en = 'Tampered'
  await expect(verifySignedUpdateCatalog(canonicalCatalogJson({ ...envelope, payload: canonicalCatalogJson(changed) }),
    updateCatalogTrustFixture(), verifyEd25519CatalogSignature)).rejects.toMatchObject({ code: 'signature' })
  await expect(verifySignedUpdateCatalog(canonicalCatalogJson({ ...envelope, signature: '0'.repeat(128) }),
    updateCatalogTrustFixture(), verifyEd25519CatalogSignature)).rejects.toMatchObject({ code: 'signature' })
  const trust = updateCatalogTrustFixture()
  await expect(verifySignedUpdateCatalog(canonicalCatalogJson({ ...envelope, keyId: 'test:alias' }),
    { ...trust, keys: [{ ...trust.keys[0], id: 'test:alias' }] }, verifyEd25519CatalogSignature)).rejects.toMatchObject({ code: 'signature' })
  expect(catalogSigningMessage(envelope.keyId, envelope.payload)).not.toBe(envelope.payload)
})

it.each([
  ['unknown key', (trust: any) => { trust.keys[0].id = 'other' }, 'trust'],
  ['revoked key', (trust: any) => { trust.keys[0].revoked = true }, 'trust'],
  ['invalid key window', (trust: any) => { trust.keys[0].notAfterMs = CATALOG_TEST_NOW_MS }, 'trust'],
  ['not-yet-valid key', (trust: any) => { trust.keys[0].notBeforeMs = CATALOG_TEST_NOW_MS + 1 }, 'trust'],
  ['duplicate pinned keys', (trust: any) => { trust.keys.push(trust.keys[0]) }, 'trust'],
  ['wrong repository', (trust: any) => { trust.repository = 'other/IsleMind' }, 'namespace'],
  ['wrong channel', (trust: any) => { trust.channel = 'preview' }, 'namespace'],
  ['expired catalog', (trust: any) => { trust.nowMs = CATALOG_TEST_NOW_MS + 60_000 }, 'expired'],
  ['future catalog', (trust: any) => { trust.nowMs = CATALOG_TEST_NOW_MS - 2000 }, 'expired'],
  ['minimum sequence floor', (trust: any) => { trust.minimumSequence = 3 }, 'replay'],
])('rejects %s', async (_name, edit, code) => {
  const trust = JSON.parse(JSON.stringify(updateCatalogTrustFixture()))
  edit(trust)
  await expect(verifySignedUpdateCatalog(signedCatalogFixture(), trust, verifyEd25519CatalogSignature)).rejects.toMatchObject({ code })
})

it('allows an identical sequence idempotently but rejects rollback and equivocation', async () => {
  const text = signedCatalogFixture()
  const first = await verifySignedUpdateCatalog(text, updateCatalogTrustFixture(), verifyEd25519CatalogSignature)
  const trust = { ...updateCatalogTrustFixture(), previous: first.checkpoint }
  expect((await verifySignedUpdateCatalog(text, trust, verifyEd25519CatalogSignature)).checkpoint).toEqual(first.checkpoint)
  const old = { ...updateCatalogFixture(), sequence: 1 }
  await expect(verifySignedUpdateCatalog(signedCatalogFixture(old), trust, verifyEd25519CatalogSignature)).rejects.toMatchObject({ code: 'replay' })
  const edited = JSON.parse(JSON.stringify(updateCatalogFixture()))
  edited.changes[0].texts.en += ' Edited.'
  await expect(verifySignedUpdateCatalog(signedCatalogFixture(edited), trust, verifyEd25519CatalogSignature)).rejects.toMatchObject({ code: 'equivocation' })
  await expect(verifySignedUpdateCatalog(text, { ...trust, previous: { ...first.checkpoint, repository: 'other/app' } },
    verifyEd25519CatalogSignature)).rejects.toMatchObject({ code: 'trust' })
})

it('rejects ambiguous envelope/checkpoint fields rather than forgetting accepted state', () => {
  const text = signedCatalogFixture()
  expect(() => decodeSignedUpdateCatalog(text.replace('"keyId":"test:rfc8032"', '"keyId":"other","keyId":"test:rfc8032"'))).toThrow(/canonical/)
  expect(() => decodeSignedUpdateCatalog(canonicalCatalogJson({ ...JSON.parse(text), algorithm: 'none' }))).toThrow(/fields/)
  expect(() => parseUpdateCatalogCheckpoint({ sequence: 100 })).toThrow()
})

it('snapshots trust and cancellation options before an asynchronous signature verification', async () => {
  const trust = JSON.parse(JSON.stringify(updateCatalogTrustFixture()))
  const original = new AbortController()
  const options = { signal: original.signal }
  let resolve!: (value: boolean) => void
  const port = jest.fn((_request: Parameters<UpdateCatalogSignatureVerifier>[0]) => new Promise<boolean>((yes) => { resolve = yes }))
  const running = verifySignedUpdateCatalog(signedCatalogFixture(), trust, port, options)
  await Promise.resolve()
  trust.repository = 'mutated/app'
  trust.keys[0].publicKeyHex = '0'.repeat(64)
  options.signal = new AbortController().signal
  expect(port.mock.calls[0][0].publicKeyHex).toBe(TEST_ONLY_ED25519_PUBLIC_KEY)
  const rejected = expect(running).rejects.toMatchObject({ code: 'cancelled' })
  original.abort()
  resolve(true)
  await rejected
})

it('bounds unresponsive signature ports and clears its deadline after settlement', async () => {
  jest.useFakeTimers()
  try {
    const pending = verifySignedUpdateCatalog(signedCatalogFixture(), updateCatalogTrustFixture(), () => new Promise<boolean>(() => undefined), { timeoutMs: 10 })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await jest.advanceTimersByTimeAsync(10)
    await rejected
    expect(jest.getTimerCount()).toBe(0)
    await verifySignedUpdateCatalog(signedCatalogFixture(), updateCatalogTrustFixture(), verifyEd25519CatalogSignature)
    expect(jest.getTimerCount()).toBe(0)
  } finally { jest.useRealTimers() }
})

it('does not fall back when cryptography throws or reports non-boolean success', async () => {
  await expect(verifySignedUpdateCatalog(signedCatalogFixture(), updateCatalogTrustFixture(), () => { throw new Error('unsupported') }))
    .rejects.toMatchObject({ code: 'signature' })
  await expect(verifySignedUpdateCatalog(signedCatalogFixture(), updateCatalogTrustFixture(), (() => 'true') as any))
    .rejects.toMatchObject({ code: 'signature' })
})

it('rechecks a live trusted clock when asynchronous cryptography outlives catalog validity', async () => {
  await expect(verifySignedUpdateCatalog(signedCatalogFixture(), updateCatalogTrustFixture(), verifyEd25519CatalogSignature,
    { readNowMs: () => CATALOG_TEST_NOW_MS + 60_000 })).rejects.toMatchObject({ code: 'expired' })
})
