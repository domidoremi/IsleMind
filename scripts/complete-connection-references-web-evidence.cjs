const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const evidence = path.resolve(root, process.argv[2] || 'test-evidence/qa/islemind-connection-references-20261106')
assert(evidence.startsWith(root + path.sep))
const out = path.join(evidence, 'views-final')
assert(!fs.existsSync(out), 'Preserve previous completion evidence')
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name, 'results.json'), 'utf8'))
const initial = read('views-i1'), remaining = read('views-i2-remaining')
assert.equal(initial.exportHash, remaining.exportHash)
assert.equal(initial.fixtureSha256, remaining.fixtureSha256)
assert(initial.errors.length === 2 && remaining.passed && remaining.errors.length === 0)
assert(initial.blockedExternalHosts.length === 0 && remaining.blockedExternalHosts.length === 0)
const key = entry => JSON.stringify([entry.family, entry.mode, entry.width])
const failed = new Set(initial.errors.map(key))
assert.deepEqual([...failed].sort(), [key({ family: 'animal-island-ui', mode: 'light', width: 390 }),
  key({ family: 'animal-island-ui', mode: 'dark', width: 390 })].sort())
assert(remaining.pages.every(entry => failed.has(key(entry))))
const selected = [
  ...initial.pages.filter(entry => !failed.has(key(entry))).map(entry => ({ ...entry, origin: 'views-i1' })),
  ...remaining.pages.map(entry => ({ ...entry, origin: 'views-i2-remaining' })),
]
assert.equal(selected.length, 260)
const expected = ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
  .flatMap(family => ['light', 'dark'].flatMap(mode => [320, 390, 960].map(width => ({ family, mode, width }))))
for (const identity of expected) {
  assert.equal(selected.filter(entry => key(entry) === key(identity)).length, identity.width === 390 ? 14 : 6)
}
const names = new Set()
fs.mkdirSync(out)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
for (const entry of selected) {
  assert(!names.has(entry.screenshot)); names.add(entry.screenshot)
  const source = path.resolve(evidence, entry.origin, entry.screenshot)
  const target = path.resolve(out, entry.screenshot)
  assert(source.startsWith(evidence + path.sep) && target.startsWith(out + path.sep))
  fs.copyFileSync(source, target)
  assert.equal(hash(source), hash(target))
  entry.sha256 = hash(target)
}
const checks = [...initial.checks.filter(entry => !failed.has(key(entry))).map(entry => ({ ...entry, origin: 'views-i1' })),
  ...remaining.checks.map(entry => ({ ...entry, origin: 'views-i2-remaining' }))]
assert.equal(checks.length, 140)
const result = { ...remaining, pages: selected, checks, completedAt: new Date().toISOString(), errors: [], passed: true,
  completion: {
    initial: { file: 'views-i1/results.json', sha256: hash(path.join(evidence, 'views-i1/results.json')), passedCombinations: 28, errors: initial.errors },
    remaining: { file: 'views-i2-remaining/results.json', sha256: hash(path.join(evidence, 'views-i2-remaining/results.json')), passedCombinations: 2 },
    reason: 'The Animal Island Select exposes its Web trigger on the outer control. The qualification selector now follows the actual trigger; application source and fixture hashes are unchanged.',
    originalEvidencePreserved: true, screenshotCopyVerified: true,
  } }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ passed: true, combinations: 30, pages: result.pages.length, checks: result.checks.length, exportHash: result.exportHash }))
