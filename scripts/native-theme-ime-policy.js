const assert = require('node:assert/strict')

function isNativeInputViewShown(dump) {
  return /mInputShown=true\b/.test(dump)
    && /mInputViewStarted=true\b/.test(dump)
    && /mIsInputViewShown=true\b/.test(dump)
}

function validateSystemImeControl(control, device, inputMethod, now = Date.now()) {
  assert.equal(control?.device, device, 'IME control must use the same device')
  assert.equal(control?.inputMethod, inputMethod, 'IME control must use the unchanged input method')
  assert.equal(control?.controlPackage, 'com.android.settings', 'IME control must be outside the application')
  assert.equal(control?.inputMethodUnchanged, true)
  assert.equal(control?.nightModeRestored, true)
  assert.equal(control?.noTextEntered, true)
  const recordedAt = Date.parse(control?.recordedAt)
  assert.ok(Number.isFinite(recordedAt) && recordedAt <= now && now - recordedAt <= 30 * 60 * 1000,
    'IME control must be a recent, completed native observation')
  assert.equal(control?.states?.length, 4, 'Both native system transitions must be observed')
  for (const mode of ['light', 'dark']) {
    const before = control.states.filter(state => state.id === `before-${mode}`)
    const after = control.states.filter(state => state.id === `system-${mode}`)
    assert.equal(before.length, 1)
    assert.equal(after.length, 1)
    for (const key of ['fieldPresent', 'focused', 'inputShown', 'inputViewShown', 'inputViewStarted', 'showRequested']) {
      assert.equal(before[0][key], true, 'The native control must start with a visible, focused software keyboard')
    }
    for (const key of ['inputShown', 'inputViewStarted', 'showRequested']) {
      assert.equal(after[0][key], false, 'The native control must reproduce the system keyboard closure')
    }
  }
  return { inputMethod, controlPackage: control.controlPackage, recordedAt: control.recordedAt }
}

module.exports = { isNativeInputViewShown, validateSystemImeControl }
