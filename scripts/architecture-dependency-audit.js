const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const SCHEMA = 'islemind.architecture-dependency-audit.v1'
const args = new Set(process.argv.slice(2))
const rootArgIndex = process.argv.indexOf('--root')
const root = path.resolve(rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : path.resolve(__dirname, '..'))
const includeTypeOnly = args.has('--include-type')
const jsonOutput = args.has('--json')
const gate = args.has('--gate')
const sourceRoots = ['app', 'src']
const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx'])
const ignoreDirs = new Set(['node_modules', '.git', '.expo', 'dist', 'dist-apk', 'coverage', 'android', 'ios'])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (sourceExts.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function lineCount(text) {
  return text ? text.split(/\r?\n/).length : 0
}

function groupOf(relative) {
  const parts = relative.split('/')
  if (parts[0] === 'app') return 'app/routes'
  if (parts[0] !== 'src') return 'other'
  if (parts[1] === 'components') {
    const area = parts[2] || 'other'
    if (['chat', 'main', 'settings', 'providers', 'ui', 'navigation', 'conversations'].includes(area)) return `components/${area}`
    return 'components/other'
  }
  if (parts[1] === 'store') return 'stores'
  if (parts[1] === 'product') return 'product'
  if (parts[1] === 'hooks') return 'hooks'
  if (parts[1] === 'i18n') return 'i18n'
  if (parts[1] === 'theme') return 'theme'
  if (parts[1] === 'types') return 'types'
  if (parts[1] === 'utils') return 'utils'
  if (parts[1] === 'generated') return 'generated'
  if (parts[1] !== 'services') return `src/${parts[1] || 'other'}`

  const file = parts.slice(2).join('/')
  if (file.startsWith('ai/')) return 'services/ai-provider'
  if (file.startsWith('agent/')) return 'services/agent-workflow'
  if (/^(context|contextStore|contextPlanner|contextPacker|contextRuntime|contextSelfTest|contextAsset|contextLocalModelRules|knowledge|localDataStore|rag|ragEvaluation|searchPolicy)/.test(file)) return 'services/context-rag'
  // Toolchain adapters and runtime-observability services share one
  // architectural boundary so their internal policy imports are not reported
  // as misleading cross-boundary dependencies.
  if (/^(runtime|observability|toolchain\/)/.test(file)) return 'services/runtime-observability'
  if (/^(storage|secureStorage|portableData|fileImport|apkInstallCache|appUpdates)/.test(file)) return 'services/storage-portable'
  if (/^(mcp|toolCalling|builtinTool|appAction|appCommand|android|attachment|speech|mediaGeneration)/.test(file)) return 'services/tools-device-media'
  if (/^tavern/.test(file)) return 'services/tavern-companion'
  if (/^provider/.test(file)) return 'services/provider-settings'
  if (/CompatibilityEvaluation|compatibility/i.test(file)) return 'services/compatibility-evals'
  return 'services/other'
}

const files = sourceRoots.flatMap((dir) => walk(path.join(root, dir)))
const fileSet = new Set(files.map(rel))

function resolveImport(fromRel, spec) {
  if (!spec || spec.startsWith('node:')) return null
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null
  const fromDir = path.dirname(path.join(root, fromRel))
  const base = spec.startsWith('@/') ? path.join(root, 'src', spec.slice(2)) : path.resolve(fromDir, spec)
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx'].map((ext) => base + ext),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((idx) => path.join(base, idx)),
  ]
  for (const candidate of candidates) {
    const relative = rel(candidate)
    if (fileSet.has(relative)) return relative
  }
  return null
}

const importDeclRegex = /\b(?:import|export)\s+[\s\S]*?\s+from\s+['"][^'"]+['"]/g
const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const graph = new Map()
const metadata = new Map()

function isTypeOnlyImportDeclaration(statement) {
  const trimmed = statement.trim()
  if (/^(?:import|export)\s+type\b/.test(trimmed)) return true
  const match = trimmed.match(/^(?:import|export)\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]$/)
  const clause = match?.[1]?.trim()
  if (!clause?.startsWith('{') || !clause.endsWith('}')) return false
  const specifiers = clause.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
  return specifiers.length > 0 && specifiers.every((item) => item.startsWith('type '))
}

