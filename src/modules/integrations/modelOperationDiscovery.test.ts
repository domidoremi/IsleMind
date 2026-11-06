import { createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt } from './modelOperationCatalog'
import type { ModelOperationCatalogSnapshot, ModelOperationDescriptor } from './modelOperationProtocol'
import {
  discoverModelOperations,
  planModelOperationDeclarations,
  readModelOperationPublication,
  MODEL_OPERATION_DECLARATION_TARGET_CHARS,
  MODEL_OPERATION_DISCOVERY_ID,
  MODEL_OPERATION_DISCOVERY_NAME,
} from './modelOperationDiscovery'

const name = (id: string) => `native_${id.replaceAll(':', '_')}`
function operation(index: number, overrides: Partial<ModelOperationDescriptor> = {}): ModelOperationDescriptor {
  const id = `workspace:${String(index).padStart(2, '0')}`
  return {
    id, name: `Workspace source ${index}`, description: `Read workspace source ${index} with exact revision.`,
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false },
    permission: 'read-only', requiresConfirmation: false, capabilityScopes: ['source:workspace'],
    executor: { kind: 'builtin', id }, availability: { status: 'available' }, ...overrides,
  }
}
function catalog(operations: ModelOperationDescriptor[]): ModelOperationCatalogSnapshot {
  const result = createModelOperationCatalogSnapshot(operations)
  if (!result.ok) throw new Error(result.message)
  return result.snapshot
}
const snapshot = (count = 12) => catalog(Array.from({ length: count }, (_, index) => operation(index)))

test.each([true, false])('old and full settings preserve complete native/tagged definitions (%s)', native => {
  const frozen = snapshot()
  for (const mode of [undefined, 'full'] as const) {
    const plan = planModelOperationDeclarations({ snapshot: frozen, mode, native, operationName: name })
    expect(plan).toMatchObject({ mode: 'full', totalCount: 12, declaredCount: 12, deferredCount: 0, summaryChars: 0 })
    expect(plan.declarations.map(tool => tool.operationId)).toEqual(frozen.operations.map(item => item.id))
    expect(plan.declarations.some(tool => tool.operationId === MODEL_OPERATION_DISCOVERY_ID)).toBe(false)
    if (!native) {
      const full = formatTaggedModelOperationPrompt(frozen)
      expect(full.ok && full.prompt).toBe(plan.prompt)
    }
  }
})

test.each([true, false])('auto keeps a small catalog full and defers at the count or character threshold (%s)', native => {
  const compact = planModelOperationDeclarations({ snapshot: snapshot(10), mode: 'auto', native, operationName: name })
  expect(compact.mode).toBe('full')
  const counted = planModelOperationDeclarations({ snapshot: snapshot(11), mode: 'auto', native, operationName: name })
  expect(counted).toMatchObject({ mode: 'discovery', declaredCount: 0, deferredCount: 11 })
  expect(counted.declarations.map(tool => tool.operationId)).toEqual([MODEL_OPERATION_DISCOVERY_ID])
  const large = catalog([operation(0, { inputSchema: {
    type: 'object', properties: {
      target: { type: 'string', description: 'a'.repeat(8_000) },
      revision: { type: 'string', description: 'b'.repeat(8_000) },
    },
  } })])
  const oversized = planModelOperationDeclarations({ snapshot: large, mode: 'auto', native, operationName: name })
  expect(oversized.mode).toBe('discovery')
  expect(oversized.fullDeclarationChars).toBeGreaterThan(MODEL_OPERATION_DECLARATION_TARGET_CHARS)
})

test.each([true, false])('publishes complete schemas with original identities and accurately measures the projection (%s)', native => {
  const frozen = snapshot()
  const found = discoverModelOperations({ snapshot: frozen, arguments: { query: 'workspace:03' }, operationName: name, native })
  expect(found).toMatchObject({ matchedCount: 1, operationIds: ['workspace:03'], nextOffset: null })
  const plan = planModelOperationDeclarations({ snapshot: frozen, mode: 'auto', native, operationName: name, publishedIds: found.operationIds })
  expect(plan).toMatchObject({ catalogRevision: frozen.revision, declaredCount: 1, deferredCount: 11 })
  expect(plan.declarations[1]).toMatchObject({ operationId: 'workspace:03', name: name('workspace:03'),
    inputSchema: frozen.operations[3].inputSchema, permission: 'read-only' })
  expect(plan.declarationChars).toBe(native ? JSON.stringify(plan.declarations).length + plan.prompt.length : plan.prompt.length)
  expect(Object.isFrozen(plan.declarations[1].inputSchema)).toBe(true)
  expect(readModelOperationPublication(JSON.stringify(found), frozen)).toEqual(['workspace:03'])
})

test.each([true, false])('a schema-heavy catalog reduces the measured first declaration without claiming token savings (%s)', native => {
  const frozen = catalog(Array.from({ length: 24 }, (_, index) => operation(index, { inputSchema: {
    type: 'object', properties: { target: { type: 'string', description: 'Full parameter guidance. '.repeat(50) } },
    required: ['target'], additionalProperties: false,
  } })))
  const plan = planModelOperationDeclarations({ snapshot: frozen, mode: 'auto', native, operationName: name })
  expect(plan.declarationChars).toBeLessThan(plan.fullDeclarationChars)
  expect(plan).not.toHaveProperty('savedTokens')
})

