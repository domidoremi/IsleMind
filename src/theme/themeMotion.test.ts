import { collectThemeMotionProfileIssues, resolveThemeMotion, THEME_EXPERIENCE_EXTENSIONS, type ThemeMotionRole } from './themeMotion'
import { THEME_MOTION_DURATIONS } from './themeTokens'

const themes = Object.keys(THEME_EXPERIENCE_EXTENSIONS) as (keyof typeof THEME_EXPERIENCE_EXTENSIONS)[]
const settled = { opacity: 1, translateX: 0, translateY: 0, scale: 1 }
const durationRoles = { page: 'page', section: 'panel', overlay: 'panel', accent: 'emphasis', scenic: 'panel' } as const

describe.each(themes)('%s motion', (themeId) => {
  it.each(Object.keys(durationRoles) as ThemeMotionRole[])('resolves %s from canonical timing tokens and keeps its first frame readable', (role) => {
    const motion = resolveThemeMotion({ themeId, role, intensity: 'full', readable: true, direction: 'forward' })
    expect(motion.from.opacity).toBeGreaterThanOrEqual(0.65)
    expect(motion.animate).toEqual(settled)
    expect(motion.transition.duration).toBe(THEME_MOTION_DURATIONS[themeId][durationRoles[role]])
    expect(THEME_EXPERIENCE_EXTENSIONS[themeId].motion[role]).not.toHaveProperty('durationMs')
    expect(motion.transition.delay).toBe(0)
  })

  it('removes spatial motion and staggering with reduced motion and starts settled with none', () => {
    const input = { themeId, role: 'overlay' as const, readable: true, order: 100 }
    const reduced = resolveThemeMotion({ ...input, intensity: 'reduced' })
    expect(reduced.from).toEqual({ ...settled, opacity: 0.65 })
    expect(reduced.transition).toEqual({ type: 'timing', duration: 120, delay: 0 })
    const none = resolveThemeMotion({ ...input, intensity: 'none' })
    expect(none.from).toEqual(settled)
    expect(none.animate).toEqual(settled)
    expect(none.transition.delay).toBe(0)
  })

  it('retains directional geometry and bounded staggering independently of the timing tokens', () => {
    const forward = resolveThemeMotion({ themeId, role: 'page', intensity: 'full', direction: 'forward' })
    const backward = resolveThemeMotion({ themeId, role: 'page', intensity: 'full', direction: 'backward' })
    expect(backward.from.translateX).toBe(-forward.from.translateX || 0)
    expect(backward.transition.duration).toBe(forward.transition.duration)
    const staggered = resolveThemeMotion({ themeId, role: 'section', intensity: 'full', order: 100 })
    expect(staggered.transition.delay).toBe(Math.min(6 * THEME_EXPERIENCE_EXTENSIONS[themeId].motion.section.staggerMs, 180))
    expect(staggered.transition.duration).toBe(THEME_MOTION_DURATIONS[themeId].panel)
  })
})

it('validates canonical profiles and falls back to the Minimal panel token for malformed input', () => {
  expect(collectThemeMotionProfileIssues()).toEqual([])
  const motion = resolveThemeMotion({
    themeId: 'invalid' as never, role: 'invalid' as never, intensity: 'full', order: Number.NaN,
  })
  expect(motion.transition).toEqual({ type: 'timing', duration: THEME_MOTION_DURATIONS.minimal.panel, delay: 0 })
})
