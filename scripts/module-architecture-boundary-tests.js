const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SCHEMA = 'islemind.module-architecture-boundary.v1'
const root = path.resolve(__dirname, '..')
const sourceExtensions = new Set(['.ts', '.tsx'])
const targetRoots = ['src/core', 'src/bootstrap', 'src/modules', 'src/platform', 'src/presentation']
const canonicalArchitectureDocuments = new Set([
  'docs/architecture/architecture.md',
  'docs/architecture/module-public-api.md',
])
const durableWorkspaceEvidenceContractPhrases = [
  '`AssistantRun` schema v4 persists the exact captured handoff atomically with `run.created` as strictly validated durable evidence only; it does not grant recovery authority.',
  'terminal decode-only no-replay inputs',
  'awaited durable final-output/success barrier exists',
]
const retiredProviderIdentitySegments = [
  ['custom', 'openai', 'compatible'],
  ['custom', 'anthropic', 'compatible'],
]
const retiredProviderIdentityScanExtensions = new Set(['.ts', '.tsx', '.js', '.json', '.md', '.yml', '.yaml'])
const legacyAliases = [
  '@/services',
  '@/store',
  '@/components',
  '@/product',
  '@/hooks',
  '@/i18n',
  '@/theme',
]
const coreForbiddenAliases = [...legacyAliases, '@/modules', '@/platform', '@/presentation', '@/bootstrap']

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function walkAllFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkAllFiles(fullPath, files)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

function collectArchitectureDocumentSetIssues(documents) {
  const issues = []
  const documentSet = new Set(documents)
  for (const requiredDocument of canonicalArchitectureDocuments) {
    if (!documentSet.has(requiredDocument)) {
      issues.push({ file: requiredDocument, specifier: '', rule: 'architecture-document-set' })
    }
  }
  for (const document of documentSet) {
    if (!canonicalArchitectureDocuments.has(document)) {
      issues.push({ file: document, specifier: '', rule: 'architecture-document-set' })
    }
  }
  return issues
}

function collectDurableWorkspaceEvidenceContractIssues(documentSources) {
  const issues = []
  for (const document of canonicalArchitectureDocuments) {
    const source = documentSources.get(document)
    if (source === undefined) continue
    for (const phrase of durableWorkspaceEvidenceContractPhrases) {
      if (!source.includes(phrase)) {
        issues.push({
          file: document,
          specifier: phrase,
          rule: 'durable-workspace-evidence-contract',
        })
      }
    }
  }
  return issues
}

function collectRetiredProviderIdentityIssues(fileSources) {
  const issues = []
  const retiredIds = retiredProviderIdentitySegments.map((segments) => segments.join('-'))
  for (const [file, source] of fileSources) {
    for (const retiredId of retiredIds) {
      if (source.includes(retiredId)) {
        issues.push({ file, specifier: retiredId, rule: 'retired-provider-identity-restoration' })
      }
    }
  }
  return issues
}

function importsFrom(source) {
  const matches = []
  const matcher = /\bfrom\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(matcher)) {
    matches.push(match[1] || match[2])
  }
  return matches
}

function moduleNameFor(file) {
  const parts = relative(file).split('/')
  return parts[0] === 'src' && parts[1] === 'modules' ? parts[2] : undefined
}

function targetModuleFromSpecifier(specifier) {
  if (!specifier.startsWith('@/modules/')) return undefined
  return specifier.slice('@/modules/'.length).split('/')[0]
}

function isDeepModuleSpecifier(specifier) {
  return specifier.startsWith('@/modules/') && specifier.slice('@/modules/'.length).split('/').length > 1
}

function resolvesToAnotherModule(file, specifier, owner) {
  if (!specifier.startsWith('.')) return false
  const target = path.resolve(path.dirname(file), specifier)
  const targetRelative = relative(target)
  const parts = targetRelative.split('/')
  return parts[0] === 'src' && parts[1] === 'modules' && parts[2] !== owner
}

