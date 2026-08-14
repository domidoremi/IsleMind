export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface AwsSigV4Request {
  method: string
  url: string
  region: string
  service: string
  headers?: Record<string, string>
  body?: string
  credentials: AwsCredentials
  now?: Date
}

const SHA256_BLOCK_SIZE = 64
const HEX = '0123456789abcdef'

export function signAwsRequestV4(input: AwsSigV4Request): Record<string, string> {
  const now = input.now ?? new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const url = new URL(input.url)
  const body = input.body ?? ''
  const payloadHash = sha256Hex(utf8Bytes(body))
  const baseHeaders = normalizeHeaders({
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...(input.credentials.sessionToken ? { 'x-amz-security-token': input.credentials.sessionToken } : {}),
    ...(input.headers ?? {}),
  })
  const signedHeaderNames = Object.keys(baseHeaders).sort()
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    signedHeaderNames.map((name) => `${name}:${baseHeaders[name]}`).join('\n') + '\n',
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(utf8Bytes(canonicalRequest)),
  ].join('\n')
  const signingKey = awsSigningKey(input.credentials.secretAccessKey, dateStamp, input.region, input.service)
  const signature = hmacSha256Hex(signingKey, utf8Bytes(stringToSign))
  return {
    ...restoreHeaderCase(baseHeaders),
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaderNames.join(';')}`,
      `Signature=${signature}`,
    ].join(', '),
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

export function hmacSha256Hex(key: Uint8Array | string, message: Uint8Array | string): string {
  return bytesToHex(hmacSha256(toBytes(key), toBytes(message)))
}

function awsSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Uint8Array {
  const dateKey = hmacSha256(utf8Bytes(`AWS4${secretAccessKey}`), utf8Bytes(dateStamp))
  const dateRegionKey = hmacSha256(dateKey, utf8Bytes(region))
  const dateRegionServiceKey = hmacSha256(dateRegionKey, utf8Bytes(service))
  return hmacSha256(dateRegionServiceKey, utf8Bytes('aws4_request'))
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.entries(headers).reduce<Record<string, string>>((acc, [name, value]) => {
    if (value === undefined || value === null) return acc
    const lowerName = name.toLowerCase()
    acc[lowerName] = String(value).trim().replace(/\s+/g, ' ')
    return acc
  }, {})
}

function restoreHeaderCase(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [canonicalHeaderName(name), value]))
}

function canonicalHeaderName(name: string): string {
  if (name === 'host') return 'Host'
  if (name === 'content-type') return 'Content-Type'
  return name.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join('-')
}

function canonicalUri(pathname: string): string {
  const path = pathname || '/'
  return path.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, percentEncodeChar)).join('/')
}

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .map(([key, value]) => [strictUriEncode(key), strictUriEncode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function strictUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, percentEncodeChar)
}

function percentEncodeChar(value: string): string {
  return `%${value.charCodeAt(0).toString(16).toUpperCase()}`
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const normalizedKey = key.length > SHA256_BLOCK_SIZE ? sha256(key) : key
  const block = new Uint8Array(SHA256_BLOCK_SIZE)
  block.set(normalizedKey)
  const outerKeyPad = new Uint8Array(SHA256_BLOCK_SIZE)
  const innerKeyPad = new Uint8Array(SHA256_BLOCK_SIZE)
  for (let index = 0; index < SHA256_BLOCK_SIZE; index += 1) {
    outerKeyPad[index] = block[index] ^ 0x5c
    innerKeyPad[index] = block[index] ^ 0x36
  }
  const inner = concatBytes(innerKeyPad, message)
  return sha256(concatBytes(outerKeyPad, sha256(inner)))
}

function sha256(bytes: Uint8Array): Uint8Array {
  const words = new Uint32Array(64)
  const state = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000)
  const bitLengthLow = (bytes.length << 3) >>> 0
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6)
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, bitLengthHigh)
  view.setUint32(paddedLength - 4, bitLengthLow)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3)
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10)
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }
    let a = state[0]
    let b = state[1]
    let c = state[2]
    let d = state[3]
    let e = state[4]
    let f = state[5]
    let g = state[6]
    let h = state[7]
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    state[0] = (state[0] + a) >>> 0
    state[1] = (state[1] + b) >>> 0
    state[2] = (state[2] + c) >>> 0
    state[3] = (state[3] + d) >>> 0
    state[4] = (state[4] + e) >>> 0
    state[5] = (state[5] + f) >>> 0
    state[6] = (state[6] + g) >>> 0
    state[7] = (state[7] + h) >>> 0
  }
  const digest = new Uint8Array(32)
  const digestView = new DataView(digest.buffer)
  for (let index = 0; index < state.length; index += 1) {
    digestView.setUint32(index * 4, state[index])
  }
  return digest
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const next = new Uint8Array(left.length + right.length)
  next.set(left)
  next.set(right, left.length)
  return next
}

function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? utf8Bytes(value) : value
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function bytesToHex(bytes: Uint8Array): string {
  let output = ''
  for (const byte of bytes) {
    output += HEX[(byte >>> 4) & 0xf] + HEX[byte & 0xf]
  }
  return output
}
