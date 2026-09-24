const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repository = 'https://github.com/domidoremi/animal-island-ui.git'

/** Provision the sibling workspace for CI/EAS; never replace a developer's checkout. */
function prepareAnimalIslandUi({ root = path.resolve(__dirname, '..'), ref = process.env.ANIMAL_ISLAND_UI_REF, git = execFileSync } = {}) {
  const directory = path.resolve(root, '../animal-island-ui')
  if (ref && !/^[a-f0-9]{40}$/i.test(ref)) throw new Error('ANIMAL_ISLAND_UI_REF must be a full commit SHA.')
  if (!fs.existsSync(directory)) {
    git('git', ['clone', '--branch', 'rn', '--single-branch', repository, directory], { stdio: 'inherit' })
    if (ref) {
      git('git', ['-C', directory, 'fetch', '--depth=1', 'origin', ref], { stdio: 'inherit' })
      git('git', ['-C', directory, 'checkout', '--detach', 'FETCH_HEAD'], { stdio: 'inherit' })
    }
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
  console.log(`animal-island-ui-rn: ${directory} (${revision})`)
  return directory
}

if (require.main === module) prepareAnimalIslandUi()
module.exports = { prepareAnimalIslandUi }
