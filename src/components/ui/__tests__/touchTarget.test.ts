import { resolveMinimumTouchTargetHeight } from '../isle/touchTarget'

describe('resolveMinimumTouchTargetHeight', () => {
  const minimumTarget = 44

  it.each([
    { name: 'raises a compact base height', baseHeight: 40, style: undefined, expected: 44 },
    { name: 'keeps the canonical target', baseHeight: 44, style: { minHeight: 44 }, expected: 44 },
    { name: 'keeps a larger feature height', baseHeight: 40, style: { minHeight: 52 }, expected: 52 },
    { name: 'keeps a larger fixed height', baseHeight: 40, style: { height: 60 }, expected: 60 },
    { name: 'ignores non-numeric dimensions', baseHeight: 40, style: { height: '100%', minHeight: 'auto' }, expected: 44 },
  ])('$name', ({ baseHeight, style, expected }) => {
    expect(resolveMinimumTouchTargetHeight(baseHeight, style, minimumTarget)).toBe(expected)
  })
})