for (const file of files) {
  const relative = rel(file)
  const text = fs.readFileSync(file, 'utf8')
  const deps = new Set()

  importDeclRegex.lastIndex = 0
  let decl
  while ((decl = importDeclRegex.exec(text))) {
    const statement = decl[0]
    if (!includeTypeOnly && isTypeOnlyImportDeclaration(statement)) continue
    const match = statement.match(/['"]([^'"]+)['"]\s*$/)
    const target = match ? resolveImport(relative, match[1]) : null
    if (target) deps.add(target)
  }

  dynamicImportRegex.lastIndex = 0
  let dynamicMatch
  while ((dynamicMatch = dynamicImportRegex.exec(text))) {
    const target = resolveImport(relative, dynamicMatch[1])
    if (target) deps.add(target)
  }

  graph.set(relative, [...deps])
  metadata.set(relative, {
    file: relative,
    group: groupOf(relative),
    lines: lineCount(text),
    exports: (text.match(/^\s*export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+/gm) || []).length,
    imports: deps.size,
  })
}

const fanIn = new Map([...graph.keys()].map((file) => [file, 0]))
for (const deps of graph.values()) {
  for (const dep of deps) fanIn.set(dep, (fanIn.get(dep) || 0) + 1)
}

const groupStats = new Map()
for (const meta of metadata.values()) {
  const stat = groupStats.get(meta.group) || { group: meta.group, files: 0, lines: 0, imports: 0, exports: 0 }
  stat.files += 1
  stat.lines += meta.lines
  stat.imports += meta.imports
  stat.exports += meta.exports
  groupStats.set(meta.group, stat)
}

const groupEdges = new Map()
for (const [file, deps] of graph.entries()) {
  const from = metadata.get(file).group
  for (const dep of deps) {
    const to = metadata.get(dep).group
    if (from === to) continue
    const key = `${from} -> ${to}`
    groupEdges.set(key, (groupEdges.get(key) || 0) + 1)
  }
}

function tarjan(g) {
  let index = 0
  const stack = []
  const state = new Map()
  const result = []

  function strongconnect(v) {
    const item = { index, lowlink: index, onStack: true }
    index += 1
    state.set(v, item)
    stack.push(v)

    for (const w of g.get(v) || []) {
      if (!state.has(w)) {
        strongconnect(w)
        item.lowlink = Math.min(item.lowlink, state.get(w).lowlink)
      } else if (state.get(w).onStack) {
        item.lowlink = Math.min(item.lowlink, state.get(w).index)
      }
    }

    if (item.lowlink === item.index) {
      const component = []
      let w
      do {
        w = stack.pop()
        state.get(w).onStack = false
        component.push(w)
      } while (w !== v)
      if (component.length > 1) result.push(component)
    }
  }

  for (const v of g.keys()) {
    if (!state.has(v)) strongconnect(v)
  }
  return result
}

