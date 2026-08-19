const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const worklistPath = path.join(root, 'scripts/fixtures/worklists/product-mobile-web-render-evidence-worklist.json')
const evidencePath = path.join(root, 'test-evidence/qa/product-mobile-web-render-results.json')

const REQUIRED_CAPTURE_IDS = ['history-320', 'chat-320', 'chat-composer-tools-320']
const REQUIRED_CAPTURES = [
  {
    id: 'history-320',
    route: '/conversations',
    viewport: '320x568',
    screenshotName: 'islemind-history-320.png',
    verifiedNeedles: ['unified history has no product-mode filters', 'search and empty history remain readable'],
  },
  {
    id: 'chat-320',
    route: '/',
    viewport: '320x568',
    screenshotName: 'islemind-chat-320.png',
    verifiedNeedles: ['borderless mode introduction', 'single starter action', 'composer visible'],
  },
  {
    id: 'chat-composer-tools-320',
    route: '/',
    viewport: '320x568',
    screenshotName: 'islemind-chat-composer-tools-320.png',
    interaction: 'open-composer-tools',
    verifiedNeedles: ['Composer tools trigger', 'Composer tools panel', '44px contextual actions', 'composer remains visible'],
  },
]

const REQUIRED_APPEARANCE_CAPTURES = [
  ['minimal', 'light', '320x568'],
  ['minimal', 'light', '360x640'],
  ['minimal', 'dark', '320x568'],
  ['minimal', 'dark', '360x640'],
  ['monet', 'light', '320x568'],
  ['monet', 'light', '360x640'],
  ['monet', 'dark', '320x568'],
  ['monet', 'dark', '360x640'],
  ['material', 'light', '320x568'],
  ['material', 'light', '360x640'],
  ['material', 'dark', '320x568'],
  ['material', 'dark', '360x640'],
  ['liquid-glass', 'light', '320x568'],
  ['liquid-glass', 'light', '360x640'],
  ['liquid-glass', 'dark', '320x568'],
  ['liquid-glass', 'dark', '360x640'],
].map(([family, mode, viewport]) => {
  const width = viewport.split('x')[0]
  const id = `appearance-${family}-${mode}-${width}`
  return {
    id,
    route: '/settings',
    mode: 'settings',
    viewport,
    screenshotName: `islemind-${id}.png`,
    appearance: { family, mode, accentId: 'default' },
    verifiedNeedles: [familyLabel(family), modeLabel(mode), 'radio roles', 'custom controls in viewport'],
  }
}).concat({
  id: 'appearance-liquid-glass-dark-custom-indigo-360',
  route: '/settings',
  mode: 'settings',
  viewport: '360x640',
  screenshotName: 'islemind-appearance-liquid-glass-dark-custom-indigo-360.png',
  appearance: { family: 'liquid-glass', mode: 'dark', accentId: 'custom', accent: '#4455B7' },
  verifiedNeedles: ['Liquid Glass', 'Dark', 'custom indigo', 'radio roles', 'custom controls in viewport'],
})

function familyLabel(family) {
  if (family === 'minimal') return 'Minimalist'
  if (family === 'monet') return 'Monet'
  if (family === 'material') return 'Material 3'
  if (family === 'liquid-glass') return 'Liquid Glass'
  return family[0].toUpperCase() + family.slice(1)
}

