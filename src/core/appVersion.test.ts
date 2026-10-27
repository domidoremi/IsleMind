import { compareAppVersions, mergeAppReleaseNotes, parseAppVersion } from './appVersion'

it.each([
  ['v1', '1.0.0', 0],
  ['1.2', '1.2.0', 0],
  ['1.9.0', '1.10.0', -1],
  ['1.2.9', '1.2.10', -1],
  ['2.0.0', '1.99.99', 1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0-alpha.2', '1.0.0-alpha.10', -1],
  ['1.0.0-beta.9', '1.0.0-beta.a', -1],
  ['1.0.0-rc.1', '1.0.0', -1],
  ['1.0.0+build.1', '1.0.0+build.2', 0],
  ['1.0.0-99999999999999999999', '1.0.0-100000000000000000000', -1],
] as const)('compares %s and %s with version precedence', (left, right, expected) => {
  expect(compareAppVersions(left, right)).toBe(expected)
  expect(compareAppVersions(right, left)).toBe(expected === 0 ? 0 : -expected)
})

it.each(['', 'version 1.2.3', '1.2.3.4', '1.02.3', '1.0.0-01', '1.0.0-', '9007199254740992.0.0'])(
  'does not accept malformed version %j',
  (version) => {
    expect(parseAppVersion(version)).toBeUndefined()
    expect(() => compareAppVersions(version, '1.0.0')).toThrow(TypeError)
  },
)

it('merges exactly (installed, target], numerically ordered, skipping absent and invalid notes', () => {
  const entries = [
    { version: 'v1.10.0', notes: '- latest' },
    { version: '1.9.0', notes: '  - intermediate  ' },
    { version: '1.11.0', notes: '- future' },
    { version: '1.8.0', notes: '- installed' },
    { version: '1.9.1', notes: '  ' },
    { version: 'not a version', notes: '- invalid' },
    { version: '1.7.0', notes: '- older' },
  ]
  expect(mergeAppReleaseNotes('1.8.0', 'v1.10.0', entries)).toEqual([
    { version: '1.9.0', notes: '- intermediate' },
    { version: '1.10.0', notes: '- latest' },
  ])
  expect(entries[1].notes).toBe('  - intermediate  ')
  expect(mergeAppReleaseNotes('1.10.0', '1.10.0', entries)).toEqual([])
  expect(mergeAppReleaseNotes('1.9.0', '1.10.0', entries)).toEqual([{ version: '1.10.0', notes: '- latest' }])
})

it('combines distinct notes for equivalent version labels without duplicating paragraphs', () => {
  const notes = 'first paragraph\n\nsecond paragraph'
  expect(mergeAppReleaseNotes('v1', 'v3', [
    { version: 'v3', notes: 'c' },
    { version: '2.0.0', versionCode: 3, notes: 'b' },
    { version: 'v2', versionCode: 2, notes },
    { version: '2.0', versionCode: 2, notes },
  ])).toEqual([
    { version: '2', versionCode: 2, notes: `${notes}\n\nb` },
    { version: '3', notes: 'c' },
  ])
})
