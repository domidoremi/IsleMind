import {
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  KNOWLEDGE_MEMORY_RECORD_SCHEMA,
  KnowledgeRepositoryConflictError,
  type KnowledgeDocumentRecord,
  type KnowledgeMemoryRecord,
} from '../contracts'
import {
  assertKnowledgeDocumentUnchanged,
  assertKnowledgeMemoryUnchanged,
  knowledgeMemoryReviewMutationOptions,
} from './knowledgeMutationGuard'

const memory = (overrides: Partial<KnowledgeMemoryRecord> = {}): KnowledgeMemoryRecord => ({
  schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA, id: 'reviewed', content: 'Reviewed fact', status: 'pending',
  scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal', sourceKind: 'manual',
  sourceMessageIds: ['source'], createdAt: 1, updatedAt: 1, ...overrides,
})
const document = (overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord => ({
  schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id: 'reviewed', title: 'Reviewed document',
  mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready',
  contentHash: 'reviewed-source', createdAt: 1, updatedAt: 1, ...overrides,
})

it('compares records by value rather than object identity or property insertion order', () => {
  const reviewed = memory()
  expect(() => assertKnowledgeMemoryUnchanged({
    ...reviewed, scope: { id: 'local-user', kind: 'user' }, sourceMessageIds: ['source'],
  }, reviewed)).not.toThrow()
  const reviewedDocument = document()
  const { updatedAt, ...rest } = reviewedDocument
  expect(() => assertKnowledgeDocumentUnchanged({ updatedAt, ...rest }, reviewedDocument)).not.toThrow()
})

it.each<Partial<KnowledgeMemoryRecord>>([
  { content: 'Unreviewed text' }, { status: 'active' }, { sensitivity: 'sensitive' },
  { scope: { kind: 'conversation', id: 'other' } }, { sourceMessageIds: ['other-source'] },
  { sourceKind: 'model' }, { sourceDetail: 'Unreviewed provenance' }, { confidence: 0.5 },
  { validUntil: 5 }, { supersedesId: 'other' }, { conflictWithId: 'other' }, { updatedAt: 2 },
])('rejects an unreviewed memory change: %j', change => {
  const reviewed = memory()
  expect(() => assertKnowledgeMemoryUnchanged(memory(change), reviewed)).toThrow(KnowledgeRepositoryConflictError)
  expect(reviewed).toEqual(memory())
})

it.each<Partial<KnowledgeDocumentRecord>>([
  { contentHash: 'unreviewed-source' }, { title: 'Unreviewed title' }, { chunkCount: 2 },
  { sourceUri: 'different-source' }, { status: 'error' }, { updatedAt: 2 },
])('rejects an unreviewed document change: %j', change => {
  expect(() => assertKnowledgeDocumentUnchanged(document(change), document())).toThrow(KnowledgeRepositoryConflictError)
})

it('rejects disappeared records instead of acknowledging a nonexistent write', () => {
  expect(() => assertKnowledgeMemoryUnchanged(undefined, memory())).toThrow(KnowledgeRepositoryConflictError)
  expect(() => assertKnowledgeDocumentUnchanged(undefined, document())).toThrow(KnowledgeRepositoryConflictError)
})

it('binds activation to the shown active fact using the repository logical-key normalization and exact scope', () => {
  const candidate = memory({ subject: 'User-Name', key: 'Favorite color', value: 'Amber' })
  const wrongScope = memory({
    id: 'other-scope', status: 'active', scope: { kind: 'conversation', id: 'other' },
    subject: 'user name', key: 'favorite_color', value: 'Red',
  })
  const active = memory({ id: 'active', status: 'active', subject: 'USER NAME', key: 'favorite_color', value: 'Blue' })
  const options = knowledgeMemoryReviewMutationOptions(candidate, [wrongScope, candidate, active])
  expect(options).toEqual({ expectedMemory: candidate, expectedActiveMemory: active })
  expect(knowledgeMemoryReviewMutationOptions(candidate, [wrongScope, candidate]).expectedActiveMemory).toBeNull()
  expect(knowledgeMemoryReviewMutationOptions(memory(), [active]).expectedActiveMemory).toBeNull()
})

it('detaches both reviewed memory snapshots, including scope and source IDs, from later caller mutations', () => {
  const sourceMessageIds = ['source']
  const candidate = memory({ subject: 'User', key: 'color', value: 'Amber', sourceMessageIds })
  const active = memory({ id: 'active', status: 'active', subject: 'User', key: 'color', value: 'Blue' })
  const expectedCandidate = { ...candidate, scope: { ...candidate.scope }, sourceMessageIds: [...candidate.sourceMessageIds] }
  const expectedActive = { ...active, scope: { ...active.scope }, sourceMessageIds: [...active.sourceMessageIds] }
  const options = knowledgeMemoryReviewMutationOptions(candidate, [candidate, active])
  candidate.scope.id = 'other-user'
  sourceMessageIds.push('unreviewed-source')
  active.content = 'Unreviewed active fact'
  expect(options.expectedMemory).toEqual(expectedCandidate)
  expect(options.expectedActiveMemory).toEqual(expectedActive)
})
