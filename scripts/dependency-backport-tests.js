const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

function boundedPatternProbe(entrypoint) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', `
    const assert = require('node:assert/strict');
    (async () => {
      const { Minimatch } = await import(${JSON.stringify(entrypoint)});
      const amplified = Array(30).fill('**/../a/b').join('/');
      assert.equal(new Minimatch(amplified, { optimizationLevel: 2, braceExpandMax: 64 }).set.length, 64);
      const ordinary = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
      assert.equal(ordinary.set.length, 4);
      assert.equal(ordinary.match('../a/b/../c/d'), true);
      assert.equal(ordinary.match('x/a/b/y/c/d'), true);
      const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
      assert.equal(large.set.length, 2000);
      assert.equal(large.match('x/5'), true);
      assert.equal(large.match('y/999'), true);
      assert.equal(large.match('.y/5'), false);
    })().catch(error => { console.error(error); process.exitCode = 1 });
  `], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  assert.equal(result.error, undefined, 'Pattern preprocessing must stay within the process budget')
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

async function verifyDependencyBackports() {
  const { pathToFileURL } = require('node:url')
  const globRoot = path.dirname(require.resolve('glob/package.json'))
  const minimatchRoot = path.dirname(require.resolve('minimatch/package.json', { paths: [globRoot] }))
  assert.equal(JSON.parse(fs.readFileSync(path.join(minimatchRoot, 'package.json'), 'utf8')).version, '10.2.6')
  for (const branch of ['commonjs', 'esm']) {
    boundedPatternProbe(pathToFileURL(path.join(minimatchRoot, `dist/${branch}/index.js`)).href)
  }
  const legacyRoot = path.dirname(require.resolve('glob/package.json', {
    paths: [path.dirname(require.resolve('test-exclude'))],
  }))
  const legacy = require(require.resolve('minimatch', { paths: [legacyRoot] }))
  assert.equal(typeof legacy.Minimatch.prototype.firstPhasePreProcess, 'undefined',
    'The locked v3 branch does not expose the vulnerable optimization pass')
  assert.equal(new legacy.Minimatch(Array(30).fill('**/../a/b').join('/'), { optimizationLevel: 2 }).set.length, 1)

  const prefix = 'islemind-dependency-backports-'
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  function tree(target, depth) {
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'fixture.txt'), 'synthetic fixture')
    if (depth) for (const name of ['a', 'b']) tree(path.join(target, name), depth - 1)
  }
  tree(directory, 5)
  try {
    const variants = [
      ['public-cjs', require('glob')], ['raw-cjs', require('glob/raw')],
      ['public-esm', await import('glob')], ['raw-esm', await import('glob/raw')],
    ]
    for (const [name, glob] of variants) {
      const patterns = new glob.Glob(Array(30).fill('**/../a/b').join('/'), { cwd: directory, braceExpandMax: 64 })
      assert.equal(patterns.patterns.length, 64, `${name}: embedded minimatch preprocessing is bounded`)
      for (const streaming of [false, true]) {
        const controller = new AbortController()
        const reason = new Error('synthetic abort')
        let reads = 0
        const counted = { ...fs, readdir(...args) {
          if (++reads === 1) controller.abort(reason)
          return fs.readdir(...args)
        } }
        const options = { cwd: directory, signal: controller.signal, fs: counted }
        const work = streaming ? (async () => { for await (const _ of glob.globStream('**', options)) {} })()
          : glob.glob('**', options)
        await assert.rejects(work, error => error === reason)
        const atRejection = reads
        await new Promise(resolve => setTimeout(resolve, 25))
        assert.equal(reads, atRejection, `${name}: aborted ${streaming ? 'stream' : 'walk'} performs no further directory reads`)
        assert.equal(reads, 1)
      }
      const controller = new AbortController()
      const reason = new Error('synthetic sync abort')
      let syncReads = 0
      const counted = { ...fs, readdirSync(...args) {
        if (++syncReads === 1) controller.abort(reason)
        return fs.readdirSync(...args)
      } }
      const syncStream = glob.globStreamSync('**', { cwd: directory, signal: controller.signal, fs: counted })
      await new Promise((resolve, reject) => {
        syncStream.on('error', error => {
          try { assert.equal(error, reason); assert.equal(syncReads, 1); resolve() } catch (failure) { reject(failure) }
        })
        syncStream.resume()
      })
      const paused = glob.globStream('**', { cwd: directory })
      await new Promise(resolve => setTimeout(resolve, 25))
      const matches = []
      for await (const match of paused) matches.push(match)
      assert.deepEqual(new Set(matches), new Set(glob.globSync('**', { cwd: directory })),
        `${name}: paused streams resume and retain all ordinary matches`)
    }
    console.log('Dependency backports passed: CJS/ESM public and raw glob cancellation, stream resume, bounded embedded and external minimatch preprocessing, and legacy matching.')
  } finally {
    const resolved = fs.realpathSync(directory)
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase())
    assert.ok(path.basename(resolved).startsWith(prefix))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

module.exports = { verifyDependencyBackports }
if (require.main === module) verifyDependencyBackports().catch(error => { console.error(error); process.exitCode = 1 })
