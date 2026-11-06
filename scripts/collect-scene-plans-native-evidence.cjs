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
const receipt = { schema: 'islemind.scene-plans-native-evidence.v1', startedAt: new Date().toISOString(),
  package: 'com.islemind.stage9', serial: option('--serial'), apkSha256: build.apkSha256, productionRelease: false,
  liveProviderRequests: 0, realCapabilityExecutions: 0, pages: [], checks: [], errors: [],
  scope: 'Actual ExpoRoot scenes, shared controls and Expo SQLite in an independent offline optimized Hermes APK. Synthetic connections/resources only; original public package and OS preferences are inspected without mutation.' }
const host = createNativeSceneQualificationHost({ root, out: path.resolve(option('--out') || ''), apk: path.resolve(option('--apk') || ''),
  build, adb: option('--adb'), serial: option('--serial'), sdk: option('--sdk'),
  authorized: args.includes('--isolated-install-authorized'), receipt })
const { install, launch, command, nodes, label, find, tap, waitLabel, scrollTo, capture, shell, pause, until, save, verifyPreserved } = host
const labels = (group, key) => [zh[group][key], en[group][key]]
const planRow = (tree, name) => tree.entries.find(node => node.clickable === 'true'
  && (node['content-desc']?.startsWith(name + ', ') || label(node, name)))
