const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const outputPath = path.join(evidenceDir, 'coverage-report.md')
const provenancePath = path.join(evidenceDir, 'apk-provenance.json')
const locales = ['zh-CN', 'en', 'ja']
const appPackageName = 'com.islemind.app'
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const sensitiveEvidenceExtensions = new Set(['.json', '.jsonl', '.log', '.md', '.txt', '.xml'])
const secretPatterns = [
  { label: 'OpenAI-style API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'MiMo Token Plan API key', pattern: /\btp-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'Bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/g },
]
const interactiveTags = [
  'IslePressable',
  'Pressable',
  'IsleIconButton',
  'IsleButton',
  'IsleToggle',
  'IsleListItem',
  'DataButton',
  'DangerButton',
  'ActionButton',
  'ComposerToolButton',
  'TextInput',
]
const expectedRoutes = [
  '/',
  '/conversations',
  '/settings',
  '/chat/[id]',
  '/source',
  '/settings/providers',
  '/settings/context',
  '/settings/knowledge',
  '/settings/memory',
  '/settings/preferences',
  '/settings/skills',
  '/settings/mcp',
]

main()

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const sourceFiles = listFiles(path.join(root, 'src')).concat(listFiles(path.join(root, 'app')))
    .filter((file) => sourceExtensions.has(path.extname(file)))
  const appRoutes = listFiles(path.join(root, 'app'))
    .filter((file) => path.extname(file) === '.tsx')
    .map(routeFromAppFile)
    .filter(Boolean)
    .sort(routeSort)
  const routeLinks = collectRouteLinks(sourceFiles)
  const i18n = auditI18n(sourceFiles)
  const staticControls = auditStaticControls(sourceFiles)
  const uiSnapshots = auditUiaSnapshots()
  const releaseProvenance = collectReleaseProvenance()
  const resultEvidence = auditResultEvidence()
  const sensitiveEvidence = auditSensitiveEvidence()
  const report = renderReport({
    generatedAt: new Date().toISOString(),
    appRoutes,
    routeLinks,
    i18n,
    staticControls,
    uiSnapshots,
    releaseProvenance,
    resultEvidence,
    sensitiveEvidence,
  })
  fs.writeFileSync(outputPath, report, 'utf8')
  console.log(report)
  const blockingIssues = findBlockingIssues({ i18n, staticControls, uiSnapshots, releaseProvenance, resultEvidence, sensitiveEvidence })
  if (blockingIssues.length) {
    console.error(`QA coverage audit failed:\n${blockingIssues.map((issue) => `- ${issue}`).join('\n')}`)
    process.exit(1)
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(full)
  }
  return files
}

function routeFromAppFile(file) {
  const relative = path.relative(path.join(root, 'app'), file).replace(/\\/g, '/')
  if (relative === '_layout.tsx') return null
  let route = `/${relative.replace(/\.tsx$/, '')}`
  route = route.replace(/\/index$/, '')
  return route || '/'
}

function routeSort(a, b) {
  return a.localeCompare(b, 'en')
}

function collectRouteLinks(files) {
  const links = new Map()
  const patterns = [
    /router\.(?:push|replace)\(\s*['"]([^'"]+)['"]/g,
    /pathname:\s*['"]([^'"]+)['"]/g,
    /Linking\.createURL\(\s*`([^`]+)`/g,
  ]
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const route = normalizeRoute(match[1])
        if (!route) continue
        const hit = links.get(route) ?? { route, files: new Set() }
        hit.files.add(relative(file))
        links.set(route, hit)
      }
    }
  }
  return [...links.values()]
    .map((hit) => ({ route: hit.route, files: [...hit.files].sort() }))
    .sort((a, b) => routeSort(a.route, b.route))
}

function normalizeRoute(route) {
  if (!route.startsWith('/')) return null
  return route.replace(/\$\{[^}]+\}/g, '[id]')
}

function auditI18n(files) {
  const localeResources = Object.fromEntries(locales.map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'resources', `${locale}.json`), 'utf8')),
  ]))
  const keys = new Set()
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\b(?:t|st)\(\s*['"]([^'"`]+)['"]/g)) {
      keys.add(match[1])
    }
  }
  const missing = []
  for (const key of [...keys].sort()) {
    for (const locale of locales) {
      if (!hasNestedKey(localeResources[locale], key)) missing.push({ locale, key })
    }
  }
  return { checkedKeyCount: keys.size, missing }
}

function hasNestedKey(resource, key) {
  return key.split('.').reduce((current, part) => {
    if (!current || !Object.prototype.hasOwnProperty.call(current, part)) return undefined
    return current[part]
  }, resource) !== undefined
}

function auditStaticControls(files) {
  const controls = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    visit(sourceFile)

    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = jsxTagName(node.tagName)
        if (interactiveTags.includes(tag)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
          const props = jsxPropNames(node.attributes)
          const hiddenFromAccessibility = jsxBooleanPropValue(node.attributes, 'accessible') === false
          const forwardsAccessibilityProps = jsxHasSpreadAttribute(node.attributes) && isUiPrimitiveFile(file)
          const parent = node.parent
          const hasLabel = ['accessibilityLabel', 'accessibilityHint', 'label', 'title', 'placeholder', 'description'].some((prop) => props.has(prop))
          const hasVisibleText = !ts.isJsxSelfClosingElement(node) && ts.isJsxElement(parent) && parent.openingElement === node && jsxElementHasText(parent)
          const likelyAccessible = hiddenFromAccessibility || forwardsAccessibilityProps || hasLabel || hasVisibleText
          controls.push({
            file: relative(file),
            line,
            tag,
            likelyAccessible,
            reason: hiddenFromAccessibility
              ? 'hidden-from-accessibility'
              : forwardsAccessibilityProps
                ? 'prop-forwarding-wrapper'
                : likelyAccessible ? 'label-or-visible-text' : 'review-label',
          })
        }
      }
      ts.forEachChild(node, visit)
    }
  }
  const reviewNeeded = controls.filter((control) => !control.likelyAccessible)
  return { total: controls.length, reviewNeeded }
}

function jsxTagName(name) {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isPropertyAccessExpression(name)) return name.name.text
  return name.getText()
}

function jsxPropNames(attributes) {
  const props = new Set()
  for (const prop of attributes.properties) {
    if (ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name)) props.add(prop.name.text)
  }
  return props
}

function jsxHasSpreadAttribute(attributes) {
  return attributes.properties.some((prop) => ts.isJsxSpreadAttribute(prop))
}

function jsxBooleanPropValue(attributes, name) {
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !ts.isIdentifier(prop.name) || prop.name.text !== name) continue
    if (!prop.initializer) return true
    if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
    if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
    if (ts.isJsxExpression(prop.initializer)) {
      if (!prop.initializer.expression) return true
      if (prop.initializer.expression.kind === ts.SyntaxKind.FalseKeyword) return false
      if (prop.initializer.expression.kind === ts.SyntaxKind.TrueKeyword) return true
    }
  }
  return undefined
}

