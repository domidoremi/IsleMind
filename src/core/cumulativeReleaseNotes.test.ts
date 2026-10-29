import type { AppReleaseNotes } from './appVersion'
import { collectCumulativeReleaseNotes, selectReleaseNotesRange } from './cumulativeReleaseNotes'

function collect(entries: readonly AppReleaseNotes[], patch: Partial<Parameters<typeof collectCumulativeReleaseNotes>[0]> = {}) {
  return collectCumulativeReleaseNotes({
    installed: { version: '1.0.0' }, target: { version: '2.0.0' }, language: 'en', complete: true, entries, ...patch,
  })
}

it('counts forty actual releases and fifty changes without subtracting version numbers', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    sourceId: `github:release:${index}`,
    version: `0.1.${1687 + index + (index > 20 ? 2 : 0)}`,
    notes: index < 7 ? `### New features\n- Feature ${index}`
      : index < 24 ? `### Improvements\n- Improvement ${index}`
        : index < 39 ? `### Bug fixes\n- Fix ${index}` : '### Privacy\n- Privacy',
  }))
  entries[0].notes += '\n### Bug fixes\n' + Array.from({ length: 10 }, (_, index) => `- Extra fix ${index}`).join('\n')
  const before = JSON.stringify(entries)
  const result = collect(entries.reverse(), { installed: { version: '0.1.1686' }, target: { version: '0.1.1728' } })
  expect(result).toMatchObject({ releaseCount: 40, changeCount: 50, firstVersion: '0.1.1687', lastVersion: '0.1.1728', complete: true })
  expect(result.groups.map((group) => [group.category, group.items.length])).toEqual([
    ['features', 7], ['improvements', 17], ['fixes', 25], ['privacy', 1],
  ])
  expect(result.groups[0].items[0]).toMatchObject({ version: '0.1.1693', sourceId: 'github:release:6' })
  expect(result.groups[2].items[0].version).toBe('0.1.1727')
  expect(new Set(result.groups.flatMap((group) => group.items.map((item) => item.id))).size).toBe(50)
  expect(JSON.stringify([...entries].reverse())).toBe(before)
})

it('uses stable provenance, not similar or repeated prose, as the duplicate identity', () => {
  const result = collect([
    { sourceId: 'a', version: 'v1.1', notes: '### New features\n- Same\n- Same' },
    { sourceId: 'a', version: '1.1.0', notes: '### New features\n- Same\n- Same' },
    { sourceId: 'b', version: '1.1.0', notes: '### New features\n- Same' },
    { sourceId: 'c', version: '2.0.0', notes: '### New features\n- Same' },
  ])
  expect(result.releaseCount).toBe(3)
  expect(result.changeCount).toBe(4)
  expect(result.groups[0].items.map((item) => item.sourceId)).toEqual(['c', 'b', 'a', 'a'])
})

it('normalizes equivalent legacy aliases without conflating different builds', () => {
  const result = collect([
    { version: 'v1.1', versionCode: 2, notes: '- same' },
    { version: '1.1.0+build.2', versionCode: 2, notes: '- same' },
    { version: '1.1', versionCode: 3, notes: '- rebuilt' },
    { version: '2.0.0', versionCode: 4, notes: '- target' },
  ], { installed: { version: '1.0.0', versionCode: 1 }, target: { version: '2.0.0', versionCode: 4 } })
  expect(result.releaseCount).toBe(3)
  expect(result.changeCount).toBe(3)
})

it('keeps conflicting snapshots visible and discloses incomplete history', () => {
  const entries = [
    { sourceId: 'a', version: '2.0.0', notes: '### New features\n- first' },
    { sourceId: 'a', version: '2.0.0', notes: '### Bug fixes\n- revised' },
  ]
  const result = collect(entries)
  expect(result).toMatchObject({ releaseCount: 1, changeCount: 2, complete: false })
  expect(collect([...entries].reverse())).toEqual(result)
})

const multilingual = `# App 2.0.0
<details open><summary>\u7b80\u4f53\u4e2d\u6587</summary>
### \u65b0\u529f\u80fd
- \u4e2d\u6587\u529f\u80fd
### \u9519\u8bef\u4fee\u590d
- \u4e2d\u6587\u4fee\u590d
</details>
<details><summary>English</summary>
### New features
- English feature
### Bug fixes
- English fix
</details>
<details><summary>\u65e5\u672c\u8a9e</summary>
### \u65b0\u6a5f\u80fd
- Japanese feature
### \u4e0d\u5177\u5408\u4fee\u6b63
- Japanese fix
</details>`