function modeLabel(mode) {
  return mode[0].toUpperCase() + mode.slice(1)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function run() {
  assert.ok(fs.existsSync(worklistPath), 'mobile web render evidence worklist exists')
  const worklist = JSON.parse(fs.readFileSync(worklistPath, 'utf8'))
  assertWorklist(worklist)
  assertSourceSetupBoundary()

  if (!fs.existsSync(evidencePath)) {
    assert.equal(
      worklist.status,
      'blocked-no-web-render-evidence',
      'missing web render evidence must stay explicitly blocked instead of being treated as complete',
    )
    assert.ok(
      JSON.stringify(worklist.observedBlockers ?? []).includes('product-mobile-web-render-results.json'),
      'blocked web render evidence records the missing ignored result path',
    )
    console.log('Product mobile web render evidence worklist passed; web screenshots remain blocked by missing local render evidence')
    return
  }

  const result = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  const status = result.status ?? 'captured'
  if (status !== 'captured') {
    assertBlockedWebRenderEvidenceResult(result, worklist)
    console.log(`Product mobile web render evidence result is explicitly blocked by ${status}`)
    return
  }

  if (!capturedResultMatchesWorklist(result, worklist)) {
    assertStaleCapturedWebRenderEvidenceResult(result, worklist)
    console.log('Product mobile web render evidence result is explicitly stale under the Chat-only capture contract')
    return
  }

  assertCapturedWebRenderEvidenceResult(result, worklist)
  console.log('Product mobile web render evidence tests passed')
}

function assertWorklist(worklist) {
  assert.equal(worklist.schema, 'islemind.product-mobile-web-render-evidence-worklist.v1', 'web render worklist schema is stable')
  assert.equal(worklist.webEvidenceIsNotNativeProof, true, 'worklist states web viewport evidence is not native proof')
  assert.equal(
    normalizeEvidencePath(worklist.resultPath),
    'test-evidence/qa/product-mobile-web-render-results.json',
    'worklist points at the web render result path',
  )
  assert.equal(
    normalizeEvidencePath(worklist.screenshotDirectory),
    'test-evidence/qa/product-mobile-web-render/',
    'worklist points at the web render screenshot directory',
  )
  assert.equal(
    worklist.collectorCommand,
    'bun run test:product-mobile-web-render-evidence:collect -- --base-url <Expo Web URL>',
    'worklist records the web render evidence collector command',
  )

  const captures = Array.isArray(worklist.requiredCaptures) ? worklist.requiredCaptures : []
  assert.deepEqual(
    captures.map((capture) => capture.id),
    REQUIRED_CAPTURE_IDS,
    'web render worklist covers unified History, Chat, and Composer tools captures in stable order',
  )
  for (const expected of REQUIRED_CAPTURES) {
    const capture = captures.find((item) => item.id === expected.id)
    assert.ok(capture, `${expected.id} capture is listed`)
    assert.equal(capture.route, expected.route, `${expected.id} route matches the render contract`)
    assert.equal(capture.viewport, expected.viewport, `${expected.id} viewport matches the render contract`)
    assert.equal(capture.screenshotName, expected.screenshotName, `${expected.id} screenshot name is stable`)
    assert.equal(capture.interaction, expected.interaction, `${expected.id} interaction matches the render contract`)
    const verified = Array.isArray(capture.verified) ? capture.verified.join('\n') : ''
    for (const needle of expected.verifiedNeedles) {
      assert.ok(verified.includes(needle), `${expected.id} worklist verified notes include ${needle}`)
    }
  }

  const appearanceCaptures = Array.isArray(worklist.appearanceRequiredCaptures) ? worklist.appearanceRequiredCaptures : []
  assert.deepEqual(
    appearanceCaptures.map((capture) => capture.id),
    REQUIRED_APPEARANCE_CAPTURES.map((capture) => capture.id),
    'web render worklist covers the complete Appearance family, mode, width, and custom-accent matrix in stable order',
  )
  for (const expected of REQUIRED_APPEARANCE_CAPTURES) {
    const capture = appearanceCaptures.find((item) => item.id === expected.id)
    assert.ok(capture, `${expected.id} capture is listed`)
    assert.equal(capture.route, expected.route, `${expected.id} route matches the render contract`)
    assert.equal(capture.mode, expected.mode, `${expected.id} product mode matches the render contract`)
    assert.equal(capture.viewport, expected.viewport, `${expected.id} viewport matches the render contract`)
    assert.equal(capture.screenshotName, expected.screenshotName, `${expected.id} screenshot name is stable`)
    assert.deepEqual(capture.appearance, expected.appearance, `${expected.id} Appearance selection is stable`)
    const verified = Array.isArray(capture.verified) ? capture.verified.join('\n') : ''
    for (const needle of expected.verifiedNeedles) {
      assert.ok(verified.includes(needle), `${expected.id} worklist verified notes include ${needle}`)
    }
  }

  assert.equal(worklist.resultAcceptance?.schema, 'islemind.product-mobile-web-render-results.v1', 'worklist records result schema')
  assert.match(worklist.resultAcceptance?.runnerMustMention ?? '', /Expo Web.*Playwright/i, 'worklist requires the rendered browser runner')
  assert.match(worklist.resultAcceptance?.noteMustMention ?? '', /native device\/ADB.*separate/i, 'worklist separates web proof from native proof')
  assert.deepEqual(
    worklist.resultAcceptance?.allowedStatuses,
    ['blocked-no-web-render-evidence', 'blocked-missing-playwright', 'blocked-web-render-verification', 'captured'],
    'worklist allows explicit blocked states or captured web evidence',
  )
  assert.ok(
    Array.isArray(worklist.resultAcceptance?.requiresPerCapture) &&
      worklist.resultAcceptance.requiresPerCapture.includes('screenshot') &&
      worklist.resultAcceptance.requiresPerCapture.includes('screenshotDimensions') &&
      worklist.resultAcceptance.requiresPerCapture.includes('consoleErrors') &&
      worklist.resultAcceptance.requiresPerCapture.includes('verified'),
    'worklist requires per-capture screenshot, console-error, and verification evidence',
  )
  assert.deepEqual(
    worklist.resultAcceptance?.requiresPerAppearanceCapture,
    ['appearance', 'appearance.radioGroups', 'appearance.customControls'],
    'worklist requires rendered radio-group and custom-control evidence for each Appearance capture',
  )
  assert.equal(worklist.resultAcceptance?.mustRecordConsoleErrors, true, 'worklist requires console error evidence')
  assert.equal(worklist.resultAcceptance?.mustRecordScreenshotDimensions, true, 'worklist requires screenshot dimension evidence')
  assert.equal(worklist.resultAcceptance?.mustRecordFixedDuringRun, true, 'worklist requires the render-discovered fix note')

  const packageJson = JSON.parse(read('package.json'))
  assert.equal(
    packageJson.scripts?.['test:product-mobile-web-render-evidence:collect'],
    'node scripts/collect-product-mobile-web-render-evidence.js',
    'package script exposes the web render evidence collector',
  )
  assert.equal(
    packageJson.scripts?.['test:browser-storage-evidence'],
    'bun scripts/collect-product-mobile-web-render-evidence.js --storage-evidence-only',
    'package script exposes the Bun-only current-browser storage evidence collector',
  )
}

function assertBlockedWebRenderEvidenceResult(result, worklist) {
  assert.equal(result.schema, 'islemind.product-mobile-web-render-results.v1', 'blocked web render result schema is stable')
  assert.ok(
    worklist.resultAcceptance.allowedStatuses.includes(result.status) && result.status !== 'captured',
    'blocked web render result uses an explicit non-complete status',
  )
  assert.match(result.runner ?? '', /Expo Web.*Playwright/i, 'blocked web render result records the intended runner')
  assert.match(result.note ?? '', /native device\/ADB.*separate/i, 'blocked web render result separates web proof from native proof')
  assert.deepEqual(result.captures, [], 'blocked web render result has no fake captures')
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'blocked web render result records the blocking reason')
}

