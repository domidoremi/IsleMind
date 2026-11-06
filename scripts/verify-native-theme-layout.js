const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { PNG } = require('pngjs')
const { collectReleaseSourceFreshness } = require('./release-freshness-contract')
const { isValidAdbDeviceSerial } = require('./release-validation-contract')
const { isNativeInputViewShown, validateSystemImeControl } = require('./native-theme-ime-policy')

const root = path.resolve(__dirname, '..')
const appPackage = 'com.islemind.app'
const familyKeys = {
  minimal: 'themeMinimal', monet: 'themeMonet', material: 'themeMaterial',
  'liquid-glass': 'themeLiquidGlass', 'animal-island-ui': 'themeAnimalIsland',
}
const testFamilies = ['liquid-glass', 'animal-island-ui', 'minimal', 'monet', 'material']
const routes = [
  '/', 'settings', 'conversations', 'chat/native-theme-layout-missing', 'documents', 'settings/preferences',
  'settings/providers', 'settings/context',
  'settings/knowledge', 'settings/memory', 'settings/skills', 'settings/mcp',
  'settings/agents', 'settings/usage',
]
const routeIds = {
  '/': 'composer-input-dock', settings: 'settings-groups',
  conversations: 'conversation-history-screen', 'settings/providers': 'provider-empty',
}
const routeTitleKeys = {
  'chat/native-theme-layout-missing': 'conversation.unavailable',
  documents: 'documents.title', 'settings/preferences': 'settings.preferences',
  'settings/context': 'settings.context',
  'settings/knowledge': 'settings.knowledge', 'settings/memory': 'settings.memory',
  'settings/skills': 'settings.skills', 'settings/mcp': 'settings.mcp',
  'settings/agents': 'agents.title', 'settings/usage': 'usage.title',
}

