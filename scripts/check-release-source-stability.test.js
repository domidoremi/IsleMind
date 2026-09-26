const assert = require('node:assert/strict')
const { observeSourceStability, parseArgs } = require('./check-release-source-stability')

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
