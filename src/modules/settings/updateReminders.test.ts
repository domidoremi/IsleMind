import type { Settings } from '@/types/settingsContracts'
import {
  createApkUpdateIgnoreState,
  normalizeApkUpdateIgnoreState,
  normalizeSettingsUpdateReminders,
  reconcileApkUpdateIgnoreState,
  shouldPromptApkUpdate,
} from './updateReminders'

const installed = { appVersion: '1.1.2', buildVersion: '127' }
const target = { version: '1.1.3', versionCode: 128 }
const ignored = createApkUpdateIgnoreState(installed, target)!

it('persists an ignore bound to the installed version and target build', () => {
  expect(ignored).toEqual({
    installedVersion: '1.1.2', installedBuildVersion: '127',
    targetVersion: '1.1.3', targetVersionCode: 128,
  })
  const restored = JSON.parse(JSON.stringify({ ignoredApkUpdate: ignored }))
  expect(shouldPromptApkUpdate(restored, installed, target)).toBe(false)
  expect(shouldPromptApkUpdate(restored, installed, { version: '1.1.4', versionCode: 129 })).toBe(true)
  expect(shouldPromptApkUpdate(restored, installed, { ...target, versionCode: 129 })).toBe(true)
  expect(shouldPromptApkUpdate(restored, installed, { ...target, version: 'v1.1.3' })).toBe(false)
})

it('keeps global suppression independent of a per-version ignore', () => {
  expect(shouldPromptApkUpdate({ neverRemindUpdates: true }, installed, target)).toBe(false)
  expect(shouldPromptApkUpdate({ neverRemindUpdates: false }, installed, target)).toBe(true)
  expect(shouldPromptApkUpdate({ neverRemindUpdates: true, ignoredApkUpdate: ignored },
    installed, { version: '1.2.0', versionCode: 130 })).toBe(false)
  expect(shouldPromptApkUpdate({ neverRemindUpdates: false, ignoredApkUpdate: ignored }, installed, target)).toBe(false)
  expect(shouldPromptApkUpdate({ neverRemindUpdates: false, ignoredApkUpdate: ignored },
    installed, { version: '1.2.0', versionCode: 130 })).toBe(true)
})

it('expires an ignore only when installed metadata changes, including build-only upgrades', () => {
  expect(reconcileApkUpdateIgnoreState(ignored, installed)).toEqual(ignored)
  expect(reconcileApkUpdateIgnoreState(ignored, { appVersion: 'v1.1.2', buildVersion: '127' })).toEqual(ignored)
  expect(reconcileApkUpdateIgnoreState(ignored, { appVersion: target.version, buildVersion: '128' })).toBeUndefined()
  expect(reconcileApkUpdateIgnoreState(ignored, { ...installed, buildVersion: '128' })).toBeUndefined()
  expect(shouldPromptApkUpdate({ ignoredApkUpdate: ignored }, { appVersion: '1.1.3', buildVersion: '128' }, target)).toBe(false)
  expect(shouldPromptApkUpdate({ ignoredApkUpdate: ignored }, { appVersion: '1.1.3', buildVersion: '128' },
    { version: '1.1.4', versionCode: 129 })).toBe(true)
  expect(reconcileApkUpdateIgnoreState({ ...ignored, targetVersion: '1.1.2', targetVersionCode: 127 }, installed)).toBeUndefined()
})

it('rejects non-updates using Android build precedence and numeric version fallback', () => {
  expect(shouldPromptApkUpdate({}, installed, { version: '9.0.0', versionCode: 126 })).toBe(false)
  expect(shouldPromptApkUpdate({}, installed, { version: '1.0.0', versionCode: 128 })).toBe(true)
  expect(shouldPromptApkUpdate({}, { appVersion: '1.9', buildVersion: '' }, { version: '1.10' })).toBe(true)
  expect(shouldPromptApkUpdate({}, { appVersion: '1.10', buildVersion: '' }, { version: '1.9' })).toBe(false)
  expect(shouldPromptApkUpdate({}, installed, { version: 'invalid' })).toBe(false)
})

it.each([null, [], {}, { ...ignored, targetVersion: 'garbage' }, { ...ignored, targetVersionCode: '128' },
  { ...ignored, targetVersionCode: 0 }, { ...ignored, targetVersionCode: NaN },
  { ...ignored, installedBuildVersion: '' }])('discards malformed persisted ignore %j', (value) => {
  expect(normalizeApkUpdateIgnoreState(value)).toBeUndefined()
})

it('normalizes persisted reminder fields without changing unrelated settings', () => {
  const settings = { language: 'ja', neverRemindUpdates: true, ignoredApkUpdate: ignored } as Settings
  expect(normalizeSettingsUpdateReminders(settings)).toBe(settings)
  expect(normalizeSettingsUpdateReminders({ ...settings, neverRemindUpdates: 'false',
    ignoredApkUpdate: { version: '1.1.3' } } as unknown as Settings)).toEqual({
    language: 'ja', neverRemindUpdates: false, ignoredApkUpdate: undefined,
  })
})
