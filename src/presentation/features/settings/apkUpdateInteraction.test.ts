import {
  beginManualApkUpdateCheck,
  claimAutomaticApkUpdatePrompt,
  clearAutomaticApkUpdatePromptSession,
  markApkUpdatePromptHandled,
} from './apkUpdateInteraction'

const installed = { appVersion: '1.1.2', buildVersion: '127' }
const target = { version: '1.1.3', versionCode: 128 }
beforeEach(clearAutomaticApkUpdatePromptSession)
afterEach(clearAutomaticApkUpdatePromptSession)

it('gives a manual check ownership and cancels a queued automatic duplicate without ignoring the target', () => {
  const automatic = new AbortController()
  expect(claimAutomaticApkUpdatePrompt(installed, target, automatic)).toBeDefined()
  const finish = beginManualApkUpdateCheck()
  expect(automatic.signal.aborted).toBe(true)
  expect(claimAutomaticApkUpdatePrompt(installed, target, new AbortController())).toBeUndefined()
  finish()
  finish()
  expect(claimAutomaticApkUpdatePrompt(installed, target, new AbortController())).toBeDefined()
})

it('does not enqueue two automatic confirmations at the same time', () => {
  const release = claimAutomaticApkUpdatePrompt(installed, target, new AbortController())!
  expect(claimAutomaticApkUpdatePrompt(installed, target, new AbortController())).toBeUndefined()
  release()
  expect(claimAutomaticApkUpdatePrompt(installed, target, new AbortController())).toBeDefined()
})

it('does not duplicate a handled manual or automatic target, but admits a higher target and a new installed baseline', () => {
  markApkUpdatePromptHandled(installed, target)
  expect(claimAutomaticApkUpdatePrompt(installed, { ...target, version: 'v1.1.3' }, new AbortController())).toBeUndefined()
  claimAutomaticApkUpdatePrompt(installed, { ...target, versionCode: 129 }, new AbortController())!()
  claimAutomaticApkUpdatePrompt(installed, { version: '1.1.4', versionCode: 129 }, new AbortController())!()
  expect(claimAutomaticApkUpdatePrompt({ ...installed, buildVersion: '128' }, target, new AbortController())).toBeDefined()
})

it('resets only transient prompt ownership at app teardown', () => {
  markApkUpdatePromptHandled(installed, target)
  const higher = new AbortController()
  claimAutomaticApkUpdatePrompt(installed, { version: '1.1.4', versionCode: 129 }, higher)
  clearAutomaticApkUpdatePromptSession()
  expect(higher.signal.aborted).toBe(true)
  expect(claimAutomaticApkUpdatePrompt(installed, target, new AbortController())).toBeDefined()
})
