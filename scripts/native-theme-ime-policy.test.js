const assert = require('node:assert/strict')
const { test } = require('node:test')
const { isNativeInputViewShown, validateSystemImeControl } = require('./native-theme-ime-policy')

const now = Date.parse('2026-11-01T12:00:00.000Z')
function control() {
  return {
    device: 'test-device',
    inputMethod: 'test.ime/.Service',
    controlPackage: 'com.android.settings',
    recordedAt: new Date(now - 1000).toISOString(),
    inputMethodUnchanged: true,
    nightModeRestored: true,
    noTextEntered: true,
    states: ['light', 'dark'].flatMap(mode => [
      { id: `before-${mode}`, fieldPresent: true, focused: true, inputShown: true,
        inputViewShown: true, inputViewStarted: true, showRequested: true },
      { id: `system-${mode}`, fieldPresent: false, focused: false, inputShown: false,
        inputViewShown: false, inputViewStarted: false, showRequested: false },
    ]),
  }
}
const validate = value => validateSystemImeControl(value, 'test-device', 'test.ime/.Service', now)

test('requires a started and visible keyboard, not a stale input-method request', () => {
  assert.equal(isNativeInputViewShown('mInputShown=true mInputViewStarted=true mIsInputViewShown=true'), true)
  assert.equal(isNativeInputViewShown('mInputShown=true mInputViewStarted=false mIsInputViewShown=false'), false)
  assert.equal(isNativeInputViewShown('mInputShown=false mInputViewStarted=false mIsInputViewShown=true'), false)
})

test('accepts only a completed outside-app observation with the same native input method', () => {
  assert.equal(validate(control()).controlPackage, 'com.android.settings')
})

for (const [name, mutate] of [
  ['other device', value => { value.device = 'another-device' }],
  ['changed keyboard', value => { value.inputMethod = 'another.ime/.Service' }],
  ['application-only observation', value => { value.controlPackage = 'com.islemind.app' }],
  ['stale observation', value => { value.recordedAt = new Date(now - 31 * 60 * 1000).toISOString() }],
  ['incomplete transitions', value => { value.states.pop() }],
  ['keyboard never shown', value => { value.states[0].inputViewShown = false }],
  ['system did not close keyboard', value => { value.states[1].inputShown = true }],
  ['unrestored system preference', value => { value.nightModeRestored = false }],
  ['text entered in control', value => { value.noTextEntered = false }],
]) {
  test(`rejects ${name}`, () => {
    const value = control()
    mutate(value)
    assert.throws(() => validate(value))
  })
}
