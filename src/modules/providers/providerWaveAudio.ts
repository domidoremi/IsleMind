/** Bounded, allocation-free inspection of inline PCM WAVE, not a general decoder.
 * The duration is derived from the bytes sent, never attachment metadata. Reject
 * compressed/extended formats, playlists/loops and ambiguous/truncated containers.
 */
export const MAX_INLINE_WAVE_BYTES = 8 * 1024 * 1024
export const MAX_INLINE_WAVE_SECONDS = 300

export function measureInlinePcmWave(base64: string): { seconds: number; frames: number; sampleRate: number } | undefined {
  const source = base64Bytes(base64)
  if (!source || source.length < 44) return undefined
  const { byte, length } = source
  const u16 = (at: number) => byte(at) + byte(at + 1) * 256
  const u32 = (at: number) => u16(at) + u16(at + 2) * 65536
  const tag = (at: number, text: string) => [...text].every((char, i) => byte(at + i) === char.charCodeAt(0))
  if (!tag(0, 'RIFF') || !tag(8, 'WAVE') || u32(4) !== length - 8) return undefined

  let blockAlign = 0
  let sampleRate = 0
  let frames = 0
  let chunks = 0
  let at = 12
  while (at < length) {
    if (++chunks > 128 || at + 8 > length) return undefined
    const size = u32(at + 4)
    const start = at + 8
    const end = start + size
    const next = end + (size % 2)
    if (next > length) return undefined
    if (tag(at, 'fmt ')) {
      if (sampleRate || frames || (size !== 16 && size !== 18)) return undefined
      if (size === 18 && u16(start + 16) !== 0) return undefined
      const channels = u16(start + 2)
      sampleRate = u32(start + 4)
      blockAlign = u16(start + 12)
      // Only signed 16-bit little-endian PCM, mono/stereo, at ordinary rates.
      if (u16(start) !== 1 || ![1, 2].includes(channels) || u16(start + 14) !== 16
        || ![8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000].includes(sampleRate)
        || blockAlign !== channels * 2 || u32(start + 8) !== sampleRate * blockAlign) return undefined
    } else if (tag(at, 'data')) {
      if (!sampleRate || frames || !size || size % blockAlign !== 0) return undefined
      frames = size / blockAlign
      if (frames > sampleRate * MAX_INLINE_WAVE_SECONDS) return undefined
    } else if (!tag(at, 'JUNK') && !tag(at, 'PAD ')) {
      // In particular LIST/wavl, slnt, smpl, fact and a second RIFF can change
      // decoded duration or interpretation. Do not guess how a server decodes them.
      return undefined
    }
    at = next
  }
  return frames ? { seconds: frames / sampleRate, frames, sampleRate } : undefined
}

/** Validate all Base64 syntax once, then read only header bytes in O(1) space.
 * No Buffer/atob/native decoder or whole-media UTF-16/binary copy is required.
 */
function base64Bytes(value: string): { length: number; byte(at: number): number } | undefined {
  if (!value.length || value.length % 4 || value.length > Math.ceil(MAX_INLINE_WAVE_BYTES / 3) * 4) return undefined
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const end = value.length - padding
  for (let i = 0; i < end; i++) if (sextet(value.charCodeAt(i)) < 0) return undefined
  if (padding && (sextet(value.charCodeAt(end - 1)) & (padding === 2 ? 15 : 3)) !== 0) return undefined
  const length = value.length / 4 * 3 - padding
  if (length > MAX_INLINE_WAVE_BYTES) return undefined
  return { length, byte(at) {
    const group = Math.floor(at / 3) * 4
    const offset = at % 3
    const a = sextet(value.charCodeAt(group + offset))
    const b = sextet(value.charCodeAt(group + offset + 1))
    return offset === 0 ? (a << 2) | (b >> 4)
      : offset === 1 ? ((a & 15) << 4) | (b >> 2) : ((a & 3) << 6) | b
  } }
}

function sextet(code: number): number {
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 71
  if (code >= 48 && code <= 57) return code + 4
  return code === 43 ? 62 : code === 47 ? 63 : -1
}