const hotspots = [...metadata.values()]
  .map((meta) => ({
    ...meta,
    fanIn: fanIn.get(meta.file) || 0,
    fanOut: graph.get(meta.file).length,
    score: meta.lines + (fanIn.get(meta.file) || 0) * 80 + graph.get(meta.file).length * 30,
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 30)

const cycles = tarjan(graph)
  .map((component) => ({
    size: component.length,
    groups: [...new Set(component.map((file) => metadata.get(file).group))].sort(),
    files: component.sort(),
  }))
  .sort((a, b) => b.size - a.size)

const result = {
  schema: SCHEMA,
  generatedAt: new Date().toISOString(),
  mode: includeTypeOnly ? 'include-type-only' : 'value-only',
  summary: {
    files: files.length,
    groups: groupStats.size,
    edges: [...graph.values()].reduce((sum, deps) => sum + deps.length, 0),
    cycles: cycles.length,
  },
  groups: [...groupStats.values()].sort((a, b) => b.lines - a.lines),
  groupEdges: [...groupEdges.entries()]
    .map(([edge, count]) => ({ edge, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 60),
  hotspots,
  cycles: cycles.slice(0, 20),
}

if (args.has('--self-test')) {
  runArchitectureDependencyAuditSelfTest()
} else if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`${SCHEMA} ${result.mode}`)
  console.log(`files=${result.summary.files} groups=${result.summary.groups} edges=${result.summary.edges} cycles=${result.summary.cycles}`)
  console.log('\nTop hotspots:')
  for (const item of result.hotspots.slice(0, 15)) {
    console.log(`${String(item.score).padStart(6)} score | ${String(item.lines).padStart(5)} loc | in ${String(item.fanIn).padStart(2)} out ${String(item.fanOut).padStart(2)} | ${item.file}`)
  }
  console.log('\nTop cross-group edges:')
  for (const edge of result.groupEdges.slice(0, 20)) {
    console.log(`${String(edge.count).padStart(4)} ${edge.edge}`)
  }
  console.log('\nCycles:')
  if (!result.cycles.length) console.log('none')
  for (const cycle of result.cycles.slice(0, 5)) {
    console.log(`size=${cycle.size} groups=${cycle.groups.join(',')}`)
    for (const file of cycle.files.slice(0, 12)) console.log(`  - ${file}`)
    if (cycle.files.length > 12) console.log('  ...')
  }
}

if (gate && result.summary.cycles > 0) {
  process.exitCode = 1
}

function runArchitectureDependencyAuditSelfTest() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-architecture-dependency-audit-'))
  try {
    const typeOnlyRoot = path.join(tempRoot, 'type-only')
    writeFixture(typeOnlyRoot, [
      ['app/index.tsx', 'export default function Index() { return null }'],
      ['src/a.ts', "import type { B } from './b'\nexport interface A { b?: B }\n"],
      ['src/b.ts', "import { type A } from './a'\nexport interface B { a?: A }\n"],
    ])

    const valueRoot = path.join(tempRoot, 'value')
    writeFixture(valueRoot, [
      ['app/index.tsx', 'export default function Index() { return null }'],
      ['src/a.ts', "import { b } from './b'\nexport const a = b\n"],
      ['src/b.ts', "import { a } from './a'\nexport const b = a\n"],
    ])

    const valueMode = runAuditFixture(typeOnlyRoot)
    assert.equal(valueMode.status, 0, 'value-only audit exits cleanly for a type-only cycle fixture')
    assert.equal(valueMode.result.summary.cycles, 0, 'value-only audit ignores pure type-only cycles')

    const typeMode = runAuditFixture(typeOnlyRoot, ['--include-type'])
    assert.equal(typeMode.status, 0, 'include-type audit reports type cycles without gate failure')
    assert.equal(typeMode.result.summary.cycles, 1, 'include-type audit detects pure type-only cycles')

    const typeGate = runAuditFixture(typeOnlyRoot, ['--include-type', '--gate'])
    assert.equal(typeGate.status, 1, 'include-type gate fails when type cycles exist')
    assert.equal(typeGate.result.summary.cycles, 1, 'include-type gate still emits cycle evidence')

    const valueGate = runAuditFixture(valueRoot, ['--gate'])
    assert.equal(valueGate.status, 1, 'value gate fails when value cycles exist')
    assert.equal(valueGate.result.summary.cycles, 1, 'value gate emits cycle evidence')

    const toolchainGroupingRoot = path.join(tempRoot, 'toolchain-grouping')
    writeFixture(toolchainGroupingRoot, [
      ['app/index.tsx', 'export default function Index() { return null }'],
      ['src/services/toolchain/adapter.ts', "import { helper } from './helper'\nexport const adapter = helper\n"],
      ['src/services/toolchain/helper.ts', 'export const helper = true\n'],
    ])

    const toolchainGrouping = runAuditFixture(toolchainGroupingRoot)
    const runtimeBoundary = toolchainGrouping.result.groups.find((item) => item.group === 'services/runtime-observability')
    assert.equal(runtimeBoundary?.files, 2, 'toolchain adapter and helper modules share the runtime-observability boundary')
    assert.equal(
      toolchainGrouping.result.groupEdges.some((item) => item.edge.includes('services/runtime-observability')),
      false,
      'toolchain adapter-to-helper imports are not reported as cross-boundary edges',
    )

    console.log('Architecture dependency self-test passed (value cycles and type-only cycles are gated separately).')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function writeFixture(projectRoot, entries) {
  for (const [relativeFile, content] of entries) {
    const full = path.join(projectRoot, relativeFile)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

function runAuditFixture(projectRoot, extraArgs = []) {
  const child = spawnSync(process.execPath, [__filename, '--root', projectRoot, '--json', ...extraArgs], {
    encoding: 'utf8',
  })
  if (child.error) throw child.error
  assert.ok(child.stdout.trim(), `audit fixture emitted JSON for ${extraArgs.join(' ') || 'value-only'}`)
  return {
    status: child.status,
    result: JSON.parse(child.stdout),
    stderr: child.stderr,
  }
}