function capturedResultMatchesWorklist(result, worklist) {
  const expectedIds = [
    ...(worklist.requiredCaptures ?? []).map((capture) => capture.id),
    ...(worklist.appearanceRequiredCaptures ?? []).map((capture) => capture.id),
  ]
  return Array.isArray(result.captures) &&
    result.captures.length === expectedIds.length &&
    result.captures.every((capture, index) => capture.id === expectedIds[index])
}

function assertStaleCapturedWebRenderEvidenceResult(result, worklist) {
  assert.equal(result.schema, 'islemind.product-mobile-web-render-results.v1', 'stale web evidence keeps the known result schema')
  assert.equal(result.status, 'captured', 'stale web evidence is a formerly captured result, not current proof')
  assert.ok(Array.isArray(result.captures) && result.captures.length > 0, 'stale web evidence contains the obsolete capture set')
  assert.equal(capturedResultMatchesWorklist(result, worklist), false, 'stale web evidence cannot match the current Chat-only worklist')
  const captureIds = result.captures.map((capture) => capture.id)
  const hasRemovedProductCapture = captureIds.includes('agent-360') || captureIds.includes('tavern-390')
  const hasRetiredToolboxCapture = captureIds.includes('chat-toolbox-320')
  assert.ok(
    hasRemovedProductCapture || hasRetiredToolboxCapture,
    'stale web evidence is attributable to a known removed product or toolbox capture',
  )
  const blockerText = JSON.stringify(worklist.observedBlockers ?? [])
  if (hasRemovedProductCapture) {
    assert.ok(blockerText.includes('predate the Chat-only routing contract'), 'the worklist records why removed product captures are stale')
  }
  if (hasRetiredToolboxCapture) {
    assert.ok(blockerText.includes('predate the Composer-owned tools contract'), 'the worklist records why the retired floating toolbox capture is stale')
  }
}