function isUiPrimitiveFile(file) {
  const normalized = relative(file)
  return normalized.startsWith('src/components/ui/isle/') || normalized === 'src/components/ui/PressableScale.tsx'
}

function jsxElementHasText(element) {
  for (const child of element.children) {
    if (ts.isJsxText(child) && child.getText().trim()) return true
    if (ts.isJsxExpression(child) && child.expression) return true
    if (ts.isJsxElement(child) && jsxElementHasText(child)) return true
  }
  return false
}

function auditUiaSnapshots() {
  const files = listFiles(evidenceDir).filter((file) => file.endsWith('.uia.xml'))
  if (!files.length) return []
  const density = readDeviceDensity()
  return files
    .sort((a, b) => relative(a).localeCompare(relative(b), 'en'))
    .map((file) => auditUiaSnapshot(file, density))
}

function auditUiaSnapshot(file, density) {
  const xml = fs.readFileSync(file, 'utf8')
  const screenshotPath = file.replace(/\.uia\.xml$/, '.png')
  const screenshotFile = fs.existsSync(screenshotPath) ? relative(screenshotPath) : null
  const nodes = [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => parseAttributes(match[1]))
  const viewport = detectSnapshotViewport(nodes)
  const clickable = nodes.filter((node) => node.clickable === 'true')
  const unlabeled = clickable.filter((node) => !node.text && !node['content-desc'])
  const appUnlabeled = unlabeled.filter((node) => isAppOwnedPackage(node.package))
  const externalUnlabeled = unlabeled.filter((node) => !isAppOwnedPackage(node.package))
  const measuredTargets = clickable
    .map((node) => ({ ...node, box: parseBounds(node.bounds), label: node['content-desc'] || node.text || '(unlabeled)' }))
    .filter((node) => node.box)
    .map((node) => {
      const widthDp = density ? Math.round(node.box.width / (density / 160)) : null
      const heightDp = density ? Math.round(node.box.height / (density / 160)) : null
      const belowTarget = density ? widthDp < 44 || heightDp < 44 : node.box.width < 44 || node.box.height < 44
      const edgePartial = isViewportEdgePartial(node.box, viewport)
      const invalidBounds = node.box.clipped
      return {
        label: node.label,
        className: node.class,
        packageName: node.package,
        bounds: node.bounds,
        widthDp,
        heightDp,
        widthPx: node.box.width,
        heightPx: node.box.height,
        belowTarget,
        edgePartial,
        invalidBounds,
        clipped: invalidBounds && !edgePartial,
      }
    })
  const clippedTargets = measuredTargets.filter((node) => node.clipped)
  const edgePartialTargets = measuredTargets.filter((node) => node.edgePartial && (node.invalidBounds || node.belowTarget))
  const smallTargets = measuredTargets
    .filter((node) => !node.packageName || node.packageName === appPackageName)
    .filter((node) => !node.clipped && !node.edgePartial)
    .filter((node) => node.belowTarget)
  return {
    file: relative(file),
    screenshotFile,
    nodeCount: nodes.length,
    clickableCount: clickable.length,
    unlabeled,
    appUnlabeled,
    externalUnlabeled,
    smallTargets,
    clippedTargets,
    edgePartialTargets,
    density,
    capturedAt: fs.statSync(file).mtime.toISOString(),
  }
}

function isAppOwnedPackage(packageName) {
  return !packageName || packageName === appPackageName
}

function parseAttributes(input) {
  const attrs = {}
  for (const match of input.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2])
  return attrs
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseBounds(bounds) {
  const match = /^\[(\d+),(\d+)]\[(\d+),(\d+)]$/.exec(bounds ?? '')
  if (!match) return null
  const [, left, top, right, bottom] = match.map(Number)
  const width = right - left
  const height = bottom - top
  return { left, top, right, bottom, width, height, clipped: width <= 0 || height <= 0 }
}

function detectSnapshotViewport(nodes) {
  const scrollViewport = nodes
    .filter((node) => node.class === 'android.widget.ScrollView' && node.scrollable === 'true')
    .map((node) => parseBounds(node.bounds))
    .filter(Boolean)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
  if (scrollViewport) return scrollViewport
  return nodes
    .map((node) => parseBounds(node.bounds))
    .filter(Boolean)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] ?? null
}

function isViewportEdgePartial(box, viewport) {
  if (!viewport) return false
  return box.top <= viewport.top || box.bottom >= viewport.bottom || box.left <= viewport.left || box.right >= viewport.right
}

function readDeviceDensity() {
  const file = path.join(evidenceDir, 'device.json')
  if (!fs.existsSync(file)) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Number.isFinite(data.density) ? data.density : null
  } catch {
    return null
  }
}

function collectReleaseProvenance() {
  const apk = findCurrentReleaseApk()
  const cached = readJsonFile(provenancePath)
  const expected = readExpectedAppConfig()
  const installed = readInstalledPackageInfo()
  const releaseProvenance = {
    generatedAt: new Date().toISOString(),
    appPackageName,
    apk,
    expected,
    installed,
    source: installed?.deviceSerial ? 'adb' : cached ? 'cached' : 'missing',
  }
  const effective = installed ? releaseProvenance : normalizeCachedProvenance(cached, apk, expected)
  if (installed || !cached) {
    fs.writeFileSync(provenancePath, `${JSON.stringify(releaseProvenance, null, 2)}\n`, 'utf8')
  }
  return effective
}