function main() {
  const args = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]
    assert.ok(['--device', '--output', '--apk', '--restore-family', '--restore-mode', '--scope', '--resume', '--system-ime-control'].includes(key), `Unsupported argument: ${key}`)
    assert.ok(process.argv[i + 1], `Missing value for ${key}`)
    args[key.slice(2)] = process.argv[i + 1]
  }
  const scope = args.scope || 'full'
  assert.ok(['full', 'interaction-layout'].includes(scope), 'Unsupported native qualification scope')
  // The focused scope complements exhaustive web rendering and full-route device captures.
  const measuredRoutes = scope === 'full' ? routes : routes.filter(route => ['/', 'settings', 'settings/providers'].includes(route))
  const device = args.device
  assert.ok(isValidAdbDeviceSerial(device), 'One explicit authorized device is required')
  assert.ok(Object.hasOwn(familyKeys, args['restore-family']), 'An original family is required')
  assert.ok(['light', 'dark', 'system'].includes(args['restore-mode']), 'An original mode is required')
  const output = path.resolve(args.output || '')
  assert.ok(output.startsWith(path.join(root, 'test-evidence', 'qa') + path.sep), 'Evidence must stay inside test-evidence/qa')
  fs.mkdirSync(output, { recursive: true })
  const apkPath = path.resolve(args.apk || '')
  const stat = fs.statSync(apkPath)
  const apk = {
    path: path.relative(root, apkPath), exists: true, sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex'),
  }
  assert.equal(collectReleaseSourceFreshness(root, apk).status, 'current', 'The APK must contain the current workspace')
  const devices = execFileSync('adb', ['devices'], { encoding: 'utf8' })
  assert.ok(devices.split(/\r?\n/).some(line => line.trim() === `${device}\tdevice`), 'Authorized device is not ready')
  let sequence = 0
  const adb = (...command) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return execFileSync('adb', ['-s', device, ...command], {
          encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
      } catch (error) {
        // A daemon startup failure occurs before delivery; never replay an ambiguous tap.
        const startupFailed = /cannot connect to daemon|failed to start daemon|could not read ok from ADB Server/i.test(String(error.stderr || ''))
        if (!startupFailed || attempt === 2) throw error
        console.warn('ADB startup transient; retrying an undelivered command.')
        sleep(1000 * (attempt + 1))
      }
    }
  }
  const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  const installedPath = adb('shell', 'pm', 'path', appPackage).split(/\r?\n/).find(line => line.endsWith('/base.apk'))?.slice(8)
  assert.ok(installedPath, 'Installed app APK is unavailable')
  assert.equal(adb('shell', 'sha256sum', installedPath).split(/\s+/)[0], apk.sha256, 'Installed bytes must match the current APK')
  const originalNight = adb('shell', 'cmd', 'uimode', 'night').match(/Night mode:\s*(yes|no|auto)\b/)?.[1]
  assert.ok(originalNight, 'System night mode must be restorable before testing')
  const originalFontScale = adb('shell', 'settings', 'get', 'system', 'font_scale')
  assert.ok(originalFontScale === 'null' || /^\d+(\.\d+)?$/.test(originalFontScale), 'System font scale must be restorable')
  const originalDensity = adb('shell', 'wm', 'density')
  const originalDensityOverride = originalDensity.match(/Override density:\s*(\d+)/)?.[1]
  let density = Number(originalDensity.match(/(?:Override|Physical) density:\s*(\d+)/g)?.at(-1)?.match(/\d+/)?.[0]) / 160
  assert.ok(density > 0, 'Display density is unavailable')
  const initialPng = PNG.sync.read(execFileSync('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { maxBuffer: 8 * 1024 * 1024 }))
  const viewport = { width: initialPng.width, height: initialPng.height }
  const locales = ['zh-CN', 'en', 'ja'].map(locale => require(path.join(root, 'src', 'i18n', 'resources', `${locale}.json`)))
  const labels = key => locales.map(locale => locale.settings[key])
  const report = { device, scope, routes: measuredRoutes, apkSha256: apk.sha256, viewport, density, originalNight, originalFontScale, originalDensity, checks: [], captures: [], restoration: {}, passed: false }
  let systemImeControl
  if (args['system-ime-control']) {
    const controlPath = path.resolve(args['system-ime-control'])
    assert.ok(controlPath.startsWith(path.join(root, 'test-evidence', 'qa') + path.sep), 'IME control must stay inside test-evidence/qa')
    const bytes = fs.readFileSync(controlPath)
    systemImeControl = validateSystemImeControl(JSON.parse(bytes.toString()), device,
      adb('shell', 'settings', 'get', 'secure', 'default_input_method'))
    report.systemImeControl = { ...systemImeControl, path: path.relative(root, controlPath),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
    fs.writeFileSync(path.join(output, 'system-ime-control.json'), bytes)
  }
  const completedModes = new Set()
  if (args.resume) {
    const resumePath = path.resolve(args.resume)
    assert.ok(resumePath.startsWith(path.join(root, 'test-evidence', 'qa') + path.sep), 'Resume evidence must stay inside test-evidence/qa')
    const previous = JSON.parse(fs.readFileSync(resumePath, 'utf8'))
    assert.equal(previous.device, device)
    assert.equal(previous.apkSha256, apk.sha256)
    assert.equal(previous.sourceFreshness, 'current')
    assert.equal(previous.restoration.passed, true)
    assert.equal(previous.scope, scope)
    assert.deepEqual(previous.routes, measuredRoutes)
    const previousDir = path.dirname(resumePath)
    report.resumedFrom = path.relative(root, resumePath)
    report.resumedModes = []
    for (const family of testFamilies) {
      for (const mode of ['light', 'dark']) {
        const prefix = `${family}-${mode}-`
        const coldId = `${prefix}cold-persistence`
        if (!previous.checks.some(check => check.id === coldId && check.coldPersistence && check.family === family && check.mode === mode)) continue
        const expectedIds = [`${prefix}appearance`, coldId, ...measuredRoutes.map(route =>
          `${prefix}${route === '/' ? 'home' : route.replaceAll('/', '-')}`)]
        const captures = expectedIds.map(id => previous.captures.find(capture => capture.id === id))
        assert.ok(captures.every(Boolean), 'A resumed mode must contain every required capture')
        for (const capture of captures) {
          for (const file of [capture.image, capture.xml]) {
            assert.equal(path.basename(file), file, 'Resume capture names must be local basenames')
            if (previousDir !== output) fs.copyFileSync(path.join(previousDir, file), path.join(output, file))
          }
          const png = PNG.sync.read(fs.readFileSync(path.join(output, capture.image)))
          assert.equal(png.width, viewport.width); assert.equal(png.height, viewport.height)
          assert.ok(fs.readFileSync(path.join(output, capture.xml), 'utf8').includes(`package="${appPackage}"`))
          report.captures.push(capture)
        }
        report.checks.push(...previous.checks.filter(check => check.id.startsWith(prefix)))
        completedModes.add(`${family}/${mode}`)
        report.resumedModes.push(`${family}/${mode}`)
      }
    }
  }
  fs.writeFileSync(path.join(output, 'original-device-state.json'), JSON.stringify({
    device, night: originalNight, fontScale: originalFontScale, density: originalDensity,
    family: args['restore-family'], mode: args['restore-mode'],
  }, null, 2) + '\n')
  let ownRouteOpen = false
  const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const bounds = node => {
    const values = node.bounds?.match(/\d+/g)?.map(Number)
    return values?.length === 4 ? { left: values[0], top: values[1], right: values[2], bottom: values[3] } : null
  }
  const scrollBounds = capture => {
    const node = capture.nodes.find(item => item.scrollable === 'true' && item.class === 'android.widget.ScrollView')
      || capture.nodes.find(item => item['resource-id'] === 'android:id/content')
    return node && bounds(node) || { left: 0, top: 0, right: viewport.width, bottom: viewport.height }
  }
  function snapshot(id, image = true) {
    const xmlPath = path.join(output, `${id}.xml`)
    fs.writeFileSync(path.join(output, `${id}-dump.log`), adb('shell', 'uiautomator', 'dump', '/sdcard/islemind-native-theme-layout.xml'))
    adb('pull', '/sdcard/islemind-native-theme-layout.xml', xmlPath)
    const xml = fs.readFileSync(xmlPath, 'utf8')
    assert.ok(xml.includes(`package="${appPackage}"`), `${id}: app is not visible`)
    const nodes = [...xml.matchAll(/<node\b([^>]+)>?/g)].map(match => Object.fromEntries(
      [...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], decode(attribute[2])]),
    ))
    let png
    if (image) {
      const bytes = execFileSync('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { maxBuffer: 8 * 1024 * 1024 })
      fs.writeFileSync(path.join(output, `${id}.png`), bytes)
      png = PNG.sync.read(bytes)
      assert.equal(png.width, viewport.width)
      assert.equal(png.height, viewport.height)
      report.captures.push({ id, xml: `${id}.xml`, image: `${id}.png` })
    }
    return { nodes, png }
  }
  function navigate(route) {
    // Pop only our preceding, unedited QA route instead of growing the stack.
    if (ownRouteOpen) {
      adb('shell', 'input', 'keyevent', '4')
      sleep(220)
    }
    adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `islemind://${route}`, '-n', `${appPackage}/.MainActivity`)
    ownRouteOpen = true
    sleep(600)
  }
  const swipe = forward => adb('shell', 'input', 'swipe',
    String(Math.round(viewport.width * 0.86)), String(Math.round(viewport.height * (forward ? 0.8 : 0.3))),
    String(Math.round(viewport.width * 0.86)), String(Math.round(viewport.height * (forward ? 0.3 : 0.8))), '280')
  function choose(key, family = false) {
    navigate('settings/system/appearance')
    for (let i = 0; i < 5; i++) swipe(false)
    const names = labels(family ? familyKeys[key] : { light: 'themeLight', dark: 'themeDark', system: 'themeSystem' }[key])
    const matches = node => names.some(label => family ? node['content-desc']?.startsWith(`${label}. `) : node['content-desc'] === label)
    for (let attempt = 0; attempt < 12; attempt++) {
      const capture = snapshot(`selection-${++sequence}`, false)
      const clip = scrollBounds(capture)
      const options = capture.nodes.filter(matches)
      if (options.some(node => node.checked === 'true')) return
      const safeBounds = node => {
        const b = bounds(node)
        if (!b) return null
        return { left: Math.max(b.left, clip.left + density, 0), right: Math.min(b.right, clip.right - density, viewport.width),
          top: Math.max(b.top, 120, clip.top + density), bottom: Math.min(b.bottom, viewport.height - 120, clip.bottom - density) }
      }
      // A scroll-clipped card still offers a valid 44dp target; do not fling past it.
      const option = options.find(node => {
        const b = safeBounds(node)
        return b && b.right - b.left >= density * 44 - 2 && b.bottom - b.top >= density * 44 - 2
      })
      if (option) {
        const b = safeBounds(option)
        adb('shell', 'input', 'tap', String(Math.round((b.left + b.right) / 2)), String(Math.round((b.top + b.bottom) / 2)))
        sleep(800)
        const next = snapshot(`selection-${++sequence}`, false)
        assert.ok(next.nodes.some(node => matches(node) && node.checked === 'true'), `Choice did not apply: ${key}`)
        // The status stays above the gallery, including when the chosen card
        // needed scrolling. Verify the receipt independently of card visibility.
        for (let i = 0; i < 5; i++) swipe(false)
        const confirmed = snapshot(`selection-saved-${++sequence}`, false)
        assert.ok(confirmed.nodes.some(node => locales.some(locale =>
          node.text === locale.settings.appearanceApplied || node['content-desc'] === locale.settings.appearanceApplied,
        )), `Choice was not durably confirmed: ${key}`)
        return
      }
      swipe(true)
    }
    throw new Error(`Theme option is not reachable: ${key}`)
  }
  function checkPalette(capture, mode, id) {
    const values = [0.25, 0.5, 0.75].flatMap(y => [8, viewport.width - 9].map(x => {
      const offset = (Math.round(viewport.height * y) * viewport.width + x) * 4
      const rgb = [...capture.png.data.subarray(offset, offset + 3)].map(value => {
        const c = value / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    })).sort((a, b) => a - b)
    const luminance = values[Math.floor(values.length / 2)]
    assert.ok(mode === 'light' ? luminance > 0.45 : luminance < 0.3, `${id}: ${mode} did not reach the native surface (${luminance})`)
    report.checks.push({ id: `${id}:palette`, luminance, mode })
  }
  function checkDestination(capture, route, id) {
    const resourceId = routeIds[route]
    const key = routeTitleKeys[route]
    const names = key ? locales.map(locale => key.split('.').reduce((value, segment) => value?.[segment], locale)) : []
    if (key) assert.ok(names.every(name => typeof name === 'string'), `${id}: destination title contract is unavailable`)
    assert.ok(capture.nodes.some(node => {
      const b = bounds(node)
      return b && b.right > b.left && b.bottom > b.top && (resourceId
        ? node['resource-id'] === resourceId
        : names.includes(node.text) || names.includes(node['content-desc']))
    }), `${id}: deep link did not display the requested destination`)
    report.checks.push({ id: `${id}:destination`, route, marker: resourceId || key })
  }
  function homeInput(capture, id) {
    const names = locales.map(locale => locale.chat.inputAccessibility)
    const input = capture.nodes.find(node => node.class === 'android.widget.EditText' && names.includes(node['content-desc']))
    assert.ok(input, `${id}: native composer input is inaccessible`)
    return input
  }
  function checkHomeControls(capture, id) {
    const input = homeInput(capture, id)
    const b = bounds(input)
    assert.ok(b && b.left >= 0 && b.right <= viewport.width && b.right > b.left && b.bottom > b.top, `${id}: composer input overflows horizontally`)
    // The reserved, inaccessible idle receipt is not an interactive header action.
    const topControls = capture.nodes.filter(node => node.clickable === 'true' && node.enabled !== 'false' && bounds(node)?.top < viewport.height * 0.2)
    assert.equal(topControls.length, 4, `${id}: history, model, new-chat and settings controls must remain accessible`)
    for (const control of topControls) {
      const box = bounds(control)
      assert.ok(box && box.left >= 0 && box.right <= viewport.width
        && box.bottom - box.top >= density * 44 - 2, `${id}: header control is clipped or undersized`)
    }
    report.checks.push({ id: `${id}:controls`, headerControls: topControls.length, inputBounds: b })
  }
  function checkActionCenter(capture, id, names) {
    const node = capture.nodes.find(node => node.clickable === 'true' && names.includes(node['content-desc']))
    assert.ok(node, `${id}: empty-state action is unavailable`)
    const b = bounds(node)
    assert.ok(b && b.right > b.left && b.bottom > b.top, `${id}: action has invalid bounds`)
    const horizontalError = Math.abs((b.left + b.right) / 2 - viewport.width / 2)
    assert.ok(horizontalError <= density * 2, `${id}: action is off center by ${horizontalError}px`)
    assert.ok(b.left >= 0 && b.right <= viewport.width, `${id}: action overflows the screen`)
    assert.ok(b.bottom - b.top >= density * 44 - 2, `${id}: action misses the touch target`)
    const text = capture.nodes.find(node => names.includes(node.text) && bounds(node)?.left >= b.left && bounds(node)?.right <= b.right)
    const textBounds = text && bounds(text)
    assert.ok(textBounds, `${id}: action label is missing`)
    assert.ok(Math.abs((textBounds.left + textBounds.right) / 2 - (b.left + b.right) / 2) <= density * 2, `${id}: label is not centered`)
    report.checks.push({ id: `${id}:center`, bounds: b, horizontalError })
  }
  function checkProviderCenter(capture, id) {
    checkActionCenter(capture, id, locales.map(locale => locale.settingsUx.addConnection))
  }
  function checkAppearanceLayout(capture, id) {
    const modeLabels = ['themeLight', 'themeDark', 'themeSystem'].flatMap(labels)
    const modes = capture.nodes.filter(node => node.clickable === 'true' && modeLabels.includes(node['content-desc']))
    assert.equal(modes.length, 3, `${id}: all three mode controls must be reachable at the top`)
    const familyLabels = Object.values(familyKeys).flatMap(labels)
    const families = capture.nodes.filter(node => node.clickable === 'true'
      && familyLabels.some(label => node['content-desc']?.startsWith(`${label}. `)))
    const clip = scrollBounds(capture)
    const fullyVisible = node => {
      const b = bounds(node)
      return b && b.top >= clip.top + density && b.bottom <= clip.bottom - density
    }
    const visibleFamilies = families.filter(fullyVisible)
    for (const node of [...modes, ...visibleFamilies]) {
      const b = bounds(node)
      assert.ok(b && b.left >= 0 && b.right <= viewport.width && b.right > b.left, `${id}: radio control overflows horizontally`)
      assert.ok(fullyVisible(node), `${id}: mode control is clipped at the top of the page`)
      assert.ok(b.bottom - b.top >= density * 44 - 2, `${id}: radio control misses the touch target`)
    }
    for (let i = 0; i < visibleFamilies.length; i++) {
      for (const other of visibleFamilies.slice(i + 1)) {
        const a = bounds(visibleFamilies[i]); const b = bounds(other)
        if (Math.abs(a.top - b.top) <= density * 2) {
          assert.ok(Math.abs(a.bottom - b.bottom) <= density * 2, `${id}: cards in the same gallery row have uneven heights`)
        }
      }
    }
    report.checks.push({ id: `${id}:layout`, modeControls: modes.length, visibleFamilyControls: visibleFamilies.length, density })
  }
  function verifyColdPersistence(family, mode, id) {
    adb('shell', 'am', 'force-stop', appPackage)
    ownRouteOpen = false
    navigate('settings/system/appearance')
    const capture = snapshot(id)
    const familyLabels = labels(familyKeys[family])
    const modeLabels = labels({ light: 'themeLight', dark: 'themeDark', system: 'themeSystem' }[mode])
    let familyPersisted = false; let modePersisted = false
    let scanned = capture
    for (let attempt = 0; attempt < 10; attempt++) {
      familyPersisted ||= scanned.nodes.some(node => node.checked === 'true' && familyLabels.some(label => node['content-desc']?.startsWith(`${label}. `)))
      modePersisted ||= scanned.nodes.some(node => node.checked === 'true' && modeLabels.includes(node['content-desc']))
      if (familyPersisted && modePersisted) break
      swipe(true)
      scanned = snapshot(`${id}-scan-${attempt}`, false)
    }
    assert.ok(familyPersisted, `${id}: family was not persisted`)
    assert.ok(modePersisted, `${id}: mode was not persisted`)
    if (mode !== 'system') checkPalette(capture, mode, id)
    report.checks.push({ id, family, mode, coldPersistence: true })
  }
  function checkColdPersistence(family, mode, id) {
    choose(family, true); choose(mode)
    verifyColdPersistence(family, mode, id)
  }
  try {
    for (const family of testFamilies) {
      if (['light', 'dark'].every(mode => completedModes.has(`${family}/${mode}`))) {
        console.log(`Native ${family}/light+dark: resuming source-matched completed cases`)
        continue
      }
      choose(family, true)
      for (const mode of ['light', 'dark']) {
        if (completedModes.has(`${family}/${mode}`)) continue
        choose(mode)
        const appearance = snapshot(`${family}-${mode}-appearance`)
        checkPalette(appearance, mode, `${family}-${mode}-appearance`)
        checkAppearanceLayout(appearance, `${family}-${mode}-appearance`)
        for (const route of measuredRoutes) {
          navigate(route)
          const id = `${family}-${mode}-${route === '/' ? 'home' : route.replaceAll('/', '-')}`
          const capture = snapshot(id)
          checkDestination(capture, route, id)
          checkPalette(capture, mode, id)
          if (route === '/') checkHomeControls(capture, id)
          if (route === 'settings/providers') checkProviderCenter(capture, id)
          if (route.startsWith('chat/') && !['monet', 'material'].includes(family)) {
            checkActionCenter(capture, id, locales.map(locale => locale.conversation.viewHistory))
          }
        }
        verifyColdPersistence(family, mode, `${family}-${mode}-cold-persistence`)
        console.log(`Native ${family}/${mode}: appearance + ${measuredRoutes.length} screens passed (${scope})`)
      }
    }
    for (const family of testFamilies) {
      choose(family, true); choose('system')
      navigate('/')
      const initial = snapshot(`${family}-keyboard-before`, false)
      const input = homeInput(initial, `${family}-keyboard-before`)
      const draft = input.text
      const b = bounds(input)
      assert.ok(b && b.bottom > b.top, `${family}: composer cannot be focused`)
      adb('shell', 'input', 'tap', String(Math.round((b.left + b.right) / 2)), String(Math.round((b.top + b.bottom) / 2)))
      sleep(850)
      assert.ok(isNativeInputViewShown(adb('shell', 'dumpsys', 'input_method')), `${family}: the initial software keyboard is not visible`)
      for (const [night, mode] of [['no', 'light'], ['yes', 'dark']]) {
        adb('shell', 'cmd', 'uimode', 'night', night); sleep(900)
        const id = `${family}-keyboard-system-${mode}`
        const capture = snapshot(id)
        const focused = homeInput(capture, id)
        assert.equal(focused.focused, 'true', `${id}: system appearance change lost input focus`)
        assert.equal(focused.text, draft, `${id}: system appearance change changed the existing draft`)
        const ime = adb('shell', 'dumpsys', 'input_method')
        const keyboardShown = isNativeInputViewShown(ime)
        if (!keyboardShown) {
          // An independently reproduced system/IME closure is not an app focus loss.
          assert.ok(systemImeControl, `${id}: keyboard is not shown; strict qualification requires retention`)
          const inputBounds = bounds(focused)
          assert.ok(inputBounds && inputBounds.bottom > inputBounds.top, `${id}: existing input cannot be reopened`)
          adb('shell', 'input', 'tap', String(Math.round((inputBounds.left + inputBounds.right) / 2)),
            String(Math.round((inputBounds.top + inputBounds.bottom) / 2)))
          sleep(1200)
          const recovered = homeInput(snapshot(`${id}-recovered`), `${id}-recovered`)
          assert.equal(recovered.focused, 'true', `${id}: keyboard recovery lost input focus`)
          assert.equal(recovered.text, draft, `${id}: keyboard recovery changed the draft`)
          assert.ok(isNativeInputViewShown(adb('shell', 'dumpsys', 'input_method')), `${id}: software keyboard did not recover`)
          report.checks.push({ id, focusRetained: true, existingDraftRetained: true, keyboardShown: false,
            keyboardRecovered: true, systemImeRestart: true, platformControlSha256: report.systemImeControl.sha256 })
          console.log(`Native ${family}/system-${mode}: focus and draft retained; independently reproduced system IME closure recovered by tapping the existing input`)
        } else {
          report.checks.push({ id, focusRetained: true, existingDraftRetained: true, keyboardShown: true })
        }
      }
      adb('shell', 'input', 'keyevent', '4'); sleep(300)
    }
    choose('material', true); choose('system')
    for (const [night, mode] of [['no', 'light'], ['yes', 'dark']]) {
      adb('shell', 'cmd', 'uimode', 'night', night); sleep(900)
      const capture = snapshot(`follow-system-${mode}`)
      checkPalette(capture, mode, `follow-system-${mode}`)
      assert.ok(capture.nodes.some(node => node.checked === 'true' && labels('themeSystem').includes(node['content-desc'])), 'System following must not replace the saved preference')
    }
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.4'); sleep(900)
    navigate('/')
    checkHomeControls(snapshot('large-font-home'), 'large-font-home')
    navigate('settings/providers')
    checkProviderCenter(snapshot('large-font-provider'), 'large-font-provider')
    navigate('settings/system/appearance')
    checkAppearanceLayout(snapshot('large-font-appearance'), 'large-font-appearance')
    adb('shell', 'settings', 'put', 'system', 'font_scale', originalFontScale === 'null' ? '1.0' : originalFontScale)
    sleep(700)
    const narrowDensity = Math.round(viewport.width * 160 / 320)
    adb('shell', 'wm', 'density', String(narrowDensity))
    density = narrowDensity / 160
    sleep(900)
    navigate('/')
    checkHomeControls(snapshot('narrow-320dp-home'), 'narrow-320dp-home')
    navigate('settings/providers')
    checkProviderCenter(snapshot('narrow-320dp-provider'), 'narrow-320dp-provider')
    navigate('settings/system/appearance')
    checkAppearanceLayout(snapshot('narrow-320dp-appearance'), 'narrow-320dp-appearance')
    report.checks.push({ id: 'narrow-native-width', widthDp: viewport.width / density, fontScale: originalFontScale })
    adb('shell', 'wm', 'density', originalDensityOverride ?? 'reset')
    density = report.density
    sleep(900)
    checkColdPersistence('monet', 'dark', 'cold-persist-monet-dark')
    report.passed = true
  } catch (error) {
    report.error = String(error.message || error).slice(0, 1000)
    throw error
  } finally {
    try {
      adb('shell', 'cmd', 'uimode', 'night', originalNight)
      if (originalFontScale === 'null') adb('shell', 'settings', 'delete', 'system', 'font_scale')
      else adb('shell', 'settings', 'put', 'system', 'font_scale', originalFontScale)
      adb('shell', 'wm', 'density', originalDensityOverride ?? 'reset')
      density = report.density
      assert.equal(adb('shell', 'cmd', 'uimode', 'night').match(/Night mode:\s*(yes|no|auto)\b/)?.[1], originalNight)
      assert.equal(adb('shell', 'settings', 'get', 'system', 'font_scale'), originalFontScale)
      assert.equal(adb('shell', 'wm', 'density'), originalDensity)
      sleep(700)
      checkColdPersistence(args['restore-family'], args['restore-mode'], 'restored-original-appearance')
      navigate('settings/providers')
      checkProviderCenter(snapshot('restored-provider'), 'restored-provider')
      report.restoration = { family: args['restore-family'], mode: args['restore-mode'], night: originalNight, fontScale: originalFontScale, density: originalDensity, passed: true }
    } catch (error) {
      report.restoration = { passed: false, error: String(error.message || error).slice(0, 1000) }
      report.passed = false
    }
    report.sourceFreshness = collectReleaseSourceFreshness(root, apk).status
    if (report.sourceFreshness !== 'current') report.passed = false
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ passed: report.passed, captures: report.captures.length, checks: report.checks.length, restoration: report.restoration, report: path.join(output, 'results.json') }))
    if (!report.passed) process.exitCode = 1
  }
}

if (require.main === module) main()
module.exports = { main }
