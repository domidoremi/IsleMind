import {
  resolveSettingsControlBackAction,
  resolveSettingsControlPanelScrollTarget,
  resolveSettingsControlSwipeAction,
} from './settingsControlNavigation'

describe('settings control navigation', () => {
  it('switches between the AI and system sibling catalogs with a deliberate horizontal swipe', () => {
    expect(resolveSettingsControlSwipeAction({
      activePanel: null,
      currentView: 'ai',
      translationX: -92,
      velocityX: -180,
    })).toEqual({ kind: 'show-view', view: 'system' })
    expect(resolveSettingsControlSwipeAction({
      activePanel: null,
      currentView: 'system',
      translationX: 92,
      velocityX: 180,
    })).toEqual({ kind: 'show-view', view: 'ai' })
  })

  it('uses Back or a right swipe to return from a system detail to its parent catalog', () => {
    expect(resolveSettingsControlBackAction('appearance')).toEqual({ kind: 'close-panel' })
    expect(resolveSettingsControlSwipeAction({
      activePanel: 'appearance',
      currentView: 'system',
      translationX: 92,
      velocityX: 180,
    })).toEqual({ kind: 'close-panel' })
  })

  it('ignores short or wrong-direction gestures and delegates Back at the catalog level', () => {
    expect(resolveSettingsControlSwipeAction({
      activePanel: null,
      currentView: 'ai',
      translationX: 24,
      velocityX: 80,
    })).toEqual({ kind: 'none' })
    expect(resolveSettingsControlBackAction(null)).toEqual({ kind: 'delegate' })
  })

  it('keeps the explicit parent return row visible when revealing a detail panel', () => {
    expect(resolveSettingsControlPanelScrollTarget(520)).toBe(456)
    expect(resolveSettingsControlPanelScrollTarget(42)).toBe(0)
  })
})
