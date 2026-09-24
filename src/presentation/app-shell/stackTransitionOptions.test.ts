import { resolveStackTransitionOptions } from './stackTransitionOptions'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'

describe('stack transitions', () => {
  it.each([
    ['minimal', 'fade'], ['monet', 'fade_from_bottom'], ['material', 'slide_from_right'],
    ['liquid-glass', 'fade_from_bottom'], ['animal-island-ui', 'simple_push'],
  ] as const)('uses the %s native grammar without enabling conflicting gestures', (theme, animation) => {
    expect(resolveStackTransitionOptions('android', 'full', theme)).toEqual({
      animation,
      animationDuration: THEME_MOTION_DURATIONS[theme].page,
      gestureEnabled: false,
      fullScreenGestureEnabled: false,
      animationMatchesGesture: false,
    })
    expect(resolveStackTransitionOptions('ios', 'full', theme).animation).toBe(theme === 'animal-island-ui' ? 'slide_from_right' : animation)
  })

  it.each(['android', 'ios', 'web'])('respects reduced/disabled motion on %s', (platform) => {
    for (const theme of Object.keys(THEME_MOTION_DURATIONS) as (keyof typeof THEME_MOTION_DURATIONS)[]) {
      expect(resolveStackTransitionOptions(platform, 'reduced', theme)).toMatchObject({ animation: 'fade', animationDuration: 120 })
      expect(resolveStackTransitionOptions(platform, 'none', theme)).toMatchObject({ animation: 'none', animationDuration: 0 })
    }
  })
})
