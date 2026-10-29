const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { TextDecoder } = require('node:util')
const { loadUpdateDeliveryContract } = require('./load-update-delivery-contracts')
const { canonicalCatalogJson } = loadUpdateDeliveryContract('src/core/updateCatalog.ts')
const {
  createReleasePlan, classifyReleasePlanPath, assertReleasePlanPath,
  parseReleaseChangeRecord, packageRuntimeProjection, appRuntimeProjection, INPUT_SCHEMA,
} = require('./release-plan-contract')

const DEFAULT_ROOT = path.resolve(__dirname, '..')
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const MAX_GIT_BYTES = 8 * 1024 * 1024

function git(root, args, options = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[name]
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: MAX_GIT_BYTES, timeout: 10_000, ...options })
}

function parseOptions(args) {
  const options = { worktree: false }
  for (let index = 0; index < args.length; index++) {
    const name = args[index]
    if (name === '--worktree' && !options.worktree) { options.worktree = true; continue }
    if (!['--base', '--head', '--state', '--repository', '--channel'].includes(name)
      || !args[index + 1] || Object.hasOwn(options, name)) {
      throw new Error('Use [--base COMMIT --head COMMIT] [--worktree] [--state FILE] [--repository OWNER/REPO] [--channel stable|preview].')
    }
    options[name] = args[++index]
  }
  for (const name of ['--base', '--head']) {
    if (options[name] && !COMMIT.test(options[name])) throw new Error('Source inputs must be full immutable commit IDs, never branch names or options.')
  }
  return options
}

function gitTree(root, ref) {
  const raw = git(root, ['ls-tree', '-r', '-z', ref])
  const entries = raw.split('\0').filter(Boolean).map((line) => {
    const match = line.match(/^(\d{6}) (blob|commit) ([a-f0-9]+)\t(.+)$/)
    if (!match) throw new Error('Malformed Git tree metadata.')
    const [, mode, type, object, filename] = match
    assertReleasePlanPath(filename)
    if (!['100644', '100755'].includes(mode) || type !== 'blob' || !COMMIT.test(object)) {
      throw new Error('Release planning does not follow symlinks, submodules, or unknown tree entry modes.')
    }
    return { filename, object }
  })
  if (entries.length > 20_000) throw new Error('Source tree exceeds the bounded planning window.')
  return entries
}

function parseGitChanges(raw) {
  const tokens = raw.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  const files = []
  for (let index = 0; index < tokens.length;) {
    const match = tokens[index++].match(/^([AMDCRT])(?:\d{1,3})?$/)
    if (!match) throw new Error('Unmerged or malformed Git changes cannot form a release plan.')
    const status = match[1]
    const first = tokens[index++]
    if (!first) throw new Error('Git changes require exact source paths.')
    assertReleasePlanPath(first)
    if (status === 'R' || status === 'C') {
      const next = tokens[index++]
      if (!next) throw new Error('Renamed changes require both source paths.')
      assertReleasePlanPath(next)
      files.push({ status, path: next, previousPath: first })
    } else files.push({ status, path: first })
  }
  return files
}

function readWorkspaceBytes(root, filename, maximum = 1_048_576) {
  assertReleasePlanPath(filename)
  const absolute = path.join(root, filename)
  const stat = fs.lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Planning reads only bounded regular workspace files.')
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute))
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Planning cannot follow parent-directory links outside its workspace.')
  return fs.readFileSync(absolute)
}

function readWorkspaceFile(root, filename, maximum) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readWorkspaceBytes(root, filename, maximum))
}
function readGitFile(root, ref, filename) {
  assertReleasePlanPath(filename)
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(git(root, ['show', `${ref}:${filename}`], { encoding: null }))
}

function pairedUiSnapshot(root) {
  const sibling = path.resolve(root, '../animal-island-ui')
  if (!fs.existsSync(path.join(sibling, '.git'))) return { commit: null, clean: false }
  const commit = git(sibling, ['rev-parse', 'HEAD']).trim()
  if (!COMMIT.test(commit)) throw new Error('Paired UI source must be a full immutable revision.')
  return { commit, clean: git(sibling, ['status', '--porcelain=v1', '--untracked-files=all']).trim() === '' }
}

function runtimeFingerprint(root, ref, tree, ui, worktree = false, changed = []) {
  const entries = new Map(tree.filter((entry) => classifyReleasePlanPath(entry.filename) === 'native')
    .map((entry) => [entry.filename, entry.object]))
  if (worktree) {
    for (const file of changed) {
      if (file.previousPath) entries.delete(file.previousPath)
      if (file.status === 'D') { entries.delete(file.path); continue }
      if (classifyReleasePlanPath(file.path) !== 'native') continue
      const contents = readWorkspaceBytes(root, file.path, MAX_GIT_BYTES)
      entries.set(file.path, createHash('sha256').update(contents).digest('hex'))
    }
  }
  for (const filename of ['package.json', 'app.json']) {
    const content = worktree ? readWorkspaceFile(root, filename, 256_000) : readGitFile(root, ref, filename)
    const projection = filename === 'package.json' ? packageRuntimeProjection(content) : appRuntimeProjection(content)
    entries.set(filename, `projection:${createHash('sha256').update(canonicalCatalogJson(projection)).digest('hex')}`)
  }
  const inputs = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return `sha256:${createHash('sha256').update(canonicalCatalogJson({ schema: 'islemind.native-runtime-inputs.v1', inputs, uiSourceCommit: ui.commit })).digest('hex')}`
}