function findCurrentReleaseApk() {
  const distDir = path.join(root, 'dist-apk')
  if (!fs.existsSync(distDir)) return null
  const files = fs.readdirSync(distDir)
    .filter((name) => /^IsleMind-\d+\.\d+\.\d+-x86_64-no-model\.apk$/.test(name))
    .map((name) => path.join(distDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  const apkPath = files[0]
  if (!apkPath) return null
  const sha256 = sha256File(apkPath)
  return {
    path: relative(apkPath),
    sha256,
    sizeBytes: fs.statSync(apkPath).size,
    sidecarSha256: readSha256Sidecar(apkPath),
    modifiedAt: fs.statSync(apkPath).mtime.toISOString(),
  }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function readSha256Sidecar(apkPath) {
  const sidecar = `${apkPath}.sha256`
  if (!fs.existsSync(sidecar)) return null
  const text = fs.readFileSync(sidecar, 'utf8').trim()
  const match = text.match(/^([a-fA-F0-9]{64})\b/)
  return match ? match[1].toLowerCase() : null
}

function readExpectedAppConfig() {
  const packageJson = readJsonFile(path.join(root, 'package.json'))
  const appJson = readJsonFile(path.join(root, 'app.json'))
  const expo = appJson?.expo ?? {}
  return {
    packageVersion: packageJson?.version ?? null,
    expoVersion: expo.version ?? null,
    androidPackage: expo.android?.package ?? null,
    androidVersionCode: expo.android?.versionCode ?? null,
  }
}

function readInstalledPackageInfo() {
  const deviceSerial = resolveAdbDeviceSerial()
  if (!deviceSerial) return null
  const packageDump = runAdb(deviceSerial, ['shell', 'dumpsys', 'package', appPackageName])
  if (!packageDump || /Unable to find package|not found/i.test(packageDump)) return null
  const installPath = runAdb(deviceSerial, ['shell', 'pm', 'path', appPackageName])?.trim() ?? null
  const deviceAbi = runAdb(deviceSerial, ['shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null
  const info = {
    deviceSerial,
    deviceAbi,
    packagePath: installPath || null,
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
    primaryCpuAbi: matchFirst(packageDump, /primaryCpuAbi=([^\s]+)/),
    firstInstallTime: matchFirst(packageDump, /firstInstallTime=([^\n\r]+)/),
    lastUpdateTime: matchFirst(packageDump, /lastUpdateTime=([^\n\r]+)/),
  }
  info.cleanInstall = Boolean(info.firstInstallTime && info.lastUpdateTime && info.firstInstallTime === info.lastUpdateTime)
  return info
}

function resolveAdbDeviceSerial() {
  const requested = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
  const devices = runCommand('adb', ['devices'])
  if (!devices) return null
  const serials = devices
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  return serials[0] ?? null
}

function runAdb(deviceSerial, args) {
  return runCommand('adb', ['-s', deviceSerial, ...args])
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    })
  } catch {
    return null
  }
}

function normalizeCachedProvenance(cached, apk, expected) {
  if (!cached) return { generatedAt: new Date().toISOString(), appPackageName, apk, expected, installed: null, source: 'missing' }
  const currentSha = apk?.sha256 ?? null
  const cachedSha = cached.apk?.sha256 ?? null
  return {
    ...cached,
    generatedAt: cached.generatedAt ?? new Date().toISOString(),
    appPackageName,
    apk: apk ?? cached.apk ?? null,
    expected: expected ?? cached.expected ?? null,
    installed: cached.installed ?? null,
    source: currentSha && cachedSha && currentSha === cachedSha ? 'cached' : 'stale-cache',
  }
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function matchFirst(text, pattern) {
  const match = text.match(pattern)
  return match ? match[1].trim() : null
}

function toNumber(value) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function auditResultEvidence() {
  const checks = [
    checkKnowledgeSelfTest(),
    checkSettingsBackResults(),
    checkLocalModelDownloadResults(),
    checkMcpOfflineResults(),
    checkMcpOnlineRequests(),
    checkPreferencesPersistence(),
    checkThemeLocaleResults(),
    checkFontScaleResults(),
    checkMockChatRequests(),
    checkLongContentRequests(),
    checkCorruptMirrorRequests(),
  ]
  return checks.map((check) => ({
    ...check,
    passed: check.issues.length === 0,
  }))
}

function resultCheck(name, fileName, validate) {
  const file = path.join(evidenceDir, fileName)
  if (!fs.existsSync(file)) {
    return { name, file: `test-evidence/qa/${fileName}`, summary: 'missing', issues: [`Missing result evidence file ${fileName}.`] }
  }
  try {
    return validate(file)
  } catch (error) {
    return {
      name,
      file: `test-evidence/qa/${fileName}`,
      summary: 'parse failed',
      issues: [`Could not parse ${fileName}: ${error.message}`],
    }
  }
}

function checkKnowledgeSelfTest() {
  return resultCheck('Knowledge and memory self-test result', 'settings-knowledge-selftest-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const failed = data.steps?.filter((step) => step.status === '失败') ?? []
    const passed = data.steps?.filter((step) => step.status === '通过') ?? []
    const expectedWarning = data.steps?.some((step) => step.name === '联网搜索' && step.status === '需配置')
    const issues = []
    if (!/失败 0/.test(data.summaryDialog?.summary ?? '')) issues.push('Self-test summary does not report 失败 0.')
    if (failed.length) issues.push(`Self-test has failing steps: ${failed.map((step) => step.name).join(', ')}.`)
    if (passed.length < 6) issues.push(`Self-test passed ${passed.length} steps, expected at least 6.`)
    if (!expectedWarning) issues.push('Expected clean-install web-search needs-configuration warning was not recorded.')
    return {
      name: 'Knowledge and memory self-test result',
      file: relative(file),
      summary: data.summaryDialog?.summary ?? 'missing summary',
      issues,
    }
  })
}

function checkSettingsBackResults() {
  const expectedCases = ['providers', 'context', 'memory', 'knowledge', 'preferences', 'skills', 'mcp']
  return resultCheck('Settings child-page Back results', 'settings-back-dynamic-results.json', (file) => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    const byCase = new Map(rows.map((row) => [row.Case, row]))
    const issues = []
    for (const name of expectedCases) {
      const row = byCase.get(name)
      if (!row) issues.push(`Missing Back result for ${name}.`)
      else if (!row.Found || !row.ChildOk || !row.BackOk) issues.push(`${name} Back result is not fully passing.`)
    }
    return {
      name: 'Settings child-page Back results',
      file: relative(file),
      summary: `${rows.length} cases checked`,
      issues,
    }
  })
}

function checkLocalModelDownloadResults() {
  return resultCheck('Local embedding model download result', 'settings-context-local-model-download-emulator-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const steps = new Set((data.observations ?? []).map((item) => item.step))
    const issues = []
    for (const step of ['confirm', 'start', 'download-progress', 'verify', 'success-dialog', 'final-row']) {
      if (!steps.has(step)) issues.push(`Missing local-model observation step ${step}.`)
    }
    const finalText = (data.observations ?? []).find((item) => item.step === 'final-row')?.visibleText ?? []
    if (!finalText.some((text) => /已启用/.test(text))) issues.push('Final local-model row does not show 已启用.')
    if (!data.startedFromFreshInstall) issues.push('Local-model download evidence did not start from a fresh install.')
    if (!data.mirror?.emulatorUrl) issues.push('Local-model mirror URL was not recorded.')
    return {
      name: 'Local embedding model download result',
      file: relative(file),
      summary: `${data.model?.id ?? 'unknown model'} via ${data.mirror?.emulatorUrl ?? 'missing mirror'}`,
      issues,
    }
  })
}

