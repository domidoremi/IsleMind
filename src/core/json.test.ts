import { assertJsonTraversalBudget, measureJsonCharacters } from './json'

test('rejects oversized input before serialization, traverses shared values with a bound and never invokes getters', () => {
  expect(() => assertJsonTraversalBudget({ data: 'x'.repeat(1024) }, 100)).toThrow('managed text')
  const getter = jest.fn(() => 'unsafe')
  expect(() => assertJsonTraversalBudget(Object.defineProperty({}, 'data', { enumerable: true, get: getter }), 100)).toThrow('accessors')
  expect(getter).not.toHaveBeenCalled()
  const shared = { text: '12345' }
  expect(() => assertJsonTraversalBudget([shared, shared], 25)).toThrow('managed text')
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  expect(() => assertJsonTraversalBudget(cycle, 100)).toThrow('acyclic')
  expect(() => assertJsonTraversalBudget(Array.from({ length: 5 }, () => null), 100, 4)).toThrow('traversal')
  expect(() => assertJsonTraversalBudget(new Array(100_001), 100, 10)).toThrow('traversal')
  const indexedGetter = jest.fn(() => 'unsafe')
  const indexed: unknown[] = []
  Object.defineProperty(indexed, '0', { get: indexedGetter })
  expect(() => assertJsonTraversalBudget(indexed, 100)).toThrow('accessors')
  expect(indexedGetter).not.toHaveBeenCalled()
  const hiddenHook = Object.defineProperty({}, 'toJSON', { get: indexedGetter })
  expect(() => assertJsonTraversalBudget(hiddenHook, 100)).toThrow('serialization hooks')
  expect(indexedGetter).not.toHaveBeenCalled()
  expect(() => assertJsonTraversalBudget({ content: '中英 mixed', empty: [], optional: undefined }, 200)).not.toThrow()
})

test('counts serialized escaping, numeric widths and shared values without stringifying', () => {
  const shared = { text: '\u0000\n"\\\ud800\udfff😀', number: -1.7976931348623157e308, bool: false }
  const input = { ['\u0001"']: [shared, shared, undefined, null], optional: undefined }
  const serializedLength = JSON.stringify(input).length
  const stringify = jest.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('must not serialize') })
  try {
    expect(measureJsonCharacters(input)).toBeGreaterThanOrEqual(serializedLength)
    expect(() => measureJsonCharacters(input, 20)).toThrow('managed text')
    expect(() => measureJsonCharacters(input, 10000, 3)).toThrow('traversal')
  } finally { stringify.mockRestore() }
  const getter = jest.fn()
  expect(() => measureJsonCharacters(Object.defineProperty({}, 'text', { enumerable: true, get: getter }))).toThrow('accessors')
  expect(getter).not.toHaveBeenCalled()
})