it.each([
  ['zh-CN', '\u4e2d\u6587\u529f\u80fd', '\u4e2d\u6587\u4fee\u590d'],
  ['en-US', 'English feature', 'English fix'],
  ['ja', 'Japanese feature', 'Japanese fix'],
])('selects %s before parsing categories or counting changes', (language, feature, fix) => {
  const result = collect([{ version: '2.0.0', notes: multilingual }], { language })
  expect(result).toMatchObject({ releaseCount: 1, changeCount: 2, complete: true, fallbackVersions: [] })
  expect(result.groups.map((group) => group.items[0].text)).toEqual([`- ${feature}`, `- ${fix}`])
})

it('discloses language fallback and preserves content outside language blocks', () => {
  const result = collect([{ version: '2.0.0', notes: `Global notice\n<details><summary>English</summary>### Privacy\n- Local control</details>` }], { language: 'ja' })
  expect(result.fallbackVersions).toEqual(['2.0.0'])
  expect(result.groups.map((group) => group.category)).toEqual(['privacy', 'other'])
  expect(result.groups[1].items[0].text).toBe('Global notice')
})

it('preserves unclassified paragraphs, nested lists, issue links, and code without adding fake changes', () => {
  const nested = '- Main change\n  - Nested detail\n\n  More detail\n  ```text\n  - not a change\n  ```'
  const result = collect([{ version: '2.0.0', notes: `Intro\n\n**New features 1**\n${nested}\n\n### Bug fixes\n- Fix [#3766](https://github.com/example/repo/issues/3766)\n\nSource only; no installer.\n\n### Other information\nKeep this notice.` }])
  expect(result.changeCount).toBe(5)
  expect(result.groups[0].items[0].text).toBe(nested)
  expect(result.groups[1].items[0].text).toContain('[#3766](https://github.com/example/repo/issues/3766)')
  expect(result.groups[2].items.map((item) => item.text)).toEqual(['Intro', 'Source only; no installer.', '### Other information\nKeep this notice.'])
})

it('does not clip long bodies or manufacture notes for empty releases', () => {
  const long = '- ' + 'detail '.repeat(30_000)
  const result = collect([
    { sourceId: 'blank', version: '1.5.0', notes: '' },
    { version: '2.0.0', notes: `### Improvements\n${long}` },
  ])
  expect(result).toMatchObject({ releaseCount: 2, changeCount: 1, complete: false, missingVersions: ['1.5.0'] })
  expect(result.groups[0].items[0].text).toBe(long.trim())
})

it('does not claim complete history when the target record is missing', () => {
  expect(collect([{ version: '1.5.0', notes: '- intermediate' }]).complete).toBe(false)
  expect(collect([{ version: '2.0.0', notes: '- target' }], { complete: false }).complete).toBe(false)
  expect(collect([{ version: '2.0.0', notes: '- target' }], { complete: undefined }).complete).toBe(false)
})

it('selects exactly (applied, target], including same-version rebuilds and excluding later source versions', () => {
  const entries = [
    { version: '1.1.0', versionCode: 10, notes: '- installed' },
    { version: '1.1.0', versionCode: 11, notes: '- rebuild' },
    { version: '1.2.0', versionCode: 12, notes: '- delivered' },
    { version: '1.3.0', versionCode: 13, notes: '- source-only future' },
  ]
  const result = collect(entries, {
    installed: { version: '1.1.0', versionCode: 10 }, target: { version: '1.2.0', versionCode: 12 },
  })
  expect(result.groups[0].items.map((item) => item.text)).toEqual(['- delivered', '- rebuild'])
  expect(result.releaseCount).toBe(2)
  expect(entries[1].version).toBe('1.1.0')
})

it('includes intermediate source-only versions with held build codes but excludes future source-only versions', () => {
  const result = collect([
    { version: '1.1.0', versionCode: 10, notes: '- Applied' },
    { version: '1.2.0', versionCode: 10, notes: '- Intermediate source-only change' },
    { version: '1.3.0', versionCode: 11, notes: '- Selected APK' },
    { version: '1.4.0', versionCode: 11, notes: '- Future source-only change' },
    { version: '1.2.0', versionCode: 12, notes: '- Future rebuild' },
  ], { installed: { version: '1.1.0', versionCode: 10 }, target: { version: '1.3.0', versionCode: 11 } })
  expect(result).toMatchObject({ releaseCount: 2, changeCount: 2, complete: true })
  expect(result.groups[0].items.map(item => item.text)).toEqual(['- Selected APK', '- Intermediate source-only change'])
})

it('rejects invalid version boundaries and ignores malformed records without throwing', () => {
  expect(collect([], { installed: { version: 'not a version' } })).toMatchObject({ releaseCount: 0, complete: false })
  expect(selectReleaseNotesRange({ version: '1' }, { version: '2' }, [
    null, { version: 'invalid', notes: 'bad' }, { version: '2', notes: null },
  ] as unknown as AppReleaseNotes[])).toEqual([{ version: '2.0.0', notes: '' }])
})