function checkMcpOfflineResults() {
  return resultCheck('MCP offline and online functional result', 'settings-mcp-offline-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const offlineChecks = data.offlineServer?.checks ?? []
    const issues = []
    if (data.builtInServer?.status !== '已连接') issues.push('Built-in MCP server is not recorded as 已连接.')
    for (const check of offlineChecks) {
      if (check.status !== 'passed') issues.push(`MCP offline check ${check.name} did not pass.`)
    }
    if (data.externalOnlineServer?.status !== 'passed') issues.push('External online MCP sync did not pass.')
    return {
      name: 'MCP offline and online functional result',
      file: relative(file),
      summary: `${offlineChecks.length} offline checks, online=${data.externalOnlineServer?.status ?? 'missing'}`,
      issues,
    }
  })
}

function checkMcpOnlineRequests() {
  return resultCheck('MCP online server request log', 'settings-mcp-online-cleartext-server-requests.jsonl', (file) => {
    const rows = readJsonl(file)
    const methods = new Set(rows.map((row) => row.payload?.method).filter(Boolean))
    const issues = []
    for (const method of ['resources/list', 'prompts/list', 'tools/list', 'initialize']) {
      if (!methods.has(method)) issues.push(`MCP request log is missing ${method}.`)
    }
    return {
      name: 'MCP online server request log',
      file: relative(file),
      summary: [...methods].join(', ') || 'no methods',
      issues,
    }
  })
}

function checkPreferencesPersistence() {
  return resultCheck('Preferences persistence result', 'settings-preferences-persistence-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (!data.changedAfterToggle) issues.push('Preference switch did not change after tap.')
    if (!data.persistedAfterRestart) issues.push('Preference switch did not persist after restart.')
    return {
      name: 'Preferences persistence result',
      file: relative(file),
      summary: `${data.label ?? 'preference'} ${data.before?.inferredState ?? '?'} -> ${data.afterRestart?.inferredState ?? '?'}`,
      issues,
    }
  })
}

function checkThemeLocaleResults() {
  const expectedSteps = ['theme-dark', 'language-en', 'language-ja', 'restore-zh', 'restore-system']
  return resultCheck('Theme and locale switch result', 'theme-locale-results.json', (file) => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    const steps = new Set(rows.map((row) => row.Step))
    const issues = expectedSteps.filter((step) => !steps.has(step)).map((step) => `Missing theme/locale step ${step}.`)
    return {
      name: 'Theme and locale switch result',
      file: relative(file),
      summary: `${rows.length} steps checked`,
      issues,
    }
  })
}

function checkFontScaleResults() {
  return resultCheck('Font scale result', 'font-scale-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (data.testFontScale !== '1.30') issues.push(`Font scale test recorded ${data.testFontScale}, expected 1.30.`)
    if (data.originalFontScale !== '1.0') issues.push(`Original font scale recorded ${data.originalFontScale}, expected 1.0.`)
    if (!data.serial) issues.push('Font scale device serial was not recorded.')
    return {
      name: 'Font scale result',
      file: relative(file),
      summary: `${data.originalFontScale ?? '?'} -> ${data.testFontScale ?? '?'}`,
      issues,
    }
  })
}

function checkMockChatRequests() {
  return resultCheck('Mock provider chat request log', 'mock-openai-compatible-requests.jsonl', (file) => {
    const rows = readJsonl(file)
    const bodies = rows.map((row) => parseRequestBody(row.body)).filter(Boolean)
    const hasModels = rows.some((row) => row.method === 'GET' && /\/v1\/models/.test(row.url ?? ''))
    const hasProviderTest = bodies.some((body) => body.model === 'islemind-mock-chat' && body.stream === false && body.max_tokens === 32)
    const hasStreaming = bodies.some((body) => body.model === 'islemind-mock-chat' && body.stream === true && (body.max_output_tokens === 4096 || body.max_tokens === 4096))
    const issues = []
    if (!hasModels) issues.push('Mock provider log does not include /v1/models discovery.')
    if (!hasProviderTest) issues.push('Mock provider log does not include non-streaming test request.')
    if (!hasStreaming) issues.push('Mock provider log does not include streaming chat request.')
    return {
      name: 'Mock provider chat request log',
      file: relative(file),
      summary: `${rows.length} requests`,
      issues,
    }
  })
}

function checkLongContentRequests() {
  return resultCheck('Long content provider request log', 'long-content-mock-openai-requests.jsonl', (file) => {
    const rows = readJsonl(file)
    const bodies = rows.map((row) => parseRequestBody(row.body)).filter(Boolean)
    const hasLongModel = bodies.some((body) => /qa-ultra-long-model-name/.test(body.model ?? ''))
    const hasStreamingLong = bodies.some((body) => /qa-ultra-long-model-name/.test(body.model ?? '') && body.stream === true)
    const hasLongMemoryExtraction = bodies.some((body) => /qa-ultra-long-model-name/.test(body.model ?? '') && body.stream === false && body.max_tokens === 512)
    const issues = []
    if (!hasLongModel) issues.push('Long-content log does not include the long model id.')
    if (!hasStreamingLong) issues.push('Long-content log does not include a streaming long-content request.')
    if (!hasLongMemoryExtraction) issues.push('Long-content log does not include the follow-up memory extraction request.')
    return {
      name: 'Long content provider request log',
      file: relative(file),
      summary: `${rows.length} requests`,
      issues,
    }
  })
}

function checkCorruptMirrorRequests() {
  return resultCheck('Local model corrupt mirror request log', 'local-model-corrupt-mirror-requests.jsonl', (file) => {
    const rows = readJsonl(file)
    const relatives = new Set(rows.map((row) => row.relative).filter(Boolean))
    const issues = []
    if (!relatives.has('config.json')) issues.push('Corrupt mirror log does not include config.json.')
    if (!relatives.has('special_tokens_map.json')) issues.push('Corrupt mirror log does not include special_tokens_map.json.')
    return {
      name: 'Local model corrupt mirror request log',
      file: relative(file),
      summary: [...relatives].join(', ') || 'no files',
      issues,
    }
  })
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function parseRequestBody(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function auditSensitiveEvidence() {
  const files = listFiles(evidenceDir)
    .filter((file) => sensitiveEvidenceExtensions.has(path.extname(file)))
    .filter((file) => relative(file) !== relative(outputPath))
  const hits = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const { label, pattern } of secretPatterns) {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern)) {
        hits.push({
          file: relative(file),
          line: lineNumber(text, match.index ?? 0),
          label,
          sample: maskSecret(match[0]),
        })
      }
    }
  }
  return { scannedFiles: files.length, hits }
}

