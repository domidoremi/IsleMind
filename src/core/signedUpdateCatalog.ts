import { sha256Hex } from './contentDigest'
import { snapshotPlainData } from './plainDataSnapshot'
import {
  assertCatalogId, assertCatalogRepository, assertCatalogTextBudget, canonicalCatalogJson,
  decodeUpdateCatalog, type UpdateCatalog, type UpdateChannel,
} from './updateCatalog'

export const SIGNED_UPDATE_CATALOG_SCHEMA = 'islemind.signed-update-catalog.v1'
export const UPDATE_CATALOG_CHECKPOINT_SCHEMA = 'islemind.update-catalog-checkpoint.v1'

export interface SignedUpdateCatalogEnvelope {
  readonly schema: typeof SIGNED_UPDATE_CATALOG_SCHEMA
  readonly keyId: string
  readonly payload: string
  readonly signature: string
}

export interface UpdateCatalogCheckpoint {
  readonly schema: typeof UPDATE_CATALOG_CHECKPOINT_SCHEMA
  readonly repository: string
  readonly channel: UpdateChannel
  readonly sequence: number
  readonly payloadSha256: string
}

export interface PinnedUpdateCatalogKey {
  readonly id: string
  readonly publicKeyHex: string
  readonly notBeforeMs: number
  readonly notAfterMs: number
  readonly revoked: boolean
}

export interface UpdateCatalogTrust {
  readonly repository: string
  readonly channel: UpdateChannel
  readonly nowMs: number
  readonly minimumSequence: number
  readonly keys: readonly PinnedUpdateCatalogKey[]
  readonly previous?: UpdateCatalogCheckpoint
}

export type UpdateCatalogSignatureVerifier = (request: {
  readonly message: string
  readonly signatureHex: string
  readonly publicKeyHex: string
  readonly signal?: AbortSignal
}) => boolean | Promise<boolean>

declare const verifiedCatalogBrand: unique symbol
export interface VerifiedUpdateCatalog {
  readonly catalog: UpdateCatalog
  readonly checkpoint: UpdateCatalogCheckpoint
  readonly keyId: string
  readonly verifiedAtMs: number
  readonly validUntilMs: number
  readonly expectedPrevious?: UpdateCatalogCheckpoint
  readonly [verifiedCatalogBrand]: true
}

export class UpdateCatalogVerificationError extends Error {
  constructor(readonly code: 'trust' | 'namespace' | 'expired' | 'signature' | 'replay' | 'equivocation' | 'cancelled' | 'timeout', message: string) {
    super(message)
    this.name = 'UpdateCatalogVerificationError'
  }
}

const verifiedCatalogs = new WeakSet<object>()
const HEX_32_BYTES = /^[a-f0-9]{64}$/
const HEX_64_BYTES = /^[a-f0-9]{128}$/

export function catalogSigningMessage(keyId: string, canonicalPayload: string): string {
  assertCatalogId(keyId)
  assertCatalogTextBudget(canonicalPayload)
  return `${SIGNED_UPDATE_CATALOG_SCHEMA}\n${keyId}\n${canonicalPayload}`
}

