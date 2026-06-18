#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

const requiredThemeScripts = {
  'test:theme-system:source': 'node scripts/verify-theme-web-render.js --source-only',
  'test:theme-system:audit': 'node scripts/theme-system-audit.js',
  'test:theme-system:qa': 'node scripts/qa-coverage-audit.js --self-test=theme-system',
  'theme:release-gate-status': 'node scripts/theme-release-gate-specs.js --status',
  'test:theme-system': 'bun run test:theme-system:source && bun run test:theme-system:audit && bun run test:theme-system:qa',
}

const requiredThemeFiles = [
  'src/theme/colors.ts',
  'src/hooks/useAppTheme.ts',
  'src/store/settingsStore.ts',
  'src/types/index.ts',
  'app/_layout.tsx',
  'app/settings/preferences.tsx',
  'docs/architecture/theme-system-liquid-glass-audit.md',
  'src/global.css',
  'src/components/main/SettingsScreenContent.tsx',
  'src/services/appActionPolicy.ts',
  'src/services/appCommandRouter.ts',
  'src/services/builtinToolRegistry.ts',
  'src/services/agent/agentToolRegistry.ts',
  'src/i18n/resources/en.json',
  'src/i18n/resources/zh-CN.json',
  'src/i18n/resources/ja.json',
  'src/components/chat/ChatWorkspace.tsx',
  'src/components/chat/ChatOptionsPanel.tsx',
  'src/components/main/ConversationsScreenContent.tsx',
  'src/components/conversations/ConversationRow.tsx',
  'src/components/ui/isle/Chip.tsx',
  'src/components/ui/isle/Controls.tsx',
  'src/components/ui/isle/Primitives.tsx',
  'src/components/ui/isle/Dialog.tsx',
  'scripts/verify-theme-web-render.js',
  'scripts/theme-system-audit.js',
  'scripts/qa-coverage-audit.js',
  'scripts/theme-qa-selftest.js',
]

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function collectThemePackageScriptReport({ repoRoot = root } = {}) {
  const packageJson = readJsonFile(path.join(repoRoot, 'package.json')) ?? {}
  const scripts = packageJson.scripts ?? {}
  const missingScripts = []
  const mismatchedScripts = []

  for (const [name, expected] of Object.entries(requiredThemeScripts)) {
    if (!(name in scripts)) {
      missingScripts.push(name)
      continue
    }
    if (scripts[name] !== expected) {
      mismatchedScripts.push({
        name,
        expected,
        actual: scripts[name],
      })
    }
  }

  const issues = [
    ...missingScripts.map((name) => `Missing package.json theme script: ${name}`),
    ...mismatchedScripts.map((entry) => `Theme script ${entry.name} must be "${entry.expected}" (got "${entry.actual}")`),
  ]

  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    requiredScripts: requiredThemeScripts,
    actualScripts: scripts,
    missingScripts,
    mismatchedScripts,
  }
}

function collectThemeFileReport({ repoRoot = root } = {}) {
  const missingFiles = requiredThemeFiles.filter((relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)))
  const issues = missingFiles.map((relativePath) => `Missing theme release-gate file: ${relativePath}`)
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    requiredFiles: requiredThemeFiles,
    missingFiles,
  }
}

function walkRepoFiles(startDir, collector) {
  if (!fs.existsSync(startDir)) return
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const fullPath = path.join(startDir, entry.name)
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.expo' || entry.name === 'dist' || entry.name === 'build') continue
      walkRepoFiles(fullPath, collector)
      continue
    }
    collector(fullPath, relativePath)
  }
}

function collectNativeIosBoundary({ repoRoot = root } = {}) {
  const projectFiles = []
  const workspaceFiles = []
  const pbxprojFiles = []
  const packageSwiftFiles = []

  walkRepoFiles(repoRoot, (_fullPath, relativePath) => {
    if (relativePath.endsWith('.xcodeproj')) projectFiles.push(relativePath)
    else if (relativePath.endsWith('.xcworkspace')) workspaceFiles.push(relativePath)
    else if (relativePath.endsWith('project.pbxproj')) pbxprojFiles.push(relativePath)
    else if (relativePath.endsWith('Package.swift')) packageSwiftFiles.push(relativePath)
  })

  const repoOwnedNativeFiles = [
    ...projectFiles,
    ...workspaceFiles,
    ...pbxprojFiles,
    ...packageSwiftFiles,
  ]

  return {
    mode: repoOwnedNativeFiles.length ? 'native-eligible' : 'rn-fallback',
    repoOwnedProjectFiles: projectFiles,
    repoOwnedWorkspaceFiles: workspaceFiles,
    repoOwnedPbxprojFiles: pbxprojFiles,
    repoOwnedPackageSwiftFiles: packageSwiftFiles,
    nativeTargetAvailable: repoOwnedNativeFiles.length > 0,
  }
}

function collectThemeSystemReleaseGateReport({ repoRoot = root } = {}) {
  const packageScripts = collectThemePackageScriptReport({ repoRoot })
  const releaseGateFiles = collectThemeFileReport({ repoRoot })
  const nativeIosBoundary = collectNativeIosBoundary({ repoRoot })
  const issues = [
    ...packageScripts.issues,
    ...releaseGateFiles.issues,
  ]

  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    packageScripts,
    releaseGateFiles,
    nativeIosBoundary,
  }
}

function compactThemeSystemReleaseGateReport(report) {
  return {
    status: report.ok ? 'passed' : 'failed',
    issueCount: report.issueCount,
    fallbackMode: report.nativeIosBoundary.mode,
    missingFiles: report.releaseGateFiles.missingFiles,
    missingScripts: report.packageScripts.missingScripts,
    mismatchedScripts: report.packageScripts.mismatchedScripts.map((entry) => entry.name),
  }
}

function printStatus(report) {
  const compact = compactThemeSystemReleaseGateReport(report)
  console.log(`Theme release gate: ${compact.status}`)
  console.log(`Fallback mode: ${compact.fallbackMode}`)
  console.log(`Issues: ${compact.issueCount}`)
  if (report.nativeIosBoundary.nativeTargetAvailable) {
    console.log(`Repo-owned iOS targets: ${[
      ...report.nativeIosBoundary.repoOwnedProjectFiles,
      ...report.nativeIosBoundary.repoOwnedWorkspaceFiles,
      ...report.nativeIosBoundary.repoOwnedPbxprojFiles,
      ...report.nativeIosBoundary.repoOwnedPackageSwiftFiles,
    ].join(', ')}`)
  } else {
    console.log('Repo-owned iOS targets: none')
  }
  if (report.issues.length) {
    for (const issue of report.issues) {
      console.log(`- ${issue}`)
    }
  }
}

if (require.main === module) {
  const report = collectThemeSystemReleaseGateReport()
  if (process.argv.includes('--status')) {
    printStatus(report)
  } else {
    console.log(JSON.stringify(compactThemeSystemReleaseGateReport(report), null, 2))
  }
  if (!report.ok) process.exitCode = 1
}

module.exports = {
  collectThemeFileReport,
  collectThemePackageScriptReport,
  collectThemeSystemReleaseGateReport,
  compactThemeSystemReleaseGateReport,
  requiredThemeFiles,
  requiredThemeScripts,
}
