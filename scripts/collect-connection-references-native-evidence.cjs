const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const zh = require('../src/i18n/resources/zh-CN.json')
const en = require('../src/i18n/resources/en.json')
const { createNativeSceneQualificationHost } = require('./native-scene-qualification-host.cjs')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const build = JSON.parse(fs.readFileSync(option('--build-receipt'), 'utf8'))
const receipt = {
  schema: 'islemind.connection-references-native-evidence.v1', startedAt: new Date().toISOString(),
  package: 'com.islemind.stage9', apkSha256: build.apkSha256, productionRelease: false,
  liveProviderRequests: 0, realCapabilityExecutions: 0, pages: [], checks: [], errors: [],
  scope: 'Actual reference disclosure, metadata reads and template navigation in the independent offline optimized Hermes APK. All connections and conversations are synthetic; the public installation and OS preferences are inspected without mutation.',
}
const host = createNativeSceneQualificationHost({ root, out: path.resolve(option('--out') || ''), apk: path.resolve(option('--apk') || ''),
  build, adb: option('--adb'), serial: option('--serial'), sdk: option('--sdk'),
  authorized: args.includes('--isolated-install-authorized'), receipt })
const { install, launch, command, nodes, label, find, tap, waitLabel, scrollTo, capture, shell, pause, until, save, verifyPreserved } = host
const labels = (group, key) => [zh[group][key], en[group][key]]
const countLabels = (kind, count) => [zh, en].map(language => language.connectionReferences.count[kind].replace('{{count}}', count))
const referenceLabels = name => [zh, en].map(language => `${language.connectionReferences.open} · ${name}`)
const inspectLabels = drafts => [zh, en].map(language => language.connectionReferences.inspected.replace('{{count}}', 81).replace('{{drafts}}', drafts))
async function goProvider(id, family, mode) {
  await command('references-navigate', { screen: 'settings' })
  const state = await command('references-navigate', { screen: id === 'scene-a' ? 'provider-a' : 'provider-b', ...(family ? { family, mode } : {}) })
  if (family) { assert.equal(state.themeId, family); assert.equal(state.theme, mode) }
  return waitLabel(labels('connectionReferences', 'title'))
}
async function openReferences(expected, identity) {
  const header = await scrollTo(labels('connectionReferences', 'title'))
  tap(find(header, labels('connectionReferences', 'title')))
  const tree = await until(() => {
    const tree = nodes()
    return tree.entries.some(node => countLabels('conversation', expected).some(text => label(node, text))) && tree
  }, 'the actual reference count', 30000)
  capture(`${identity.family}-${identity.mode}-${identity.screen}`, tree, identity)
  return tree
}
async function openReference(name, destinationLabel) {
  const tree = await scrollTo(referenceLabels(name))
  const control = find(tree, referenceLabels(name))
  assert(control?.clickable === 'true' && control.enabled === 'true')
  tap(control)
  return waitLabel(destinationLabel)
}
function verifyReport(state, expected) {
  const counts = Object.fromEntries(state.report.groups.map(group => [group.kind, group.total]))
  assert.deepEqual(counts, expected)
  assert.equal(state.report.conversations.savedInspected, 81)
  assert.equal(state.report.conversations.savedRemaining, 0)
  assert.equal(state.report.conversations.unreadable, 0)
  assert.equal(state.savedCount.count, 81)
  assert.deepEqual(state.historicalMessageBytes, receipt.fixture.historicalMessageBytes)
}
function verifyMessageBelowWarning(tree, message) {
  const text = tree.entries.find(node => label(node, message))
  const action = tree.entries.find(node => /去配置|Configure/.test(`${node.text ?? ''} ${node['content-desc'] ?? ''}`))
  assert(text && action, 'The original message and connection-warning action must both be visible')
  assert(text.bounds[1] >= action.bounds[3] + 4, 'The connection warning must not overlap the historical message')
}
async function main() {
  install()
  await launch('bench'); await command('prepare-startup')
  receipt.fixture = await command('references-fixture')
  assert.equal(receipt.fixture.conversations, 81)
  assert.equal(receipt.fixture.integrity.integrity_check, 'ok')
  receipt.guide = await command('references-guide')
  assert(receipt.guide.models.length === 3 && receipt.guide.models.every(chapter => chapter.references))
  await launch('app')
  // A prior probe may have selected an older record. Select the fixture's
  // current chat through the real route before verifying a 40-row cold page.
  await command('references-navigate', { screen: 'conversation' })
  await waitLabel(['保留原样的第 1 条历史内容。'])
  await launch('app')
  await goProvider('scene-a', 'minimal', 'light')
  const paged = await command('references-state', { scope: 'all' })
  verifyReport(paged, receipt.fixture.expected.all)
  assert.equal(paged.loadedConversations, 40, 'History mutations must start with only the initial page loaded')
  receipt.historyMutations = await command('references-history-mutations')
  assert.deepEqual(receipt.historyMutations, { create: 'one-record', localGuide: 'one-record', delete: 'one-record', savedCount: 81, historicalMessageBytesUnchanged: true })
  verifyReport(await command('references-state', { scope: 'all' }), receipt.fixture.expected.all)
  receipt.checks.push('With only 40 of 81 histories loaded, normal/guide creation and scoped deletion preserve every original saved message byte and all 81 records.')
  for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) for (const mode of ['light', 'dark']) {
    const identity = { family, mode, screen: 'references' }
    const initial = await goProvider('scene-a', family, mode)
    capture(`${family}-${mode}-closed`, initial, { ...identity, screen: 'closed' })
    await openReferences(41, identity)
    const state = await command('references-state', { scope: 'scene-a' })
    verifyReport(state, receipt.fixture.expected['scene-a'])
    assert(state.loadedConversations <= 41 && state.loadedConversations < 81, 'Older rows are inspected without loading complete history')
    await openReference('研究主备', labels('routing', 'name'))
    capture(`${family}-${mode}-route`, nodes(), { family, mode, screen: 'routing-editor' })
    await goProvider('scene-b')
    await openReferences(42, { family, mode, screen: 'backup-roles' })
    verifyReport(await command('references-state', { scope: 'scene-b' }), receipt.fixture.expected['scene-b'])
    await openReference('保留的工作 41', ['保留原样的第 41 条历史内容。'])
    const olderTree = nodes()
    verifyMessageBelowWarning(olderTree, '保留原样的第 41 条历史内容。')
    capture(`${family}-${mode}-older-conversation`, olderTree, { family, mode, screen: 'older-conversation' })
    const older = await command('references-state', { scope: 'all' })
    verifyReport(older, receipt.fixture.expected.all)
    assert.equal(older.loadedConversations, 41, 'Opening an older reference loads only its exact record, preserving the original page')
    await goProvider('scene-b')
    tap(find(await scrollTo(labels('connectionReferences', 'title')), labels('connectionReferences', 'title')))
    await openReference('资料研究', labels('scenes', 'name'))
    capture(`${family}-${mode}-scene`, nodes(), { family, mode, screen: 'scene-editor' })
    console.log(JSON.stringify({ family, mode, views: 6, passed: true }))
  }
  receipt.checks.push('Five native theme families × light/dark: on-demand references, exact route/scene navigation, and older rows checked without complete history hydration.')
  receipt.checks.push('An older conversation reference loads exactly one additional history record; all themes render its original message and all saved JSON bytes remain unchanged.')
  await goProvider('scene-a', 'minimal', 'light')
  await openReferences(41, { family: 'minimal', mode: 'light', screen: 'references-final' })
  const coverage = await scrollTo([], node => inspectLabels(0).some(text => label(node, text)))
  capture('native-reference-coverage', coverage, { family: 'minimal', mode: 'light', screen: 'coverage' })
  await command('references-navigate', { screen: 'routing-reference' })
  let tree = await waitLabel(labels('routing', 'name'))
  const input = tree.entries.find(node => node.class === 'android.widget.EditText' && node.text === '研究主备')
  assert(input, 'The exact referenced route name is the actual native input')
  tap(input); shell('input keyevent 123'); shell('input text I')
  await command('references-navigate', { family: 'monet', mode: 'dark' })
  tree = await until(() => {
    const tree = nodes()
    return tree.entries.some(node => node.class === 'android.widget.EditText' && node.text === '研究主备I' && node.focused === 'true') && tree
  }, 'native route draft remains focused through a theme change', 30000)
  capture('native-route-input-theme', tree, { family: 'monet', mode: 'dark', screen: 'route-input' })
  shell('input keyevent 4')
  tap(find(await scrollTo(labels('common', 'cancel')), labels('common', 'cancel')))
  tap(find(await scrollTo(labels('routing', 'discard')), labels('routing', 'discard')))
  receipt.checks.push('Actual referenced-route input retains text and focus through a theme change; discarding the local edit does not publish a template.')
  await goProvider('scene-a', 'monet', 'dark')
  await openReferences(41, { family: 'monet', mode: 'dark', screen: 'conversation-reference' })
  await openReference('当前研究会话', ['保留原样的第 1 条历史内容。'])
  capture('native-conversation-reference', nodes(), { family: 'monet', mode: 'dark', screen: 'conversation' })
  verifyReport(await command('references-state', { scope: 'all' }), receipt.fixture.expected.all)
  for (const kind of ['all', 'invalid', 'selected']) {
    await command('references-navigate', { screen: 'settings' })
    await command('references-navigate', { screen: 'providers' })
    tap(find(await scrollTo(labels('providerSettings', 'manageConnections')), labels('providerSettings', 'manageConnections')))
    if (kind === 'selected') {
      tap(find(await scrollTo(labels('providerSettings', 'selectionMode')), labels('providerSettings', 'selectionMode')))
      const names = labels('providerSettings', 'selectProvider').map(text => `${text} 研究连接 A`)
      tap(find(await scrollTo(names), names))
      tap(find(await scrollTo(labels('providerSettings', 'deleteSelected')), labels('providerSettings', 'deleteSelected')))
    } else {
      const names = labels('providerSettings', kind === 'all' ? 'clearAll' : 'clearInvalid')
      tap(find(await scrollTo(names), names))
    }
    const expected = kind === 'selected' ? 41 : 81
    tree = await until(() => {
      const tree = nodes()
      return tree.entries.some(node => countLabels('conversation', expected).some(text => `${node.text ?? ''} ${node['content-desc'] ?? ''}`.includes(text))) && tree
    }, `native ${kind} deletion impact`, 30000)
    capture(`native-delete-${kind}`, tree, { family: 'monet', mode: 'dark', screen: `delete-${kind}` })
    tap(find(await scrollTo(labels('common', 'cancel')), labels('common', 'cancel')))
    verifyReport(await command('references-state', { scope: 'all' }), receipt.fixture.expected.all)
  }
  receipt.checks.push('All/invalid/selected native deletion confirmations display reference counts; cancellation preserves configured objects and historical JSON bytes.')
  for (const screen of ['routing-missing', 'scene-missing']) {
    await command('references-navigate', { screen })
    capture(`native-${screen}`, await waitLabel(labels('connectionReferences', 'missing')), { family: 'monet', mode: 'dark', screen })
  }
  const draft = await command('references-draft')
  assert(draft.drafts.some(item => item.id === draft.draftId && item.messages === 0))
  assert.equal(draft.report.groups.find(group => group.kind === 'conversation').total, 42)
  assert.equal(draft.report.conversations.localDrafts, 1); assert.equal(draft.savedCount.count, 81)
  await goProvider('scene-a')
  await openReferences(42, { family: 'monet', mode: 'dark', screen: 'unsent-draft' })
  const draftCoverage = await scrollTo([], node => inspectLabels(1).some(text => label(node, text)))
  capture('native-draft-coverage', draftCoverage, { family: 'monet', mode: 'dark', screen: 'draft-coverage' })
  receipt.checks.push('Deleted template destinations show absence; a draft created through the existing local owner action counts separately without a saved conversation or sent message.')
  await command('references-navigate', { screen: 'help' })
  tree = await scrollTo([], node => /连接引用|Connection references/.test(node.text ?? ''))
  capture('native-reference-help', tree, { family: 'monet', mode: 'dark', screen: 'help' })
  receipt.checks.push('The actual offline reader includes the updated connection-reference guidance; the compiled guide has all three reviewed languages.')
  verifyPreserved()
  receipt.checks.push('The public production installation/APK and OS display, font, night-mode and accessibility settings remain unchanged.')
  receipt.completedAt = new Date().toISOString(); receipt.pass = true
  save('results.json', receipt)
  console.log(JSON.stringify({ views: receipt.pages.length, checks: receipt.checks.length, pass: true }))
}
main().catch(error => {
  receipt.errors.push({ message: error.message, stack: error.stack })
  try { capture('failure', nodes(), { screen: 'failure' }) } catch {}
  try { verifyPreserved() } catch (preservationError) { receipt.errors.push({ message: preservationError.message }) }
  save('results.json', receipt); console.error(error); process.exitCode = 1
})
