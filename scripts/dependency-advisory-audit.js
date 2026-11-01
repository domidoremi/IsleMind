const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const json5 = require('json5')
const semver = require('semver')

const projectRoot = path.resolve(__dirname, '..')
const ledgerPath = 'scripts/fixtures/provider-maintenance-ledger.json'
const SCHEMA = 'islemind.dependency-advisory-review.v1'
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')

function inside(parent, target) {
  const relative = path.relative(parent, target)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function inventoryFromLock(text) {
  const lock = json5.parse(text)
  if (!lock.packages || !lock.workspaces || lock.lockfileVersion !== 3) throw new Error('Unsupported or incomplete Bun lockfile')
  const versions = Object.create(null), consumers = Object.create(null)
  for (const entry of Object.values(lock.packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') throw new Error('Malformed locked package')
    const match = entry[0].match(/^((?:@[^/]+\/)?[^@]+)@(.+)$/)
    if (!match) throw new Error(`Unidentified locked package: ${entry[0]}`)
    const [, name, version] = match
    if (version.startsWith('workspace:')) continue
    if (!semver.valid(version)) throw new Error(`Non-registry version needs a separate review: ${entry[0]}`)
    ;(versions[name] ??= new Set()).add(version)
    for (const dependency of Object.keys(entry[2]?.dependencies ?? {})) {
      ;(consumers[dependency] ??= new Set()).add(entry[0])
    }
  }
  for (const [directory, workspace] of Object.entries(lock.workspaces)) {
    for (const dependency of Object.keys(workspace.dependencies ?? {})) {
      ;(consumers[dependency] ??= new Set()).add(`workspace:${directory || '.'}`)
    }
  }
  const ordered = values => Object.fromEntries(Object.entries(values)
    .map(([name, set]) => [name, [...set].sort()]).sort(([a], [b]) => a.localeCompare(b)))
  return { versions: ordered(versions), consumers: ordered(consumers) }
}

function collectInputs(root = projectRoot) {
  root = fs.realpathSync(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const files = ['package.json', 'bun.lock', ...Object.values(manifest.patchedDependencies ?? {})]
  const workspacePaths = manifest.workspaces?.packages ?? manifest.workspaces ?? []
  if (!Array.isArray(workspacePaths) || workspacePaths.some(value => value !== '../animal-island-ui')) {
    throw new Error('New workspace paths require an explicit isolation review')
  }
  const inputs = files.map(file => {
    if (typeof file !== 'string' || path.isAbsolute(file) || file.includes('\\')
      || path.posix.normalize(file) !== file || !inside(root, fs.realpathSync(path.join(root, file)))) {
      throw new Error('Patch/input path escapes the project')
    }
    return { file, data: fs.readFileSync(path.join(root, file)) }
  })
  for (const directory of workspacePaths) {
    const workspace = path.join(root, directory, 'package.json')
    const data = fs.readFileSync(workspace)
    if (JSON.parse(data).name !== 'animal-island-ui-rn') throw new Error('Unexpected sibling workspace identity')
    inputs.push({ file: `${directory}/package.json`, data })
  }
  const patches = Object.fromEntries(Object.entries(manifest.patchedDependencies ?? {}).map(([name, file]) =>
    [name, { file, sha256: sha256(inputs.find(input => input.file === file).data) }]))
  const ledgerBytes = fs.readFileSync(path.join(root, ledgerPath))
  return { root, manifest, inputs, patches, ledger: JSON.parse(ledgerBytes),
    fingerprints: Object.fromEntries([...inputs, { file: ledgerPath, data: ledgerBytes }]
      .map(input => [input.file, sha256(input.data)])),
    inventory: inventoryFromLock(inputs.find(input => input.file === 'bun.lock').data.toString('utf8')) }
}

function directProductionImports(root, packageNames) {
  const imports = Object.fromEntries(packageNames.map(name => [name, []]))
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Production-source symlinks require a separate reachability review')
      if (entry.isDirectory()) {
        if (!['__tests__', 'testing', 'node_modules'].includes(entry.name)) visit(file)
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
        const source = fs.readFileSync(file, 'utf8')
        for (const match of source.matchAll(/(?:\brequire\s*\(\s*|\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
          for (const name of packageNames) if (match[1] === name || match[1].startsWith(`${name}/`)) {
            imports[name].push(path.relative(root, file).split(path.sep).join('/'))
          }
        }
      }
    }
  }
  for (const directory of ['app', 'src']) visit(path.join(root, directory))
  return imports
}

function evaluateAdvisories(raw, { ledger, inventory, patches, directImports, now = Date.now() }) {
  const issues = [], reviewed = [], exceptions = ledger?.security?.exceptions
  if (!Array.isArray(exceptions)) throw new Error('Maintenance ledger has no explicit exception inventory')
  const keys = new Set()
  for (const exception of exceptions) {
    const key = `${exception.id}:${exception.package}`
    if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(exception.id ?? '') || keys.has(key)
      || !Array.isArray(exception.versions) || !exception.versions.length
      || new Set(exception.versions).size !== exception.versions.length
      || exception.versions.some(version => !semver.valid(version))) {
      issues.push(`Malformed or duplicate exception: ${key}`)
      continue
    }
    keys.add(key)
    if (exception.versions.some(version => !inventory.versions[exception.package]?.includes(version))) {
      issues.push(`Exception versions no longer match the lock; refresh the ledger: ${key}`)
    }
    for (const field of ['owner', 'scope', 'mitigation', 'limitations', 'nextAction']) {
      if (typeof exception[field] !== 'string' || !exception[field].trim()) issues.push(`Missing ${field}: ${key}`)
    }
    const reviewedAt = Date.parse(exception.reviewedAt), expiresAt = Date.parse(exception.expiresAt)
    const nextReview = Date.parse(exception.nextReview)
    if (!Number.isFinite(reviewedAt) || reviewedAt > now || !Number.isFinite(expiresAt) || expiresAt <= now
      || !Number.isFinite(nextReview) || nextReview < reviewedAt || nextReview > expiresAt || nextReview <= now) {
      issues.push(`Expired, overdue, or invalid review dates: ${key}`)
    }
    if (!['low', 'moderate', 'high', 'critical'].includes(exception.severity)) issues.push(`Invalid severity: ${key}`)
    if (!Array.isArray(exception.expectedConsumers) || JSON.stringify([...exception.expectedConsumers].sort())
      !== JSON.stringify(inventory.consumers[exception.package] ?? [])) {
      issues.push(`Locked consumer set changed; repeat reachability review: ${key}`)
    }
    if (!Array.isArray(directImports[exception.package]) || directImports[exception.package].length) {
      issues.push(`Direct production import invalidates tooling-scoped exception: ${key}`)
    }
    if (exception.patch) {
      const registered = patches[`${exception.package}@${exception.versions[0]}`]
      if (exception.versions.length !== 1
        || registered?.file !== exception.patch.file || registered?.sha256 !== exception.patch.sha256) {
        issues.push(`Patch registration or SHA-256 mismatch: ${key}`)
      }
    } else if (exception.scope !== 'unpatched-tooling-static-review') {
      issues.push(`An unpatched exception must explicitly identify its remaining tooling risk: ${key}`)
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Malformed registry audit response')
  const seen = new Set()
  for (const [name, advisories] of Object.entries(raw)) {
    if (!Array.isArray(advisories) || !advisories.length || !inventory.versions[name]) {
      throw new Error(`Unknown/malformed audited package: ${name}`)
    }
    for (const advisory of advisories) {
      const match = typeof advisory.url === 'string'
        && advisory.url.match(/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/)
      if (!match || !semver.validRange(advisory.vulnerable_versions)
        || !['low', 'moderate', 'high', 'critical'].includes(advisory.severity)) {
        throw new Error(`Incomplete advisory identity/range/severity: ${name}`)
      }
      const id = match[1], versions = inventory.versions[name]
        .filter(version => semver.satisfies(version, advisory.vulnerable_versions, { includePrerelease: true }))
      if (!versions.length) throw new Error(`Audit result does not match the input lock: ${name}/${id}`)
      const exception = exceptions.find(value => value.id === id && value.package === name)
      for (const version of versions) {
        const key = `${id}:${name}@${version}`
        if (seen.has(key)) continue
        seen.add(key)
        const accepted = exception?.versions.includes(version) && exception.severity === advisory.severity
        if (!accepted) issues.push(`Unreviewed advisory/version/severity: ${key}`)
        reviewed.push({ id, package: name, version, severity: advisory.severity,
          decision: accepted ? 'time-bounded-exception' : 'needs-review',
          ...(accepted ? { owner: exception.owner, expiresAt: exception.expiresAt, scope: exception.scope } : {}) })
      }
    }
  }
  return { passed: !issues.length, issues, reviewed }
}

function auditEnvironment(container, source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) =>
    /^(path|systemroot|windir|comspec|pathext|temp|tmp|ci|tz)$/i.test(key)))
  const profile = path.join(container, 'profile')
  fs.mkdirSync(profile)
  const npmrc = path.join(profile, '.npmrc')
  fs.writeFileSync(npmrc, 'registry=https://registry.npmjs.org/\n')
  return { ...env, HOME: profile, USERPROFILE: profile, XDG_CONFIG_HOME: profile,
    NPM_CONFIG_USERCONFIG: npmrc, NODE_ENV: 'test' }
}

function materializeSnapshot(container, inputs) {
  const directory = path.join(container, 'IsleMind')
  for (const { file, data } of inputs) {
    const destination = path.resolve(directory, file)
    if (!inside(container, destination)) throw new Error('Snapshot destination escapes its isolated container')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, data)
  }
  fs.writeFileSync(path.join(directory, '.npmrc'), 'registry=https://registry.npmjs.org/\n')
  fs.writeFileSync(path.join(directory, 'bunfig.toml'), '[install]\nregistry = "https://registry.npmjs.org"\n')
  return directory
}

function removeSnapshot(container, parent) {
  const resolved = fs.realpathSync(container), expectedParent = fs.realpathSync(parent)
  if (fs.lstatSync(container).isSymbolicLink() || path.dirname(resolved) !== expectedParent
    || !path.basename(resolved).startsWith('islemind-advisories-')) {
    throw new Error('Refusing recursive cleanup outside the explicit advisory temp root')
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}

function runAudit({ root = projectRoot, bun = 'bun', reportDir, execute = spawnSync, now = Date.now() } = {}) {
  if (!reportDir) throw new Error('Choose a durable, new --report-dir')
  reportDir = path.resolve(reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  if (fs.readdirSync(reportDir).length) throw new Error('Existing audit evidence is preserved; use a new empty directory')
  const report = { schema: SCHEMA, reviewedAt: new Date(now).toISOString(), passed: false,
    mode: 'public-registry-online', isolation: 'manifest-lock-patch-only; no dotenv or credentials; no lifecycle scripts',
    nodeVersion: process.version, issues: [] }
  let container
  try {
    const collected = collectInputs(root)
    report.inputs = collected.fingerprints
    report.inventory = collected.inventory
    container = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-advisories-'))
    const cwd = materializeSnapshot(container, collected.inputs)
    const options = { cwd, env: auditEnvironment(container), encoding: 'utf8',
      timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
    const version = execute(bun, ['--version'], options)
    const actualVersion = (version.stdout ?? '').trim()
    report.scanner = { binary: bun, version: actualVersion, expectedVersion: collected.ledger.toolchain.bun }
    if (path.isAbsolute(bun)) report.scanner.binarySha256 = sha256(fs.readFileSync(bun))
    if (version.status !== 0 || version.error || version.signal || actualVersion !== report.scanner.expectedVersion) {
      throw new Error('Advisory scanner version is not the reviewed pinned Bun version')
    }
    const scan = execute(bun, ['--no-env-file', 'audit', '--json'], options)
    report.scanner.status = scan.status
    fs.writeFileSync(path.join(reportDir, 'audit.stdout.json'), scan.stdout ?? '')
    fs.writeFileSync(path.join(reportDir, 'audit.stderr.log'), scan.stderr ?? '')
    if (![0, 1].includes(scan.status) || scan.error || scan.signal
      || /audit request failed|error:|^\s*\[.*\.env/m.test(scan.stderr ?? '')) {
      throw new Error('Registry audit failed or violated isolation; no exception can override a scanner error')
    }
    const raw = JSON.parse(scan.stdout)
    if ((scan.status === 0) !== (Object.keys(raw).length === 0)) throw new Error('Scanner exit/result mismatch')
    report.directProductionImports = directProductionImports(collected.root, Object.keys(raw)
      .concat(collected.ledger.security.exceptions.map(value => value.package)))
    Object.assign(report, evaluateAdvisories(raw, { ...collected, directImports: report.directProductionImports, now }))
    report.decision = report.passed ? report.reviewed.length ? 'reviewed-exceptions-remain' : 'no-current-advisories' : 'needs-review'
  } catch (error) {
    report.passed = false
    report.issues.push(error.message)
  } finally {
    if (container) {
      try { removeSnapshot(container, os.tmpdir()) }
      catch (error) { report.passed = false; report.issues.push(error.message) }
    }
    fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  }
  return report
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => !/^--(?:bun|report-dir)=.+$/.test(arg))) throw new Error('Use --bun=... and --report-dir=...')
    const report = runAudit({ bun: args.find(arg => arg.startsWith('--bun='))?.slice(6) ?? 'bun',
      reportDir: args.find(arg => arg.startsWith('--report-dir='))?.slice(13) })
    console.log(JSON.stringify({ passed: report.passed, decision: report.decision,
      advisoryVersions: report.reviewed?.length ?? 0, issues: report.issues }, null, 2))
    process.exitCode = report.passed ? 0 : 1
  } catch (error) { console.error(error); process.exitCode = 1 }
}

module.exports = { SCHEMA, sha256, inside, inventoryFromLock, collectInputs, directProductionImports,
  evaluateAdvisories, auditEnvironment, materializeSnapshot, removeSnapshot, runAudit }