function assertCapturedWebRenderEvidenceResult(result, worklist) {
  assert.equal(result.schema, 'islemind.product-mobile-web-render-results.v1', 'evidence schema is stable')
  assert.match(result.runner ?? '', /Expo Web.*Playwright/i, 'evidence records the rendered browser runner')
  assert.match(result.note ?? '', /native device\/ADB.*separate/i, 'evidence clearly separates web viewport proof from native device proof')
  assert.ok(Array.isArray(result.captures), 'evidence captures are listed')
  assert.deepEqual(result.errors, [], 'captured evidence has no collection or verification errors')
  assert.deepEqual(
    result.captures.map((capture) => capture.id),
    [...REQUIRED_CAPTURE_IDS, ...REQUIRED_APPEARANCE_CAPTURES.map((capture) => capture.id)],
    'captured evidence contains the exact current worklist without stale or extra captures',
  )

  for (const expected of REQUIRED_CAPTURES) {
    const capture = result.captures.find((item) => item.id === expected.id)
    assert.ok(capture, `${expected.route} ${expected.viewport} capture exists`)
    assert.equal(capture.consoleErrors, 0, `${expected.route} ${expected.viewport} has zero console errors`)
    assertCaptureScreenshot(capture, expected)

    const verified = Array.isArray(capture.verified) ? capture.verified.join('\n') : ''
    for (const needle of expected.verifiedNeedles) {
      assert.ok(verified.includes(needle), `${expected.route} verified notes include ${needle}`)
    }
    if (expected.interaction === 'open-composer-tools') {
      assert.equal(capture.interaction?.kind, 'open-composer-tools', 'Composer tools capture records the performed interaction')
      assert.equal(capture.interaction?.expanded, true, 'Composer tools capture records the expanded state')
      assertViewportBounds(capture.interaction?.trigger, expected.viewport, 'Composer tools trigger')
      assertViewportBounds(capture.interaction?.panel, expected.viewport, 'Composer tools panel')
      assertViewportBounds(capture.interaction?.firstAction, expected.viewport, 'Composer tools first action')
      assert.ok(capture.interaction.trigger.width >= 44 && capture.interaction.trigger.height >= 44, 'Composer tools trigger meets the 44px target')
      assert.ok(capture.interaction.actionCount >= 3, 'Composer tools capture records the contextual action set')
      assert.ok(capture.interaction.firstAction.height >= 44, 'Composer tool actions meet the 44px target')
    }
  }

  for (const expected of REQUIRED_APPEARANCE_CAPTURES) {
    const capture = result.captures.find((item) => item.id === expected.id)
    assert.ok(capture, `${expected.id} captured Appearance evidence exists`)
    assert.equal(capture.route, expected.route, `${expected.id} route is stable`)
    assert.equal(capture.mode, expected.mode, `${expected.id} product mode is stable`)
    assert.equal(capture.viewport, expected.viewport, `${expected.id} viewport is stable`)
    assert.equal(capture.consoleErrors, 0, `${expected.id} has zero console errors`)
    assertCaptureScreenshot(capture, expected)
    assertAppearanceEvidence(capture.appearance, expected)

    const verified = Array.isArray(capture.verified) ? capture.verified.join('\n') : ''
    for (const needle of expected.verifiedNeedles) {
      assert.ok(verified.includes(needle), `${expected.id} verified notes include ${needle}`)
    }
  }

  assert.deepEqual(result.fixedDuringRun, [], 'fresh evidence does not retain superseded implementation notes')

  for (const expected of worklist.requiredCaptures) {
    assert.ok(
      result.captures.some((capture) => capture.route === expected.route && capture.viewport === expected.viewport),
      `${expected.id} captured result covers the worklist route and viewport`,
    )
  }
  for (const expected of worklist.appearanceRequiredCaptures) {
    assert.ok(
      result.captures.some((capture) => capture.id === expected.id && capture.route === expected.route && capture.viewport === expected.viewport),
      `${expected.id} captured result covers the Appearance worklist entry`,
    )
  }
}