function resolvesToModuleLayer(file, specifier, owner, layer) {
  if (specifier.startsWith(`@/modules/${owner}/${layer}`)) return true
  if (!specifier.startsWith('.')) return false
  const targetRelative = relative(path.resolve(path.dirname(file), specifier))
  return targetRelative === `src/modules/${owner}/${layer}` || targetRelative.startsWith(`src/modules/${owner}/${layer}/`)
}

function hasPrefix(specifier, prefixes) {
  return prefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))
}

function isCoreRuntimePackage(specifier) {
  return specifier === 'react' ||
    specifier.startsWith('react/') ||
    specifier === 'react-native' ||
    specifier.startsWith('react-native/') ||
    specifier === 'expo' ||
    specifier.startsWith('expo-') ||
    specifier.startsWith('expo/') ||
    specifier === 'zustand' ||
    specifier.startsWith('zustand/')
}

function collectIssues(files) {
  const issues = []
  for (const file of files) {
    const fileRelative = relative(file)
    const source = fs.readFileSync(file, 'utf8')
    const specifiers = importsFrom(source)
    const owner = moduleNameFor(file)

    for (const specifier of specifiers) {
      if (fileRelative.startsWith('src/core/')) {
        if (hasPrefix(specifier, coreForbiddenAliases) || isCoreRuntimePackage(specifier)) {
          issues.push({ file: fileRelative, specifier, rule: 'core-purity' })
        }
        continue
      }

      if (owner) {
        if (hasPrefix(specifier, legacyAliases)) {
          issues.push({ file: fileRelative, specifier, rule: 'module-legacy-import' })
        }
        const targetModule = targetModuleFromSpecifier(specifier)
        if (targetModule && targetModule !== owner && isDeepModuleSpecifier(specifier)) {
          issues.push({ file: fileRelative, specifier, rule: 'cross-module-deep-import' })
        }
        if (resolvesToAnotherModule(file, specifier, owner)) {
          issues.push({ file: fileRelative, specifier, rule: 'cross-module-relative-import' })
        }
        if (fileRelative.includes('/domain/')) {
          const allowedDomainDependency = specifier.startsWith('.') ||
            specifier === '@/core' ||
            specifier.startsWith('@/core/') ||
            specifier === 'valibot'
          if (!allowedDomainDependency || targetModule && targetModule !== owner) {
            issues.push({ file: fileRelative, specifier, rule: 'domain-dependency-direction' })
          }
        }
        if (fileRelative.includes('/application/') && resolvesToModuleLayer(file, specifier, owner, 'adapters')) {
          issues.push({ file: fileRelative, specifier, rule: 'application-concrete-adapter-import' })
        }
        continue
      }

      if (fileRelative.startsWith('src/platform/')) {
        if (hasPrefix(specifier, ['@/modules', '@/presentation', '@/bootstrap'])) {
          issues.push({ file: fileRelative, specifier, rule: 'platform-dependency-direction' })
        }
        continue
      }

      if (fileRelative.startsWith('src/presentation/')) {
        if (hasPrefix(specifier, ['@/platform', '@/bootstrap']) || isDeepModuleSpecifier(specifier)) {
          issues.push({ file: fileRelative, specifier, rule: 'presentation-public-api-only' })
        }
        continue
      }

      if (fileRelative.startsWith('src/bootstrap/') && isDeepModuleSpecifier(specifier)) {
        issues.push({ file: fileRelative, specifier, rule: 'bootstrap-public-module-api-only' })
      }
    }
  }

  const modulesRoot = path.join(root, 'src', 'modules')
  if (fs.existsSync(modulesRoot)) {
    const moduleEntries = fs.readdirSync(modulesRoot, { withFileTypes: true })
    const manifestPath = path.join(root, 'docs', 'architecture', 'module-public-api.md')
    const manifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : undefined
    if (!manifest) {
      issues.push({ file: 'docs/architecture/module-public-api.md', specifier: '', rule: 'module-public-api-manifest' })
    }
    for (const entry of moduleEntries) {
      if (!entry.isDirectory()) continue
      if (!fs.existsSync(path.join(modulesRoot, entry.name, 'index.ts'))) {
        issues.push({ file: `src/modules/${entry.name}`, specifier: '', rule: 'module-public-entry-point' })
      }
      if (manifest && !manifest.includes(`@/modules/${entry.name}`)) {
        issues.push({ file: `src/modules/${entry.name}`, specifier: '', rule: 'module-public-api-manifest' })
      }
    }
  }

  const architectureRoot = path.join(root, 'docs', 'architecture')
  const architectureDocuments = walkAllFiles(architectureRoot).map(relative)
  issues.push(...collectArchitectureDocumentSetIssues(architectureDocuments))
  const architectureDocumentSources = new Map(
    architectureDocuments.map((document) => [
      document,
      fs.readFileSync(path.join(root, document), 'utf8'),
    ]),
  )
  issues.push(...collectDurableWorkspaceEvidenceContractIssues(architectureDocumentSources))
  const retiredProviderIdentitySources = new Map(
    ['src', 'scripts', 'docs/architecture']
      .flatMap((directory) => walkAllFiles(path.join(root, directory)))
      .filter((file) => retiredProviderIdentityScanExtensions.has(path.extname(file)))
      .map((file) => [relative(file), fs.readFileSync(file, 'utf8')]),
  )
  issues.push(...collectRetiredProviderIdentityIssues(retiredProviderIdentitySources))

  return issues
}

