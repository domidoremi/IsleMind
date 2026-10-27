const { assertReleaseVersionRelationship } = require('./release-version-contract')

const source = { version: '1.1.3' }
const app = { expo: { version: '1.1.3', android: { versionCode: 128 } } }
const previousCandidate = {
  versionName: '1.1.2',
  versionCode: 127,
  status: 'prerelease-qualification',
  assets: [],
  publishedAt: null,
}

test('a source-only release keeps the previous asset-free APK candidate identity', () => {
  expect(assertReleaseVersionRelationship(source, app, previousCandidate)).toEqual({
    sourceVersion: '1.1.3',
    sourceBuild: 128,
    apkVersion: '1.1.2',
    apkBuild: 127,
    isCurrentBuild: false,
  })
})

test('a current APK candidate must match both source version and build', () => {
  expect(assertReleaseVersionRelationship(source, app, {
    ...previousCandidate,
    versionName: '1.1.3',
    versionCode: 128,
  }).isCurrentBuild).toBe(true)
})

test('published APK metadata retains the same version ordering rules', () => {
  expect(assertReleaseVersionRelationship(source, app, {
    ...previousCandidate,
    status: 'published',
    assets: [{ name: 'previous.apk' }],
    publishedAt: '2026-10-13T00:00:00Z',
  }).isCurrentBuild).toBe(false)
})

test.each([
  ['a future version', { versionName: '1.2.0' }],
  ['an older version with the current build', { versionCode: 128 }],
  ['an older version with a future build', { versionCode: 129 }],
  ['the current version with an older build', { versionName: '1.1.3' }],
  ['the current version with a future build', { versionName: '1.1.3', versionCode: 129 }],
  ['advertised qualification assets', { assets: [{ name: 'unavailable.apk' }] }],
  ['an invented publication date', { publishedAt: '2026-10-26T00:00:00Z' }],
  ['missing qualification assets', { assets: undefined }],
  ['missing qualification publication state', { publishedAt: undefined }],
  ['a zero build', { versionCode: 0 }],
  ['a fractional build', { versionCode: 127.5 }],
  ['a string build', { versionCode: '127' }],
  ['a malformed version', { versionName: '1.1.invalid' }],
  ['an incomplete version', { versionName: '1.1' }],
  ['a noncanonical version', { versionName: '01.1.2' }],
  ['an unsafe version component', { versionName: '1.1.9007199254740992' }],
])('rejects %s rather than treating mismatched metadata as a source-only release', (_, patch) => {
  expect(() => assertReleaseVersionRelationship(source, app, { ...previousCandidate, ...patch })).toThrow()
})

test.each([
  ['a mismatched Expo version', { expo: { version: '1.1.2', android: { versionCode: 128 } } }],
  ['a missing source build', { expo: { version: '1.1.3' } }],
  ['an invalid source build', { expo: { version: '1.1.3', android: { versionCode: 0 } } }],
])('rejects %s', (_, invalidApp) => {
  expect(() => assertReleaseVersionRelationship(source, invalidApp, previousCandidate)).toThrow()
})
