const {
  createReleasePlan, classifyReleasePlanFile, assertReleasePlanPath,
  INPUT_SCHEMA, POLICY_SCHEMA, RECORD_SCHEMA, STATE_SCHEMA,
} = require('./release-plan-contract')

const NOW = Date.UTC(2026, 9, 27)
const RUNTIME = `sha256:${'a'.repeat(64)}`
const policy = {
  schema: POLICY_SCHEMA, routineMinimumIntervalMs: 86400_000, routineMaximumAgeMs: 7 * 86400_000,
  routineMinimumChanges: 5, maximumPendingChanges: 50, otaEnabled: false,
}
function record(id, patch = {}) {
  return {
    schema: RECORD_SCHEMA, id, createdAtMs: NOW - 60_000, audience: 'user', priority: 'routine',
    delivery: 'ota-compatible', category: 'improvements', platforms: ['android'],
    files: ['src/example.ts'], texts: { en: 'A real change.' }, ...patch,
  }
}
function input(count = 1) {
  return {
    schema: INPUT_SCHEMA, repository: 'example/IsleMind', channel: 'stable', nowMs: NOW,
    source: {
      baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40), treeIdentity: `git:${'c'.repeat(40)}`,
      clean: true, sourceVersion: '1.1.4', nativeBuildVersion: 129,
      runtimeVersion: RUNTIME, baseRuntimeVersion: RUNTIME, otaRuntimeReady: false,
      uiSourceCommit: 'd'.repeat(40), uiClean: true,
    },
    files: [{ path: 'src/example.ts', status: 'M' }],
    records: Array.from({ length: count }, (_, index) => record(`change-${index}`)),
    policy: { ...policy },
    publication: {
      schema: STATE_SCHEMA, repository: 'example/IsleMind', channel: 'stable', sourceCommit: 'a'.repeat(40),
      sourceVersion: '1.1.2', publishedAtMs: NOW - 2 * 86400_000, publishedChangeIds: [],
      runtimeVersion: RUNTIME, nativeBuildVersion: 127,
    },
  }
}

test('batches minor changes by durable IDs, not version or commit count', () => {
  const plan = createReleasePlan(input())
  expect(plan).toMatchObject({
    decision: 'accumulate', pendingChangeCount: 1, executionAllowed: false, publicationApproved: false,
    build: { nativeRequired: false, otaRequired: false },
  })
  expect(plan.requiredChecks).not.toContain('native-release-qualification')
  expect(createReleasePlan(input(5)).decision).toBe('native-candidate')
})

test('selects a native candidate without granting build or publication authority when OTA is disabled', () => {
  const plan = createReleasePlan(input(5))
  expect(plan).toMatchObject({ decision: 'native-candidate', executionAllowed: false, publicationApproved: false, build: { nativeRequired: true, otaRequired: false } })
  expect(plan.reasons).toContain('ota-runtime-not-qualified-or-enabled')
  expect(plan.requiredChecks).toContain('native-release-qualification')
})

test('does not let the threshold bypass the minimum interval', () => {
  const value = input(5)
  value.publication.publishedAtMs = NOW - 1000
  expect(createReleasePlan(value).decision).toBe('accumulate')
})

test.each(['important', 'security'])('%s changes can select a candidate early but never bypass approval', (priority) => {
  const value = input()
  value.records[0].priority = priority
  value.publication.publishedAtMs = NOW - 1000
  expect(createReleasePlan(value)).toMatchObject({ decision: 'native-candidate', executionAllowed: false, publicationApproved: false })
})

test.each(['age', 'capacity'])('bounds waiting by maximum pending %s', (kind) => {
  const value = input(kind === 'capacity' ? 50 : 1)
  value.publication.publishedAtMs = NOW - 1000
  if (kind === 'age') value.records[0].createdAtMs = NOW - 7 * 86400_000
  expect(createReleasePlan(value).decision).toBe('native-candidate')
})

test('requires both OTA enablement and qualified exact runtime evidence', () => {
  const value = input(5)
  value.policy.otaEnabled = true
  expect(createReleasePlan(value).decision).toBe('native-candidate')
  value.source.otaRuntimeReady = true
  expect(createReleasePlan(value)).toMatchObject({ decision: 'ota-candidate', build: { nativeRequired: false, otaRequired: true } })
  value.source.runtimeVersion = `sha256:${'f'.repeat(64)}`
  expect(createReleasePlan(value).decision).toBe('native-candidate')
})

test('native changes require a native declaration but can still wait in a routine batch', () => {
  const value = input()
  value.files = [{ path: 'plugins/adapter.js', status: 'M' }]
  value.records[0].files = ['plugins/adapter.js']
  expect(createReleasePlan(value).blockers).toContain('native-change-not-declared:plugins/adapter.js')
  value.records[0].delivery = 'native'
  expect(createReleasePlan(value).decision).toBe('accumulate')
  value.records[0].priority = 'important'
  expect(createReleasePlan(value).decision).toBe('native-candidate')
})

