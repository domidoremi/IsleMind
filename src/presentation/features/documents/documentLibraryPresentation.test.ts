import type { DocumentSummary } from '@/modules/documents'
import { buildDocumentCatalogRows, selectDocumentSummaries } from './documentLibraryPresentation'

const documents: DocumentSummary[] = [
  { id: 'b', title: 'Beta', updatedAt: 10, createdAt: 1 },
  { id: 'a', title: 'Alpha', updatedAt: 20, createdAt: 1 },
  { id: 'c', title: 'Another idea', updatedAt: 20, createdAt: 1 },
]

it('sorts summaries by recency with a deterministic title tie-breaker without mutating storage order', () => {
  expect(selectDocumentSummaries(documents, '', 'updated', 'en').map(row => row.id)).toEqual(['a', 'c', 'b'])
  expect(documents.map(row => row.id)).toEqual(['b', 'a', 'c'])
})

it('sorts matching titles without reading bodies or changing the search text', () => {
  expect(selectDocumentSummaries(documents, '  A  ', 'title', 'en').map(row => row.id)).toEqual(['a', 'c', 'b'])
  expect(selectDocumentSummaries(documents, 'idea', 'updated', 'en').map(row => row.id)).toEqual(['c'])
})

it('breaks identical titles and timestamps by identity', () => {
  const rows = [{ ...documents[0], id: 'z' }, { ...documents[0], id: 'x' }]
  expect(selectDocumentSummaries(rows, '', 'title', 'en').map(row => row.id)).toEqual(['x', 'z'])
})

it('groups recent summary rows by local-day boundaries and preserves their order', () => {
  const now = new Date(2026, 10, 2, 12).getTime()
  const values = [
    { ...documents[0], updatedAt: new Date(2026, 10, 2, 0).getTime() },
    { ...documents[1], updatedAt: new Date(2026, 9, 27, 0).getTime() },
    { ...documents[2], updatedAt: new Date(2026, 9, 26, 23, 59).getTime() },
  ]
  const rows = buildDocumentCatalogRows(values, 'updated', 'en', now)
  expect(rows.filter(row => row.kind === 'heading').map(row => row.labelKey)).toEqual([
    'taskWorkspace.catalog.today', 'taskWorkspace.catalog.week', 'taskWorkspace.catalog.earlier',
  ])
  expect(rows.filter(row => row.kind === 'document').map(row => row.document)).toEqual(values)
  expect(rows.filter(row => row.kind === 'document')[0].document).toBe(values[0])
})

it('keeps keys unique for mixed-script headings and document identifiers', () => {
  const values = ['# note', 'Alpha', 'idea', 'Report', '! idea'].map((title, index) => ({
    ...documents[0], id: index === 1 ? 'group:#' : String(index), title,
  }))
  const rows = buildDocumentCatalogRows(values, 'title', 'en', 0)
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  expect(rows.filter(row => row.kind === 'document').map(row => row.document.title)).toEqual(values.map(row => row.title))
  expect(rows.filter(row => row.kind === 'heading').map(row => row.labelKey ?? row.label)).toEqual([
    'taskWorkspace.catalog.otherTitles', 'A', 'I', 'R', 'taskWorkspace.catalog.otherTitles',
  ])
})
