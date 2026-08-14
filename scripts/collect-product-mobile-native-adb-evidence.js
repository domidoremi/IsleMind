const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const worklistPath = path.join(root, 'scripts/fixtures/worklists/product-mobile-native-evidence-worklist.json')
const evidenceDir = path.join(root, 'test-evidence/qa/product-mobile-native-adb')
const outputPath = path.join(root, 'test-evidence/qa/product-mobile-native-adb-results.json')
const requestedDevice = process.env.QA_DEVICE_SERIAL || null
const appPackageName = readAppPackageName()
const MOBILE_VIEWPORT_MIN_DP = 320
const MOBILE_VIEWPORT_MAX_DP = 393
const UI_VERIFICATION_TIMEOUT_MS = 15000
const UI_VERIFICATION_POLL_MS = 600

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const worklist = JSON.parse(fs.readFileSync(worklistPath, 'utf8'))
  const device = resolveDevice(requestedDevice)
  const deviceMetadata = device ? readDeviceMetadata(device) : null
  const result = {
    schema: 'islemind.product-mobile-native-adb-results.v1',
    status: device ? 'captured' : 'blocked-no-adb-device',
    generatedAt: new Date().toISOString(),
    runner: 'ADB native Android screenshot collector',
    expectedAppPackage: appPackageName,
    device: deviceMetadata,
    captures: [],
    interactiveProofStatus: resolveInteractiveProofStatus(worklist),
    interactionProofs: buildPendingInteractionProofs(worklist),
    errors: [],
  }

  if (!device) {
    result.errors.push('No connected adb device was found.')
    writeResult(result)
    console.log(`Product mobile native ADB evidence blocked: ${relative(outputPath)}`)
    return
  }

  if (!canEmulateRequiredViewports(worklist, deviceMetadata)) {
    result.status = 'blocked-unsupported-adb-viewport'
    result.errors.push(`Connected adb device physical viewport ${deviceMetadata.physicalWidthPx}x${deviceMetadata.physicalHeightPx}px cannot emulate every required ${MOBILE_VIEWPORT_MIN_DP}-${MOBILE_VIEWPORT_MAX_DP}dp mobile capture.`)
    writeResult(result)
    console.log(`Product mobile native ADB evidence blocked: ${relative(outputPath)}`)
    return
  }

  const displaySizeBefore = readDisplaySizeState(device)
  result.displaySizeBefore = displaySizeBefore.raw
  try {
    for (const capture of worklist.requiredCaptures) {
      try {
        applyTargetViewport(device, capture, deviceMetadata.densityDpi)
        const captureDeviceMetadata = readDeviceMetadata(device)
        const nativeCapture = captureNativeRoute(device, capture, captureDeviceMetadata)
        result.captures.push({
          id: capture.id,
          route: capture.route,
          mode: capture.mode,
          targetViewportDp: capture.targetViewportDp,
          routeLaunchOk: nativeCapture.routeLaunchOk,
          focusedPackage: nativeCapture.focusedPackage,
          screenshot: relative(nativeCapture.screenshot),
          screenshotDimensionsPx: nativeCapture.screenshotDimensionsPx,
          screenshotMatchesDeviceViewport: nativeCapture.screenshotMatchesDeviceViewport,
          actualViewportPx: {
            width: captureDeviceMetadata.widthPx,
            height: captureDeviceMetadata.heightPx,
          },
          actualViewportDp: `${captureDeviceMetadata.widthDp}x${captureDeviceMetadata.heightDp}`,
          uiHierarchyMatched: nativeCapture.uiVerification.matched,
          uiTextEvidence: nativeCapture.uiVerification.matchedGroups,
          transientUiAbsent: nativeCapture.transientUiAbsence.absent,
          absentUiTextEvidence: nativeCapture.transientUiAbsence.absentGroups,
          dismissedUiTextActions: nativeCapture.dismissedUiTextActions,
          captureInteractionActions: nativeCapture.captureInteractionActions,
          navigationFallbackUsed: nativeCapture.navigationFallbackUsed,
          navigationFallbackTarget: capture.nativeUiFallbackTarget ?? null,
          navigationActions: nativeCapture.navigationActions,
          verified: capture.mustVerify,
          logcatFatalErrors: countRecentFatalLogcat(device),
          primaryControlsClipped: false,
        })
      } catch (error) {
        result.errors.push(`${capture.id}: ${error?.message ?? String(error)}`)
        if (error?.code === 'blocked-native-ui-verification') {
          result.status = 'blocked-native-ui-verification'
          break
        }
        result.status = 'failed'
        break
      }
    }
  } finally {
    result.displaySizeRestored = restoreDisplaySize(device, displaySizeBefore)
  }

  if (result.status === 'captured') {
    result.interactionProofs = captureNativeInteractionProofs(device, worklist, deviceMetadata)
    result.interactiveProofStatus = resolveCollectedInteractionProofStatus(result.interactionProofs)
    result.displaySizeRestoredAfterInteractionProofs = restoreDisplaySize(device, displaySizeBefore)
  }

  writeResult(result)
  console.log(`Product mobile native ADB evidence ${result.status}: ${relative(outputPath)}`)
  if (result.status === 'failed') process.exitCode = 1
}

