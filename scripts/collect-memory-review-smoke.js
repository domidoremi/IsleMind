const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const smokeDir = path.join(evidenceDir, 'memory-review-smoke')
const outputPath = path.join(evidenceDir, 'memory-review-smoke-results.json')
const fixturePath = path.join(smokeDir, 'islemind-memory-review-smoke.json')
const remoteFixturePath = '/sdcard/Download/islemind-memory-review-smoke.json'
const appPackageName = defaultReleaseAppPackageName
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const importJsonLabels = ['导入 JSON', 'Import JSON', 'JSON インポート']
const importDoneLabels = ['导入完成', 'Import complete', 'インポート完了']
const reviewImportedLabels = ['审查导入记忆', 'Review imported memories', 'インポートしたメモリを確認']
const reviewQueueLabels = ['复核队列', 'Review queue', '確認キュー']
const importedFilterLabels = ['导入', 'Imported', 'インポート']
const lowConfidenceLabels = ['低置信', 'Low confidence', '低信頼度']
const confirmPendingLabels = ['确认全部待确认记忆', 'Confirm all pending memories', '確認待ち記憶をすべて確認']
const confirmPendingTitleLabels = ['确认 3 条待确认记忆？', 'Confirm 3 pending memories?', '3 件の確認待ち記憶を確認しますか？']