test('cannot disguise native risk by renaming it into documentation', () => {
  const value = input()
  value.files = [{ path: 'docs/adapter.md', previousPath: 'plugins/adapter.js', status: 'R' }]
  value.records[0].files = ['docs/adapter.md']
  expect(createReleasePlan(value).blockers).toContain('native-change-not-declared:docs/adapter.md')
})

test('docs, tests and declared no-delivery internal changes skip publication without inventing state', () => {
  const value = input(0)
  value.publication = null
  value.source.uiSourceCommit = null
  value.source.uiClean = false
  value.files = [{ path: 'docs/architecture/architecture.md', status: 'M' }, { path: 'src/example.test.ts', status: 'A' }]
  expect(createReleasePlan(value)).toMatchObject({ decision: 'skip', pendingChangeCount: 0 })
  value.files = [{ path: 'src/example.ts', status: 'M' }]
  value.records = [record('internal', { audience: 'internal', delivery: 'none', platforms: [], texts: {} })]
  expect(createReleasePlan(value)).toMatchObject({ decision: 'skip', deferredInternalChangeIds: ['internal'] })
})

test('standalone validation scripts and version-only changes do not become native rebuilds', () => {
  const before = { version: '1.1.3', dependencies: { 'react-native': '0.86.3' }, scripts: { postinstall: 'keep', test: 'jest' } }
  const after = { ...before, version: '1.1.4', scripts: { ...before.scripts, 'release:plan': 'node scripts/release-plan.js' } }
  const file = { path: 'package.json', status: 'M', beforeContent: JSON.stringify(before), afterContent: JSON.stringify(after) }
  expect(classifyReleasePlanFile(file)).toBe('infrastructure')
  after.dependencies = { 'react-native': '0.87.0' }
  expect(classifyReleasePlanFile({ ...file, afterContent: JSON.stringify(after) })).toBe('native')
  expect(classifyReleasePlanFile({ ...file, afterContent: JSON.stringify({ ...before, codegenConfig: { name: 'new-contract' } }) })).toBe('native')
  expect(classifyReleasePlanFile({ ...file, afterContent: 'malformed' })).toBe('native')
})

test.each([
  'install', 'prepare', 'prepublishOnly', 'eas-build-post-install', 'build:release', 'bundle', 'unknown-helper',
])('treats changed %s script as a native input rather than a validation-only edit', (name) => {
  const before = { version: '1.1.3', scripts: { [name]: 'node scripts/old.js', test: 'jest' } }
  const after = { ...before, scripts: { ...before.scripts, [name]: 'node scripts/new.js' } }
  expect(classifyReleasePlanFile({
    path: 'package.json', status: 'M', beforeContent: JSON.stringify(before), afterContent: JSON.stringify(after),
  })).toBe('native')
})

test.each(['bun run test', 'bun run native-helper', 'bun run $RUNTIME_STEP'])(
  'retains script dependencies of a runtime hook: %s', (command) => {
    const before = { scripts: { postinstall: command, 'native-helper': 'bun run test', test: 'jest' } }
    const after = { scripts: { ...before.scripts, test: 'node scripts/changed-validation.js' } }
    expect(classifyReleasePlanFile({
      path: 'package.json', status: 'M', beforeContent: JSON.stringify(before), afterContent: JSON.stringify(after),
    })).toBe('native')
  },
)

test.each([null, [], 'not-an-object', { prepare: null }])('refuses malformed script evidence %j', (scripts) => {
  expect(classifyReleasePlanFile({
    path: 'package.json', status: 'M', beforeContent: '{"scripts":{}}', afterContent: JSON.stringify({ scripts }),
  })).toBe('native')
})

test('Expo identity-only bumps preserve runtime inputs but native permissions do not', () => {
  const before = { expo: { version: '1.1.3', android: { versionCode: 128, permissions: [] } } }
  const after = { expo: { version: '1.1.4', android: { versionCode: 129, permissions: [] } } }
  const file = { path: 'app.json', status: 'M', beforeContent: JSON.stringify(before), afterContent: JSON.stringify(after) }
  expect(classifyReleasePlanFile(file)).toBe('infrastructure')
  after.expo.android.permissions.push('android.permission.INTERNET')
  expect(classifyReleasePlanFile({ ...file, afterContent: JSON.stringify(after) })).toBe('native')
})