const inputNode = (tree, key) => tree.entries.find(node => node.class === 'android.widget.EditText' && labels('scenes', key).some(value => label(node, value)))
function radioAfter(tree, key, value) {
  const heading = tree.entries.filter(node => labels('scenes', key).some(text => label(node, text))).sort((a, b) => a.bounds[1] - b.bounds[1])[0]
  return heading && tree.entries.filter(node => node.clickable === 'true' && labels('scenes', value).some(text => label(node, text))
    && node.bounds[1] >= heading.bounds[1]).sort((a, b) => a.bounds[1] - b.bounds[1])[0]
}
async function goScenes(family, mode) {
  const state = await command('scene-navigate', { screen: 'scenes', ...(family ? { family, mode } : {}) })
  if (family) { assert.equal(state.themeId, family); assert.equal(state.theme, mode) }
  await waitLabel(labels('scenes', 'create'))
  return state
}
async function openPlan(name) {
  const tree = await scrollTo([name], node => node.clickable === 'true' && node['content-desc']?.startsWith(name + ', '))
  tap(planRow(tree, name))
  await waitLabel(labels('scenes', 'preview'))
}
async function preview() {
  tap(find(await scrollTo(labels('scenes', 'preview')), labels('scenes', 'preview')))
  await pause(250)
  return scrollTo(labels('scenes', 'refreshPreview'))
}
async function main() {
  install()
  await launch('bench'); await command('prepare-startup')
  receipt.fixture = await command('scene-fixture')
  assert.equal(receipt.fixture.integrity.integrity_check, 'ok')
  assert.equal(receipt.fixture.plans, 4)
  receipt.boundaries = await command('scene-boundaries')
  receipt.guide = await command('scene-guide')
  assert.equal(receipt.guide.models.length, 3)
  assert(receipt.guide.models.every(chapter => chapter.sceneAnchor && chapter.characters > 0))
  await launch('app')
  await goScenes('minimal', 'light')
  capture('initial-list', nodes(), { family: 'minimal', mode: 'light', screen: 'list' })
  await command('scene-navigate', { screen: 'capture' })
  let tree = await waitLabel(labels('scenes', 'name'))
  const name = inputNode(tree, 'name') ?? tree.entries.find(node => node.class === 'android.widget.EditText')
  assert(name, 'The actual captured-scene name input must be visible')
  tap(name); shell('input text NativeSceneH'); shell('input keyevent 4')
  tree = await scrollTo(labels('scenes', 'resources'))
  tap(find(tree, labels('scenes', 'resources')))
  tree = await scrollTo([], value => labels('scenes', 'enabledTools').some(text => label(value, text)))
  tap(radioAfter(tree, 'enabledTools', 'none'))
  tree = await scrollTo([], value => labels('scenes', 'knowledgeSources').some(text => label(value, text)))
  tap(radioAfter(tree, 'knowledgeSources', 'none'))
  capture('captured-resource-scope', nodes(), { family: 'minimal', mode: 'light', screen: 'resources' })
  tree = await scrollTo(labels('scenes', 'context'), undefined, 'up')
  tap(find(tree, labels('scenes', 'context')))
  tap(find(await scrollTo(labels('scenes', 'custom')), labels('scenes', 'custom')))
  tree = await scrollTo([], node => node.class === 'android.widget.EditText' && node.text === '80')
  tap(tree.entries.find(node => node.class === 'android.widget.EditText' && node.text === '80'))
  shell('input keyevent 123'); shell('input keyevent 67'); shell('input keyevent 67'); shell('input text 65')
  await command('scene-navigate', { family: 'monet', mode: 'dark' })
  const focused = await until(async () => {
    const state = await command('scene-state')
    const keyboard = state.keyboard, bounds = state.focusedInputBounds
    return keyboard?.height > 0 && bounds?.height > 0 && bounds.y >= 0
      && bounds.y + bounds.height <= keyboard.screenY - 8 && state
  }, 'The actual scene input remains above the keyboard after a theme change', 30000)
  tree = nodes()
  assert(tree.entries.some(node => node.class === 'android.widget.EditText' && node.text === '65' && node.focused === 'true'))
  receipt.nativeInput = { text: '65', keyboard: focused.keyboard, bounds: focused.focusedInputBounds,
    gap: focused.keyboard.screenY - focused.focusedInputBounds.y - focused.focusedInputBounds.height }
  capture('input-after-theme', tree, { family: 'monet', mode: 'dark', screen: 'context' })
  shell('input keyevent 4')
  tap(find(await scrollTo(labels('scenes', 'auto')), labels('scenes', 'auto')))
  tap(find(await scrollTo(labels('common', 'save')), labels('common', 'save')))
  await waitLabel(labels('scenes', 'saved'))
  let state = await command('scene-state')
  const nativePlan = state.scenePlans.find(plan => plan.name === 'NativeSceneH')
  assert(nativePlan && nativePlan.configuration.contextPolicy.remoteCompactThreshold === 0.65)
  assert.deepEqual(nativePlan.configuration.enabledTools, []); assert.deepEqual(nativePlan.configuration.knowledgeSources, [])
  assert.equal(nativePlan.configuration.toolDeclarationMode, 'auto')
  receipt.nativePlan = { id: nativePlan.id, name: nativePlan.name }
  receipt.checks.push('Actual capture route, resource-none radios, Android input/focus through a theme change, and explicit Settings save.')
  await launch('app'); await goScenes()
  assert((await command('scene-state')).scenePlans.some(plan => plan.id === nativePlan.id))
  capture('saved-after-restart', nodes(), { family: 'monet', mode: 'dark', screen: 'list' })
  await openPlan('资料研究'); await preview()
  capture('route-resource-preview', nodes(), { family: 'monet', mode: 'dark', screen: 'preview' })
  tap(find(await scrollTo(labels('scenes', 'apply')), labels('scenes', 'apply')))
  await waitLabel(labels('scenes', 'applied'))
  state = await command('scene-state')
  assert.equal(state.canonical.scenePlanSource.id, 'scene-research')
  assert.equal(state.canonical.scenePlanSource.revision, 1)
  assert.equal(state.canonical.routingPlan.backup.providerId, 'scene-b')
  assert.equal(state.canonical.routingPlan.crossProvider, 'ask')
  assert.equal(state.canonical.resourceScopeOverride.tools, 'selected')
  assert.equal(state.global.mcpEnabled, false); assert.equal(state.global.knowledgeEnabled, false)
  assert.deepEqual(state.historicalMessageBytes, receipt.fixture.historicalMessageBytes)
  capture('applied-existing', nodes(), { family: 'monet', mode: 'dark', screen: 'applied' })
  receipt.checks.push('Native preview and application use exact route/resource identities; real SQLite preserves historical JSON bytes and global feature switches.')
  await goScenes(); await openPlan('待补全的方案'); await preview()
  tree = await scrollTo(labels('scenes', 'apply'), node => labels('scenes', 'apply').some(text => label(node, text)))
  assert(tree.entries.some(node => labels('scenes', 'apply').some(text => label(node, text)) && node.enabled === 'false'))
  capture('missing-references', tree, { family: 'monet', mode: 'dark', screen: 'missing' })
  await goScenes(); await openPlan('专注写作')
  tap(find(await scrollTo(labels('scenes', 'editTemplate')), labels('scenes', 'editTemplate')))
  tree = await waitLabel(labels('scenes', 'description'))
  const description = inputNode(tree, 'description') ?? tree.entries.filter(node => node.class === 'android.widget.EditText')[1]
  tap(description); shell('input keyevent 123')
  // The synthetic description is deliberately replaced only in this independent editor.
  for (let index = 0; index < 24; index++) shell('input keyevent 67')
  shell('input text KeepLocalDraft'); shell('input keyevent 4')
  await command('scene-conflict')
  tree = await waitLabel(labels('scenes', 'templateConflict'))
  assert(tree.entries.some(node => node.class === 'android.widget.EditText' && node.text.includes('KeepLocalDraft')))
  capture('template-conflict', tree, { family: 'monet', mode: 'dark', screen: 'conflict' })
  tap(find(await scrollTo(labels('scenes', 'saveAsNew')), labels('scenes', 'saveAsNew')))
  tree = await scrollTo([], node => node.class === 'android.widget.EditText', 'up')
  const copyName = inputNode(tree, 'name') ?? tree.entries.find(node => node.class === 'android.widget.EditText')
  tap(copyName); shell('input keyevent 123')
  for (let index = 0; index < 8; index++) shell('input keyevent 67')
  shell('input text NativeCopyH'); shell('input keyevent 4')
  tap(find(await scrollTo(labels('common', 'save')), labels('common', 'save')))
  await waitLabel(labels('scenes', 'saved'))
  state = await command('scene-state')
  assert.equal(state.canonical.scenePlanSource.revision, 1)
  assert(state.scenePlans.some(plan => plan.name === 'NativeCopyH'))
  receipt.checks.push('Missing references disable actual Apply; a concurrent template revision keeps local text and supports Save as new without changing the applied conversation copy.')
  for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) for (const mode of ['light', 'dark']) {
    await goScenes(family, mode)
    capture(`${family}-${mode}-list`, nodes(), { family, mode, screen: 'list' })
    await openPlan('资料研究'); await preview()
    capture(`${family}-${mode}-preview`, nodes(), { family, mode, screen: 'preview' })
    tap(find(await scrollTo(labels('scenes', 'editTemplate')), labels('scenes', 'editTemplate')))
    await waitLabel(labels('scenes', 'name'))
    capture(`${family}-${mode}-editor`, nodes(), { family, mode, screen: 'editor' })
    console.log(JSON.stringify({ family, mode, views: 3 }))
  }
  await goScenes('animal-island-ui', 'dark'); await openPlan('NativeSceneH')
  tree = await scrollTo([], node => node.clickable === 'true' && labels('scenes', 'target').some(text => node['content-desc']?.startsWith(text)))
  tap(tree.entries.find(node => node.clickable === 'true' && labels('scenes', 'target').some(text => node['content-desc']?.startsWith(text))))
  tree = await waitLabel(labels('scenes', 'newConversation'))
  const newTarget = find(tree, labels('scenes', 'newConversation'))
  assert(newTarget?.clickable === 'true' && newTarget.enabled === 'true', 'The unselected native target exposes an enabled click action')
  receipt.nativeTargetChoice = { label: newTarget['content-desc'] || newTarget.text, clickable: true,
    enabled: true, focusable: newTarget.focusable, bounds: newTarget.bounds }
  capture('native-target-choice', tree, { family: 'animal-island-ui', mode: 'dark', screen: 'target' })
  tap(newTarget)
  await preview()
  tap(find(await scrollTo(labels('scenes', 'createAndApply')), labels('scenes', 'createAndApply')))
  await waitLabel(labels('scenes', 'draftApplied'))
  state = await command('scene-state')
  const draft = state.drafts.find(item => item.source.id === nativePlan.id)
  assert(draft && draft.messages === 0 && draft.resources.tools === 'none' && draft.resources.knowledge === 'none')
  capture('new-unsent-draft', nodes(), { family: 'animal-island-ui', mode: 'dark', screen: 'draft' })
  tap(find(await scrollTo(labels('scenes', 'openConversation')), labels('scenes', 'openConversation')))
  await pause(500)
  capture('opened-unsent-chat', nodes(), { family: 'animal-island-ui', mode: 'dark', screen: 'chat' })
  receipt.checks.push('Actual Animal Island shared Select chooses a new target; Apply creates an unsent draft with explicit resource-none scopes.')
  await command('scene-navigate', { screen: 'help' })
  capture('offline-models-help', await waitLabel(['模型与回答', 'Models & answers']), { family: 'animal-island-ui', mode: 'dark', screen: 'help' })
  tree = await scrollTo(labels('scenes', 'title'), node => labels('scenes', 'title').some(text => label(node, text)))
  capture('offline-scene-help', tree, { family: 'animal-island-ui', mode: 'dark', screen: 'help' })
  receipt.checks.push('The actual offline reader contains the scene-plan section from the synchronized guide build inputs.')
  verifyPreserved()
  receipt.checks.push('Five actual native theme families × light/dark use shared list/editor/preview controls; the original public installation and OS preferences remain unchanged.')
  receipt.completedAt = new Date().toISOString(); receipt.pass = true
  save('results.json', receipt)
  console.log(JSON.stringify({ package: receipt.package, device: receipt.device, views: receipt.pages.length, checks: receipt.checks.length, pass: true }))
}
main().catch(error => {
  receipt.errors.push({ message: error.message, stack: error.stack })
  try { capture('failure', nodes(), { family: 'minimal', mode: 'light', screen: 'failure' }) } catch {}
  try { verifyPreserved() } catch (preservationError) { receipt.errors.push({ message: preservationError.message }) }
  save('results.json', receipt); console.error(error); process.exitCode = 1
})
