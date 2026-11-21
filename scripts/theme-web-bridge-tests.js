#!/usr/bin/env bun

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { parseTypeScriptModule, transformTypeScriptModule } = require('./node-ts-support')
const { getColors } = await import('../src/theme/colors')
const { resolveBackgroundEnvironment } = await import('../src/theme/backgroundEnvironment')

const filename = path.resolve(__dirname, '../app/_layout.tsx')
const source = fs.readFileSync(filename, 'utf8')
const declaration = parseTypeScriptModule(source, filename).program.body.find(
  node => node.type === 'FunctionDeclaration' && node.id?.name === 'useWebThemeBridge',
)
assert.ok(declaration, 'The application owns the runtime Web theme bridge')
const code = transformTypeScriptModule(source.slice(declaration.start, declaration.end), filename)

function harness(os = 'web', withDocument = true) {
  const attributes = { 'data-theme-mode-preference': 'light' }
  const styles = {}
  let dependencies
  const context = {
    Platform: { OS: os },
    useLayoutEffect(effect, next) {
      if (!dependencies || next.some((value, index) => !Object.is(value, dependencies[index]))) effect()
      dependencies = next
    },
    ...(withDocument ? { document: { documentElement: {
      setAttribute(name, value) { attributes[name] = value },
      style: { setProperty(name, value) { styles[name] = value } },
    } } } : {}),
  }
  const render = vm.runInNewContext(code + '\nuseWebThemeBridge', context, { filename })
  return { render, attributes, styles }
}

let checks = 0
for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) {
  const bridge = harness()
  for (const mode of ['light', 'dark']) {
    const colors = getColors(mode, family)
    const props = { canonicalThemeId: family, colors, design: colors.design, mode, ready: true,
      backgroundEnvironment: resolveBackgroundEnvironment({ family, mode, startupSeed: 0 }) }
    bridge.render({ ...props, themeMode: mode })
    assert.equal(bridge.attributes['data-theme-id'], family)
    assert.equal(bridge.attributes['data-theme-mode'], mode)
    assert.equal(bridge.attributes['data-theme-mode-preference'], mode, `${family}/${mode} replaces the prepaint preference`)
    assert.equal(bridge.styles['color-scheme'], mode)
    // All resolved tokens stay identical: switching to system still reruns the bridge.
    bridge.render({ ...props, themeMode: 'system' })
    assert.equal(bridge.attributes['data-theme-mode-preference'], 'system', `${family}/${mode} keeps system separate from its resolved mode`)
    assert.equal(bridge.attributes['data-theme-mode'], mode)
    bridge.render({ ...props, themeMode: mode })
    assert.equal(bridge.attributes['data-theme-mode-preference'], mode)
    checks += 3
  }
}

const colors = getColors('light', 'minimal')
const props = { canonicalThemeId: 'minimal', colors, design: colors.design, mode: 'light', themeMode: 'dark', ready: true,
  backgroundEnvironment: resolveBackgroundEnvironment({ family: 'minimal', mode: 'light', startupSeed: 0 }) }
for (const os of ['android', 'ios']) {
  const bridge = harness(os)
  bridge.render(props)
  assert.deepEqual(bridge.attributes, { 'data-theme-mode-preference': 'light' })
  assert.deepEqual(bridge.styles, {})
  checks += 1
}
const pending = harness()
pending.render({ ...props, ready: false })
assert.deepEqual(pending.attributes, { 'data-theme-mode-preference': 'light' })
assert.deepEqual(pending.styles, {})
harness('web', false).render(props)
checks += 2
console.log(`theme Web bridge tests passed: ${checks} runtime preference, system resolution and platform/readiness cases`)
