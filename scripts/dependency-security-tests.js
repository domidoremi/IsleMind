const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const queryString = require('query-string')
const xcode = require('xcode')

for (const [query, options, expected] of [
  ['q=a+b&literal=%2B', {}, { literal: '+', q: 'a b' }],
  ['x[]=a%2Bb&x[]=c+d', { arrayFormat: 'bracket' }, { x: ['a+b', 'c d'] }],
  ['x=a%2Bb,c+d', { arrayFormat: 'comma' }, { x: ['a+b', 'c d'] }],
  ['bad=%C1%81&ok=%E4%B8%AD%E6%96%87', {}, { bad: '%C1%81', ok: '中文' }],
]) {
  assert.deepEqual({ ...queryString.parse(query, options) }, expected)
}
const parsed = queryString.parseUrl('https://example.invalid/?q=a+b#c+d', { parseFragmentIdentifier: true })
assert.deepEqual({ ...parsed.query }, { q: 'a b' })
assert.equal(parsed.fragmentIdentifier, 'c d')
assert.equal(queryString.stringify({ q: '中文 + 日本語', ids: ['a', 'b'] }), 'ids=a&ids=b&q=%E4%B8%AD%E6%96%87%20%2B%20%E6%97%A5%E6%9C%AC%E8%AA%9E')

const malformed = spawnSync(process.execPath, ['-e', `
  const assert = require('node:assert/strict');
  const parse = require('query-string').parse;
  const malformed = '%C1%81'.repeat(8192);
  assert.equal(parse('q=' + malformed).q, malformed);
`], { cwd: __dirname + '/..', encoding: 'utf8', timeout: 5000, windowsHide: true })
assert.equal(malformed.error, undefined, 'Malformed URI decoding must complete without recursive/exponential work')
assert.equal(malformed.status, 0, malformed.stderr)

const project = xcode.project('synthetic-fixture.pbxproj')
project.hash = { project: { objects: {} } }
const ids = new Set()
for (let index = 0; index < 32; index++) {
  const id = project.generateUuid()
  assert.match(id, /^[A-F0-9]{24}$/)
  ids.add(id)
}
assert.equal(ids.size, 32)
function packageDirectory(name, from = __dirname) {
  let directory = path.dirname(require.resolve(name, { paths: [from] }))
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json')
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return directory
    directory = path.dirname(directory)
  }
  throw new Error(`Installed package ${name} could not be identified`)
}

function boundedProbe(source) {
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=128', '--require', path.join(__dirname, 'offline-provider-test-guard.js'), '-e', source,
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 5000, windowsHide: true })
  assert.equal(result.error, undefined, 'Pathological-input regressions must remain bounded')
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

async function verifyCompressionAbortCleanup() {
  const http = require('node:http')
  const zlib = require('node:zlib')
  const descriptor = Object.getOwnPropertyDescriptor(zlib, 'createGzip')
  const streams = []
  Object.defineProperty(zlib, 'createGzip', { ...descriptor, value: (...args) => {
    const stream = descriptor.value(...args)
    streams.push(stream)
    return stream
  } })
  const compress = require('compression')({ threshold: 0 })
  let closed
  const responseClosed = new Promise(resolve => { closed = resolve })
  const server = http.createServer((request, response) => compress(request, response, () => {
    response.setHeader('Content-Type', 'text/plain')
    const timer = setInterval(() => response.write('x'.repeat(65536)), 5)
    response.once('close', () => { clearInterval(timer); closed() })
  }))
  let watchdog
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const request = http.get({ hostname: '127.0.0.1', port: server.address().port,
      headers: { 'Accept-Encoding': 'gzip' } }, response => response.once('data', () => request.destroy()))
    request.on('error', () => undefined)
    await Promise.race([responseClosed, new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('Compression abort fixture did not close')), 2000)
    })])
    assert.equal(streams.length, 1, 'Abort regression exercises an actual gzip response')
    assert.equal(streams[0].destroyed, true, 'Premature response close destroys the native zlib stream')
  } finally {
    clearTimeout(watchdog)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    Object.defineProperty(zlib, 'createGzip', descriptor)
  }
}

