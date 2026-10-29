const { createPublicKey, verify } = require('node:crypto')

function verifyEd25519CatalogSignature({ message, signatureHex, publicKeyHex, signal }) {
  if (signal?.aborted) return false
  if (typeof message !== 'string' || Buffer.byteLength(message, 'utf8') > 1_049_000
    || typeof publicKeyHex !== 'string' || !/^[a-f0-9]{64}$/.test(publicKeyHex)
    || typeof signatureHex !== 'string' || !/^[a-f0-9]{128}$/.test(signatureHex)) return false
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyHex, 'hex').toString('base64url') },
  })
  // Ed25519 performs its own hashing; Node requires the digest argument to be null.
  return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureHex, 'hex'))
}

module.exports = { verifyEd25519CatalogSignature }
