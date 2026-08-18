const fs = require('node:fs')
const path = require('node:path')

function resolveReleaseApkPaths(args, { projectRoot, defaultDir }) {
  const apkPaths = []
  for (const item of args) {
    if (item.includes('*')) apkPaths.push(...expandSimpleGlob(item, projectRoot))
    else apkPaths.push(item)
  }
  if (!apkPaths.length && fs.existsSync(defaultDir)) {
    apkPaths.push(...fs.readdirSync(defaultDir)
      .filter((name) => name.endsWith('.apk'))
      .map((name) => path.join(defaultDir, name)))
  }
  return [...new Set(apkPaths.map((apkPath) => path.resolve(projectRoot, apkPath)))]
}

function expandSimpleGlob(pattern, projectRoot) {
  const normalized = pattern.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const dir = slash >= 0 ? normalized.slice(0, slash) : '.'
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const regex = new RegExp(`^${base.split('*').map(escapeRegex).join('.*')}$`)
  const absoluteDir = path.resolve(projectRoot, dir)
  if (!fs.existsSync(absoluteDir)) return []
  return fs.readdirSync(absoluteDir)
    .filter((name) => regex.test(name))
    .map((name) => path.join(absoluteDir, name))
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

module.exports = {
  resolveReleaseApkPaths,
}