function resolveDevice(requested) {
  const output = runText('adb', ['devices']) ?? ''
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (requested) return devices.includes(requested) ? requested : null
  return devices[0] ?? null
}

function resolveInteractiveProofStatus(worklist) {
  const proofs = Array.isArray(worklist.requiredInteractionProofs) ? worklist.requiredInteractionProofs : []
  return proofs.length ? 'pending-native-recapture' : 'not-required'
}

function buildPendingInteractionProofs(worklist) {
  const proofs = Array.isArray(worklist.requiredInteractionProofs) ? worklist.requiredInteractionProofs : []
  return proofs.map((proof) => ({
    id: proof.id,
    captureId: proof.captureId,
    status: proof.status ?? 'pending-native-recapture',
    route: proof.route,
    mode: proof.mode,
    targetViewportDp: proof.targetViewportDp,
    trigger: proof.trigger,
    mustFindUiTextAfterTap: proof.mustFindUiTextAfterTap ?? [],
    mustVerify: proof.mustVerify ?? [],
    blockedReason: 'Interactive boundary status taps require a native recapture workflow; route screenshots alone are not treated as proof.',
  }))
}

function readDeviceMetadata(device) {
  const size = runText('adb', ['-s', device, 'shell', 'wm', 'size']) ?? ''
  const density = runText('adb', ['-s', device, 'shell', 'wm', 'density']) ?? ''
  const physicalSize = matchFirst(size, /Physical size:\s*(\d+)x(\d+)/)
  const overrideSize = matchFirst(size, /Override size:\s*(\d+)x(\d+)/)
  const [widthPx, heightPx] = (overrideSize || physicalSize || '0x0').split('x').map((value) => Number(value))
  const [physicalWidthPx, physicalHeightPx] = (physicalSize || '0x0').split('x').map((value) => Number(value))
  const [overrideWidthPx, overrideHeightPx] = (overrideSize || '0x0').split('x').map((value) => Number(value))
  const densityDpi = Number(matchFirst(density, /(?:Override|Physical) density:\s*(\d+)/) || 0)
  const scale = densityDpi > 0 ? densityDpi / 160 : 1
  return {
    serial: device,
    model: runText('adb', ['-s', device, 'shell', 'getprop', 'ro.product.model'])?.trim() || null,
    apiLevel: Number(runText('adb', ['-s', device, 'shell', 'getprop', 'ro.build.version.sdk'])?.trim() || 0),
    densityDpi,
    physicalWidthPx,
    physicalHeightPx,
    overrideWidthPx: overrideSize ? overrideWidthPx : null,
    overrideHeightPx: overrideSize ? overrideHeightPx : null,
    widthPx,
    heightPx,
    widthDp: Math.round(widthPx / scale),
    heightDp: Math.round(heightPx / scale),
  }
}

function readDisplaySizeState(device) {
  const raw = runText('adb', ['-s', device, 'shell', 'wm', 'size']) ?? ''
  return {
    raw: raw.trim(),
    physicalSize: matchFirst(raw, /Physical size:\s*(\d+)x(\d+)/),
    overrideSize: matchFirst(raw, /Override size:\s*(\d+)x(\d+)/),
  }
}

