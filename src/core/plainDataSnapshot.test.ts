import { snapshotPlainData } from './plainDataSnapshot'

describe('operation-local plain data snapshots', () => {
  it('detaches and freezes mutable nested data without freezing the caller', () => {
    const original = { ids: ['source'], nested: { memoryEnabled: true }, optional: undefined }
    const captured = snapshotPlainData(original)
    original.ids.push('later')
    original.nested.memoryEnabled = false
    expect(captured).toEqual({ ids: ['source'], nested: { memoryEnabled: true }, optional: undefined })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.ids)).toBe(true)
    expect(Object.isFrozen(captured.nested)).toBe(true)
    expect(Object.isFrozen(original)).toBe(false)
  })

  it('reuses deeply immutable plain data without treating a shallow freeze as a snapshot', () => {
    const immutable = Object.freeze({ ids: Object.freeze(['source']) })
    expect(snapshotPlainData(immutable)).toBe(immutable)
    const shallow = Object.freeze({ ids: ['source'] })
    const captured = snapshotPlainData(shallow)
    shallow.ids.push('later')
    expect(captured.ids).toEqual(['source'])
    expect(captured).not.toBe(shallow)
  })

  it('bounds repeated capture work for an already validated immutable catalog', () => {
    const catalog = snapshotPlainData(Array.from({ length: 256 }, (_, index) => ({
      id: `model-${index}`, capabilities: { text: true, limits: [4096, 8192] },
    })))
    expect(snapshotPlainData(catalog)).toBe(catalog)
    const enumerate = jest.spyOn(Object, 'getOwnPropertyNames')
    try {
      for (let index = 0; index < 10; index++) expect(snapshotPlainData(catalog)).toBe(catalog)
      expect(enumerate.mock.calls.length).toBeLessThanOrEqual(10)
    } finally {
      enumerate.mockRestore()
    }
  })

  it('does not trust a frozen cycle that reaches a mutable child', () => {
    const child: { value: unknown } = { value: 'before' }
    const parent: { child: typeof child; cycle?: { parent: unknown } } = { child }
    parent.cycle = Object.freeze({ parent })
    Object.freeze(parent)
    const captured = snapshotPlainData(parent)
    expect(captured).not.toBe(parent)
    expect(captured.cycle?.parent).toBe(captured)
    child.value = () => 'invalid'
    expect(() => snapshotPlainData(parent.cycle)).toThrow()
    expect(captured.child.value).toBe('before')
  })

  it('rejects an invalid graph again after a failed immutable validation', () => {
    const read = jest.fn(() => 'live')
    const parent = Object.create(null) as Record<string, unknown>
    parent.invalid = Object.freeze(Object.defineProperty({}, 'value', { get: read }))
    parent.cycle = Object.freeze({ parent })
    Object.freeze(parent)
    expect(() => snapshotPlainData(parent)).toThrow()
    expect(() => snapshotPlainData(parent.cycle)).toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it('preserves shared references and safely detaches cyclic data', () => {
    const child = { id: 'shared' }
    const original: { a: typeof child; b: typeof child; self?: unknown } = { a: child, b: child }
    original.self = original
    const captured = snapshotPlainData(original)
    expect(captured.a).toBe(captured.b)
    expect(captured.self).toBe(captured)
    expect(captured.a).not.toBe(child)
  })

  it('copies null-prototype and own __proto__ data without changing prototypes', () => {
    const original = Object.create(null) as Record<string, unknown>
    original.__proto__ = { id: 'data-not-prototype' }
    const captured = snapshotPlainData(original)
    expect(Object.getPrototypeOf(captured)).toBe(null)
    expect(captured.__proto__).toEqual({ id: 'data-not-prototype' })
    const ordinary = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    expect(Object.getPrototypeOf(snapshotPlainData(ordinary))).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([
    ['signal', () => new AbortController().signal],
    ['date', () => new Date(0)],
    ['map', () => new Map()],
    ['callable', () => ({ callback() {} })],
  ])('rejects non-data %s rather than cloning its lifetime or behavior', (_label, create) => {
    expect(() => snapshotPlainData(create())).toThrow()
  })

  it('rejects accessors without invoking them', () => {
    const read = jest.fn(() => 'live')
    const original = Object.defineProperty({}, 'settings', { enumerable: true, get: read })
    expect(() => snapshotPlainData(original)).toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it('preserves sparse arrays and rejects indexed accessors', () => {
    const sparse = new Array<string>(3)
    sparse[2] = 'last'
    const captured = snapshotPlainData(sparse)
    expect(captured.length).toBe(3)
    expect(0 in captured).toBe(false)
    const read = jest.fn(() => 'live')
    const indexed = Object.defineProperty([], '0', { enumerable: true, get: read })
    expect(() => snapshotPlainData(indexed)).toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})