function assertCaptureScreenshot(capture, expected) {
  assert.equal(path.basename(capture.screenshot), expected.screenshotName, `${expected.id} screenshot name is stable`)
  assert.ok(
    normalizeEvidencePath(capture.screenshot).startsWith('test-evidence/qa/product-mobile-web-render/'),
    `${expected.id} screenshot stays inside the product mobile web render evidence directory`,
  )
  const screenshotPath = path.join(root, capture.screenshot)
  assert.ok(fs.existsSync(screenshotPath), `${expected.id} screenshot file exists`)
  const [width, height] = parseViewport(expected.viewport)
  assert.deepEqual(capture.screenshotDimensions, { width, height }, `${expected.id} records exact screenshot dimensions`)
  assertPngViewport(screenshotPath, expected.viewport)
}

function assertAppearanceEvidence(appearance, expected) {
  assert.ok(appearance && typeof appearance === 'object', `${expected.id} records Appearance evidence`)
  assert.equal(appearance.family, expected.appearance.family, `${expected.id} records the selected family`)
  assert.equal(appearance.mode, expected.appearance.mode, `${expected.id} records the selected color mode`)
  assert.equal(appearance.accentId, expected.appearance.accentId, `${expected.id} records the selected accent choice`)
  assert.equal(appearance.accent, expected.appearance.accent, `${expected.id} records the custom accent value when required`)

  const checkedIds = {
    family: `settings-theme-family-${expected.appearance.family}`,
    mode: `settings-theme-mode-${expected.appearance.mode}`,
    accent: `settings-theme-accent-${expected.appearance.accentId}`,
  }
  const expectedCounts = { family: 3, mode: 3, accent: 6 }
  for (const groupName of ['family', 'mode', 'accent']) {
    assert.deepEqual(
      appearance.radioGroups?.[groupName],
      { role: 'radiogroup', radioCount: expectedCounts[groupName], checkedTestId: checkedIds[groupName] },
      `${expected.id} records exactly one rendered checked radio for ${groupName}`,
    )
  }

  assertViewportBounds(appearance.customControls?.input, expected.viewport, `${expected.id} custom accent input`)
  assertViewportBounds(appearance.customControls?.apply, expected.viewport, `${expected.id} custom accent Apply button`)
  assert.ok(appearance.customControls.input.height >= 44, `${expected.id} custom accent input meets the 44px target`)
  assert.ok(appearance.customControls.apply.height >= 44, `${expected.id} custom accent Apply button meets the 44px target`)
}

