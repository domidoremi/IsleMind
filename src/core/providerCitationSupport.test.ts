import { describe, expect, it } from '@jest/globals'
import {
  createProviderCitationSupportBinder,
  isProviderCitationSupportCurrent,
  mergeProviderCitationSupport,
  parseProviderCitationPassage,
  parseProviderCitationSupport,
  PROVIDER_CITATION_SUPPORT_LIMITS,
} from './providerCitationSupport'

const passage = { text: '日本語 😀', partIndex: 2, startByte: 9, endByte: 23 }
const answer = `Prefix ${passage.text} suffix\r\n`
const captured = () => createProviderCitationSupportBinder(answer)([passage])!

describe('bounded provider citation support contract', () => {
  it('round trips exact text and part-local bytes without turning them into rendered offsets', () => {
    const value = captured()
    expect(parseProviderCitationSupport(JSON.parse(JSON.stringify(value)))).toEqual(value)
    expect(isProviderCitationSupportCurrent(value, answer)).toBe(true)
    expect(answer.slice(passage.startByte, passage.endByte)).not.toBe(passage.text)
  })

  it.each([answer.trim(), answer.replace('\r\n', '\n'), `Changed ${answer}`, answer.replace('日本語', '日本')])(
    'does not rebind retained passages when the exact answer changes: %j', (changed) => {
      expect(isProviderCitationSupportCurrent(captured(), changed)).toBe(false)
    },
  )

  it('retains no non-answer passages and detaches returned values', () => {
    const bind = createProviderCitationSupportBinder(answer)
    const value = bind([passage, { ...passage, text: 'Absent', endByte: 15 }])!
    expect(value.passages).toEqual([passage])
    expect(value.passages[0]).not.toBe(passage)
    value.passages[0].text = 'caller mutation'
    expect(bind([passage])?.passages[0].text).toBe(passage.text)
  })

  it('does not claim a UTF-8 answer identity for ill-formed Unicode', () => {
    expect(createProviderCitationSupportBinder(`${answer}\ud800`)([passage])).toBeUndefined()
    expect(isProviderCitationSupportCurrent(captured(), `${answer}\ud800`)).toBe(false)
  })

  it.each([null, {}, { ...passage, partIndex: -1 }, { ...passage, startByte: 1.2 },
    { ...passage, endByte: 2 }, { ...passage, endByte: 22 }, { ...passage, partIndex: '2' },
    { text: '\ud800', partIndex: 0, startByte: 1, endByte: 0 }])('rejects malformed part-local ranges: %j', (value) => {
    expect(parseProviderCitationPassage(value)).toBeUndefined()
  })

  it('treats unknown versions, invalid digests and oversized persisted metadata as unknown', () => {
    const value = captured()
    expect(parseProviderCitationSupport({ ...value, schema: 'future.v2' })).toBeUndefined()
    expect(parseProviderCitationSupport({ ...value, answerSha256: 'not-an-exact-answer-digest' })).toBeUndefined()
    expect(parseProviderCitationSupport({ ...value, passages: Array(17).fill(passage) })).toBeUndefined()
    expect(parseProviderCitationSupport({ ...value, passages: [{ ...passage, text: 'x'.repeat(2049), startByte: 0, endByte: 2049 }] })).toBeUndefined()
    const long = { text: 'x'.repeat(2048), partIndex: 0, startByte: 0, endByte: 2048 }
    expect(parseProviderCitationSupport({ ...value, passages: Array(5).fill(long) })).toBeUndefined()
    expect(createProviderCitationSupportBinder('x'.repeat(PROVIDER_CITATION_SUPPORT_LIMITS.answerChars + 1))([long])).toBeUndefined()
  })

  it('bounds repeated merges and keeps the latest exact-answer snapshot, not an unbounded history', () => {
    let value = captured()
    for (let index = 0; index < 100; index += 1) {
      value = mergeProviderCitationSupport(value, { ...captured(), passages: [{ ...passage, partIndex: index }] })!
    }
    expect(value.passages).toHaveLength(16)
    const next = createProviderCitationSupportBinder(`Next ${answer}`)([passage])!
    expect(mergeProviderCitationSupport(value, next)).toEqual(next)
    expect(mergeProviderCitationSupport(value, { schema: 'future.v2' })).toEqual(value)
  })
})