export function decodeSignedUpdateCatalog(text: string): SignedUpdateCatalogEnvelope {
  assertCatalogTextBudget(text)
  let value: unknown
  try { value = JSON.parse(text) } catch { fail('signature', 'Signed catalog envelope must be valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('signature', 'Signed catalog envelope must be an object.')
  const envelope = value as Record<string, unknown>
  if (Object.keys(envelope).sort().join(',') !== 'keyId,payload,schema,signature'
    || envelope.schema !== SIGNED_UPDATE_CATALOG_SCHEMA) fail('signature', 'Unsupported signed catalog envelope fields or schema.')
  assertCatalogId(envelope.keyId)
  if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string'
    || !HEX_64_BYTES.test(envelope.signature)) fail('signature', 'Envelope requires canonical payload text and a 64-byte Ed25519 signature.')
  if (canonicalCatalogJson(envelope) !== text.trim()) fail('signature', 'Envelope must be canonical JSON without duplicate fields.')
  return snapshotPlainData(envelope as unknown as SignedUpdateCatalogEnvelope)
}

export function parseUpdateCatalogCheckpoint(value: unknown): UpdateCatalogCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('trust', 'Catalog checkpoint must be an object.')
  canonicalCatalogJson(value)
  const checkpoint = value as Record<string, unknown>
  if (Object.keys(checkpoint).sort().join(',') !== 'channel,payloadSha256,repository,schema,sequence'
    || checkpoint.schema !== UPDATE_CATALOG_CHECKPOINT_SCHEMA) fail('trust', 'Unsupported catalog checkpoint.')
  assertCatalogRepository(checkpoint.repository)
  if (!['stable', 'preview'].includes(String(checkpoint.channel))) fail('trust', 'Checkpoint channel must be explicit.')
  positiveInteger(checkpoint.sequence, 'checkpoint sequence')
  if (typeof checkpoint.payloadSha256 !== 'string' || !HEX_32_BYTES.test(checkpoint.payloadSha256)) fail('trust', 'Checkpoint requires the exact payload SHA-256.')
  return snapshotPlainData(checkpoint as unknown as UpdateCatalogCheckpoint)
}

/** Verification proposes a CAS-bound metadata checkpoint, never an applied-update receipt. */
export async function verifySignedUpdateCatalog(
  text: string,
  trustInput: UpdateCatalogTrust,
  verifySignature: UpdateCatalogSignatureVerifier,
  options: { signal?: AbortSignal; timeoutMs?: number; readNowMs?: () => number } = {},
): Promise<VerifiedUpdateCatalog> {
  const verificationOptions = Object.freeze({ signal: options.signal, timeoutMs: options.timeoutMs, readNowMs: options.readNowMs })
  checkCancellation(verificationOptions.signal)
  const trust = snapshotPlainData(trustInput)
  validateTrust(trust)
  const envelope = decodeSignedUpdateCatalog(text)
  const catalog = decodeUpdateCatalog(envelope.payload)
  if (catalog.repository !== trust.repository || catalog.channel !== trust.channel) {
    fail('namespace', 'Catalog repository/channel does not match the pinned trust namespace.')
  }
  if (catalog.issuedAtMs > trust.nowMs || catalog.expiresAtMs <= trust.nowMs) {
    fail('expired', 'Catalog is expired or has not become valid.')
  }
  const key = trust.keys.find((entry) => entry.id === envelope.keyId)
  if (!key || key.revoked || trust.nowMs < key.notBeforeMs || trust.nowMs >= key.notAfterMs
    || catalog.issuedAtMs < key.notBeforeMs || catalog.expiresAtMs > key.notAfterMs) {
    fail('trust', 'Catalog key is unknown, revoked, or outside its pinned validity window.')
  }
  const payloadSha256 = sha256Hex(envelope.payload)
  if (catalog.sequence < trust.minimumSequence || (trust.previous && catalog.sequence < trust.previous.sequence)) {
    fail('replay', 'Catalog sequence is older than the pinned/accepted checkpoint.')
  }
  if (trust.previous && catalog.sequence === trust.previous.sequence && payloadSha256 !== trust.previous.payloadSha256) {
    fail('equivocation', 'An accepted catalog sequence cannot identify different signed bytes.')
  }
  let signatureValid: boolean
  try {
    signatureValid = await boundedSignatureVerification(() => verifySignature(Object.freeze({
      message: catalogSigningMessage(envelope.keyId, envelope.payload),
      signatureHex: envelope.signature, publicKeyHex: key.publicKeyHex, signal: verificationOptions.signal,
    })), verificationOptions)
  } catch (error) {
    if (error instanceof UpdateCatalogVerificationError) throw error
    fail('signature', 'The pinned signature verifier failed; no fallback trust is available.')
  }
  checkCancellation(verificationOptions.signal)
  if (signatureValid !== true) fail('signature', 'Catalog Ed25519 signature is invalid.')
  const verifiedAtMs = verificationOptions.readNowMs?.() ?? trust.nowMs
  if (!Number.isSafeInteger(verifiedAtMs) || verifiedAtMs < trust.nowMs
    || verifiedAtMs >= catalog.expiresAtMs || verifiedAtMs >= key.notAfterMs) {
    fail('expired', 'Catalog/key validity changed while signature verification was pending.')
  }
  const result = Object.freeze({
    catalog, keyId: key.id, expectedPrevious: trust.previous, verifiedAtMs,
    validUntilMs: Math.min(catalog.expiresAtMs, key.notAfterMs),
    checkpoint: Object.freeze({
      schema: UPDATE_CATALOG_CHECKPOINT_SCHEMA, repository: catalog.repository,
      channel: catalog.channel, sequence: catalog.sequence, payloadSha256,
    }),
  }) as VerifiedUpdateCatalog
  verifiedCatalogs.add(result)
  return result
}