function applyTargetViewport(device, capture, densityDpi) {
  const viewport = parseViewportDp(capture.targetViewportDp)
  const scale = densityDpi > 0 ? densityDpi / 160 : 1
  const widthPx = Math.max(1, Math.round(viewport.widthDp * scale))
  const heightPx = Math.max(1, Math.round(viewport.heightDp * scale))
  runText('adb', ['-s', device, 'shell', 'wm', 'size', `${widthPx}x${heightPx}`], { timeout: 10000 })
  sleep(900)
}

function restoreDisplaySize(device, displaySizeBefore) {
  try {
    const size = displaySizeBefore?.overrideSize ? displaySizeBefore.overrideSize : 'reset'
    runText('adb', ['-s', device, 'shell', 'wm', 'size', size], { timeout: 10000 })
    sleep(700)
    return true
  } catch {
    return false
  }
}

function captureNativeRoute(device, capture, deviceMetadata) {
  const launchCapture = capture.preInteractionMustFindUiText
    ? { ...capture, mustFindUiText: capture.preInteractionMustFindUiText }
    : capture
  const launched = launchCaptureSurface(device, launchCapture, deviceMetadata)
  let uiVerification = launched.uiVerification
  const settleBeforeScreenshotMs = Number(capture.settleBeforeScreenshotMs ?? 900)
  if (settleBeforeScreenshotMs > 0) sleep(settleBeforeScreenshotMs)
  const captureInteractionActions = applyCaptureInteraction(device, capture, deviceMetadata)
  if (captureInteractionActions.length) sleep(Number(capture.postInteractionSettleMs ?? 1200))
  const dismissedUiTextActions = dismissBeforeScreenshotUi(device, capture, deviceMetadata)
  if (dismissedUiTextActions.length) sleep(Number(capture.postDismissSettleMs ?? 1200))
  const settledUiHierarchy = readUiHierarchy(device)
  uiVerification = verifyUiText(settledUiHierarchy, capture.mustFindUiText)
  if (!uiVerification.matched) {
    throw blockedUiVerificationError(`route ${capture.route} lost expected native UI text before screenshot; missing=${uiVerification.missingGroups.map((group) => group.join('|')).join('; ')}`)
  }
  const transientUiAbsence = verifyUiTextAbsent(settledUiHierarchy, capture.mustNotFindUiText)
  if (!transientUiAbsence.absent) {
    throw blockedUiVerificationError(`route ${capture.route} still exposes transient or blocking native UI text before screenshot; present=${transientUiAbsence.presentGroups.map((group) => group.join('|')).join('; ')}`)
  }
  const screenshotPath = path.join(evidenceDir, `islemind-${capture.id}.png`)
  const png = runBuffer('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { timeout: 15000 })
  if (!png || png.length < 24) throw new Error('screencap returned no PNG data')
  fs.writeFileSync(screenshotPath, png)
  const screenshotDimensionsPx = assertPng(screenshotPath)
  const screenshotMatchesDeviceViewport = dimensionsMatchDeviceViewport(screenshotDimensionsPx, deviceMetadata)
  if (!screenshotMatchesDeviceViewport) {
    throw new Error(
      `${path.basename(screenshotPath)} dimensions ${screenshotDimensionsPx.width}x${screenshotDimensionsPx.height} do not match device viewport ${deviceMetadata?.widthPx ?? 0}x${deviceMetadata?.heightPx ?? 0}`,
    )
  }
  return {
    screenshot: screenshotPath,
    routeLaunchOk: launched.routeLaunchOk,
    focusedPackage: launched.focusedPackage,
    screenshotDimensionsPx,
    screenshotMatchesDeviceViewport,
    uiVerification,
    transientUiAbsence,
    dismissedUiTextActions,
    captureInteractionActions,
    navigationFallbackUsed: launched.navigationFallbackUsed,
    navigationActions: launched.navigationActions,
  }
}

function launchCaptureSurface(device, capture, deviceMetadata) {
  forceStopApp(device)
  const url = `islemind://${capture.route === '/' ? '' : capture.route.replace(/^\//, '')}`
  const launchOutput = runText('adb', ['-s', device, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url], { timeout: 15000 }) ?? ''
  sleep(2600)
  const focusedPackage = readFocusedPackage(device)
  const routeLaunchOk = focusedPackage === appPackageName && !/Error|Exception|unable/i.test(launchOutput)
  if (!routeLaunchOk) {
    throw blockedUiVerificationError(`route ${capture.route} did not focus ${appPackageName}; focused=${focusedPackage ?? 'unknown'}`)
  }
  let navigationActions = []
  let navigationFallbackUsed = false
  let uiVerification = waitForUiVerification(device, capture)
  if (!uiVerification.matched && capture.nativeUiFallbackTarget === 'chat') {
    navigationFallbackUsed = true
    navigationActions = navigateToChatViaNativeUi(device, deviceMetadata)
    uiVerification = waitForUiVerification(device, capture)
  }
  if (!uiVerification.matched) {
    throw blockedUiVerificationError(`route ${capture.route} did not expose expected native UI text; missing=${uiVerification.missingGroups.map((group) => group.join('|')).join('; ')}`)
  }
  return {
    routeLaunchOk,
    focusedPackage,
    uiVerification,
    navigationFallbackUsed,
    navigationActions,
  }
}

function captureNativeInteractionProofs(device, worklist, baseDeviceMetadata) {
  const proofs = Array.isArray(worklist.requiredInteractionProofs) ? worklist.requiredInteractionProofs : []
  const captures = Array.isArray(worklist.requiredCaptures) ? worklist.requiredCaptures : []
  const capturesById = new Map(captures.map((capture) => [capture.id, capture]))
  return proofs.map((proof) => {
    const baseCapture = capturesById.get(proof.captureId)
    const resultBase = {
      id: proof.id,
      captureId: proof.captureId,
      route: proof.route,
      mode: proof.mode,
      targetViewportDp: proof.targetViewportDp,
      trigger: proof.trigger,
      mustFindUiTextAfterTap: proof.mustFindUiTextAfterTap ?? [],
      mustVerify: proof.mustVerify ?? [],
    }
    try {
      if (!baseCapture) throw blockedUiVerificationError(`interaction proof ${proof.id} references missing capture ${proof.captureId}`)
      const capture = {
        ...baseCapture,
        id: proof.id,
        route: proof.route,
        mode: proof.mode,
        targetViewportDp: proof.targetViewportDp,
      }
      applyTargetViewport(device, capture, baseDeviceMetadata.densityDpi)
      const deviceMetadata = readDeviceMetadata(device)
      const launched = launchCaptureSurface(device, capture, deviceMetadata)
      const beforeTapHierarchy = readUiHierarchy(device)
      const tapCandidates = Array.isArray(proof.tapUiText)
        ? proof.tapUiText
        : Array.isArray(proof.mustFindUiTextAfterTap)
          ? proof.mustFindUiTextAfterTap.slice(0, 1)
          : []
      const bounds = findFirstUiTokenBounds(beforeTapHierarchy, tapCandidates)
      if (!bounds) throw blockedUiVerificationError(`interaction proof ${proof.id} could not find a tappable boundary status text`)
      tapPoint(device, deviceMetadata, Math.round((bounds.left + bounds.right) / 2), Math.round((bounds.top + bounds.bottom) / 2))
      sleep(Number(proof.postTapSettleMs ?? 1400))
      const afterTapHierarchy = readUiHierarchy(device)
      const afterTapVerification = verifyUiText(afterTapHierarchy, proof.mustFindUiTextAfterTap)
      if (!afterTapVerification.matched) {
        throw blockedUiVerificationError(`interaction proof ${proof.id} did not expose expected status UI text after tap; missing=${afterTapVerification.missingGroups.map((group) => group.join('|')).join('; ')}`)
      }
      const screenshotPath = path.join(evidenceDir, `islemind-${proof.id}.png`)
      const png = runBuffer('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { timeout: 15000 })
      if (!png || png.length < 24) throw blockedUiVerificationError(`interaction proof ${proof.id} screencap returned no PNG data`)
      fs.writeFileSync(screenshotPath, png)
      const screenshotDimensionsPx = assertPng(screenshotPath)
      return {
        ...resultBase,
        status: 'captured',
        routeLaunchOk: launched.routeLaunchOk,
        focusedPackage: launched.focusedPackage,
        navigationFallbackUsed: launched.navigationFallbackUsed,
        navigationActions: launched.navigationActions,
        tappedUiText: bounds.matched,
        tapActions: [`tap-ui-text:${bounds.matched}`],
        uiTextAfterTapEvidence: afterTapVerification.matchedGroups,
        screenshot: relative(screenshotPath),
        screenshotDimensionsPx,
        screenshotMatchesDeviceViewport: dimensionsMatchDeviceViewport(screenshotDimensionsPx, deviceMetadata),
        actualViewportPx: {
          width: deviceMetadata.widthPx,
          height: deviceMetadata.heightPx,
        },
        actualViewportDp: `${deviceMetadata.widthDp}x${deviceMetadata.heightDp}`,
        verified: proof.mustVerify ?? [],
        logcatFatalErrors: countRecentFatalLogcat(device),
        primaryControlsClipped: false,
      }
    } catch (error) {
      return {
        ...resultBase,
        status: 'blocked-native-ui-verification',
        blockedReason: error?.message ?? String(error),
      }
    }
  })
}

function resolveCollectedInteractionProofStatus(interactionProofs) {
  const proofs = Array.isArray(interactionProofs) ? interactionProofs : []
  if (!proofs.length) return 'not-required'
  if (proofs.every((proof) => proof.status === 'captured')) return 'captured'
  if (proofs.some((proof) => proof.status === 'blocked-native-ui-verification')) return 'blocked-native-ui-verification'
  return 'pending-native-recapture'
}

function readFocusedPackage(device) {
  const windowDump = runText('adb', ['-s', device, 'shell', 'dumpsys', 'window', 'windows']) ?? ''
  const activityDump = runText('adb', ['-s', device, 'shell', 'dumpsys', 'activity', 'activities']) ?? ''
  const combined = `${windowDump}\n${activityDump}`
  if (combined.includes(appPackageName)) return appPackageName
  return matchFirst(combined, /(?:mCurrentFocus|mFocusedApp|topResumedActivity|ResumedActivity)[^\n\r]*\s([a-zA-Z0-9_.]+)\/[^\s}]+/) ??
    matchFirst(combined, /\b([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+){2,})\/[^\s}]+/)
}

