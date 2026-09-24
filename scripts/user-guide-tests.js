const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { loadGuide, renderBundle } = require('./user-guide')
const source = path.resolve(__dirname, '../docs/user-guide')

function fixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-guide-'))
  fs.cpSync(source, base, { recursive: true })
  try { run(base) } finally {
    assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(base).startsWith('islemind-guide-'))
    fs.rmSync(base, { recursive: true, force: true })
  }
}
const change = (base, file, update) => {
  const target = path.join(base, file)
  fs.writeFileSync(target, update(fs.readFileSync(target, 'utf8')))
}
test('all 12 chapters and three languages match the packaged content', () => {
  const guide = loadGuide()
  assert.equal(guide.chapters['zh-CN'].length, 12)
  assert.equal(guide.chapters.en.length, 12)
  assert.equal(guide.chapters.ja.length, 12)
  assert.equal(renderBundle(guide), fs.readFileSync(path.resolve(__dirname, '../src/generated/userGuide.ts'), 'utf8'))
})
test('missing translation fails', () => fixture(base => {
  fs.unlinkSync(path.join(base, 'ja/models.md'))
  assert.throws(() => loadGuide(base), /Missing or extra translation/)
}))
test('source edits invalidate reviewed translation fingerprints', () => fixture(base => {
  change(base, 'zh-CN/models.md', text => text + '\nChanged behavior.\n')
  assert.throws(() => loadGuide(base), /Stale translation/)
}))
test('shared image edits invalidate review fingerprints', () => fixture(base => {
  change(base, 'assets/setup-flow.svg', text => text.replace('#eef5f4', '#eeeeee'))
  assert.throws(() => loadGuide(base), /Stale translation/)
}))
test('duplicate anchors fail', () => fixture(base => {
  change(base, 'en/models.md', text => text + '\n<a id="steps"></a>\n')
  assert.throws(() => loadGuide(base), /Duplicate anchor/)
}))
test('missing corresponding anchors fail', () => fixture(base => {
  change(base, 'en/models.md', text => text.replace('<a id="steps"></a>', '<a id="different"></a>'))
  assert.throws(() => loadGuide(base), /Anchor mismatch/)
}))
test('dead internal anchors fail', () => fixture(base => {
  change(base, 'en/models.md', text => text + '\n[Dead](models.md#missing)\n')
  assert.throws(() => loadGuide(base), /Broken guide link/)
}))
test('unsafe links and remote images fail', () => fixture(base => {
  change(base, 'en/models.md', text => text + '\n![Remote](https://example.org/image.svg)\n')
  assert.throws(() => loadGuide(base), /Remote guide images/)
}))
test('unknown contextual help topic fails', () => {
  assert.throws(() => loadGuide(source, [{ id: 'missing', helpTopic: 'no-such-topic' }]), /Unknown help topic/)
})
test('review date is a warning, not an age limit for unchanged content', () => fixture(base => {
  change(base, 'en/models.md', text => text.replace(/reviewedAt: "\d{4}-\d{2}-\d{2}"/, 'reviewedAt: "2000-01-01"'))
  assert.ok(loadGuide(base).warnings.some(warning => warning.includes('en/models')))
}))
