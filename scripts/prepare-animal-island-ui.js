const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repository = 'https://github.com/domidoremi/animal-island-ui.git'
const sharedRuntimes = ['react', 'react-native', 'react-native-svg']

/** Outside-root workspaces cannot resolve hoisted dependencies by walking upwards.
 * Match Metro's host-runtime boundary for TypeScript and native autolinking too.
 * Only these generated node_modules entries are replaced, never fork sources.
 */
function linkAnimalIslandUiRuntimes({ root = path.resolve(__dirname, '..') } = {}) {
  root = fs.realpathSync(root)
  const directory = fs.realpathSync(path.resolve(root, '../animal-island-ui'))
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const fork = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (fork.name !== 'animal-island-ui-rn') throw new Error('Expected the sibling RN fork; nothing was changed.')
  const modules = path.join(directory, 'node_modules')
  if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Refusing to replace dependencies inside a linked node_modules directory.')
  }
  // Validate every replacement before removing any installed package.
  const links = sharedRuntimes.map(name => {
    const target = fs.realpathSync(path.join(root, 'node_modules', name))
    const installed = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
    if (installed.name !== name || installed.version !== manifest.dependencies[name]
      || manifest.overrides[name] !== `$${name}`) {
      throw new Error(`Install the pinned host ${name} and its override before linking the RN fork.`)
    }
    const destination = path.join(modules, name)
    const existing = fs.lstatSync(destination, { throwIfNoEntry: false })
    if (existing && !existing.isSymbolicLink()) {
      const previous = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'))
      if (previous.name !== name || fs.existsSync(path.join(destination, '.git'))) {
        throw new Error(`Refusing to replace a non-package directory at ${destination}.`)
      }
    }
    return { target, destination, existing }
  })
  fs.mkdirSync(modules, { recursive: true })
  for (const { target, destination, existing } of links) {
    if (fs.existsSync(destination) && fs.realpathSync(destination) === target) continue
    // Both paths are absolute. The destination is an allowlisted direct child
    // of the checked sibling node_modules; symlinks are removed, not followed.
    if (existing) fs.rmSync(destination, { recursive: true, force: true })
    fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
  }
}

/** Provision the sibling workspace for CI/EAS; never replace a developer's checkout. */
function prepareAnimalIslandUi({ root = path.resolve(__dirname, '..'), ref = process.env.ANIMAL_ISLAND_UI_REF, git = execFileSync } = {}) {
  const directory = path.resolve(root, '../animal-island-ui')
  if (ref && !/^[a-f0-9]{40}$/i.test(ref)) throw new Error('ANIMAL_ISLAND_UI_REF must be a full commit SHA.')
  if (!fs.existsSync(directory)) {
    if (!ref) throw new Error('ANIMAL_ISLAND_UI_REF is required when provisioning the RN workspace. Pin the full commit SHA containing the paired UI changes; a moving rn branch is not a build input.')
    git('git', ['clone', '--branch', 'rn', '--single-branch', repository, directory], { stdio: 'inherit' })
    git('git', ['-C', directory, 'fetch', '--depth=1', 'origin', ref], { stdio: 'inherit' })
    git('git', ['-C', directory, 'checkout', '--detach', 'FETCH_HEAD'], { stdio: 'inherit' })
  }
  const manifestPath = path.join(directory, 'package.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Expected the RN fork at ${directory}; the existing directory was left untouched.`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== 'animal-island-ui-rn' || manifest['react-native'] !== 'src/index.ts' || !manifest.exports?.['./theme']) {
    throw new Error(`Expected animal-island-ui-rn with its theme export at ${directory}. Use the rn branch, not the Web main branch.`)
  }
  const revision = String(git('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' })).trim()
  if (ref && revision.toLowerCase() !== ref.toLowerCase()) {
    throw new Error(`Existing RN fork is at ${revision}, not ${ref}; it was left untouched.`)
  }
  if (ref && String(git('git', ['-C', directory, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })).trim()) {
    throw new Error('The pinned RN fork contains local changes; it was left untouched. A matching HEAD alone does not identify the build sources.')
  }
  console.log(`animal-island-ui-rn: ${directory} (${revision})`)
  return directory
}

if (require.main === module) {
  if (process.argv.includes('--link-runtimes')) linkAnimalIslandUiRuntimes()
  else prepareAnimalIslandUi()
}
module.exports = { prepareAnimalIslandUi, linkAnimalIslandUiRuntimes, sharedRuntimes }
