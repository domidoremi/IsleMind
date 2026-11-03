import type { DocumentSummary } from '@/modules/documents'
import type { DocumentLibrarySort } from './useDocumentLibraryViewState'

export function selectDocumentSummaries(documents: readonly DocumentSummary[], query: string, sort: DocumentLibrarySort, language: string) {
  const needle = query.trim().toLocaleLowerCase(language)
  return documents.filter(document => document.title.toLocaleLowerCase(language).includes(needle))
    .sort((a, b) => sort === 'title'
      ? a.title.localeCompare(b.title, language) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
      : b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, language) || a.id.localeCompare(b.id))
}

export type DocumentCatalogRow =
  | { kind: 'heading'; id: string; labelKey?: string; label?: string }
  | { kind: 'document'; id: string; document: DocumentSummary }

export function buildDocumentCatalogRows(documents: readonly DocumentSummary[], sort: DocumentLibrarySort, language: string, now: number): DocumentCatalogRow[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const week = new Date(today)
  week.setDate(week.getDate() - 6)
  const rows: DocumentCatalogRow[] = []
  let previousGroup = ''
  for (const document of documents) {
    const first = document.title.trim().slice(0, 1).toLocaleUpperCase(language)
    const group = sort === 'title' ? (/^[A-Z0-9]$/.test(first) ? first : '#')
      : document.updatedAt >= today.getTime() ? 'today'
        : document.updatedAt >= week.getTime() ? 'week' : 'earlier'
    if (group !== previousGroup) {
      rows.push({
        kind: 'heading', id: `group:${group}:${document.id}`,
        ...(sort === 'title' ? group === '#' ? { labelKey: 'taskWorkspace.catalog.otherTitles' } : { label: group }
          : { labelKey: `taskWorkspace.catalog.${group}` }),
      })
      previousGroup = group
    }
    rows.push({ kind: 'document', id: `document:${document.id}`, document })
  }
  return rows
}
