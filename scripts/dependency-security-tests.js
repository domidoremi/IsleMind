const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
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
console.log('Dependency security regressions passed: URI decoding, malformed-input bound, CommonJS interop, and Xcode UUID generation.')
