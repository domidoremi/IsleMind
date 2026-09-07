import { resolveBackgroundEnvironment, seededEnvironmentValue } from './backgroundEnvironment'

describe('background environment', () => {
  test.each(['minimal', 'monet', 'material', 'liquid-glass'] as const)('%s supports light, dark, and accent-derived variation', (family) => {
    const light = resolveBackgroundEnvironment({ family, mode: 'light', variation: 'fixed' })
    const dark = resolveBackgroundEnvironment({ family, mode: 'dark', variation: 'fixed' })
    const accented = resolveBackgroundEnvironment({ family, mode: 'light', accent: '#4963A6', variation: 'fixed' })
    expect(light.seed).not.toBe(dark.seed)
    expect(light.seed).not.toBe(accented.seed)
    expect(light.layerCount).toBeGreaterThan(0)
  })

  test('variation policies are deterministic within their intended lifetime', () => {
    const day = new Date(2026, 8, 5, 10, 30)
    const nextDay = new Date(2026, 8, 6, 10, 30)
    const base = { family: 'monet' as const, mode: 'light' as const }
    expect(resolveBackgroundEnvironment({ ...base, variation: 'fixed', now: day }).seed)
      .toBe(resolveBackgroundEnvironment({ ...base, variation: 'fixed', now: nextDay }).seed)
    expect(resolveBackgroundEnvironment({ ...base, variation: 'daily', now: day }).seed)
      .not.toBe(resolveBackgroundEnvironment({ ...base, variation: 'daily', now: nextDay }).seed)
    expect(resolveBackgroundEnvironment({ ...base, variation: 'startup', startupSeed: 1 }).seed)
      .not.toBe(resolveBackgroundEnvironment({ ...base, variation: 'startup', startupSeed: 2 }).seed)
    expect(resolveBackgroundEnvironment({ ...base, variation: 'preset', preset: 1 }).seed)
      .not.toBe(resolveBackgroundEnvironment({ ...base, variation: 'preset', preset: 2 }).seed)
    expect(resolveBackgroundEnvironment({ ...base, variation: 'random', rotationEpoch: 1 }).seed)
      .not.toBe(resolveBackgroundEnvironment({ ...base, variation: 'random', rotationEpoch: 2 }).seed)
  })

  test('motion and intensity stay conservative while respecting user choice', () => {
    const low = resolveBackgroundEnvironment({ family: 'liquid-glass', mode: 'dark' })
    const staticEnvironment = resolveBackgroundEnvironment({ family: 'liquid-glass', mode: 'dark', motion: 'static' })
    const immersive = resolveBackgroundEnvironment({ family: 'liquid-glass', mode: 'dark', motion: 'immersive', intensity: 'high' })
    expect(low.motion).toBe('subtle')
    expect(low.intensity).toBe('low')
    expect(staticEnvironment.amplitude).toBe(0)
    expect(immersive.amplitude).toBeGreaterThan(low.amplitude)
    expect(immersive.layerCount).toBeLessThanOrEqual(6)
    expect(immersive.cycleMs).toBeGreaterThanOrEqual(60_000)
    expect(resolveBackgroundEnvironment({ family: 'minimal', mode: 'light' }).motion).toBe('static')
    expect(resolveBackgroundEnvironment({ family: 'material', mode: 'light' }).motion).toBe('static')
  })

  test('seeded field values are stable and bounded', () => {
    expect(seededEnvironmentValue(42, 7)).toBe(seededEnvironmentValue(42, 7))
    expect(seededEnvironmentValue(42, 7)).toBeGreaterThanOrEqual(0)
    expect(seededEnvironmentValue(42, 7)).toBeLessThanOrEqual(1)
  })
})
