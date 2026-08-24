import {
  COMPOSER_KEYBOARD_FALLBACK_DURATION_MS,
  normalizeComposerKeyboardMotion,
  resolveComposerKeyboardLift,
} from './chatWorkspaceKeyboard'

describe('composer keyboard motion', () => {
  it('removes the Android window-resize portion from keyboard lift', () => {
    expect(resolveComposerKeyboardLift({
      platform: 'android',
      keyboardHeight: 320,
      baselineWindowHeight: 800,
      windowHeight: 560,
    })).toBe(80)
  })

  it('uses the full iOS keyboard height', () => {
    expect(resolveComposerKeyboardLift({
      platform: 'ios',
      keyboardHeight: 320,
      baselineWindowHeight: 800,
      windowHeight: 800,
    })).toBe(320)
  })

  it('preserves a valid system duration and easing', () => {
    expect(normalizeComposerKeyboardMotion(
      { duration: 280, easing: 'easeOut' },
      'show',
    )).toEqual({
      durationMs: 280,
      easing: 'easeOut',
      phase: 'show',
    })
  })

  it('falls back when Android reports zero duration', () => {
    expect(normalizeComposerKeyboardMotion(
      { duration: 0, easing: 'keyboard' },
      'hide',
    )).toEqual({
      durationMs: COMPOSER_KEYBOARD_FALLBACK_DURATION_MS,
      easing: 'keyboard',
      phase: 'hide',
    })
  })
})
