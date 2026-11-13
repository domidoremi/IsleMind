import { createKnowledgeDocumentImporter } from './knowledgeDocumentImporter'
import type { KnowledgeDocumentImporterDependencies } from '../contracts'

const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')

afterEach(() => {
  if (segmenterDescriptor) Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor)
  else Reflect.deleteProperty(Intl, 'Segmenter')
})

function fallback(mode: 'missing' | 'throws') {
  Object.defineProperty(Intl, 'Segmenter', {
    configurable: true,
    value: mode === 'missing' ? undefined : class {
      constructor() { throw new Error('Sentence segmentation unavailable') }
    },
  })
}

function importCapture(targetChunkLength = 1_200) {
  const saveDocument = jest.fn<ReturnType<KnowledgeDocumentImporterDependencies['repository']['saveDocument']>,
    Parameters<KnowledgeDocumentImporterDependencies['repository']['saveDocument']>>(async () => undefined)
  const unexpected = async () => { throw new Error('Unexpected repository operation') }
  let sequence = 0
  const importer = createKnowledgeDocumentImporter({
    repository: {
      saveDocument,
      loadSnapshot: unexpected,
      prepareReplacementSnapshot() { throw new Error('Unexpected snapshot replacement') },
      listDocuments: unexpected,
      listChunks: unexpected,
      deleteDocument: unexpected,
      clearDocuments: unexpected,
      updateDocumentStatus: unexpected,
      replaceSnapshot: unexpected,
    },
    clock: { now: () => 1 },
    ids: { next: prefix => `${prefix}-${++sequence}` },
    targetChunkLength,
  })
  return {
    saveDocument,
    async import(text: string) {
      const result = await importer.import({
        title: 'notes.txt', mimeType: 'text/plain', size: text.length, text,
      }, { signal: new AbortController().signal })
      return { result, chunks: saveDocument.mock.calls[0][1] }
    },
  }
}

it.each(['missing', 'throws'] as const)(
  'keeps paragraph breaks and actual headings when Intl.Segmenter is %s',
  async mode => {
    fallback(mode)
    const text = [
      '# Field notes',
      '',
      'The librarian keeps the original wording beside each observation. '.repeat(10).trim(),
      '',
      '## 本機閱讀筆記',
      '',
      '第一張筆記記錄黃色椅子。第二張筆記記錄藍色杯子。',
      '',
      '## 読書ノート',
      '',
      '元の見出しと段落を保存します。',
    ].join('\n')
    const { chunks } = await importCapture().import(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe(text)
    expect(chunks[0].headingPath).toEqual(['notes.txt', 'Field notes', '本機閱讀筆記', '読書ノート'])
  },
)

it('normalizes CRLF while retaining blank lines, indentation and list boundaries in the fallback', async () => {
  fallback('missing')
  const text = 'First paragraph.\r\n\r\n  Indented paragraph.\r\n- Yellow chair\r\n- Blue cup'
  const { chunks } = await importCapture().import(text)
  expect(chunks).toHaveLength(1)
  expect(chunks[0].content).toBe(text.replace(/\r\n/g, '\n'))
  expect(chunks[0].headingPath).toEqual(['notes.txt'])
})

it('retains source separators when fallback passages span several chunks', async () => {
  fallback('missing')
  const text = [
    '# Morning',
    'The yellow chair is beside the window.',
    '',
    '## Afternoon',
    'The blue cup is still on the table.',
    '',
    '## Evening',
    'The notebook keeps both observations.',
  ].join('\n')
  const { chunks } = await importCapture(90).import(text)
  expect(chunks.length).toBeGreaterThan(1)
  const saved = chunks.map(chunk => chunk.content).join('\n')
  for (const line of text.split('\n').filter(Boolean)) expect(saved).toContain(line)
  expect(chunks.some(chunk => chunk.content.includes('\n'))).toBe(true)
  const headings = new Set(['notes.txt', 'Morning', 'Afternoon', 'Evening'])
  for (const chunk of chunks) {
    for (const heading of chunk.headingPath ?? []) expect(headings.has(heading)).toBe(true)
  }
})

it('refuses whitespace-only fallback text before saving a document', async () => {
  fallback('missing')
  const capture = importCapture()
  await expect(capture.import(' \r\n\r\n\t ')).rejects.toThrow('no indexable text')
  expect(capture.saveDocument).not.toHaveBeenCalled()
})
