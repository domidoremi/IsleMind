const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { observeSourceStability, parseArgs } = require('./check-release-source-stability')
const { snapshotReleaseInputs } = require('./release-freshness-contract')

const file = (path, sha256 = 'a', modifiedAt = '2026-09-26T00:00:00.000Z') => ({ path, sha256, sizeBytes: 1, modifiedAt })
const app = file('src/app.ts')
const ui = file('../animal-island-ui/src/index.ts')

function observe(samples) {
  let time = 0
  let index = 0
  return observeSourceStability({ durationMs: (samples.length - 1) * 10, intervalMs: 10 }, {
    now: () => time,
    wait: async ms => { time += ms },
    snapshot: () => samples[index++],
  })
}

test('unchanged paired sources and timestamp-only drift remain stable', async () => {
  const result = await observe([[app, ui], [{ ...app, modifiedAt: '2026-09-27T00:00:00.000Z' }, ui]])
  assert.equal(result.ok, true)
  assert.equal(result.probes, 2)
  assert.equal(result.unchangedCount, 2)
  assert.equal(result.observationScope, 'sampled-inputs-only')
})

test.each([app.path, ui.path])('an observed edit and revert still fails for %s', async path => {
  const initial = [app, ui]
  const changed = initial.map(item => item.path === path ? { ...item, sha256: 'b' } : item)
  const result = await observe([initial, changed, initial])
  assert.equal(result.ok, false)
  assert.equal(result.status, 'changed')
  assert.equal(result.changedCount, 1)
  assert.equal(result.unchangedCount, 1)
  assert.equal(result.changed[0].path, path)
  assert.equal(result.changed[0].after.sha256, 'b')
  assert.equal(result.changed[0].firstObservedProbe, 2)
})

test('temporary additions and removals are not erased by the final snapshot', async () => {
  const transient = file('src/temporary.ts')
  const result = await observe([[app, ui], [ui, transient], [app, ui]])
  assert.equal(result.ok, false)
  assert.equal(result.addedCount, 2)
  assert.equal(result.removedCount, 2)
  assert.equal(result.unchangedCount, 1)
})

test('a snapshot mutation/read error rejects instead of emitting a passing receipt', async () => {
  let index = 0
  await assert.rejects(observeSourceStability({ durationMs: 10, intervalMs: 10 }, {
    now: () => 0, wait: async () => {},
    snapshot: () => { if (index++) throw new Error('input changed while hashing'); return [app, ui] },
  }), /input changed while hashing/)
})

test.each(['1x', '1.5', '0', '-1', 'Infinity', '9007199254740992', ''])('rejects invalid sampling duration %s', value => {
  assert.throws(() => parseArgs(['--duration-ms', value]), /positive integer/)
})

test('paired compiler configuration and offline guide sources invalidate build receipts', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-paired-inputs-'))
  const root = path.join(temp, 'IsleMind')
  const inputs = [
    'tsconfig.json',
    'scripts/user-guide.js',
    'docs/user-guide/en/tasks.md',
    'docs/user-guide/assets/tasks.svg',
    '../animal-island-ui/package.json',
    '../animal-island-ui/tsconfig.json',
    '../animal-island-ui/tsconfig.build.json',
    '../animal-island-ui/babel.config.js',
  ]
  const write = (name, content) => {
    const target = path.resolve(root, name)
    assert.ok(target.startsWith(temp + path.sep))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  try {
    for (const name of inputs) write(name, 'original')
    // Neither local credentials nor generated declarations belong in this catalog.
    for (const name of ['.env', '../animal-island-ui/.env', '../animal-island-ui/dist/index.js']) write(name, 'excluded fixture')
    const initial = snapshotReleaseInputs(root)
    assert.deepEqual(initial.map(item => item.path).sort(), [...inputs].sort())
    for (const name of inputs) {
      write(name, 'modified')
      const changed = snapshotReleaseInputs(root)
      const result = await observe([initial, changed])
      assert.equal(result.ok, false, `${name} must invalidate a build receipt`)
      assert.deepEqual(result.changed.map(item => item.path), [name])
      write(name, 'original')
    }
    write('docs/user-guide/ja/tasks.md', 'new translation')
    const added = await observe([initial, snapshotReleaseInputs(root)])
    assert.equal(added.ok, false)
    assert.deepEqual(added.added.map(item => item.path), ['docs/user-guide/ja/tasks.md'])
    fs.unlinkSync(path.join(root, 'docs/user-guide/ja/tasks.md'))
    fs.unlinkSync(path.join(root, 'docs/user-guide/assets/tasks.svg'))
    const removed = await observe([initial, snapshotReleaseInputs(root)])
    assert.equal(removed.ok, false)
    assert.deepEqual(removed.removed.map(item => item.path), ['docs/user-guide/assets/tasks.svg'])
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('islemind-paired-inputs-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
