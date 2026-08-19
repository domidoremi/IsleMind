#!/usr/bin/env node

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8')
const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')
const prepaintSource = html.match(/<script>\s*(\(function prepaintIsleMindTheme\(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1]

assert.ok(prepaintSource, 'public index contains the inline prepaint bootstrap')

const palettes = {
  'minimal:light': ['#F8FAF9', '#17201D'],
  'minimal:dark': ['#101513', '#ECF4F0'],
  'monet:light': ['#F4F6F2', '#17201D'],
  'monet:dark': ['#101918', '#ECF4F0'],
  'material:light': ['#FFFBFE', '#1D1B20'],
  'material:dark': ['#1C1B1F', '#E6E1E5'],
  'liquid-glass:light': ['#EAF2F8', '#152331'],
  'liquid-glass:dark': ['#0D1722', '#EFF8FF'],
}

function runPrepaint({ persisted, systemDark = false, storageThrows = false } = {}) {
  const attributes = Object.create(null)
  const styles = Object.create(null)
  const rootElement = {
    setAttribute(name, value) {
      attributes[name] = String(value)
    },
    style: {
      setProperty(name, value) {
        styles[name] = String(value)
      },
    },
  }
  const windowObject = {
    matchMedia: () => ({ matches: systemDark }),
  }
  if (storageThrows) {
    Object.defineProperty(windowObject, 'localStorage', {
      get() {
        throw new Error('storage unavailable')
      },
    })
  } else {
    windowObject.localStorage = {
      getItem(key) {
        assert.equal(key, '@islemind/settings')
        return persisted === undefined ? null : persisted
      },
    }
  }

  vm.runInNewContext(prepaintSource, {
    window: windowObject,
    document: { documentElement: rootElement },
    JSON,
    console,
  }, { filename: 'public/index.html' })

  return { attributes, styles }
}

function testMatrix() {
  for (const family of ['minimal', 'monet', 'material', 'liquid-glass']) {
    for (const mode of ['light', 'dark']) {
      const result = runPrepaint({ persisted: JSON.stringify({ themeId: family, theme: mode }) })
      assert.equal(result.attributes['data-theme-id'], family, `${family}/${mode} keeps the canonical family`)
      assert.equal(result.attributes['data-theme-mode'], mode, `${family}/${mode} resolves the explicit mode`)
      assert.equal(result.attributes['data-theme-mode-preference'], mode, `${family}/${mode} keeps the mode preference`)
      assert.equal(result.styles['--prepaint-canvas'], palettes[`${family}:${mode}`][0], `${family}/${mode} paints the canonical canvas`)
      assert.equal(result.styles['--prepaint-content'], palettes[`${family}:${mode}`][1], `${family}/${mode} paints readable content`)
    }
  }
}

function testSystemDark() {
  const result = runPrepaint({
    persisted: JSON.stringify({ themeId: 'liquid-glass', theme: 'system' }),
    systemDark: true,
  })
  assert.equal(result.attributes['data-theme-id'], 'liquid-glass')
  assert.equal(result.attributes['data-theme-mode'], 'dark')
  assert.equal(result.attributes['data-theme-mode-preference'], 'system')
}

function testAliasesAndInvalidRecords() {
  const aliases = [
    ['lime-road', 'monet'],
    ['cartoon', 'monet'],
    ['island', 'monet'],
    ['markdown', 'material'],
    ['material-3', 'material'],
    ['material3', 'material'],
    ['glass', 'liquid-glass'],
    ['liquid', 'liquid-glass'],
  ]
  for (const [alias, canonical] of aliases) {
    const result = runPrepaint({ persisted: JSON.stringify({ themeId: alias, theme: 'dark' }) })
    assert.equal(result.attributes['data-theme-id'], canonical, `${alias} migrates to ${canonical}`)
    assert.equal(result.attributes['data-theme-mode'], 'dark')
  }

  for (const persisted of ['{broken', JSON.stringify(null), JSON.stringify({ themeId: 'unknown', theme: 'sepia' })]) {
    const result = runPrepaint({ persisted })
    assert.equal(result.attributes['data-theme-id'], 'minimal', 'invalid persisted family fails closed to Minimal')
    assert.equal(result.attributes['data-theme-mode'], 'light', 'invalid persisted mode fails closed to Light')
  }

  const storageFailure = runPrepaint({ storageThrows: true, systemDark: true })
  assert.equal(storageFailure.attributes['data-theme-id'], 'minimal', 'storage failure keeps the safe family')
  assert.equal(storageFailure.attributes['data-theme-mode'], 'light', 'storage failure does not infer an untrusted mode')
  assert.equal(storageFailure.attributes['data-theme-custom-accent'], 'false')
}

function testAccentValidation() {
  const valid = [
    ['#abc', '#AABBCC'],
    ['4455B7', '#4455B7'],
    ['#123456', '#123456'],
  ]
  for (const [input, expected] of valid) {
    const result = runPrepaint({ persisted: JSON.stringify({ themeAccent: input }) })
    assert.equal(result.attributes['data-theme-custom-accent'], 'true', `${input} is a valid custom accent`)
    assert.equal(result.styles['--prepaint-accent'], expected, `${input} is normalized before paint`)
  }

  for (const input of ['#12', '#12345', 'javascript:red', 42, null]) {
    const result = runPrepaint({ persisted: JSON.stringify({ themeAccent: input }) })
    assert.equal(result.attributes['data-theme-custom-accent'], 'false', `${String(input)} is rejected as a custom accent`)
    assert.equal(result.styles['--prepaint-accent'], undefined)
  }
}

function testRevealContract() {
  assert.match(html, /html\[data-theme-prepaint='v1'\]:not\(\[data-theme-ready='true'\]\) #root/)
  assert.match(html, /data-theme-prepaint', 'v1'/)
  assert.match(layout, /data-theme-ready', 'true'/)
  assert.match(layout, /data-theme-presentation-id', canonicalThemeId/)
  assert.match(layout, /--theme-family', canonicalThemeId/)
}

testMatrix()
testSystemDark()
testAliasesAndInvalidRecords()
testAccentValidation()
testRevealContract()

console.log('theme prepaint tests passed: 8 canonical states, system-dark, aliases, corrupt storage, accent validation, and reveal contract')