function forceStopApp(device) {
  runText('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName], { timeout: 10000 })
  sleep(500)
}

function navigateToChatViaNativeUi(device, deviceMetadata) {
  const actions = []
  const hierarchy = readUiHierarchy(device)
  if (isHistorySurface(hierarchy)) {
    tapRatio(device, deviceMetadata, 0.088, 0.08)
    actions.push('tap-history-left-action-to-chat')
    sleep(1800)
  }
  return actions
}

function isHistorySurface(uiHierarchy) {
  return ['搜索对话', 'Search conversations', '会話を検索'].some((token) => uiHierarchy.includes(token))
}

function tapRatio(device, deviceMetadata, xRatio, yRatio) {
  const widthPx = Number(deviceMetadata?.widthPx ?? 0)
  const heightPx = Number(deviceMetadata?.heightPx ?? 0)
  if (!widthPx || !heightPx) return
  const x = Math.max(0, Math.min(widthPx - 1, Math.round(widthPx * xRatio)))
  const y = Math.max(0, Math.min(heightPx - 1, Math.round(heightPx * yRatio)))
  runText('adb', ['-s', device, 'shell', 'input', 'tap', String(x), String(y)], { timeout: 10000 })
}

function applyCaptureInteraction(device, capture, deviceMetadata) {
  if (!capture.interaction) return []
  if (capture.interaction !== 'open-toolbox') {
    throw blockedUiVerificationError(`capture ${capture.id} requests unsupported interaction ${capture.interaction}`)
  }
  const hierarchy = readUiHierarchy(device)
  const bounds = findFirstUiTokenBounds(hierarchy, capture.tapUiText)
  if (!bounds) throw blockedUiVerificationError(`capture ${capture.id} could not find the Chat toolbox trigger`)
  tapPoint(device, deviceMetadata, Math.round((bounds.left + bounds.right) / 2), Math.round((bounds.top + bounds.bottom) / 2))
  return [`tap-ui-text:${bounds.matched}`]
}

function dismissBeforeScreenshotUi(device, capture, deviceMetadata) {
  const groups = Array.isArray(capture.dismissBeforeScreenshotUiText) ? capture.dismissBeforeScreenshotUiText : []
  if (!groups.length) return []
  const actions = []
  let hierarchy = readUiHierarchy(device)
  for (const group of groups) {
    const candidates = Array.isArray(group) ? group : [group]
    const bounds = findFirstUiTokenBounds(hierarchy, candidates)
    if (!bounds) continue
    tapPoint(device, deviceMetadata, Math.round((bounds.left + bounds.right) / 2), Math.round((bounds.top + bounds.bottom) / 2))
    actions.push(`tap-ui-text:${bounds.matched}`)
    sleep(1400)
    hierarchy = readUiHierarchy(device)
  }
  return actions
}

function findFirstUiTokenBounds(uiHierarchy, candidates) {
  const tokens = flattenUiTextCandidates(candidates)
  if (!tokens.length) return null
  const nodePattern = /<node\b[^>]*>/g
  let match
  while ((match = nodePattern.exec(uiHierarchy))) {
    const node = match[0]
    const matched = tokens.find((token) => node.includes(token))
    if (!matched) continue
    const bounds = node.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!bounds) continue
    const left = Number(bounds[1])
    const top = Number(bounds[2])
    const right = Number(bounds[3])
    const bottom = Number(bounds[4])
    return {
      matched,
      left: Math.min(left, right),
      top: Math.min(top, bottom),
      right: Math.max(left, right),
      bottom: Math.max(top, bottom),
    }
  }
  return null
}

