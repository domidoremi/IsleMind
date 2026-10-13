import { MAX_INLINE_WAVE_BYTES, MAX_INLINE_WAVE_SECONDS, measureInlinePcmWave } from './providerWaveAudio'
import { providerWaveTokenUpperBound } from './providerMediaTokenBudget'
import { checkProviderContextCapacity } from './providerContextCapacity'
import { buildGoogleAttachmentPart } from './providerAttachments'

function wave(frames = 8000, channels = 1, sampleRate = 8000): Buffer {
  const data = Buffer.alloc(44 + frames * channels * 2)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22)
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * channels * 2, 28)
  data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40)
  return data
}

function chunk(tag: string, size: number): Buffer {
  const data = Buffer.alloc(8 + size + size % 2)
  data.write(tag); data.writeUInt32LE(size, 4)
  return data
}

function append(data: Buffer, ...chunks: Buffer[]): Buffer {
  const result = Buffer.concat([data, ...chunks])
  result.writeUInt32LE(result.length - 8, 4)
  return result
}

const check = (parts: unknown[]) => checkProviderContextCapacity({
  body: { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 100 } },
  contextWindow: 128_000, providerType: 'google', model: 'gemini-3.8-flash',
})
const part = (data: Buffer) => buildGoogleAttachmentPart({ type: 'document', name: 'synthetic.wav', mimeType: 'audio/wav', base64: data.toString('base64') })!

test.each([1, 2])('measures mono/stereo %i-channel PCM from frames, not file length or metadata', channels => {
  expect(measureInlinePcmWave(wave(12000, channels).toString('base64'))).toEqual({ seconds: 1.5, frames: 12000, sampleRate: 8000 })
  expect(providerWaveTokenUpperBound({ providerType: 'google', model: 'gemini-3.8-flash', base64: wave(12000, channels).toString('base64') })).toBe(96)
})

test('inspects padded ancillary chunks and a zero-size fmt extension without interpreting them as samples', () => {
  const data = wave(1)
  const extended = Buffer.concat([data.subarray(0, 36), Buffer.alloc(2), data.subarray(36)])
  extended.writeUInt32LE(18, 16)
  const file = append(extended, chunk('JUNK', 3), chunk('PAD ', 0))
  expect(measureInlinePcmWave(file.toString('base64'))?.frames).toBe(1)
})

test.each([
  ['RIFF length', 4, 20], ['fmt length', 16, 0xffffffff], ['compressed format', 20, 3],
  ['channels', 22, 0], ['sample rate', 24, 0], ['byte rate', 28, 16001],
  ['block alignment', 32, 4], ['sample depth', 34, 24], ['data length', 40, 0xffffffff],
] as const)('rejects invalid %s', (_name, offset, value) => {
  const data = wave()
  data.writeUInt32LE(value, offset)
  expect(measureInlinePcmWave(data.toString('base64'))).toBeUndefined()
})

test('rejects truncation, trailing data, duplicate chunks, empty/unaligned samples and semantic chunks', () => {
  const data = wave(3)
  for (let i = 0; i < data.length; i++) expect(measureInlinePcmWave(data.subarray(0, i).toString('base64'))).toBeUndefined()
  for (const tag of ['data', 'fmt ', 'LIST', 'slnt', 'smpl', 'fact', 'RIFF']) {
    expect(measureInlinePcmWave(append(data, chunk(tag, 16)).toString('base64'))).toBeUndefined()
  }
  expect(measureInlinePcmWave(Buffer.concat([data, Buffer.alloc(1)]).toString('base64'))).toBeUndefined()
  expect(measureInlinePcmWave(wave(0).toString('base64'))).toBeUndefined()
  const partialFrame = wave(2, 2).subarray(0, 50)
  partialFrame.writeUInt32LE(partialFrame.length - 8, 4); partialFrame.writeUInt32LE(6, 40)
  expect(measureInlinePcmWave(partialFrame.toString('base64'))).toBeUndefined()
})

test('rejects malformed/non-canonical Base64 including whitespace and nonzero padding bits', () => {
  const valid = wave(1).toString('base64')
  expect(valid.endsWith('AA==')).toBe(true)
  for (const invalid of ['', 'AAAA', valid.slice(0, -1), valid + '\n', '-' + valid.slice(1),
    valid.slice(0, -3) + 'B==', valid.slice(0, -4) + '====', 'data:audio/wav;base64,' + valid]) {
    expect(measureInlinePcmWave(invalid)).toBeUndefined()
  }
})

test('bounds encoded bytes, duration and parser work; no full binary decode is required', () => {
  expect(measureInlinePcmWave('A'.repeat(Math.ceil(MAX_INLINE_WAVE_BYTES / 3) * 4 + 4))).toBeUndefined()
  expect(measureInlinePcmWave(wave(MAX_INLINE_WAVE_SECONDS * 8000 + 1).toString('base64'))).toBeUndefined()
  expect(measureInlinePcmWave(append(wave(1), ...Array.from({ length: 127 }, () => chunk('JUNK', 0))).toString('base64'))).toBeUndefined()
  expect(measureInlinePcmWave(wave(MAX_INLINE_WAVE_SECONDS * 8000).toString('base64'))?.seconds).toBe(MAX_INLINE_WAVE_SECONDS)
})

test('only documented Google models receive a PCM audio estimate', () => {
  const base64 = wave().toString('base64')
  for (const [providerType, model] of [['openai', 'gpt-4o'], ['openai-compatible', 'gemini-3.8-flash'], ['google', 'gemini-unknown'], ['google', 'gemini-3.8-flash-custom']]) {
    expect(providerWaveTokenUpperBound({ providerType, model, base64 })).toBeUndefined()
  }
})

test('actual Google wire serialization includes each audio allowance and preserves opaque payloads', () => {
  const one = check([part(wave())])
  const two = check([part(wave()), part(wave())])
  expect(one.mediaEstimated).toBe(true)
  expect(one.rawInputTokens).toBeGreaterThanOrEqual(64)
  expect(two.rawInputTokens - one.rawInputTokens).toBeGreaterThanOrEqual(64)
  expect(one.managedTextBytes).toBe(check([part(wave(16000))]).managedTextBytes)
  expect(check([part(wave(16000))]).rawInputTokens - one.rawInputTokens).toBe(32)
})

test('camelCase aliases work, but file URIs, metadata and additional unmeasured media cannot borrow an allowance', () => {
  const base64 = wave().toString('base64')
  const inlineData = { mimeType: 'audio/wav', data: base64 }
  expect(check([{ inlineData }]).mediaEstimated).toBe(true)
  for (const media of [
    { inlineData: { ...inlineData, fileUri: 'https://example.invalid/audio' } },
    { inlineData: { ...inlineData, mime_type: 'application/pdf' } },
    { inlineData: { ...inlineData, duration: 0.001 } },
    { inlineData: { ...inlineData, mimeType: 'audio/mp3' } },
    { fileData: inlineData },
    { inlineData, file_data: { mime_type: 'application/pdf', file_uri: 'https://example.invalid/pdf' } },
  ]) expect(() => check([media])).toThrow('media_estimate_unavailable')
})
