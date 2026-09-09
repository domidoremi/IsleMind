import { createInstance, type TFunction } from 'i18next'

import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zhCN from '@/i18n/resources/zh-CN.json'
import type { Message } from '@/types/chatContracts'

import { formatSelectedMessagesForExport } from './messageSelectionFormatting'

const MarkdownIt = require('markdown-it')
const i18n = createInstance()
let t: TFunction

const message: Message = {
  id: 'answer', role: 'assistant', timestamp: 1788854500366, status: 'done',
  content: 'Legacy content', responseText: '  Answer [1].  ',
  citations: [
    { id: 'policy-1', type: 'knowledge', title: 'Atlas pilot policy', excerpt: 'private excerpt', documentId: 'private-document', sourceUri: 'file:///private/policy.md' },
    { id: 'policy-2', type: 'knowledge', title: 'Atlas pilot policy', chunkId: 'private-chunk', headingPath: ['private heading'] },
  ],
}

beforeAll(async () => {
  t = await i18n.init({ lng: 'en', resources: { en: { translation: en }, ja: { translation: ja }, 'zh-CN': { translation: zhCN } } })
})

it('keeps ordinary Copy formatting, response precedence and empty-response behavior unchanged', () => {
  const expected = `## 1. Assistant · ${new Date(message.timestamp).toLocaleString()}\n\nAnswer [1].`
  expect(formatSelectedMessagesForExport([message], t)).toBe(expected)
  expect(formatSelectedMessagesForExport([{ ...message, citations: [] }], t, { includeSources: true })).toBe(expected)
  expect(formatSelectedMessagesForExport([{ ...message, responseText: '' }], t)).toContain(t('messageBubble.emptyResponse'))
  expect(formatSelectedMessagesForExport([], t, { includeSources: true })).toBe('')
})

it('keeps each message’s captured order, including repeated titles, without global reference definitions or private source bodies', () => {
  const messages: Message[] = [message, { ...message, id: 'second', citations: [{ id: 'other', type: 'memory', title: 'Another source', excerpt: 'private memory' }] }]
  const before = JSON.stringify(messages)
  const text = formatSelectedMessagesForExport(messages, t, { includeSources: true })
  const parts = text.split('\n\n---\n\n')
  expect(parts).toHaveLength(2)
  expect(parts[0]).toContain('- \\[1\\] ` Atlas pilot policy ` — Local knowledge')
  expect(parts[0]).toContain('- \\[2\\] ` Atlas pilot policy ` — Local knowledge')
  expect(parts[0]).not.toContain('Another source')
  expect(parts[1]).toContain('- \\[1\\] ` Another source ` — Long-term memory')
  expect(parts[1]).not.toContain('Atlas pilot policy')
  expect(text).not.toContain('private')
  expect(text).not.toMatch(/^\[\d+\]:/m)
  expect(text.match(/Answer \[1\]\./g)).toHaveLength(2)
  expect(text).toContain(t('messageBubble.exportSourcesNotice'))
  expect(JSON.stringify(messages)).toBe(before)
})

it('keeps hostile Markdown, raw HTML and auto-linkable titles inert in the installed renderer', () => {
  const citation = {
    id: 'web', type: 'web' as const,
    title: '`[click](https://should-not-load.invalid)`` ![image](https://should-not-load.invalid/image) <img src=x> https://should-not-load.invalid\n# Heading token=fixture-only-value',
    url: 'https://example.com/a(b)?x=<tag>&n=2',
  }
  const text = formatSelectedMessagesForExport([{ ...message, citations: [citation] }], t, { includeSources: true })
  const html = new MarkdownIt({ html: true, linkify: true }).render(text)
  expect(html.match(/<a /g)).toHaveLength(1)
  expect(html).toContain('href="https://example.com/a(b)?x=%3Ctag%3E&amp;n=2"')
  expect(html).toContain('<code>')
  expect(html).toContain('&lt;img src=x&gt;')
  expect(html).not.toMatch(/<img|<h1>|fixture-only-value/)
  expect(html).toContain('[redacted]')
})

it('only adds permitted explicit URLs, not credential links, local URIs or sourceUri fallbacks', () => {
  for (const url of ['file:///private/source.md', 'javascript:alert(1)', 'https://user:fixture@example.com', 'https://example.com/?access_token=fixture', 'https://example.com/?%61pi-key=fixture', 'https://example.com/#token=fixture']) {
    const text = formatSelectedMessagesForExport([{ ...message, citations: [{ id: 'source', type: 'web', title: 'Reference', url }] }], t, { includeSources: true })
    expect(text).not.toContain(url)
    expect(text).toContain(t('messageBubble.exportSourceNoLink'))
  }
  const text = formatSelectedMessagesForExport([{ ...message, citations: [{ id: 'source', type: 'knowledge', title: '', sourceUri: 'https://example.com/private-import' }] }], t, { includeSources: true })
  expect(text).not.toContain('private-import')
  expect(text).toContain(t('source.capturedCitation'))
})

it('provides source disclosure and fallback labels in every supported language', () => {
  for (const language of ['en', 'ja', 'zh-CN']) {
    const localT = i18n.getFixedT(language)
    const text = formatSelectedMessagesForExport([message], localT, { includeSources: true })
    for (const key of ['exportSourcesTitle', 'exportSourcesNotice', 'exportSourceNoLink']) {
      expect(text).toContain(localT(`messageBubble.${key}`))
      expect(localT(`messageBubble.${key}`)).not.toBe(`messageBubble.${key}`)
    }
    expect(localT('messageBubble.exportSourcesConfirmMessage')).not.toBe('messageBubble.exportSourcesConfirmMessage')
  }
})