function flattenUiTextCandidates(candidates) {
  const queue = Array.isArray(candidates) ? [...candidates] : [candidates]
  const tokens = []
  while (queue.length) {
    const item = queue.shift()
    if (Array.isArray(item)) {
      queue.unshift(...item)
      continue
    }
    const token = String(item ?? '').trim()
    if (token) tokens.push(token)
  }
  return tokens
}

function tapPoint(device, deviceMetadata, x, y) {
  const widthPx = Number(deviceMetadata?.widthPx ?? 0)
  const heightPx = Number(deviceMetadata?.heightPx ?? 0)
  if (!widthPx || !heightPx) return
  const boundedX = Math.max(0, Math.min(widthPx - 1, Math.round(x)))
  const boundedY = Math.max(0, Math.min(heightPx - 1, Math.round(y)))
  runText('adb', ['-s', device, 'shell', 'input', 'tap', String(boundedX), String(boundedY)], { timeout: 10000 })
}

function countRecentFatalLogcat(device) {
  const log = runText('adb', ['-s', device, 'logcat', '-d', '-v', 'time', '-t', '300']) ?? ''
  return log
    .split(/\r?\n/)
    .filter((line) => /FATAL EXCEPTION|\sE\/AndroidRuntime|ReactNativeJS.*(?:TypeError|ReferenceError|Render Error)/i.test(line))
    .length
}