function maskSecret(value) {
  const compact = value.replace(/\s+/g, ' ')
  if (compact.length <= 12) return '*'.repeat(compact.length)
  return `${compact.slice(0, 6)}...${compact.slice(-4)}`
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function renderReport({ generatedAt, appRoutes, routeLinks, i18n, staticControls, uiSnapshots, releaseProvenance, resultEvidence, sensitiveEvidence }) {
  const missingExpectedRoutes = expectedRoutes.filter((route) => !appRoutes.includes(route))
  const linkedRoutes = new Set(routeLinks.map((link) => link.route))
  const unlinkedExpectedRoutes = expectedRoutes.filter((route) => !linkedRoutes.has(route) && !['/', '/settings', '/conversations'].includes(route))
  const runtimeTotals = summarizeUiaSnapshots(uiSnapshots)
  const missingScreenshotPairs = uiSnapshots.filter((snapshot) => !snapshot.screenshotFile)
  const pairedUiSnapshots = uiSnapshots.filter((snapshot) => snapshot.screenshotFile)
  const evidenceCoverage = summarizeEvidenceCoverage(uiSnapshots)
  const failingResultEvidence = resultEvidence.filter((item) => !item.passed)
  const lines = []
  lines.push(`# IsleMind QA Coverage Audit`)
  lines.push(``)
  lines.push(`Generated: ${generatedAt}`)
  lines.push(``)
  lines.push(`## Summary`)
  lines.push(``)
  lines.push(`- App routes discovered: ${appRoutes.length}`)
  lines.push(`- Expected route gaps: ${missingExpectedRoutes.length}`)
  lines.push(`- Expected routes without static navigation evidence: ${unlinkedExpectedRoutes.length}`)
  lines.push(`- Static interactive controls scanned: ${staticControls.total}`)
  lines.push(`- Static controls needing label review: ${staticControls.reviewNeeded.length}`)
  lines.push(`- i18n keys checked: ${i18n.checkedKeyCount}`)
  lines.push(`- Missing i18n keys: ${i18n.missing.length}`)
  lines.push(`- Result evidence files checked: ${resultEvidence.length}`)
  lines.push(`- Result evidence failures: ${failingResultEvidence.length}`)
  lines.push(`- Sensitive evidence files scanned: ${sensitiveEvidence.scannedFiles}`)
  lines.push(`- Sensitive credential leaks found: ${sensitiveEvidence.hits.length}`)
  if (uiSnapshots.length) {
    lines.push(`- UIA snapshots: ${uiSnapshots.length}`)
    lines.push(`- Paired screenshot/UIA snapshots: ${pairedUiSnapshots.length}`)
    lines.push(`- UIA snapshots missing PNG pairs: ${missingScreenshotPairs.length}`)
    lines.push(`- Runtime clickable nodes: ${runtimeTotals.clickableCount}`)
    lines.push(`- Runtime unlabeled clickable nodes: ${runtimeTotals.unlabeledCount}`)
    lines.push(`- Runtime IsleMind-owned unlabeled clickable nodes: ${runtimeTotals.appUnlabeledCount}`)
    lines.push(`- Runtime external/system unlabeled clickable nodes: ${runtimeTotals.externalUnlabeledCount}`)
    lines.push(`- Runtime touch targets below 44dp: ${runtimeTotals.smallTargetCount}${runtimeTotals.density ? ` (density ${runtimeTotals.density})` : ' (raw px check; no density file)'}`)
    lines.push(`- Runtime clipped/offscreen clickable nodes: ${runtimeTotals.clippedTargetCount}`)
    lines.push(`- Runtime scroll-edge partial clickable nodes: ${runtimeTotals.edgePartialTargetCount}`)
  } else {
    lines.push(`- UIA snapshots: missing`)
  }
  lines.push(`- Release provenance: ${releaseProvenanceStatusLabel(releaseProvenance)}`)
  lines.push(``)
  lines.push(`## Release APK Provenance`)
  lines.push(``)
  renderReleaseProvenance(lines, releaseProvenance)
  lines.push(``)
  lines.push(`## Routes`)
  lines.push(``)
  lines.push(`| Route | Status | Static Navigation Evidence |`)
  lines.push(`| --- | --- | --- |`)
  for (const route of expectedRoutes) {
    const exists = appRoutes.includes(route)
    const links = routeLinks.find((link) => link.route === route)
    lines.push(`| \`${route}\` | ${exists ? 'present' : 'missing'} | ${links ? links.files.map((file) => `\`${file}\``).join('<br>') : 'not found'} |`)
  }
  lines.push(``)
  lines.push(`## Runtime UIA Snapshots`)
  lines.push(``)
  if (!uiSnapshots.length) {
    lines.push(`No UIA snapshot was found under \`test-evidence/qa/*.uia.xml\`.`)
  } else {
      lines.push(`| Snapshot | Screenshot | Captured | Clickable | App Unlabeled | External Unlabeled | Small Targets | Clipped | Edge Partials |`)
      lines.push(`| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`)
      for (const snapshot of uiSnapshots) {
      lines.push(`| \`${snapshot.file}\` | ${snapshot.screenshotFile ? `\`${snapshot.screenshotFile}\`` : 'missing'} | ${snapshot.capturedAt} | ${snapshot.clickableCount} | ${appUnlabeledNodes(snapshot).length} | ${externalUnlabeledNodes(snapshot).length} | ${snapshot.smallTargets.length} | ${(snapshot.clippedTargets ?? []).length} | ${(snapshot.edgePartialTargets ?? []).length} |`)
    }
    lines.push(``)
    lines.push(`### UIA Snapshots Missing PNG Pair`)
    lines.push(``)
    if (!missingScreenshotPairs.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These snapshots can still help with accessibility and layout checks, but they do not satisfy the production evidence standard until a same-name PNG is captured.`)
      lines.push(``)
      lines.push(`| Snapshot |`)
      lines.push(`| --- |`)
      for (const snapshot of missingScreenshotPairs.slice(0, 80)) lines.push(`| \`${snapshot.file}\` |`)
    }
    lines.push(``)
    lines.push(`### IsleMind-Owned Unlabeled Clickable Nodes`)
    lines.push(``)
    const appUnlabeled = uiSnapshots.flatMap((snapshot) => appUnlabeledNodes(snapshot).map((node) => ({ ...node, file: snapshot.file })))
    if (!appUnlabeled.length) {
      lines.push(`None found in captured app-owned snapshots.`)
    } else {
      lines.push(`| Snapshot | Class | Bounds |`)
      lines.push(`| --- | --- | --- |`)
      for (const node of appUnlabeled.slice(0, 80)) lines.push(`| \`${node.file}\` | ${node.class || ''} | \`${node.bounds || ''}\` |`)
    }
    lines.push(``)
    lines.push(`### External/System Unlabeled Clickable Nodes`)
    lines.push(``)
    const externalUnlabeled = uiSnapshots.flatMap((snapshot) => externalUnlabeledNodes(snapshot).map((node) => ({ ...node, file: snapshot.file })))
    if (!externalUnlabeled.length) {
      lines.push(`None found in captured external Android surfaces.`)
    } else {
      lines.push(`These nodes come from Android system surfaces such as permission dialogs, pickers, share sheets, and file browsers. They are reported for traceability, but only app-owned unlabeled nodes block this audit.`)
      lines.push(``)
      lines.push(`| Snapshot | Package | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of externalUnlabeled.slice(0, 80)) lines.push(`| \`${node.file}\` | ${node.package || ''} | ${node.class || ''} | \`${node.bounds || ''}\` |`)
    }
    lines.push(``)
    lines.push(`### Small Touch Targets`)
    lines.push(``)
    const smallTargets = uiSnapshots.flatMap((snapshot) => snapshot.smallTargets.map((node) => ({ ...node, file: snapshot.file })))
    if (!smallTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`| Snapshot | Label | Class | Size | Bounds |`)
      lines.push(`| --- | --- | --- | --- | --- |`)
      for (const node of smallTargets.slice(0, 120)) {
        const size = node.widthDp == null ? `${node.widthPx}x${node.heightPx}px` : `${node.widthDp}x${node.heightDp}dp`
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | ${size} | \`${node.bounds}\` |`)
      }
    }
    lines.push(``)
    lines.push(`### Clipped Or Offscreen Clickable Nodes`)
    lines.push(``)
    const clippedTargets = uiSnapshots.flatMap((snapshot) => (snapshot.clippedTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
    if (!clippedTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`| Snapshot | Label | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of clippedTargets.slice(0, 80)) {
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | \`${node.bounds}\` |`)
      }
    }
    lines.push(``)
    lines.push(`### Scroll Edge Partial Clickable Nodes`)
    lines.push(``)
    const edgePartialTargets = uiSnapshots.flatMap((snapshot) => (snapshot.edgePartialTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
    if (!edgePartialTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These nodes are partly visible at the top or bottom edge of a captured scroll viewport. Treat them as scroll-position evidence, not small touch-target failures, unless the matching fully-visible state is missing.`)
      lines.push(``)
      lines.push(`| Snapshot | Label | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of edgePartialTargets.slice(0, 80)) {
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | \`${node.bounds}\` |`)
      }
    }
  }
  lines.push(``)
  lines.push(`## Static Label Review`)
  lines.push(``)
  if (!staticControls.reviewNeeded.length) {
    lines.push(`No obvious unlabeled static controls found by the heuristic scanner.`)
  } else {
    lines.push(`| File | Line | Tag | Reason |`)
    lines.push(`| --- | ---: | --- | --- |`)
    for (const control of staticControls.reviewNeeded.slice(0, 80)) {
      lines.push(`| \`${control.file}\` | ${control.line} | ${control.tag} | ${control.reason} |`)
    }
  }
  lines.push(``)
  lines.push(`## i18n`)
  lines.push(``)
  if (!i18n.missing.length) {
    lines.push(`No missing static \`t('...')\` or \`st('...')\` keys were found across zh-CN/en/ja.`)
  } else {
    lines.push(`| Locale | Key |`)
    lines.push(`| --- | --- |`)
    for (const item of i18n.missing.slice(0, 80)) lines.push(`| ${item.locale} | \`${item.key}\` |`)
  }
  lines.push(``)
  lines.push(`## Result Evidence Checks`)
  lines.push(``)
  if (!resultEvidence.length) {
    lines.push(`No result evidence checks were configured.`)
  } else {
    lines.push(`| Check | Status | File | Summary | Issues |`)
    lines.push(`| --- | --- | --- | --- | --- |`)
    for (const item of resultEvidence) {
      lines.push(`| ${escapeCell(item.name)} | ${item.passed ? 'passed' : 'failed'} | \`${item.file}\` | ${escapeCell(item.summary)} | ${item.issues.length ? escapeCell(item.issues.join(' ')) : 'none'} |`)
    }
  }
  lines.push(``)
  lines.push(`## Sensitive Evidence Scan`)
  lines.push(``)
  if (!sensitiveEvidence.hits.length) {
    lines.push(`No full-length API tokens were found in text evidence under \`test-evidence/qa\`.`)
  } else {
    lines.push(`Full credentials must never be committed as QA evidence. Only masked samples are shown here.`)
    lines.push(``)
    lines.push(`| File | Line | Type | Masked sample |`)
    lines.push(`| --- | ---: | --- | --- |`)
    for (const hit of sensitiveEvidence.hits.slice(0, 80)) {
      lines.push(`| \`${hit.file}\` | ${hit.line} | ${escapeCell(hit.label)} | \`${escapeCell(hit.sample)}\` |`)
    }
  }
  lines.push(``)
  lines.push(`## Key Evidence Coverage`)
  lines.push(``)
  lines.push(`| Area | Status | Evidence | Follow-up if missing |`)
  lines.push(`| --- | --- | --- | --- |`)
  for (const item of evidenceCoverage) {
    lines.push(`| ${item.area} | ${item.covered ? 'covered' : 'missing'} | ${item.evidence} | ${item.followUp} |`)
  }
  lines.push(``)
  lines.push(`## Next Evidence Required`)
  lines.push(``)
  const missingEvidence = evidenceCoverage.filter((item) => !item.covered)
  if (!missingEvidence.length && !missingScreenshotPairs.length) {
    lines.push(`- No missing key evidence categories were detected from the current UIA snapshot names.`)
  } else {
    for (const item of missingEvidence) lines.push(`- ${item.followUp}`)
    if (missingScreenshotPairs.length) {
      lines.push(`- Capture same-name PNG screenshots for ${missingScreenshotPairs.length} UIA-only snapshot(s), or remove obsolete UIA-only evidence so the visual evidence set cannot pass without screenshots.`)
    }
  }
  lines.push(`- Pair this report with manual results from \`docs/production-qa-matrix.md\`.`)
  lines.push(``)
  return `${lines.join('\n')}\n`
}