if (process.argv.includes('--self-test')) {
  assert.deepEqual(collectArchitectureDocumentSetIssues([...canonicalArchitectureDocuments]), [])
  assert.deepEqual(
    collectArchitectureDocumentSetIssues([
      ...canonicalArchitectureDocuments,
      'docs/architecture/remote-compact-provider-evidence.md',
    ]),
    [{
      file: 'docs/architecture/remote-compact-provider-evidence.md',
      specifier: '',
      rule: 'architecture-document-set',
    }],
  )
  const missingArchitectureIssues = collectArchitectureDocumentSetIssues(
    [...canonicalArchitectureDocuments].filter((document) => document !== 'docs/architecture/architecture.md'),
  )
  assert.deepEqual(missingArchitectureIssues, [{
    file: 'docs/architecture/architecture.md',
    specifier: '',
    rule: 'architecture-document-set',
  }])
  const durableEvidenceFixture = new Map(
    [...canonicalArchitectureDocuments].map((document) => [
      document,
      durableWorkspaceEvidenceContractPhrases.join('\n'),
    ]),
  )
  assert.deepEqual(collectDurableWorkspaceEvidenceContractIssues(durableEvidenceFixture), [])
  durableEvidenceFixture.set(
    'docs/architecture/architecture.md',
    durableEvidenceFixture
      .get('docs/architecture/architecture.md')
      .replace('does not grant recovery authority', 'grants recovery authority'),
  )
  assert.deepEqual(collectDurableWorkspaceEvidenceContractIssues(durableEvidenceFixture), [{
    file: 'docs/architecture/architecture.md',
    specifier: durableWorkspaceEvidenceContractPhrases[0],
    rule: 'durable-workspace-evidence-contract',
  }])
  const retiredProviderId = retiredProviderIdentitySegments[0].join('-')
  assert.deepEqual(collectRetiredProviderIdentityIssues(new Map([
    ['src/modules/providers/fixture.ts', `presetId: '${retiredProviderId}'`],
  ])), [{
    file: 'src/modules/providers/fixture.ts',
    specifier: retiredProviderId,
    rule: 'retired-provider-identity-restoration',
  }])
  assert.deepEqual(collectRetiredProviderIdentityIssues(new Map([
    ['src/modules/providers/fixture.ts', "presetId: 'custom-endpoint'"],
  ])), [])
  console.log('Architecture document-set self-test passed')
}

const files = targetRoots.flatMap((directory) => walk(path.join(root, directory)))
const issues = collectIssues(files)
const report = {
  schema: SCHEMA,
  summary: {
    files: files.length,
    issues: issues.length,
    passed: issues.length === 0,
  },
  issues,
}

console.log(JSON.stringify(report, null, 2))
if (issues.length) process.exitCode = 1
