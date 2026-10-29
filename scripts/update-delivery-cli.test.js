const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createSourceBoundReleasePlan, parseGitChanges, parseOptions, runtimeFingerprint, gitTree } = require('./release-plan')
const { runVerifyUpdateCatalog } = require('./verify-update-catalog')
const { POLICY_SCHEMA, RECORD_SCHEMA, STATE_SCHEMA } = require('./release-plan-contract')
const {
  signedCatalogFixture, updateCatalogFixture, updateCatalogTrustFixture, CATALOG_TEST_NOW_MS,
} = require('../src/core/__tests__/updateCatalogFixture')

const temporaryRoot = fs.realpathSync(os.tmpdir())
const temporaryDirectories = []
const NOW = CATALOG_TEST_NOW_MS

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'islemind-update-delivery-test-'))
  temporaryDirectories.push(directory)
  return directory
}
function fixtureGit(root, args, options = {}) {
  const relative = path.relative(temporaryRoot, path.resolve(root))
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Test Git mutations must stay inside the temporary fixture root.')
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key]
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', ...options }).trim()
}
function initializeRepository(root) {
  fs.mkdirSync(root, { recursive: true })
  fixtureGit(root, ['init', '-q', '--template='])
  fixtureGit(root, ['config', 'user.email', 'fixture@example.test'])
  fixtureGit(root, ['config', 'user.name', 'Update Test Fixture'])
  fixtureGit(root, ['config', 'commit.gpgSign', 'false'])
  fixtureGit(root, ['config', 'core.autocrlf', 'false'])
  fixtureGit(root, ['config', 'core.hooksPath', path.join(root, '.git', 'disabled-hooks')])
}
function write(root, filename, value) {
  const target = path.join(root, filename)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}
function commitFixture(root, message) {
  fixtureGit(root, ['add', '.'])
  fixtureGit(root, ['commit', '-qm', message])
  return fixtureGit(root, ['rev-parse', 'HEAD'])
}
function repositoryFixture() {
  const outer = temporaryDirectory()
  const root = path.join(outer, 'IsleMind')
  const ui = path.join(outer, 'animal-island-ui')
  initializeRepository(ui)
  write(ui, 'package.json', { name: 'test-ui' })
  const uiCommit = commitFixture(ui, 'isolated UI fixture')
  initializeRepository(root)
  fixtureGit(root, ['remote', 'add', 'origin', 'https://github.com/example/IsleMind.git'])
  write(root, 'package.json', { name: 'fixture', version: '1.1.2', dependencies: {}, scripts: {} })
  write(root, 'app.json', { expo: { version: '1.1.2', android: { versionCode: 127, package: 'com.example.fixture' } } })
  write(root, 'src/example.ts', 'export const value = 1\n')
  write(root, 'updates/release-policy.json', {
    schema: POLICY_SCHEMA, routineMinimumIntervalMs: 86400_000, routineMaximumAgeMs: 7 * 86400_000,
    routineMinimumChanges: 5, maximumPendingChanges: 50, otaEnabled: false,
  })
  const base = commitFixture(root, 'isolated base fixture')
  const runtime = runtimeFingerprint(root, base, gitTree(root, base), { commit: uiCommit, clean: true })
  const stateFile = path.join(outer, 'publication.json')
  fs.writeFileSync(stateFile, JSON.stringify({
    schema: STATE_SCHEMA, repository: 'example/IsleMind', channel: 'stable', sourceCommit: base,
    sourceVersion: '1.1.2', publishedAtMs: NOW - 86400_000, publishedChangeIds: [],
    runtimeVersion: runtime, nativeBuildVersion: 127,
  }))
  write(root, 'package.json', { name: 'fixture', version: '1.1.3', dependencies: {}, scripts: {} })
  write(root, 'app.json', { expo: { version: '1.1.3', android: { versionCode: 128, package: 'com.example.fixture' } } })
  write(root, 'src/example.ts', 'export const value = 2\n')
  write(root, 'updates/changes/example.json', {
    schema: RECORD_SCHEMA, id: 'example', createdAtMs: NOW - 1000, audience: 'user', priority: 'important',
    delivery: 'ota-compatible', category: 'improvements', platforms: ['android'], files: ['src/example.ts'], texts: { en: 'A fixture change.' },
  })
  const head = commitFixture(root, 'isolated source fixture')
  return { outer, root, ui, base, head, stateFile }
}

afterEach(() => {
  jest.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = fs.realpathSync(directory)
    if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('islemind-update-delivery-test-')) {
      throw new Error('Refusing recursive cleanup outside the explicitly created test directory.')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})