function summarizeUiaSnapshots(snapshots) {
  return snapshots.reduce((summary, snapshot) => ({
    clickableCount: summary.clickableCount + snapshot.clickableCount,
    unlabeledCount: summary.unlabeledCount + snapshot.unlabeled.length,
    appUnlabeledCount: summary.appUnlabeledCount + appUnlabeledNodes(snapshot).length,
    externalUnlabeledCount: summary.externalUnlabeledCount + externalUnlabeledNodes(snapshot).length,
    smallTargetCount: summary.smallTargetCount + snapshot.smallTargets.length,
    clippedTargetCount: summary.clippedTargetCount + (snapshot.clippedTargets ?? []).length,
    edgePartialTargetCount: summary.edgePartialTargetCount + (snapshot.edgePartialTargets ?? []).length,
    density: summary.density ?? snapshot.density,
  }), { clickableCount: 0, unlabeledCount: 0, appUnlabeledCount: 0, externalUnlabeledCount: 0, smallTargetCount: 0, clippedTargetCount: 0, edgePartialTargetCount: 0, density: null })
}

function findBlockingIssues({ i18n, staticControls, uiSnapshots, releaseProvenance, resultEvidence, sensitiveEvidence }) {
  const missingScreenshotPairs = uiSnapshots.filter((snapshot) => !snapshot.screenshotFile)
  const missingEvidence = summarizeEvidenceCoverage(uiSnapshots).filter((item) => !item.covered)
  const failingResultEvidence = resultEvidence.filter((item) => !item.passed)
  const appUnlabeledCount = uiSnapshots.reduce((total, snapshot) => total + appUnlabeledNodes(snapshot).length, 0)
  return [
    i18n.missing.length ? `${i18n.missing.length} static i18n key(s) are missing.` : null,
    staticControls.reviewNeeded.length ? `${staticControls.reviewNeeded.length} static interactive control(s) need accessibility label review.` : null,
    appUnlabeledCount ? `${appUnlabeledCount} app-owned runtime clickable node(s) are missing text/content-desc labels.` : null,
    missingScreenshotPairs.length ? `${missingScreenshotPairs.length} UIA snapshot(s) are missing same-name PNG screenshots.` : null,
    missingEvidence.length ? `${missingEvidence.length} key evidence categor${missingEvidence.length === 1 ? 'y is' : 'ies are'} missing paired screenshot/UIA coverage.` : null,
    failingResultEvidence.length ? `${failingResultEvidence.length} result evidence check(s) failed: ${failingResultEvidence.map((item) => item.name).join(', ')}.` : null,
    sensitiveEvidence.hits.length ? `${sensitiveEvidence.hits.length} full-length credential token(s) were found in QA evidence.` : null,
    ...validateReleaseProvenance(releaseProvenance),
  ].filter(Boolean)
}

