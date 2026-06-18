const fs = require('node:fs')
const path = require('node:path')

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

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length
}

function relativeFrom(root, file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

module.exports = {
  lineNumber,
  listFiles,
  relativeFrom,
}
