import { describe, expect, it } from '@jest/globals'
import { sha256Hex } from '@/core'
import {
  createProviderCitationCollector,
  dedupeCitations,
  extractProviderCitations,
  extractProviderCitationsFromSse,
  mergeIdenticalProviderCitations,
} from './providerCitations'

// Synthetic generateContent fixtures, not recorded provider responses. Semantics:
// https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
const answer = '前文 😀。Second claim.'
const web = (uri: string, title = uri) => ({ web: { uri, title } })
const support = (text: string, groundingChunkIndices: number[], startIndex = 0, partIndex = 0) => ({
  segment: { text, partIndex, startIndex, endIndex: startIndex + new TextEncoder().encode(text).length },
  groundingChunkIndices,
})
const packet = (groundingChunks: unknown[], groundingSupports: unknown[] = []) => ({
  candidates: [{ groundingMetadata: { groundingChunks, groundingSupports } }],
})

describe('provider-reported citation associations', () => {
  it('keeps cumulative raw slots, including unsupported chunks, across streamed responses', () => {
    const collector = createProviderCitationCollector('google')
    collector.addJson(packet([web('https://example.test/a'), { retrievedContext: { uri: 'local' } }]))
    collector.addJson(packet([null, web('https://example.test/b')], [
      support('前文 😀。', [0], 12, 2), support('Second claim.', [3], 0, 3),
      support('Second claim.', [1, 2, 4, -1, 1.2]),
    ]))
    const citations = collector.finish(answer)
    expect(citations.map((citation) => citation.url)).toEqual(['https://example.test/a', 'https://example.test/b'])
    expect(citations[0].providerSupport).toMatchObject({
      provider: 'google', answerSha256: sha256Hex(answer),
      passages: [{ text: '前文 😀。', partIndex: 2, startByte: 12, endByte: 26 }],
    })
    expect(citations[1].providerSupport?.passages).toEqual([
      { text: 'Second claim.', partIndex: 3, startByte: 0, endByte: 13 },
    ])
    // Provider part-local bytes are deliberately not flattened answer offsets.
    expect(answer.slice(12, 26)).not.toBe('前文 😀。')
  })

  it('selects only the candidate used for answer text, and never borrows a peer source', () => {
    const input = packet([web('https://example.test/a')], [support('First', [1])])
    input.candidates.push(packet([web('https://example.test/peer')], [support('First', [0])]).candidates[0])
    const citations = extractProviderCitations(input, 'google', 'First')
    expect(citations).toEqual([{ id: 'https://example.test/a', type: 'web', title: 'https://example.test/a', url: 'https://example.test/a' }])
    expect(extractProviderCitations({ candidates: [null, input.candidates[1]] }, 'google', 'First')).toEqual([])
  })

  it('retains later declarations for duplicate URLs and deduplicates repeated passages', () => {
    const collector = createProviderCitationCollector('google')
    collector.addJson(packet([web('https://example.test/a', 'First title')], [support('First', [0])]))
    collector.addJson(packet([web('https://example.test/a', 'Later title')], [support('Second', [1]), support('First', [0])]))
    const citations = collector.finish('First Second')
    expect(citations).toHaveLength(1)
    expect(citations[0].title).toBe('First title')
    expect(citations[0].providerSupport?.passages.map((passage) => passage.text)).toEqual(['First', 'Second'])
    const bare = { ...citations[0], providerSupport: undefined }
    expect(dedupeCitations([bare, citations[0]])[0].providerSupport).toEqual(citations[0].providerSupport)
  })

  it('accepts CRLF, optional data spacing, multiline data and undelimited final metadata', () => {
    const first = JSON.stringify(packet([web('https://example.test/a')]))
    const last = JSON.stringify(packet([], [support('Answer', [0])]))
    const split = last.indexOf('"groundingSupports"')
    const raw = `: ping\r\ndata:${first}\r\n\r\ndata: ${last.slice(0, split)}\r\ndata:${last.slice(split)}`
    const citations = extractProviderCitationsFromSse(raw, 'google', 'Answer')
    expect(citations[0].providerSupport?.passages[0].text).toBe('Answer')
    expect(extractProviderCitationsFromSse(`data:${first}\ndata:[DONE]\ndata:{bad}`, 'google')).toHaveLength(1)
  })

  it.each(['data:{unreadable}', `data:${JSON.stringify({ candidates: [{ groundingMetadata: { groundingChunks: 'malformed' } }] })}`])(
    'does not guess cumulative indices across an unreadable grounding gap: %s', (gap) => {
      const collector = createProviderCitationCollector('google')
      collector.addJson(packet([web('https://example.test/a')], [support('Answer', [0])]))
      collector.addSse(gap)
      collector.addJson(packet([web('https://example.test/b')], [support('Answer', [1])]))
      const citations = collector.finish('Answer')
      expect(citations.map((citation) => citation.url)).toEqual(['https://example.test/a', 'https://example.test/b'])
      expect(citations.every((citation) => !citation.providerSupport)).toBe(true)
    },
  )

  it('does not retain hidden, edited, invented or byte-inconsistent passages', () => {
    const input = packet([web('https://example.test/a')], [
      support('Hidden reasoning', [0]), support('Not in answer', [0]),
      { ...support('前文 😀。', [0]), segment: { text: '前文 😀。', startIndex: 0, endIndex: 6 } },
      support('  Answer  ', [0]),
    ])
    expect(extractProviderCitations(input, 'google', 'Answer')[0].providerSupport).toBeUndefined()
    const good = extractProviderCitations(packet([web('https://example.test/a')], [support('Answer', [0])]), 'google', '  Answer  ')[0]
    expect(good.providerSupport?.answerSha256).toBe(sha256Hex('  Answer  '))
    expect(good.providerSupport?.answerSha256).not.toBe(sha256Hex('Answer'))
  })

  it('treats malformed and over-budget declarations as unknown without shifting indices', () => {
    const collector = createProviderCitationCollector('google')
    collector.addJson(packet([null, { web: { uri: {}, title: [] } }, web('https://example.test/a')], [
      null, [], {}, support('Valid', [2]), support('x'.repeat(2049), [2]),
      { ...support('Valid', [2]), groundingChunkIndices: ['2'] },
    ]))
    collector.addJson(packet(Array.from({ length: 200 }, (_, index) => web(`https://example.test/${index}`))))
    collector.addJson(packet([web('https://example.test/overflow')], [support('Overflow', [128])]))
    const citations = collector.finish('Valid Overflow')
    expect(citations.length).toBeLessThanOrEqual(128)
    expect(citations[0].providerSupport?.passages).toHaveLength(1)
    expect(citations.some((citation) => citation.url?.includes('overflow'))).toBe(false)
    expect(citations.flatMap((citation) => citation.providerSupport?.passages ?? []).map((passage) => passage.text)).toEqual(['Valid'])
    expect(collector.finish('x'.repeat(262145))[0].providerSupport).toBeUndefined()
  })

  it('never shares slot state between requests', () => {
    const first = createProviderCitationCollector('google')
    first.addJson(packet([web('https://example.test/a')]))
    const second = createProviderCitationCollector('google')
    second.addJson(packet([], [support('Answer', [0])]))
    expect(second.finish('Answer')).toEqual([])
    expect(first.finish('Answer')[0].providerSupport).toBeUndefined()
  })

  it('discards a discontinuous candidate index space and does not bind title-only sources', () => {
    const collector = createProviderCitationCollector('google')
    collector.addJson(packet([web('https://example.test/a')]))
    collector.addJson({ candidates: [{ index: 1, groundingMetadata: { groundingChunks: [], groundingSupports: [support('Answer', [0])] } }] })
    expect(collector.finish('Answer')).toEqual([])
    const citations = extractProviderCitations(packet([{ web: { title: 'Only a title' } }], [support('Answer', [0])]), 'google', 'Answer')
    expect(citations[0].providerSupport).toBeUndefined()
  })

  it('does not transfer a real URL association to a title-only identity collision', () => {
    const citations = extractProviderCitations(packet([
      { web: { title: 'https://example.test/a' } }, web('https://example.test/a'),
    ], [support('Answer', [1])]), 'google', 'Answer')
    expect(citations[0].url).toBeUndefined()
    expect(citations[0].providerSupport).toBeUndefined()
  })

  it.each([
    ['perplexity', { search_results: [{ title: 'Source', url: 'https://example.test/a', snippet: 'Excerpt' }] }],
    ['anthropic', { content: [{ type: 'web_search_result', title: 'Source', url: 'https://example.test/a' }] }],
    ['xiaomi-mimo', { choices: [{ delta: { annotations: [{ type: 'url_citation', title: 'Source', url: 'https://example.test/a' }] } }] }],
  ])('preserves source-only extraction for %s without inventing passage associations', (provider, json) => {
    const source = provider as string
    const citations = extractProviderCitationsFromSse(`data: ${JSON.stringify(json)}`, source, 'Answer')
    expect(citations).toEqual(extractProviderCitations(json, source))
    expect(citations).toHaveLength(1)
    expect(citations[0].providerSupport).toBeUndefined()
  })

  it('bounds declarations, passages per source and total retained text without clipping a quotation', () => {
    const text = 'x'.repeat(2048)
    const collector = createProviderCitationCollector('google')
    collector.addJson(packet(Array.from({ length: 128 }, (_, index) => web(`https://example.test/${index}`)),
      Array.from({ length: 100 }, (_, index) => support(text, Array.from({ length: 128 }, (_, source) => source), 0, index))))
    const citations = collector.finish(text)
    expect(citations.reduce((sum, citation) => sum + (citation.providerSupport?.passages.reduce((size, item) => size + item.text.length, 0) ?? 0), 0)).toBeLessThanOrEqual(32768)
    for (const citation of citations) {
      expect(citation.providerSupport?.passages.length ?? 0).toBeLessThanOrEqual(16)
      for (const passage of citation.providerSupport?.passages ?? []) expect(passage.text).toBe(text)
    }
    const afterLimit = createProviderCitationCollector('google')
    afterLimit.addJson(packet([web('https://example.test/a')], Array(64).fill(null)))
    afterLimit.addJson(packet([], [support('Answer', [0])]))
    expect(afterLimit.finish('Answer')[0].providerSupport).toBeUndefined()
  })

  it('merges continuation support only for otherwise identical citations; keeps ambiguous identities separate', () => {
    const source = web('https://example.test/a')
    const old = extractProviderCitations(packet([source], [support('Old', [0])]), 'google', 'Old')[0]
    const current = extractProviderCitations(packet([source], [support('New', [0])]), 'google', 'New')[0]
    expect(mergeIdenticalProviderCitations([old, current])).toEqual([current])
    expect(mergeIdenticalProviderCitations([old, { ...current, title: 'Different captured source' }])).toHaveLength(2)
    expect(mergeIdenticalProviderCitations([old, { ...old, providerSupport: undefined }])[0].providerSupport).toEqual(old.providerSupport)
  })
})