function appUnlabeledNodes(snapshot) {
  return snapshot.appUnlabeled ?? snapshot.unlabeled.filter((node) => isAppOwnedPackage(node.package))
}

function externalUnlabeledNodes(snapshot) {
  return snapshot.externalUnlabeled ?? snapshot.unlabeled.filter((node) => !isAppOwnedPackage(node.package))
}

function renderReleaseProvenance(lines, provenance) {
  const issues = validateReleaseProvenance(provenance)
  if (!provenance?.apk && !provenance?.installed) {
    lines.push(`No release APK or installed package provenance was found.`)
    return
  }
  lines.push(`| Field | Value |`)
  lines.push(`| --- | --- |`)
  lines.push(`| Source | ${escapeCell(provenance.source ?? 'missing')} |`)
  lines.push(`| APK | ${provenance.apk?.path ? `\`${provenance.apk.path}\`` : 'missing'} |`)
  lines.push(`| APK SHA256 | ${provenance.apk?.sha256 ? `\`${provenance.apk.sha256}\`` : 'missing'} |`)
  lines.push(`| APK sidecar SHA256 | ${provenance.apk?.sidecarSha256 ? `\`${provenance.apk.sidecarSha256}\`` : 'missing'} |`)
  lines.push(`| APK size | ${provenance.apk?.sizeBytes ?? 'missing'} bytes |`)
  lines.push(`| Expected package/version | ${escapeCell(`${provenance.expected?.androidPackage ?? 'missing'} / ${provenance.expected?.expoVersion ?? 'missing'} (${provenance.expected?.androidVersionCode ?? 'missing'})`)} |`)
  lines.push(`| Installed device | ${escapeCell(provenance.installed?.deviceSerial ?? 'missing')} |`)
  lines.push(`| Installed package path | ${escapeCell(provenance.installed?.packagePath ?? 'missing')} |`)
  lines.push(`| Installed version | ${escapeCell(`${provenance.installed?.versionName ?? 'missing'} (${provenance.installed?.versionCode ?? 'missing'})`)} |`)
  lines.push(`| Installed ABI | ${escapeCell(`${provenance.installed?.primaryCpuAbi ?? 'missing'} on ${provenance.installed?.deviceAbi ?? 'missing'}`)} |`)
  lines.push(`| Clean install timestamps | ${escapeCell(`${provenance.installed?.firstInstallTime ?? 'missing'} / ${provenance.installed?.lastUpdateTime ?? 'missing'}`)} |`)
  lines.push(`| Clean install proven | ${provenance.installed?.cleanInstall ? 'yes' : 'no'} |`)
  lines.push(``)
  if (!issues.length) {
    lines.push(`Release provenance checks passed for the current x86_64 no-model APK and installed package.`)
  } else {
    lines.push(`Release provenance checks failed:`)
    for (const issue of issues) lines.push(`- ${issue}`)
  }
}

function releaseProvenanceStatusLabel(provenance) {
  const issues = validateReleaseProvenance(provenance)
  if (!issues.length) return 'passed'
  return `failed (${issues.length})`
}

function validateReleaseProvenance(provenance) {
  if (!provenance) return ['Release provenance was not collected.']
  const issues = []
  const apk = provenance.apk
  const expected = provenance.expected
  const installed = provenance.installed
  if (!apk?.path) issues.push('No x86_64 no-model release APK was found in dist-apk.')
  if (!apk?.sha256) issues.push('Release APK SHA256 could not be calculated.')
  if (!apk?.sidecarSha256) issues.push('Release APK .sha256 sidecar file is missing or unreadable.')
  if (apk?.sha256 && apk?.sidecarSha256 && apk.sha256 !== apk.sidecarSha256) issues.push('Release APK SHA256 does not match its .sha256 sidecar.')
  if (!installed) issues.push('Installed package provenance was not collected from an Android device or valid cache.')
  if (provenance.source === 'stale-cache') issues.push('Cached installed-package provenance does not match the current APK SHA256.')
  if (expected?.androidPackage && expected.androidPackage !== appPackageName) issues.push(`app.json android.package is ${expected.androidPackage}, expected ${appPackageName}.`)
  if (expected?.expoVersion && expected.packageVersion && expected.expoVersion !== expected.packageVersion) issues.push('package.json version and app.json expo.version differ.')
  if (installed?.versionName && expected?.expoVersion && installed.versionName !== expected.expoVersion) issues.push(`Installed versionName ${installed.versionName} does not match app.json version ${expected.expoVersion}.`)
  if (installed?.versionCode != null && expected?.androidVersionCode != null && installed.versionCode !== expected.androidVersionCode) issues.push(`Installed versionCode ${installed.versionCode} does not match app.json android.versionCode ${expected.androidVersionCode}.`)
  if (installed?.primaryCpuAbi !== 'x86_64') issues.push(`Installed primaryCpuAbi is ${installed?.primaryCpuAbi ?? 'missing'}, expected x86_64.`)
  if (installed && !installed.cleanInstall) issues.push('Installed package does not have matching firstInstallTime and lastUpdateTime, so clean install is not proven.')
  return issues
}

function summarizeEvidenceCoverage(snapshots) {
  const files = snapshots
    .filter((snapshot) => snapshot.screenshotFile)
    .map((snapshot) => snapshot.file)
  const matchAny = (patterns) => files.filter((file) => patterns.some((pattern) => pattern.test(file)))
  const anyItem = (area, patterns, followUp) => {
    const matches = files.filter((file) => patterns.some((pattern) => pattern.test(file)))
    return {
      area,
      covered: matches.length > 0,
      evidence: matches.length ? formatEvidenceList(matches.slice(-3)) : 'missing',
      followUp,
    }
  }
  const allItem = (area, patternGroups, followUp) => {
    const matchesByGroup = patternGroups.map(matchAny)
    const matches = [...new Set(matchesByGroup.flat())]
    return {
      area,
      covered: matchesByGroup.every((group) => group.length > 0),
      evidence: matches.length ? formatEvidenceList(matches.slice(-4)) : 'missing',
      followUp,
    }
  }
  return [
    allItem('App shell error/update notice', [[/app-shell-error-boundary/], [/app-shell-update-notice/]], 'Capture forced app-shell error boundary and update-notice toast states.'),
    allItem('Current x86 clean-install baseline', [
      [/current-x86-clean-baseline-home/],
      [/current-x86-clean-baseline-settings/],
      [/current-x86-clean-baseline-conversations/],
    ], 'Capture home, settings, and conversations baselines from the currently clean-installed x86_64 release APK.'),
    allItem('Every expected route has paired screenshot/UIA evidence', [
      [/home-route\.uia\.xml$/],
      [/conversations-route\.uia\.xml$/],
      [/settings-route\.uia\.xml$/],
      [/settings-providers-route\.uia\.xml$/],
      [/settings-context-route\.uia\.xml$/],
      [/settings-knowledge-route\.uia\.xml$/],
      [/settings-memory-route\.uia\.xml$/],
      [/settings-preferences-route\.uia\.xml$/],
      [/settings-skills-route\.uia\.xml$/],
      [/settings-mcp-route\.uia\.xml$/],
      [/source-fallback-route\.uia\.xml$/],
      [/chat-invalid-route\.uia\.xml$/],
    ], 'Capture paired screenshot + UIA for any route whose route row is present but lacks runtime visual evidence.'),
    anyItem('Home keyboard avoidance', [/home-keyboard-open/, /current-live-chat-before-send/], 'Capture home composer with the Android keyboard open and the latest message visible.'),
    anyItem('Home model panel overlay', [/home-bottom-model-panel/], 'Capture the model picker overlay, including long and empty model-list states.'),
    anyItem('Composer More panel overlay', [/home-more-panel/], 'Capture the More tools panel and verify vertical gestures do not trigger page swipes.'),
    anyItem('Top session options overlay', [/home-session-options-panel/], 'Capture the top provider/model/settings overlay and Android Back close behavior.'),
    anyItem('Provider batch import keyboard', [/settings-providers-batch-keyboard-open/, /current-.*provider-import-filled/], 'Capture provider batch import while the keyboard is open and actions remain visible.'),
    allItem('Provider activation progress/result', [[/provider-activation-progress/], [/provider-activation-result/]], 'Capture provider activation start/progress/result to prove immediate feedback and final readiness.'),
    allItem('Chat streaming in-flight and complete', [[/chat.*inflight/, /chat-responses-json-inflight/], [/chat.*complete/, /chat-responses-json-complete/]], 'Capture a configured provider chat while streaming and after completion.'),
    allItem('Chat message actions and delete confirmation', [[/chat-message-actions-menu/], [/message-delete-confirm/, /longpress-delete-confirm/, /delete-confirm.*message/]], 'Capture copy/retry/regenerate/speak and long-press delete confirmation for a real message.'),
    allItem('Valid chat/source navigation stack', [[/chat.*complete/, /chat-responses-json-complete/], [/source-detail/, /source-from-chat/, /tap-source/], [/chat-valid-back/, /source-from-chat-back/, /valid-source-back/]], 'Capture a valid chat detail and source detail stack, including a single Android Back return.'),
    allItem('Settings subpage Android Back', [
      [/settings-back-dynamic-providers-child/],
      [/settings-back-dynamic-context-child/],
      [/settings-back-dynamic-memory-child/],
      [/settings-back-dynamic-knowledge-child/],
      [/settings-back-dynamic-preferences-child/],
      [/settings-back-dynamic-skills-child/],
      [/settings-back-dynamic-mcp-child/],
      [/settings-back-dynamic-.*after/],
    ], 'Capture all Settings child pages and prove one Android Back returns to Settings.'),
    anyItem('Settings destructive dialogs', [/settings-.*confirm/, /delete-confirm/, /clear-confirm/], 'Capture destructive dialogs and Android Back cancellation.'),
    anyItem('Knowledge keyboard/import', [/settings-knowledge.*keyboard-open/, /settings-knowledge-body-keyboard-open/], 'Capture knowledge paste import with keyboard open and import action visible.'),
    allItem('Knowledge and memory data flows', [[/knowledge-selftest/, /context-selftest/], [/knowledge-delete/], [/memory-delete/], [/knowledge-clear/], [/memory-clear/]], 'Capture context self-test plus knowledge/memory delete and clear confirmations.'),
    allItem('Context local model download progress', [[/local-model-download-after/], [/local-model-downloaded-row/]], 'Capture local model download progress, verify stage, and final enabled state.'),
    allItem('Context local model corrupt-source failure', [[/local-model-corrupt-download-after/], [/local-model-corrupt-row-after-dismiss/]], 'Capture corrupt-source download failure with readable checksum/size detail and recoverable retry row.'),
    anyItem('Context search API keyboard', [/settings-context-search-key-keyboard-open/], 'Capture search API-key field with keyboard open and save action visible.'),
    anyItem('Preferences persistence', [/preferences-persistence/], 'Capture setting persistence after force-stop and relaunch.'),
    anyItem('Skills keyboard/form', [/settings-skills.*keyboard-open/], 'Capture Skills form with keyboard open and save action visible.'),
    allItem('MCP keyboard/offline/online', [[/settings-mcp.*keyboard-open/], [/settings-mcp-offline/], [/settings-mcp-online/]], 'Capture MCP server input, offline error, sync success, toggle, and delete states.'),
    allItem('Theme and locale', [[/settings-dark/, /home-dark/], [/settings-en/, /home-en/], [/settings-ja/, /home-ja/]], 'Capture Simplified Chinese, English, Japanese, and dark-mode surfaces.'),
    anyItem('130 percent text scale', [/fontscale-130/], 'Capture key routes and overlays at 130 percent Android font scale.'),
    allItem('Long content stress states', [[/long-provider/, /long-model/], [/long-trace/], [/long-citation/], [/long-knowledge/]], 'Seed long provider/model names, long tool traces, long citations, and long knowledge documents.'),
  ]
}

function formatEvidenceList(files) {
  return files.map((file) => `\`${file}\``).join('<br>')
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|')
}
