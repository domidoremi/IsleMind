import { createSettingsTaskNavigationState } from './settingsTaskNavigationState'

it('retains the current task area without publishing duplicate selections', () => {
  const state = createSettingsTaskNavigationState()
  const listener = jest.fn()
  const release = state.subscribe(listener)
  expect(state.getSnapshot()).toBe('everyday')
  state.select('capabilities')
  state.select('capabilities')
  expect(state.getSnapshot()).toBe('capabilities')
  expect(listener).toHaveBeenCalledTimes(1)
  release()
  state.select('manage')
  expect(listener).toHaveBeenCalledTimes(1)
})

it('keeps separate navigation scopes independent', () => {
  const first = createSettingsTaskNavigationState()
  const second = createSettingsTaskNavigationState()
  first.select('support')
  expect(second.getSnapshot()).toBe('everyday')
})