function assertViewportBounds(bounds, viewport, label) {
  assert.ok(bounds && typeof bounds === 'object', `${label} records rendered bounds`)
  const [viewportWidth, viewportHeight] = parseViewport(viewport)
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Number.isFinite(bounds[key]), `${label} ${key} is finite`)
  }
  assert.ok(bounds.width > 0 && bounds.height > 0, `${label} has positive rendered dimensions`)
  assert.deepEqual(bounds.viewport, { width: viewportWidth, height: viewportHeight }, `${label} records the capture viewport`)
  assert.equal(bounds.withinViewport, true, `${label} is explicitly verified inside the viewport`)
  assert.ok(bounds.x >= 0 && bounds.y >= 0, `${label} starts inside the viewport`)
  assert.ok(bounds.x + bounds.width <= viewportWidth, `${label} fits horizontally inside the viewport`)
  assert.ok(bounds.y + bounds.height <= viewportHeight, `${label} fits vertically inside the viewport`)
}

function assertSourceSetupBoundary() {
  const chatWorkspaceSource = read('src/components/chat/ChatWorkspace.tsx')
  const homeSource = read('src/components/main/HomeScreenContent.tsx')
  const nativeIntentSource = read('app/+native-intent.tsx')
  const floatingComposerSource = read('src/components/chat/FloatingComposer.tsx')
  const composerControlsSource = read('src/components/chat/FloatingComposerControls.tsx')
  assert.ok(chatWorkspaceSource.includes('showSetupEmptyState = true'), 'ChatWorkspace keeps generic setup visible by default')
  assert.ok(homeSource.includes('showSetupEmptyState={showSetupEmptyState}'), 'HomeScreenContent passes setup visibility to ChatWorkspace')
  assert.equal(fs.existsSync(path.join(root, 'app/agent.tsx')), false, 'the legacy /agent product route stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'app/companion.tsx')), false, 'the legacy /companion product route stays deleted')
  assert.ok(nativeIntentSource.includes("host === 'agent'") && nativeIntentSource.includes("host === 'companion' || host === 'tavern'"), 'legacy Agent, Companion, and Tavern native intents redirect into Chat')
  assert.ok(floatingComposerSource.includes('testID="chat-composer-tools-trigger"'), 'Composer tools evidence has a stable trigger target')
  assert.ok(floatingComposerSource.includes('testID="chat-composer-tools-panel"'), 'Composer tools evidence has a stable panel target')
  assert.ok(composerControlsSource.includes('const controlSize = 44') && composerControlsSource.includes('hitSlop={QUICK_TOOL_HIT_SLOP}'), 'Composer contextual actions retain a physical 44px target with expanded hit area')
  assert.equal(fs.existsSync(path.join(root, 'src/components/chat/FloatingControlOrb.tsx')), false, 'retired floating toolbox stays deleted')
  const collectorSource = read('scripts/collect-product-mobile-web-render-evidence.js')
  assert.ok(collectorSource.includes('await waitForStableBounds(panel)'), 'Composer tools evidence waits for the opening animation to settle before measuring touch targets')
  assert.ok(collectorSource.includes("storageEvidenceOnly: false"), 'web collector owns a bounded storage-evidence-only mode')
  assert.ok(collectorSource.includes('createAsyncStorageTavernWorkspacePort'), 'browser storage evidence bundles the production AsyncStorage Tavern adapter')
  assert.ok(collectorSource.includes("browser: 'chrome'"), 'browser storage evidence retains Chrome as its compatibility default')
  assert.ok(collectorSource.includes("browserTransport: 'page'"), 'browser storage evidence defaults to the transport-independent browser page protocol')
  assert.ok(collectorSource.includes('collectBrowserPageStorageEvidence'), 'browser storage evidence owns the browser-native restart and cross-tab collector')
  assert.ok(collectorSource.includes("postEvidence('restart-written'"), 'browser-native evidence records the production-adapter write inside the physical browser')
  assert.ok(collectorSource.includes("postEvidence('cross-tab-summary'"), 'browser-native evidence records the final two-tab Web Locks result inside the physical browser')
  assert.ok(collectorSource.includes("window.open(peerUrl, 'islemind-storage-evidence-peer')"), 'browser-native evidence opens a real same-origin peer tab without CDP')
  assert.ok(collectorSource.includes("'--disable-popup-blocking'"), 'browser-native evidence explicitly admits its bounded peer-tab launch')
  assert.ok(collectorSource.includes('tabCount: 2'), 'browser storage evidence requires exactly two real tabs')
  assert.ok(collectorSource.includes('waitForStorageEvidenceEvent'), 'browser-native evidence receives bounded loopback-only page reports without DevTools')
  assert.ok(collectorSource.includes('browserChildHasExited'), 'browser-native evidence accepts both normal and signal-based owned process exits')
  assert.ok(collectorSource.includes("execFileSync('taskkill', ['/PID', String(child.pid), '/T']"), 'browser-native restart first requests graceful shutdown of the exact owned Chromium tree')
  assert.ok(collectorSource.includes('setTimeout(resolve, 1500)'), 'browser-native restart gives the production web storage backend a bounded persistence-settle interval')
  assert.ok(collectorSource.includes("execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']"), 'browser-native restart closes the exact owned Chromium process tree before profile reopen')
  assert.ok(collectorSource.includes("edge: Object.freeze({"), 'browser storage evidence supports the installed physical Edge candidate')
  assert.ok(collectorSource.includes('launchPersistentBrowser'), 'browser storage evidence reopens a selected persistent browser profile')
  assert.ok(collectorSource.includes('--remote-debugging-address=127.0.0.1'), 'browser storage evidence keeps DevTools control loopback-only')
  assert.ok(collectorSource.includes('connectOverCDP'), 'browser storage evidence uses Playwright against the physical persistent browser')
  assert.ok(collectorSource.includes("'android-chromium': Object.freeze({"), 'browser storage evidence supports a physical Android Chromium transport')
  assert.ok(collectorSource.includes("['reverse', `tcp:${devicePort}`, `tcp:${devicePort}`]"), 'Android browser evidence exposes only the bounded loopback harness through adb reverse')
  assert.ok(collectorSource.includes("['shell', 'am', 'force-stop', packageName]"), 'Android browser restart evidence performs an explicit package restart without clearing profile data')
  assert.ok(collectorSource.includes('resolveAndroidDevToolsSocket'), 'Android browser evidence discovers the selected Chromium DevTools socket')
  assert.ok(collectorSource.includes('removeAndroidForward(options.device, forwardedPort)'), 'Android browser evidence retries owned forward cleanup when CDP session creation fails')
  assert.ok(collectorSource.includes('const secondTab = await context.newPage()'), 'browser storage evidence opens two real tabs in one browser context')
  assert.ok(collectorSource.includes("lockScope !== 'cross-context'"), 'browser storage evidence fails closed unless the adapter selects real Web Locks')
  assert.ok(collectorSource.includes("transitions.join(',') !== '0->1,1->2'"), 'browser storage evidence rejects non-serialized cross-tab updates')
}

function normalizeEvidencePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function assertPngViewport(filePath, viewport) {
  const [width, height] = parseViewport(viewport)
  const buffer = fs.readFileSync(filePath)
  assert.ok(buffer.length >= 24, `${path.basename(filePath)} is long enough to contain a PNG header`)
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${path.basename(filePath)} has PNG signature`)
  assert.equal(buffer.readUInt32BE(4), 0x0d0a1a0a, `${path.basename(filePath)} has PNG signature suffix`)
  assert.equal(buffer.readUInt32BE(16), width, `${path.basename(filePath)} PNG width matches ${width}`)
  assert.equal(buffer.readUInt32BE(20), height, `${path.basename(filePath)} PNG height matches ${height}`)
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  assert.ok(match, `viewport ${value} has WIDTHxHEIGHT format`)
  return [Number(match[1]), Number(match[2])]
}

if (require.main === module) run()

module.exports = { run }