function repositoryIdentity(root, explicit) {
  if (explicit) return explicit
  const remote = git(root, ['config', '--get', 'remote.origin.url']).trim()
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (ssh) return ssh[1]
  const parsed = new URL(remote)
  if (parsed.hostname !== 'github.com') throw new Error('Use an explicit repository identity for a non-GitHub origin.')
  return parsed.pathname.replace(/^\//, '').replace(/\.git$/, '')
}

function readChangeRecords(root, ref, tree, worktree) {
  let filenames = tree.map((entry) => entry.filename).filter((filename) => /^updates\/changes\/[^/]+\.json$/.test(filename))
  if (worktree) {
    const directory = path.join(root, 'updates', 'changes')
    if (fs.existsSync(directory)) {
      if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Change records must use a regular workspace directory.')
      filenames = Array.from(fs.readdirSync(directory)).filter((name) => name.endsWith('.json')).map((name) => `updates/changes/${name}`)
    } else filenames = []
  }
  if (filenames.length > 1000) throw new Error('Pending records exceed the bounded planning window.')
  return filenames.map((filename) => {
    const record = parseReleaseChangeRecord(JSON.parse(worktree ? readWorkspaceFile(root, filename) : readGitFile(root, ref, filename)))
    if (filename !== `updates/changes/${record.id}.json`) throw new Error('Durable change IDs must match their versioned filenames.')
    return record
  })
}

function createSourceBoundReleasePlan(args, context = {}) {
  const root = context.root ?? DEFAULT_ROOT
  const nowMs = context.nowMs ?? Date.now()
  const options = parseOptions(args)
  const currentHead = git(root, ['rev-parse', 'HEAD']).trim()
  const head = options['--head'] ?? currentHead
  const base = options['--base'] ?? head
  for (const ref of [base, head]) {
    if (!COMMIT.test(ref)) throw new Error('Release planning requires immutable Git source.')
    git(root, ['cat-file', '-e', `${ref}^{commit}`])
  }
  git(root, ['merge-base', '--is-ancestor', base, head])
  if (options.worktree && head !== currentHead) throw new Error('Worktree previews must be anchored to the currently checked-out commit.')
  const headTree = gitTree(root, head)
  const baseTree = gitTree(root, base)
  const files = parseGitChanges(git(root, options.worktree
    ? ['diff', '--name-status', '-z', '-M', base, '--']
    : ['diff', '--name-status', '-z', '-M', base, head, '--']))
  if (options.worktree) {
    for (const filename of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
      assertReleasePlanPath(filename)
      files.push({ path: filename, status: 'A' })
    }
  }
  for (const file of files.filter((entry) => ['package.json', 'app.json'].includes(entry.path))) {
    if (baseTree.some((entry) => entry.filename === file.path)) file.beforeContent = readGitFile(root, base, file.path)
    if (file.status !== 'D') file.afterContent = options.worktree ? readWorkspaceFile(root, file.path, 256_000) : readGitFile(root, head, file.path)
  }
  const sourceFile = (filename) => options.worktree ? readWorkspaceFile(root, filename, 256_000) : readGitFile(root, head, filename)
  const packageJson = JSON.parse(sourceFile('package.json'))
  const appJson = JSON.parse(sourceFile('app.json'))
  if (packageJson.version !== appJson.expo?.version) throw new Error('Source package/Expo versions must remain synchronized.')
  const ui = pairedUiSnapshot(root)
  const runtimeVersion = runtimeFingerprint(root, head, headTree, ui, options.worktree, files)
  const baseRuntimeVersion = runtimeFingerprint(root, base, baseTree, ui)
  const initialStatus = git(root, ['status', '--porcelain=v1', '--untracked-files=all']).trim()
  const clean = currentHead === head && initialStatus === ''
  let treeIdentity = `git:${git(root, ['rev-parse', `${head}^{tree}`]).trim()}`
  if (options.worktree) {
    const observations = files.map((file) => ({
      path: file.path, status: file.status, previousPath: file.previousPath ?? null,
      sha256: file.status === 'D' ? null : createHash('sha256').update(readWorkspaceBytes(root, file.path, MAX_GIT_BYTES)).digest('hex'),
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    treeIdentity = `worktree:${createHash('sha256').update(canonicalCatalogJson({ treeIdentity, observations, uiSourceCommit: ui.commit })).digest('hex')}`
  }
  const publication = options['--state'] ? (() => {
    const filename = options['--state']
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) throw new Error('Publication state must be a bounded regular explicit file.')
    return JSON.parse(fs.readFileSync(filename, 'utf8'))
  })() : null
  const input = {
    schema: INPUT_SCHEMA, repository: repositoryIdentity(root, options['--repository']),
    channel: options['--channel'] ?? 'stable', nowMs,
    source: {
      baseCommit: base, headCommit: head, treeIdentity, clean: clean && !options.worktree,
      sourceVersion: packageJson.version, nativeBuildVersion: appJson.expo?.android?.versionCode,
      runtimeVersion, baseRuntimeVersion, otaRuntimeReady: false, uiSourceCommit: ui.commit, uiClean: ui.clean,
    },
    files, records: readChangeRecords(root, head, headTree, options.worktree),
    policy: JSON.parse(sourceFile('updates/release-policy.json')), publication,
  }
  if (!options.worktree) {
    const finalUi = pairedUiSnapshot(root)
    if (git(root, ['rev-parse', 'HEAD']).trim() !== currentHead
      || git(root, ['status', '--porcelain=v1', '--untracked-files=all']).trim() !== initialStatus
      || finalUi.commit !== ui.commit || finalUi.clean !== ui.clean) {
      throw new Error('Source or paired UI changed during planning; regenerate the read-only plan.')
    }
  }
  return createReleasePlan(input)
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(createSourceBoundReleasePlan(process.argv.slice(2)), null, 2) + '\n')
  } catch (error) {
    console.error(`Release planning refused: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { createSourceBoundReleasePlan, parseGitChanges, parseOptions, runtimeFingerprint, gitTree }