async function verifyCurrentSecurityFixes() {
  for (const [name, version] of Object.entries({
    'decode-uri-component': '0.5.1', 'markdown-it': '14.3.3', 'shell-quote': '1.11.0',
    compression: '1.8.2', 'source-map-js': '1.2.2', 'node-forge': '1.4.2',
  })) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(packageDirectory(name), 'package.json'), 'utf8')).version, version,
      `${name} runs the reviewed compatible security version`)
  }
  const quote = require('shell-quote').quote
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => quote(['echo', { comment: 'fixture' }, `a${terminator}never-executed;#`]), TypeError)
  }
  assert.equal(quote(['echo', 'two words']), "echo 'two words'")
  boundedProbe(`
    const assert = require('node:assert/strict');
    const loadedDecode = require('decode-uri-component');
    const decode = loadedDecode.default || loadedDecode;
    let input = '';
    for (let i = 0; i < 8192; i++) input += '%' + (i >> 8).toString(16).padStart(2, '0') + '%' + (i & 255).toString(16).padStart(2, '0') + 'x';
    assert.ok(decode(input + '%zz').endsWith('%zz'));
    const Markdown = require('markdown-it');
    const inputMarkdown = '[' + 'a\\n'.repeat(50000);
    assert.equal(typeof new Markdown().render(inputMarkdown), 'string');
    for (const opener of ['<!--', '<?', '<![CDATA[', '<!']) {
      assert.equal(typeof new Markdown({html:true}).render('x ' + opener.repeat(8192)), 'string');
    }
  `)
  const legacyGlob = require.resolve('glob', { paths: [path.dirname(require.resolve('jest-config'))] })
  const legacyMinimatch = require.resolve('minimatch', { paths: [path.dirname(legacyGlob)] })
  const globMinimatch = require.resolve('minimatch', { paths: [path.dirname(require.resolve('glob'))] })
  const braceDirectories = [...new Set([legacyMinimatch, globMinimatch]
    .map(file => packageDirectory('brace-expansion', path.dirname(file))))]
  assert.equal(braceDirectories.length, 2, 'Both legacy CommonJS and modern brace-expansion branches are exercised')
  for (const directory of braceDirectories) {
    const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version
    assert.ok(['1.1.21', '5.0.12'].includes(version), `Reviewed brace-expansion branch: ${version}`)
    boundedProbe(`
      const assert = require('node:assert/strict');
      const loaded = require(${JSON.stringify(directory)});
      const expand = loaded.expand || loaded.default || loaded;
      assert.equal(typeof expand, 'function');
      assert.deepEqual(expand('a{b,c}d'), ['abd', 'acd']);
      assert.ok(Array.isArray(expand('{' + '{a},'.repeat(8192) + 'b}')));
      assert.ok(Array.isArray(expand('{a}' + '}'.repeat(32768) + ',z}')));
    `)
  }
  const deepmergeRoot = packageDirectory('deepmerge')
  const bundledMerge = fs.readFileSync(path.join(deepmergeRoot, 'dist/cjs.js'), 'utf8')
  const predicateSource = bundledMerge.split('function emptyTarget(val)')[0]
  assert.match(predicateSource, /function isMergeableObject/)
  // The published source omits its build-only predicate dependency. Reuse the
  // actual bundled predicate so the source backport is exercised on fresh installs.
  const predicate = new Function(`${predicateSource}\nreturn isMergeableObject;`)()
  const sourceModule = { exports: {} }
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(deepmergeRoot, 'index.js'), 'utf8'))(
    name => { assert.equal(name, 'is-mergeable-object'); return predicate }, sourceModule, sourceModule.exports)
  for (const merge of [sourceModule.exports, require(path.join(deepmergeRoot, 'dist/cjs.js')),
    require(path.join(deepmergeRoot, 'dist/umd.js'))]) {
    const target = Object.create(null)
    target.__proto__ = { poisoned: true }
    const result = merge(target, {})
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
    assert.equal(result.poisoned, undefined)
    assert.equal({}.poisoned, undefined)
    assert.deepEqual(merge({ a: [1] }, { a: [2] }), { a: [1, 2] })
  }
  for (const entrypoint of ['zod', 'zod/v3']) {
    const { z } = require(entrypoint)
    const invalid = z.array(z.number()).safeParse(Array(100000).fill('invalid'))
    assert.equal(invalid.success, false)
    assert.ok(invalid.error.issues.length > 0 && invalid.error.issues.length <= 1000)
    const constrained = z.array(z.number()).max(1).safeParse(Array(100000).fill(1))
    assert.equal(constrained.success, false)
    assert.equal(constrained.error.issues[0].code, 'too_big')
    assert.equal(z.union([z.array(z.number()), z.array(z.string())]).safeParse(Array(2000).fill('valid')).success, true)
    assert.deepEqual(await z.array(z.number()).parseAsync(Array(2000).fill(2)), Array(2000).fill(2))
    let active = 0, peak = 0
    const asynchronous = z.array(z.number().transform(async value => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setImmediate(resolve))
      active--
      return value
    }))
    assert.equal((await asynchronous.parseAsync(Array(256).fill(1))).length, 256)
    assert.ok(peak <= 64, 'Zod v3 backport bounds async array fan-out without truncating valid values')
  }
  const forge = require('node-forge')
  const keys = forge.pki.rsa.generateKeyPair({ bits: 512, e: 65537 })
  const digest = forge.md.sha256.create().update('offline signature compatibility')
  const signature = keys.privateKey.sign(digest)
  assert.equal(keys.publicKey.verify(digest.digest().bytes(), signature), true)
  assert.equal(keys.publicKey.verify(forge.md.sha256.create().update('different').digest().bytes(), signature), false)
  assert.equal(forge.pem.decode(Buffer.from(forge.pki.privateKeyToPem(keys.privateKey)))[0].type, 'RSA PRIVATE KEY')
  boundedProbe(`
    const assert = require('node:assert/strict');
    const {SourceMapConsumer, SourceNode} = require('source-map-js');
    assert.throws(() => {
      const consumer = new SourceMapConsumer({version:3, sections:[{offset:{line:2147483647,column:0},
        map:{version:3,sources:['fixture.js'],names:[],mappings:'AAAA'}}]});
      SourceNode.fromStringWithSourceMap('fixture', consumer);
    }, /offset|line|bounds|range|source/i);
    const valid = new SourceMapConsumer({version:3,sources:['fixture.js'],names:[],mappings:'AAAA'});
    assert.equal(SourceNode.fromStringWithSourceMap('fixture', valid).toString(), 'fixture');
  `)
  await verifyCompressionAbortCleanup()
  await require('./dependency-backport-tests').verifyDependencyBackports()
  console.log('Dependency security regressions passed: compatible upgrades, bounded parser inputs, both brace branches, scoped deepmerge/Zod v3 backports, signature/PEM interop, and aborted gzip cleanup. Advisory exceptions remain separately reviewed.')
}

verifyCurrentSecurityFixes().catch(error => { console.error(error); process.exitCode = 1 })