test('the source-bound CLI produces deterministic candidates without changing repositories or publication state', () => {
  const fixture = repositoryFixture()
  const args = ['--base', fixture.base, '--head', fixture.head, '--state', fixture.stateFile]
  const before = {
    head: fixtureGit(fixture.root, ['rev-parse', 'HEAD']),
    status: fixtureGit(fixture.root, ['status', '--porcelain=v1']),
    refs: fixtureGit(fixture.root, ['show-ref']),
    index: fs.readFileSync(path.join(fixture.root, '.git', 'index')),
    publication: fs.readFileSync(fixture.stateFile),
    uiHead: fixtureGit(fixture.ui, ['rev-parse', 'HEAD']),
  }
  const first = createSourceBoundReleasePlan(args, { root: fixture.root, nowMs: NOW })
  expect(first).toMatchObject({ decision: 'native-candidate', executionAllowed: false, publicationApproved: false, pendingChangeIds: ['example'] })
  expect(first.source.runtimeVersion).toBe(first.source.baseRuntimeVersion)
  expect(createSourceBoundReleasePlan(args, { root: fixture.root, nowMs: NOW })).toEqual(first)
  expect(fixtureGit(fixture.root, ['rev-parse', 'HEAD'])).toBe(before.head)
  expect(fixtureGit(fixture.root, ['status', '--porcelain=v1'])).toBe(before.status)
  expect(fixtureGit(fixture.root, ['show-ref'])).toBe(before.refs)
  expect(fs.readFileSync(path.join(fixture.root, '.git', 'index'))).toEqual(before.index)
  expect(fs.readFileSync(fixture.stateFile)).toEqual(before.publication)
  expect(fixtureGit(fixture.ui, ['rev-parse', 'HEAD'])).toBe(before.uiHead)
})

test('a dirty preview remains blocked and records exact byte identity rather than lossy text decoding', () => {
  const fixture = repositoryFixture()
  write(fixture.root, 'assets/binary.dat', 'placeholder')
  fs.writeFileSync(path.join(fixture.root, 'assets/binary.dat'), Buffer.from([0xff]))
  const args = ['--worktree', '--base', fixture.base, '--state', fixture.stateFile]
  const first = createSourceBoundReleasePlan(args, { root: fixture.root, nowMs: NOW })
  expect(first).toMatchObject({ decision: 'blocked', build: { nativeRequired: false, otaRequired: false } })
  expect(first.source.treeIdentity).toMatch(/^worktree:/)
  fs.writeFileSync(path.join(fixture.root, 'assets/binary.dat'), Buffer.from([0xfe]))
  const second = createSourceBoundReleasePlan(args, { root: fixture.root, nowMs: NOW })
  expect(second.source.treeIdentity).not.toBe(first.source.treeIdentity)
})

test('plans real router and package-patch names from immutable Git trees and dirty previews', () => {
  const fixture = repositoryFixture()
  const filenames = ['app/(tabs)/[...slug].tsx', 'app/+native-intent.tsx', 'patches/example@1.0.0.patch']
  for (const filename of filenames) write(fixture.root, filename, 'fixture source\n')
  write(fixture.root, 'updates/changes/router-fixture.json', {
    schema: RECORD_SCHEMA, id: 'router-fixture', createdAtMs: NOW - 1000, audience: 'user', priority: 'important',
    delivery: 'native', category: 'improvements', platforms: ['android'], files: filenames, texts: { en: 'A router fixture.' },
  })
  const head = commitFixture(fixture.root, 'isolated router and patch fixture')
  const plan = createSourceBoundReleasePlan(['--base', fixture.base, '--head', head, '--state', fixture.stateFile],
    { root: fixture.root, nowMs: NOW })
  expect(plan).toMatchObject({ decision: 'native-candidate', executionAllowed: false, publicationApproved: false })
  expect(plan.source.runtimeVersion).not.toBe(plan.source.baseRuntimeVersion)
  write(fixture.root, filenames[0], 'changed fixture source\n')
  expect(createSourceBoundReleasePlan(['--worktree', '--base', fixture.base, '--state', fixture.stateFile],
    { root: fixture.root, nowMs: NOW })).toMatchObject({
    decision: 'blocked', executionAllowed: false, build: { nativeRequired: false, otaRequired: false },
  })
})

test('detects a source change during input capture instead of returning a clean candidate', () => {
  const fixture = repositoryFixture()
  const read = fs.readFileSync
  let changed = false
  jest.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) => {
    const value = read(filename, ...args)
    if (!changed && filename === fixture.stateFile) {
      changed = true
      write(fixture.root, 'src/example.ts', 'export const value = 3\n')
    }
    return value
  })
  expect(() => createSourceBoundReleasePlan(['--base', fixture.base, '--head', fixture.head, '--state', fixture.stateFile],
    { root: fixture.root, nowMs: NOW })).toThrow(/changed during planning/)
})

