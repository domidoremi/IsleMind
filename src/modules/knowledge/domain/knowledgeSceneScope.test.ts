import { buildExactKnowledgeScope, buildKnowledgeScope, filterKnowledgeSources, resolveKnowledgeScopeReferences } from './knowledgeScope'

test('scene references match exact document identities rather than title substrings', () => {
  const sources = [{ documentId: 'A', title: 'Source A' }, { documentId: 'B', title: 'Notes about a' }]
  expect(filterKnowledgeSources(sources, buildKnowledgeScope(['A']))).toHaveLength(2)
  expect(filterKnowledgeSources(sources, buildExactKnowledgeScope(['A']))).toEqual([sources[0]])
  expect(filterKnowledgeSources(sources, buildExactKnowledgeScope([]))).toEqual([])
})

test('legacy exact titles resolve only when unique, and missing references keep an empty scope closed', () => {
  const catalog = [{ id: 'A', title: 'Source A' }, { id: 'B', title: 'Shared' }, { id: 'C', title: 'Shared' }]
  expect(resolveKnowledgeScopeReferences(['A', 'Source A', 'Shared', 'missing'], catalog)).toEqual({ ids: ['A'], missing: ['Shared', 'missing'] })
  expect(resolveKnowledgeScopeReferences(['B'], catalog).ids).toEqual(['B'])
})