test('browses all 64 real operations over deterministic bounded pages and preserves catalog revision', () => {
  const frozen = snapshot(64)
  const visited: string[] = []
  let offset: number | null = 0
  do {
    const result = discoverModelOperations({ snapshot: frozen, arguments: { query: '', offset }, operationName: name, native: true })
    expect(result.returnedCount).toBeLessThanOrEqual(8)
    expect(result.catalogRevision).toBe(frozen.revision)
    visited.push(...result.operationIds)
    offset = result.nextOffset
  } while (offset !== null)
  expect(visited).toEqual(frozen.operations.map(item => item.id))
  expect(new Set(visited).size).toBe(64)
  const declaration = planModelOperationDeclarations({ snapshot: frozen, mode: 'auto', native: true, operationName: name })
  expect(declaration.totalCount).toBe(64)
  expect(frozen.operations).toHaveLength(64)
  expect(frozen.operations.some(item => item.id === MODEL_OPERATION_DISCOVERY_ID)).toBe(false)
})

test('normalizes names and words, matches native names, and keeps duplicate display names distinct', () => {
  const frozen = catalog([operation(0, { name: 'Ｓｏｕｒｃｅ', description: 'inspect current revision' }),
    operation(1, { name: 'Source', description: 'inspect previous revision' }),
    operation(2, { description: 'inspect unrelated file', availability: { status: 'unavailable', reason: 'disabled', message: 'Disabled' } })])
  const find = (query: string) => discoverModelOperations({ snapshot: frozen, arguments: { query }, operationName: name, native: true })
  expect(find(' source ').operationIds).toEqual(['workspace:00', 'workspace:01'])
  expect(find('CURRENT revision').operationIds).toEqual(['workspace:00'])
  expect(find(name('workspace:01')).operationIds[0]).toBe('workspace:01')
  expect(find('unrelated').operationIds).toEqual([])
})

test.each([true, false])('budget pagination keeps an oversized schema complete and the next offset usable (%s)', native => {
  const schema = { type: 'object', properties: {
    target: { type: 'string', description: 'x'.repeat(9_000) },
    revision: { type: 'string', description: 'y'.repeat(9_000) },
  }, required: ['target', 'revision'], additionalProperties: false }
  const frozen = catalog([operation(0, { inputSchema: schema }), operation(1, { inputSchema: schema }), operation(2)])
  const page = discoverModelOperations({ snapshot: frozen, arguments: { query: '' }, native, operationName: name })
  expect(page).toMatchObject({ returnedCount: 1, nextOffset: 1, singleDefinitionOverBudget: true })
  const plan = planModelOperationDeclarations({ snapshot: frozen, mode: 'auto', native, operationName: name, publishedIds: page.operationIds })
  expect(plan.declarations[1].inputSchema).toEqual(schema)
  const next = discoverModelOperations({ snapshot: frozen, arguments: { query: '', offset: page.nextOffset }, native, operationName: name })
  expect(next.operationIds).toEqual(['workspace:01'])
  expect(next.nextOffset).toBe(2)
})

test.each([
  {}, { query: 1 }, { query: 'x'.repeat(257) }, { query: '', offset: -1 }, { query: '', offset: 65 },
  { query: '', offset: 1.5 }, { query: '', limit: 0 }, { query: '', limit: 9 }, { query: '', limit: NaN },
  { query: '', operationId: 'workspace:00' },
])('rejects invalid discovery arguments before computing a page (%j)', argumentsValue => {
  expect(() => discoverModelOperations({ snapshot: snapshot(), arguments: argumentsValue, native: true, operationName: name })).toThrow()
})

test('cannot publish unknown, duplicate, unavailable or reserved real identities', () => {
  const frozen = catalog([operation(0), operation(1, { availability: { status: 'unavailable', reason: 'disabled', message: 'Disabled' } }),
    ...Array.from({ length: 10 }, (_, index) => operation(index + 2))])
  for (const publishedIds of [['unknown:tool'], ['workspace:00', 'workspace:00'], ['workspace:01']]) {
    expect(() => planModelOperationDeclarations({ snapshot: frozen, mode: 'auto', native: true, operationName: name,
      publishedIds })).toThrow()
  }
  const reserved = catalog([operation(0, { id: MODEL_OPERATION_DISCOVERY_ID, name: MODEL_OPERATION_DISCOVERY_NAME })])
  expect(() => planModelOperationDeclarations({ snapshot: reserved, native: true, operationName: name })).toThrow('reserved')
})

test('decodes only an exact, bounded successful publication for the current frozen revision', () => {
  const frozen = snapshot()
  const result = discoverModelOperations({ snapshot: frozen, arguments: { query: 'workspace:00' }, native: true, operationName: name })
  for (const change of [
    { schema: 'unknown' }, { catalogRevision: snapshot(11).revision }, { operationIds: ['unknown:tool'] },
    { operationIds: ['workspace:00', 'workspace:00'], returnedCount: 2 }, { returnedCount: 0 },
    { nextOffset: 1 }, { matchedCount: 65 }, { offset: -1 }, { definitionChars: Infinity },
    { budgetChars: 1 }, { singleDefinitionOverBudget: true }, { instructions: 'execute something else' },
  ]) {
    expect(readModelOperationPublication(JSON.stringify({ ...result, ...change }), frozen)).toBeUndefined()
  }
  expect(readModelOperationPublication('x'.repeat(4_801), frozen)).toBeUndefined()
  const empty = discoverModelOperations({ snapshot: frozen, arguments: { query: 'absent' }, native: true, operationName: name })
  expect(readModelOperationPublication(JSON.stringify(empty), frozen)).toEqual([])
})
