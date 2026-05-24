const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const scanRoots = ['app', 'src/components']
const allowedLowLevel = new Set([
  path.join('src', 'components', 'ui', 'PressableScale.tsx'),
  path.join('src', 'components', 'ui', 'isle', 'IsleKit.tsx'),
  path.join('src', 'components', 'ui', 'isle', 'Primitives.tsx'),
  path.join('src', 'components', 'ui', 'isle', 'Pressable.tsx'),
  path.join('src', 'components', 'ui', 'isle', 'Dialog.tsx'),
])
const allowedDocs = new Set([
  path.join('src', 'components', 'ui', 'isle', 'README.md'),
])

const legacyPatterns = [
  /@\/components\/ui\/(AnimalIslandKit|IslandButton|IslandPanel|IslandDialog|IslandPrimitives|IslandChip|Pill|MiniStat)/,
  /from ['"].*\/components\/ui\/(AnimalIslandKit|IslandButton|IslandPanel|IslandDialog|IslandPrimitives|IslandChip|Pill|MiniStat)['"]/,
  /\b(Animal[A-Z]\w*|Island[A-Z]\w*|Pill|MiniStat|useIslandDialog|IslandDialogProvider)\b/,
]
const nakedPressablePatterns = [
  /@\/components\/ui\/PressableScale/,
  /<PressableScale\b/,
]
const nakedNativePressablePatterns = [
  /<Pressable\b/,
]

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.(tsx?|md)$/.test(entry.name)) files.push(full)
  }
  return files
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join(path.sep)
}

const problems = []
for (const rootName of scanRoots) {
  for (const file of walk(path.join(root, rootName))) {
    const relative = rel(file)
    const normalized = relative.split(path.sep).join('/')
    const text = fs.readFileSync(file, 'utf8')
    const isIsleImpl = normalized.startsWith('src/components/ui/isle/')
    const isUiCompat = normalized.startsWith('src/components/ui/') && !isIsleImpl
    const lowLevelAllowed = allowedLowLevel.has(relative)
    const docsAllowed = allowedDocs.has(relative)

    if (!docsAllowed && !isIsleImpl && !isUiCompat) {
      for (const pattern of legacyPatterns) {
        if (pattern.test(text)) problems.push(`${normalized}: legacy Animal/Island UI naming is not allowed`)
      }
    }
    if (!lowLevelAllowed && !isUiCompat) {
      for (const pattern of nakedPressablePatterns) {
        if (pattern.test(text)) problems.push(`${normalized}: use IslePressable or a semantic Isle* component instead of PressableScale`)
      }
    }
    if (!lowLevelAllowed && !isUiCompat && !/Modal|overlay|scrim|stopPropagation|closeLayer/i.test(text)) {
      for (const pattern of nakedNativePressablePatterns) {
        if (pattern.test(text)) problems.push(`${normalized}: use IslePressable or IsleOverlayPressable instead of raw Pressable`)
      }
    }
  }
}

const requiredExports = [
  'IsleButton',
  'IsleIconButton',
  'IsleCard',
  'IslePanel',
  'IsleDialogProvider',
  'useIsleDialog',
  'IsleInput',
  'IsleSwitch',
  'IsleCheckbox',
  'IsleTabs',
  'IsleChip',
  'IsleListItem',
  'IsleSheet',
  'IsleMetric',
  'IslePressable',
]
const exportSources = [
  'src/components/ui/isle/index.ts',
  'src/components/ui/isle/IsleKit.tsx',
  'src/components/ui/isle/Controls.tsx',
  'src/components/ui/isle/Panel.tsx',
  'src/components/ui/isle/Primitives.tsx',
  'src/components/ui/isle/Dialog.tsx',
  'src/components/ui/isle/Pressable.tsx',
]
const exportText = exportSources.map((source) => fs.readFileSync(path.join(root, source), 'utf8')).join('\n')
for (const name of requiredExports) {
  const exportPattern = new RegExp(`export\\s+(?:function|const|class|interface|type)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`, 'm')
  if (!exportPattern.test(exportText)) {
    problems.push(`src/components/ui/isle/index.ts: missing ${name} export`)
  }
}

if (problems.length) {
  console.error('UI naming audit failed:')
  for (const item of [...new Set(problems)]) console.error(`- ${item}`)
  process.exit(1)
}
console.log('UI naming audit passed')