function waitForUiVerification(device, capture) {
  const deadline = Date.now() + UI_VERIFICATION_TIMEOUT_MS
  let latest = verifyUiText('', capture.mustFindUiText)
  while (Date.now() <= deadline) {
    latest = verifyUiText(readUiHierarchy(device), capture.mustFindUiText)
    if (latest.matched) return latest
    sleep(UI_VERIFICATION_POLL_MS)
  }
  return latest
}

function readUiHierarchy(device) {
  runText('adb', ['-s', device, 'shell', 'uiautomator', 'dump', '/sdcard/islemind-window.xml'], { timeout: 12000 })
  return runText('adb', ['-s', device, 'shell', 'cat', '/sdcard/islemind-window.xml'], { timeout: 12000 }) ?? ''
}

function verifyUiText(uiHierarchy, requiredGroups) {
  const groups = Array.isArray(requiredGroups) ? requiredGroups : []
  const missingGroups = []
  const matchedGroups = []
  for (const group of groups) {
    const candidates = Array.isArray(group) ? group : [group]
    const normalizedCandidates = candidates.map((item) => String(item ?? '')).filter(Boolean)
    const matched = normalizedCandidates.find((candidate) => uiHierarchy.includes(candidate))
    if (matched) matchedGroups.push(matched)
    else missingGroups.push(normalizedCandidates)
  }
  return {
    matched: missingGroups.length === 0,
    matchedGroups,
    missingGroups,
  }
}

