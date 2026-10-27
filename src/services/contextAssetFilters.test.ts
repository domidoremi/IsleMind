import {
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  KNOWLEDGE_MEMORY_RECORD_SCHEMA,
  type KnowledgeDocumentRecord,
  type KnowledgeMemoryRecord,
} from '@/modules/knowledge'
import { filterAndSortMemories, filterAndSortKnowledgeDocuments } from './contextAssetFilters'

it('retains canonical snapshot types and object references through settings filters', () => {
  const reviewed = {
    schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA, id: 'reviewed', content: 'Reviewed fact', status: 'pending',
    scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal', sourceKind: 'manual',
    sourceMessageIds: ['source'], createdAt: 1, updatedAt: 1,
  } satisfies KnowledgeMemoryRecord
  const selected = filterAndSortMemories([reviewed], {
    statusFocus: 'pending', reviewFocus: 'manual', filter: 'Reviewed', sortMode: 'updated',
  })[0]
  const scopedId: string = selected.scope.id
  expect(scopedId).toBe('local-user')
  expect(selected).toBe(reviewed)
  const reviewedDocument = {
    schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id: 'reviewed', title: 'Reviewed document',
    mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
  } satisfies KnowledgeDocumentRecord
  const selectedDocument = filterAndSortKnowledgeDocuments([reviewedDocument], {
    statusFocus: 'ready', filter: 'Reviewed', sortMode: 'updated',
  })[0]
  const schema: typeof KNOWLEDGE_DOCUMENT_RECORD_SCHEMA = selectedDocument.schema
  expect(schema).toBe(KNOWLEDGE_DOCUMENT_RECORD_SCHEMA)
  expect(selectedDocument).toBe(reviewedDocument)
})
