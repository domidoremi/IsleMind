const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const lazyLoadSource = fs.readFileSync(
  path.join(root, 'src', 'utils', 'lazyLoad.tsx'),
  'utf8',
)
const compatibilityFactory = lazyLoadSource.match(
  /export function createLazyComponentWithPreload[\s\S]*?\n}/,
)?.[0]

assert.ok(compatibilityFactory, 'lazy-load compatibility factory remains available')
assert.ok(
  compatibilityFactory.includes('return createLazyComponent(importFn)'),
  'compatibility factory delegates loading to React.lazy',
)
assert.equal(
  /\b(?:preloadComponent|importFn)\s*\(/.test(compatibilityFactory),
  false,
  'route module evaluation does not start a dynamic import',
)
assert.equal(
  lazyLoadSource.includes('export function preloadComponent'),
  false,
  'the eager preload helper stays deleted',
)

console.log('Lazy-load contract tests passed')