test.each([
  ['dirty source', (value) => { value.source.clean = false }, 'source-not-clean-and-fixed'],
  ['worktree identity', (value) => { value.source.treeIdentity = `worktree:${'f'.repeat(64)}` }, 'source-not-clean-and-fixed'],
  ['missing records', (value) => { value.records = [] }, 'missing-change-record:src/example.ts'],
  ['unknown path', (value) => { value.files[0].path = 'unclassified.json'; value.records[0].files = ['unclassified.json'] }, 'unclassified-path:unclassified.json'],
  ['missing publication state', (value) => { value.publication = null }, 'publication-state-required'],
  ['wrong publication namespace', (value) => { value.publication.repository = 'other/IsleMind' }, 'publication-namespace-mismatch'],
  ['wrong base', (value) => { value.publication.sourceCommit = 'f'.repeat(40) }, 'base-is-not-last-publication-source'],
  ['future publication time', (value) => { value.publication.publishedAtMs = NOW + 1 }, 'publication-time-is-in-the-future'],
  ['future change time', (value) => { value.records[0].createdAtMs = NOW + 1 }, 'future-change:change-0'],
  ['unknown UI revision', (value) => { value.source.uiSourceCommit = null }, 'paired-ui-source-not-clean-and-fixed'],
  ['dirty paired UI', (value) => { value.source.uiClean = false }, 'paired-ui-source-not-clean-and-fixed'],
  ['stale source version', (value) => { value.source.sourceVersion = '1.1.2' }, 'source-version-not-newer-than-publication'],
  ['unbound native runtime', (value) => { value.publication.runtimeVersion = `sha256:${'f'.repeat(64)}` }, 'publication-runtime-not-bound-to-base'],
])('blocks %s instead of authorizing packaging', (_name, edit, blocker) => {
  const value = input(5)
  edit(value)
  expect(createReleasePlan(value)).toMatchObject({ decision: 'blocked', build: { nativeRequired: false, otaRequired: false } })
  expect(createReleasePlan(value).blockers).toContain(blocker)
})

test('requires a higher native build code and never mutates already-published change records', () => {
  const value = input(5)
  value.source.nativeBuildVersion = value.publication.nativeBuildVersion
  expect(createReleasePlan(value).blockers).toContain('native-build-code-not-newer-than-publication')
  value.source.nativeBuildVersion = 129
  value.publication.publishedChangeIds = ['old-change']
  value.files.push({ path: 'updates/changes/old-change.json', status: 'M' })
  expect(createReleasePlan(value).blockers).toContain('published-change-record-edited:old-change')
})

test('plans deterministically across input ordering and leave original inputs untouched', () => {
  const original = input(5)
  original.files.push({ path: 'docs/README.md', status: 'M' })
  const reversed = JSON.parse(JSON.stringify(original))
  reversed.records.reverse()
  reversed.files.reverse()
  const before = JSON.stringify(original)
  expect(createReleasePlan(original)).toEqual(createReleasePlan(reversed))
  expect(JSON.stringify(original)).toBe(before)
  const changed = JSON.parse(JSON.stringify(original))
  changed.source.headCommit = 'e'.repeat(40)
  expect(createReleasePlan(changed).planId).not.toBe(createReleasePlan(original).planId)
})

test.each([
  ['unknown schema', (value) => { value.schema = 'v2' }],
  ['duplicate IDs', (value) => { value.records.push(value.records[0]) }],
  ['duplicate paths', (value) => { value.files.push(value.files[0]) }],
  ['unknown priority', (value) => { value.records[0].priority = 'model-chosen' }],
  ['missing user text', (value) => { value.records[0].texts = {} }],
  ['unknown record fields', (value) => { value.records[0].latest = true }],
  ['unknown policy fields', (value) => { value.policy.alwaysPublish = true }],
  ['unsafe sequence bounds', (value) => { value.policy.maximumPendingChanges = Number.MAX_SAFE_INTEGER }],
  ['invalid batching bounds', (value) => { value.policy.routineMaximumAgeMs = 1 }],
  ['ambiguous source ref', (value) => { value.source.headCommit = 'main' }],
  ['unknown file status', (value) => { value.files[0].status = 'U' }],
  ['rename without origin', (value) => { value.files[0].status = 'R' }],
])('fails closed on %s', (_name, edit) => {
  const value = input()
  edit(value)
  expect(() => createReleasePlan(value)).toThrow()
})

test.each([
  'app/chat/[id].tsx', 'app/+native-intent.tsx', 'app/(tabs)/index.tsx',
  'app/[...slug].tsx', 'patches/react-native@0.86.3.patch',
])('accepts canonical router and package-patch path %s', (filename) => {
  expect(() => assertReleasePlanPath(filename)).not.toThrow()
  expect(classifyReleasePlanFile({ path: filename, status: 'M' })).toBe(
    filename.startsWith('patches/') ? 'native' : 'runtime',
  )
})

test.each([
  '../outside', 'src/../outside', '/absolute', 'C:/outside', '.git/config', '.GIT/config',
  'src/x\nfile.ts', 'src/$(command).ts', 'src\\file.ts', 'src/x;command.ts', 'src/x|command.ts',
])(
  'rejects unsafe source path %s', (filename) => expect(() => assertReleasePlanPath(filename)).toThrow(),
)