function main() {
  fs.mkdirSync(smokeDir, { recursive: true })
  writeFixture()

  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    fixture: relative(fixturePath),
    remoteFixturePath,
    pushedFixture: false,
    importDialogShown: false,
    importDialogPng: null,
    importDialogUia: null,
    reviewNowTapped: false,
    reviewRouteShown: false,
    reviewQueueVisible: false,
    importedFilterVisible: false,
    lowConfidenceFilterVisible: false,
    pendingImportedMemoryVisible: false,
    lowConfidenceMemoryVisible: false,
    confirmAllTapped: false,
    confirmDialogShown: false,
    confirmDialogPng: null,
    confirmDialogUia: null,
    confirmDialogAccepted: false,
    activeFilterTapped: false,
    activeCountVisible: false,
    pendingClearedVisible: false,
    activeImportedMemoryVisible: false,
    approvedMemoryPng: null,
    approvedMemoryUia: null,
    reviewPng: null,
    reviewUia: null,
    lowConfidencePng: null,
    lowConfidenceUia: null,
    log: relative(path.join(smokeDir, 'memory-review-smoke.log')),
    steps: [],
    errors: [],
  }

  try {
    if (!device) throw new Error('No connected adb device was found.')
    result.pushedFixture = pushFixture(device)
    openSettings(device)
    captureStep(device, result, 'settings-start')
    tapImportJson(device, result)
    captureStep(device, result, 'file-picker-start')
    tapFileInDocumentsUi(device, result)
    sleep(1800)
    const importDialog = captureStep(device, result, 'import-confirm')
    result.importDialogShown = hasAnyText(importDialog.uiaText, [...importDoneLabels, ...reviewImportedLabels])
    result.importDialogPng = importDialog.png
    result.importDialogUia = importDialog.uia
    if (!result.importDialogShown) throw new Error('Import completion dialog was not visible after selecting the fixture.')

    result.reviewNowTapped = tapText(device, importDialog.uiaText, reviewImportedLabels)
    if (!result.reviewNowTapped) throw new Error('Could not tap the review-imported-memories action.')
    sleep(2500)

    const review = captureStep(device, result, 'review-imported')
    result.reviewPng = review.png
    result.reviewUia = review.uia
    result.reviewRouteShown = hasAnyText(review.uiaText, ['记忆', 'Memory', 'メモリ'])
    result.reviewQueueVisible = hasAnyText(review.uiaText, [...reviewQueueLabels, '待审记忆质量'])
    result.importedFilterVisible = /导入\s+\d/.test(review.uiaText) || /Imported\s+\d/.test(review.uiaText) || /インポート\s+\d/.test(review.uiaText) || hasAnyText(review.uiaText, importedFilterLabels)
    result.lowConfidenceFilterVisible = /低置信\s+\d/.test(review.uiaText) || /Low confidence\s+\d/.test(review.uiaText) || /低信頼度\s+\d/.test(review.uiaText) || hasAnyText(review.uiaText, lowConfidenceLabels)
    result.pendingImportedMemoryVisible = hasAnyText(review.uiaText, ['MEM0_REVIEW_IMPORTED_HIGH', 'MEM0_REVIEW_IMPORTED_LOW'])
    if (!result.pendingImportedMemoryVisible) {
      for (let index = 0; index < 3; index += 1) {
        swipeUp(device)
        sleep(500)
        const rows = captureStep(device, result, `review-imported-rows-${index}`)
        if (hasAnyText(rows.uiaText, ['MEM0_REVIEW_IMPORTED_HIGH', 'MEM0_REVIEW_IMPORTED_LOW'])) {
          result.pendingImportedMemoryVisible = true
          result.reviewPng = rows.png
          result.reviewUia = rows.uia
          break
        }
      }
    }
    if (!result.reviewQueueVisible || !result.pendingImportedMemoryVisible) {
      throw new Error('Imported pending memories were not visible in the review queue.')
    }

    if (tapText(device, review.uiaText, lowConfidenceLabels)) {
      sleep(900)
      const lowConfidence = captureStep(device, result, 'review-low-confidence')
      result.lowConfidencePng = lowConfidence.png
      result.lowConfidenceUia = lowConfidence.uia
      result.lowConfidenceMemoryVisible = hasAnyText(lowConfidence.uiaText, ['MEM0_REVIEW_IMPORTED_LOW', 'MEM0_REVIEW_MODEL_LOW'])
    }

    result.confirmAllTapped = tapTextFromLatest(device, result, confirmPendingLabels)
    if (!result.confirmAllTapped) throw new Error('Could not tap the confirm-all pending memories action.')
    sleep(700)
    const confirmDialog = captureStep(device, result, 'confirm-pending-dialog')
    result.confirmDialogPng = confirmDialog.png
    result.confirmDialogUia = confirmDialog.uia
    result.confirmDialogShown = hasAnyText(confirmDialog.uiaText, [...confirmPendingTitleLabels, ...confirmPendingLabels])
    if (!result.confirmDialogShown) throw new Error('Confirm pending memories dialog was not visible.')

    result.confirmDialogAccepted = tapText(device, confirmDialog.uiaText, confirmPendingLabels)
    if (!result.confirmDialogAccepted) throw new Error('Could not accept the confirm pending memories dialog.')
    sleep(1800)
    const afterConfirm = captureStep(device, result, 'after-confirm-pending')
    result.activeCountVisible = hasAnyText(afterConfirm.uiaText, ['启用 3', 'Active 3', '有効 3'])
    result.pendingClearedVisible = hasAnyText(afterConfirm.uiaText, ['待确认 0', 'Pending 0', '確認待ち 0'])
    result.activeFilterTapped = tapText(device, afterConfirm.uiaText, ['启用 3', 'Active 3', '有効 3'])
    if (!result.activeFilterTapped) throw new Error('Could not tap the active memories filter after confirmation.')
    sleep(700)
    const active = findVisibleActiveImportedMemory(device, result)
    result.approvedMemoryPng = active.png
    result.approvedMemoryUia = active.uia
    result.activeImportedMemoryVisible = active.visible
    if (!result.activeImportedMemoryVisible) throw new Error('Confirmed imported memories were not visible in the active memory list.')
  } catch (error) {
    result.errors.push(error.message)
  }

  writeLog(result)
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${isPassing(result) ? 'Memory review smoke passed' : 'Memory review smoke failed'}: ${relative(outputPath)}`)
  if (!isPassing(result)) process.exitCode = 1
}

function writeFixture() {
  const now = new Date().toISOString()
  const fixture = {
    schema: 'islemind.mem0.v1',
    source: 'islemind',
    exported_at: now,
    filters: { app_id: 'islemind', user_id: 'qa-memory-review' },
    memories: [
      {
        id: 'qa-mem0-review-imported-high',
        memory: 'MEM0_REVIEW_IMPORTED_HIGH user prefers concise daily planning summaries.',
        app_id: 'islemind',
        user_id: 'qa-memory-review',
        metadata: {
          islemind_status: 'pending',
          islemind_source_kind: 'imported',
          islemind_source_detail: 'mem0 qa fixture imported high confidence',
          islemind_confidence: 0.92,
        },
        created_at: now,
        updated_at: now,
      },
      {
        id: 'qa-mem0-review-imported-low',
        memory: 'MEM0_REVIEW_IMPORTED_LOW user maybe prefers speculative long reports.',
        app_id: 'islemind',
        user_id: 'qa-memory-review',
        metadata: {
          islemind_status: 'pending',
          islemind_source_kind: 'imported',
          islemind_source_detail: 'mem0 qa fixture imported low confidence',
          islemind_confidence: 0.42,
        },
        created_at: now,
        updated_at: now,
      },
      {
        id: 'qa-mem0-review-model-low',
        memory: 'MEM0_REVIEW_MODEL_LOW model inferred uncertain preference for offline research bundles.',
        app_id: 'islemind',
        user_id: 'qa-memory-review',
        metadata: {
          islemind_status: 'pending',
          islemind_source_kind: 'model',
          islemind_source_detail: 'mem0 qa fixture model low confidence',
          islemind_confidence: 0.31,
        },
        created_at: now,
        updated_at: now,
      },
    ],
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
}

function resolveDevice(requested, options = {}) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  if (options.strict) return null
  return serials[0] ?? null
}

function pushFixture(device) {
  const output = runCommand('adb', ['-s', device, 'push', fixturePath, remoteFixturePath])
  return output !== null
}

function openSettings(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'islemind://settings'])
  sleep(2500)
}

function tapImportJson(device, result) {
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, result, `settings-import-search-${index}`)
    if (tapText(device, capture.uiaText, importJsonLabels)) {
      sleep(1400)
      return
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the Settings import JSON action.')
}

function tapFileInDocumentsUi(device, result) {
  const fileName = 'islemind-memory-review-smoke.json'
  let searched = false
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, result, `file-picker-search-${index}`)
    if (hasAnyText(capture.uiaText, importDoneLabels)) return
    if (tapFileTitle(device, capture.uiaText, fileName)) {
      sleep(1800)
      return
    }
    if (!searched && searchDocumentsUi(device, capture.uiaText, fileName)) {
      searched = true
      sleep(1100)
      continue
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the mem0 fixture in Android DocumentsUI.')
}

function searchDocumentsUi(device, uiaText, fileName) {
  if (!tapText(device, uiaText, ['搜索', 'Search', '検索'])) return false
  sleep(500)
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', fileName])
  return true
}

function tapFileTitle(device, uiaText, fileName) {
  const nodes = parseNodes(uiaText)
  const titleNodes = nodes
    .filter((item) => item.enabled && item.text === fileName)
    .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
    .filter(({ bounds }) => bounds && bounds.top > 300)
    .sort((a, b) => a.bounds.top - b.bounds.top)
  for (const { item: titleNode, bounds: titleBounds } of titleNodes) {
    const card = nodes
      .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
      .filter(({ item, bounds }) => item.enabled && item.clickable && bounds && boundsContains(bounds, titleBounds))
      .sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))[0]
    if (card?.bounds) {
      const x = Math.round(card.bounds.left + (card.bounds.right - card.bounds.left) * 0.35)
      const y = Math.round(card.bounds.top + (card.bounds.bottom - card.bounds.top) * 0.55)
      runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(x), String(y)])
      return true
    }
    tapBoundsCenter(device, titleNode.bounds)
    return true
  }
  const previewNode = nodes.find((item) => item.enabled && item.clickable && item.contentDesc.includes(fileName))
  if (!previewNode) return false
  const box = parseBounds(previewNode.bounds)
  if (!box) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.max(1, box.left - 80)), String(Math.round((box.top + box.bottom) / 2))])
  return true
}

function captureStep(device, result, name) {
  const png = path.join(smokeDir, `${name}.png`)
  const uia = path.join(smokeDir, `${name}.uia.xml`)
  runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', `/sdcard/${name}.png`])
  runCommand('adb', ['-s', device, 'pull', `/sdcard/${name}.png`, png])
  runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', `/sdcard/${name}.uia.xml`])
  runCommand('adb', ['-s', device, 'pull', `/sdcard/${name}.uia.xml`, uia])
  const uiaText = fs.existsSync(uia) ? fs.readFileSync(uia, 'utf8') : ''
  const step = {
    name,
    png: relative(png),
    uia: relative(uia),
    visibleText: extractVisibleText(uiaText).slice(0, 80),
  }
  result.steps.push(step)
  return { png: step.png, uia: step.uia, uiaText }
}

function tapText(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  for (const label of labels) {
    const node = nodes.find((item) => item.enabled && item.clickable && textMatches(item, label))
      ?? nodes.find((item) => item.enabled && textMatches(item, label))
    if (!node) continue
    tapBoundsCenter(device, node.bounds)
    return true
  }
  return false
}

function tapTextFromLatest(device, result, labels) {
  const latest = captureStep(device, result, 'before-confirm-pending')
  if (tapText(device, latest.uiaText, labels)) return true
  for (let index = 0; index < 3; index += 1) {
    swipeUp(device)
    sleep(450)
    const capture = captureStep(device, result, `confirm-pending-search-${index}`)
    if (tapText(device, capture.uiaText, labels)) return true
  }
  return false
}

function findVisibleActiveImportedMemory(device, result) {
  for (let index = 0; index < 4; index += 1) {
    const capture = captureStep(device, result, `active-imported-${index}`)
    const visible = hasAnyText(capture.uiaText, ['MEM0_REVIEW_IMPORTED_HIGH', 'MEM0_REVIEW_IMPORTED_LOW'])
      && hasAnyText(capture.uiaText, ['导入记忆', 'Imported', 'インポート'])
    if (visible) return { ...capture, visible }
    swipeUp(device)
    sleep(450)
  }
  const fallback = captureStep(device, result, 'active-imported-missing')
  return { ...fallback, visible: false }
}

function parseNodes(uiaText) {
  const nodes = []
  const pattern = /<node\b[^>]*>/g
  let match
  while ((match = pattern.exec(uiaText))) {
    const tag = match[0]
    const bounds = matchFirst(tag, /bounds="([^"]+)"/)
    if (!bounds) continue
    nodes.push({
      text: decodeXml(matchFirst(tag, /text="([^"]*)"/) ?? ''),
      contentDesc: decodeXml(matchFirst(tag, /content-desc="([^"]*)"/) ?? ''),
      bounds,
      enabled: matchFirst(tag, /enabled="([^"]+)"/) !== 'false',
      clickable: matchFirst(tag, /clickable="([^"]+)"/) === 'true',
    })
  }
  return nodes
}

function textMatches(node, label) {
  return node.text.includes(label) || node.contentDesc.includes(label)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box) return
  const x = Math.round((box.left + box.right) / 2)
  const y = Math.round((box.top + box.bottom) / 2)
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(x), String(y)])
}

function parseBounds(bounds) {
  const match = String(bounds ?? '').match(/\[(\-?\d+),(\-?\d+)\]\[(\-?\d+),(\-?\d+)\]/)
  if (!match) return null
  const [, left, top, right, bottom] = match.map(Number)
  return { left, top, right, bottom }
}

function boundsContains(outer, inner) {
  return outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '620', '450'])
}

function hasAnyText(text, values) {
  return values.some((value) => text.includes(value))
}

function extractVisibleText(uiaText) {
  const values = []
  for (const node of parseNodes(uiaText)) {
    if (node.text) values.push(node.text)
    if (node.contentDesc) values.push(node.contentDesc)
  }
  return [...new Set(values)]
}

function writeLog(result) {
  const lines = [
    `generatedAt=${result.generatedAt}`,
    `device=${result.device ?? 'missing'}`,
    `pushedFixture=${result.pushedFixture}`,
    `importDialogShown=${result.importDialogShown}`,
    `reviewRouteShown=${result.reviewRouteShown}`,
    `reviewQueueVisible=${result.reviewQueueVisible}`,
    `pendingImportedMemoryVisible=${result.pendingImportedMemoryVisible}`,
    `lowConfidenceMemoryVisible=${result.lowConfidenceMemoryVisible}`,
    `confirmAllTapped=${result.confirmAllTapped}`,
    `confirmDialogShown=${result.confirmDialogShown}`,
    `confirmDialogAccepted=${result.confirmDialogAccepted}`,
    `activeCountVisible=${result.activeCountVisible}`,
    `pendingClearedVisible=${result.pendingClearedVisible}`,
    `activeImportedMemoryVisible=${result.activeImportedMemoryVisible}`,
    ...result.errors.map((error) => `error=${error}`),
  ]
  fs.writeFileSync(path.join(smokeDir, 'memory-review-smoke.log'), `${lines.join('\n')}\n`, 'utf8')
}

function isPassing(result) {
  return Boolean(
    result.device &&
    result.pushedFixture &&
    result.importDialogShown &&
    result.reviewNowTapped &&
    result.reviewRouteShown &&
    result.reviewQueueVisible &&
    result.importedFilterVisible &&
    result.lowConfidenceFilterVisible &&
    result.pendingImportedMemoryVisible &&
    result.confirmAllTapped &&
    result.confirmDialogShown &&
    result.confirmDialogAccepted &&
    result.activeFilterTapped &&
    result.activeCountVisible &&
    result.pendingClearedVisible &&
    result.activeImportedMemoryVisible &&
    result.reviewPng &&
    result.reviewUia &&
    result.confirmDialogPng &&
    result.confirmDialogUia &&
    result.approvedMemoryPng &&
    result.approvedMemoryUia &&
    fs.existsSync(path.join(root, result.reviewPng)) &&
    fs.existsSync(path.join(root, result.reviewUia)) &&
    fs.existsSync(path.join(root, result.confirmDialogPng)) &&
    fs.existsSync(path.join(root, result.confirmDialogUia)) &&
    fs.existsSync(path.join(root, result.approvedMemoryPng)) &&
    fs.existsSync(path.join(root, result.approvedMemoryUia)) &&
    result.errors.length === 0
  )
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

main()
