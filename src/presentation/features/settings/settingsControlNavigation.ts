export type SettingsControlView = 'ai' | 'system'
export type SettingsControlPanel =
  | 'appearance'
  | 'data'
  | 'advanced'
  | 'diagnostics'
  | 'governance'
  | 'updates'
  | 'danger'

export type SettingsControlNavigationAction =
  | { kind: 'none' }
  | { kind: 'delegate' }
  | { kind: 'close-panel' }
  | { kind: 'show-view'; view: SettingsControlView }

const SETTINGS_SWIPE_DISTANCE = 64
const SETTINGS_SWIPE_VELOCITY = 560
const SETTINGS_DETAIL_BACK_ROW_REVEAL_OFFSET = 64

export function resolveSettingsControlPanelScrollTarget(panelY: number): number {
  return Math.max(0, panelY - SETTINGS_DETAIL_BACK_ROW_REVEAL_OFFSET)
}

export function resolveSettingsControlBackAction(
  activePanel: SettingsControlPanel | null,
): SettingsControlNavigationAction {
  return activePanel ? { kind: 'close-panel' } : { kind: 'delegate' }
}

export function resolveSettingsControlSwipeAction(input: {
  activePanel: SettingsControlPanel | null
  currentView: SettingsControlView
  translationX: number
  velocityX: number
}): SettingsControlNavigationAction {
  const direction = resolveHorizontalDirection(input.translationX, input.velocityX)
  if (direction === 0) return { kind: 'none' }
  if (input.activePanel) {
    return direction > 0 ? { kind: 'close-panel' } : { kind: 'none' }
  }
  if (input.currentView === 'ai' && direction < 0) {
    return { kind: 'show-view', view: 'system' }
  }
  if (input.currentView === 'system' && direction > 0) {
    return { kind: 'show-view', view: 'ai' }
  }
  return { kind: 'none' }
}

function resolveHorizontalDirection(translationX: number, velocityX: number): -1 | 0 | 1 {
  if (Math.abs(translationX) >= SETTINGS_SWIPE_DISTANCE) return translationX > 0 ? 1 : -1
  if (Math.abs(velocityX) >= SETTINGS_SWIPE_VELOCITY) return velocityX > 0 ? 1 : -1
  return 0
}