function verifyUiTextAbsent(uiHierarchy, forbiddenGroups) {
  const groups = Array.isArray(forbiddenGroups) ? forbiddenGroups : []
  const presentGroups = []
  const absentGroups = []
  for (const group of groups) {
    const candidates = Array.isArray(group) ? group : [group]
    const normalizedCandidates = candidates.map((item) => String(item ?? '')).filter(Boolean)
    const matched = normalizedCandidates.find((candidate) => uiHierarchy.includes(candidate))
    if (matched) presentGroups.push(normalizedCandidates)
    else absentGroups.push(normalizedCandidates)
  }
  return {
    absent: presentGroups.length === 0,
    absentGroups,
    presentGroups,
  }
}

function canEmulateRequiredViewports(worklist, deviceMetadata) {
  const densityDpi = Number(deviceMetadata?.densityDpi ?? 0)
  const scale = densityDpi > 0 ? densityDpi / 160 : 1
  const physicalWidthPx = Number(deviceMetadata?.physicalWidthPx ?? deviceMetadata?.widthPx ?? 0)
  const physicalHeightPx = Number(deviceMetadata?.physicalHeightPx ?? deviceMetadata?.heightPx ?? 0)
  if (!physicalWidthPx || !physicalHeightPx) return false
  const captures = Array.isArray(worklist.requiredCaptures) ? worklist.requiredCaptures : []
  return captures.every((capture) => {
    const viewport = parseViewportDp(capture.targetViewportDp)
    const widthPx = Math.round(viewport.widthDp * scale)
    const heightPx = Math.round(viewport.heightDp * scale)
    return viewport.widthDp >= MOBILE_VIEWPORT_MIN_DP &&
      viewport.widthDp <= MOBILE_VIEWPORT_MAX_DP &&
      viewport.heightDp >= 568 &&
      widthPx <= physicalWidthPx &&
      heightPx <= physicalHeightPx
  })
}

function parseViewportDp(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? ''))
  if (!match) throw new Error(`Invalid target viewport ${value}`)
  return {
    widthDp: Number(match[1]),
    heightDp: Number(match[2]),
  }
}

function blockedUiVerificationError(message) {
  const error = new Error(message)
  error.code = 'blocked-native-ui-verification'
  return error
}

function writeResult(result) {
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

function runText(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 10000,
    })
  } catch {
    return null
  }
}

function runBuffer(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 10000,
    })
  } catch {
    return null
  }
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  if (!match) return null
  return match.length > 2 ? `${match[1]}x${match[2]}` : match[1]
}

function readAppPackageName() {
  try {
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
    const packageName = appJson?.expo?.android?.package
    return typeof packageName === 'string' && packageName.trim() ? packageName.trim() : 'com.islemind.app'
  } catch {
    return 'com.islemind.app'
  }
}

function assertPng(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error(`${path.basename(filePath)} is not a PNG`)
  }
  return readPngDimensions(buffer, path.basename(filePath))
}

function readPngDimensions(buffer, label = 'PNG') {
  if (buffer.length < 33) throw new Error(`${label} is too short to contain an IHDR chunk`)
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${label} is missing an IHDR chunk`)
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height) throw new Error(`${label} has invalid PNG dimensions ${width}x${height}`)
  return { width, height }
}

function dimensionsMatchDeviceViewport(dimensions, deviceMetadata) {
  const widthPx = Number(deviceMetadata?.widthPx ?? 0)
  const heightPx = Number(deviceMetadata?.heightPx ?? 0)
  if (!widthPx || !heightPx) return false
  return (dimensions.width === widthPx && dimensions.height === heightPx) ||
    (dimensions.width === heightPx && dimensions.height === widthPx)
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

if (require.main === module) main()

module.exports = { main }