test('rejects symlink Git entries without following or reading their targets', () => {
  const fixture = repositoryFixture()
  const object = fixtureGit(fixture.root, ['hash-object', '-w', '--stdin'], { input: '../outside' })
  fixtureGit(fixture.root, ['update-index', '--add', '--cacheinfo', `120000,${object},plugins/escape.js`])
  fixtureGit(fixture.root, ['commit', '-qm', 'isolated symlink metadata fixture'])
  const head = fixtureGit(fixture.root, ['rev-parse', 'HEAD'])
  expect(() => gitTree(fixture.root, head)).toThrow(/symlinks/)
})

test('refuses unknown or changed publication baselines and never infers release history from versions', () => {
  const fixture = repositoryFixture()
  const withoutState = createSourceBoundReleasePlan(['--base', fixture.base, '--head', fixture.head], { root: fixture.root, nowMs: NOW })
  expect(withoutState.blockers).toContain('publication-state-required')
  expect(withoutState.build.nativeRequired).toBe(false)
  expect(() => createSourceBoundReleasePlan(['--base', 'f'.repeat(40)], { root: fixture.root, nowMs: NOW })).toThrow()
})

test('parses NUL-delimited rename paths and refuses shell/ref/traversal substitutions', () => {
  expect(parseGitChanges('R100\0src/old.ts\0src/new.ts\0M\0src/next.ts\0')).toEqual([
    { status: 'R', path: 'src/new.ts', previousPath: 'src/old.ts' }, { status: 'M', path: 'src/next.ts' },
  ])
  expect(() => parseGitChanges('R100\0src/old.ts\0')).toThrow()
  expect(() => parseGitChanges('M\0../outside\0')).toThrow()
  expect(() => parseOptions(['--base', '--upload-pack=command'])).toThrow()
  expect(() => parseOptions(['--head', 'main'])).toThrow()
  expect(() => parseOptions(['--publish'])).toThrow()
  expect(() => parseOptions(['--worktree', '--worktree'])).toThrow()
})

test('the offline verifier returns a proposed checkpoint but writes no accepted/applied state', async () => {
  const directory = temporaryDirectory()
  const catalogFile = path.join(directory, 'catalog.json')
  const trustFile = path.join(directory, 'trust.json')
  const trust = updateCatalogTrustFixture()
  fs.writeFileSync(catalogFile, signedCatalogFixture())
  fs.writeFileSync(trustFile, JSON.stringify({
    schema: 'islemind.update-catalog-trust.v1', repository: trust.repository, channel: trust.channel,
    minimumSequence: trust.minimumSequence, keys: trust.keys,
  }))
  const before = fs.readdirSync(directory).sort()
  const result = await runVerifyUpdateCatalog(['--catalog', catalogFile, '--trust', trustFile], NOW)
  expect(result).toMatchObject({ metadataVerified: true, applied: false, checkpointPersisted: false, proposedCheckpoint: { sequence: 2 } })
  expect(fs.readdirSync(directory).sort()).toEqual(before)
  await expect(runVerifyUpdateCatalog(['--catalog', catalogFile, '--trust', trustFile], NOW + 60_000)).rejects.toMatchObject({ code: 'expired' })
})

test('the offline verifier rejects malformed UTF-8 rather than accepting replacement-character aliases', async () => {
  const directory = temporaryDirectory()
  const catalogFile = path.join(directory, 'catalog.json')
  const trustFile = path.join(directory, 'trust.json')
  const catalog = JSON.parse(JSON.stringify(updateCatalogFixture()))
  catalog.changes[0].texts.en = 'Replacement \ufffd'
  const bytes = Buffer.from(signedCatalogFixture(catalog))
  const position = bytes.indexOf(Buffer.from('\ufffd'))
  expect(position).toBeGreaterThan(0)
  fs.writeFileSync(catalogFile, Buffer.concat([bytes.subarray(0, position), Buffer.from([0xff]), bytes.subarray(position + 3)]))
  const trust = updateCatalogTrustFixture()
  fs.writeFileSync(trustFile, JSON.stringify({
    schema: 'islemind.update-catalog-trust.v1', repository: trust.repository, channel: trust.channel,
    minimumSequence: trust.minimumSequence, keys: trust.keys,
  }))
  await expect(runVerifyUpdateCatalog(['--catalog', catalogFile, '--trust', trustFile], NOW)).rejects.toThrow(/encoding/)
})