export function assertVerifiedUpdateCatalog(value: unknown): asserts value is VerifiedUpdateCatalog {
  if (!value || typeof value !== 'object' || !verifiedCatalogs.has(value)) {
    fail('trust', 'Catalog selection requires evidence returned by this verifier, not a decoded/copied object.')
  }
}

export function assertCurrentVerifiedUpdateCatalog(value: unknown, nowMs: number): asserts value is VerifiedUpdateCatalog {
  assertVerifiedUpdateCatalog(value)
  if (!Number.isSafeInteger(nowMs) || nowMs < value.verifiedAtMs || nowMs >= value.validUntilMs) {
    fail('expired', 'Verified catalog evidence is not current for artifact selection.')
  }
}

function validateTrust(trust: UpdateCatalogTrust) {
  if (Object.keys(trust).some((field) => !['repository', 'channel', 'nowMs', 'minimumSequence', 'keys', 'previous'].includes(field))) {
    fail('trust', 'Pinned trust has unknown fields.')
  }
  assertCatalogRepository(trust.repository)
  if (!['stable', 'preview'].includes(trust.channel)) fail('trust', 'Trusted channel must be explicit.')
  positiveInteger(trust.nowMs, 'trusted clock')
  positiveInteger(trust.minimumSequence, 'minimum sequence')
  if (!Array.isArray(trust.keys) || !trust.keys.length || trust.keys.length > 8) fail('trust', 'Trust requires a bounded nonempty pinned key set.')
  const ids = new Set<string>()
  for (const key of trust.keys) {
    if (Object.keys(key).sort().join(',') !== 'id,notAfterMs,notBeforeMs,publicKeyHex,revoked') fail('trust', 'Pinned key fields must be exact.')
    assertCatalogId(key.id)
    if (ids.has(key.id) || !HEX_32_BYTES.test(key.publicKeyHex) || typeof key.revoked !== 'boolean') fail('trust', 'Pinned keys must be unique explicit Ed25519 public keys.')
    ids.add(key.id)
    positiveInteger(key.notBeforeMs, 'key validity start')
    positiveInteger(key.notAfterMs, 'key validity end')
    if (key.notBeforeMs >= key.notAfterMs) fail('trust', 'Pinned key validity must be ordered.')
  }
  if (trust.previous) {
    const previous = parseUpdateCatalogCheckpoint(trust.previous)
    if (previous.repository !== trust.repository || previous.channel !== trust.channel) {
      fail('trust', 'A persisted checkpoint cannot silently migrate repository or channel.')
    }
  }
}

async function boundedSignatureVerification(
  verify: () => boolean | Promise<boolean>,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 5000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) fail('trust', 'Signature deadline must be between 1 and 10000 milliseconds.')
  checkCancellation(options.signal)
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(() => { checkCancellation(options.signal); return verify() }),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new UpdateCatalogVerificationError('cancelled', 'Catalog verification cancelled.'))
        options.signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new UpdateCatalogVerificationError('timeout', 'Catalog signature verification exceeded its deadline.')), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (abort) options.signal?.removeEventListener('abort', abort)
  }
}

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) fail('cancelled', 'Catalog verification cancelled.')
}
function positiveInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail('trust', `${name} must be a positive safe integer.`)
}
function fail(code: UpdateCatalogVerificationError['code'], message: string): never {
  throw new UpdateCatalogVerificationError(code, message)
}
