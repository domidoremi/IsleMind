const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const defaultRunDir = path.join(root, 'test-evidence', 'qa', 'isle-pet-extension-run')
const defaultCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalize(filePath) {
  return path.resolve(filePath)
}

function isInside(child, parent) {
  const relative = path.relative(normalize(parent), normalize(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function assertGeneratedImageSource(sourcePath) {
  const absoluteSource = normalize(sourcePath)
  const generatedImagesDir = path.join(defaultCodexHome, 'generated_images')
  assert.ok(fs.existsSync(absoluteSource), `source image exists: ${absoluteSource}`)
  assert.ok(isInside(absoluteSource, generatedImagesDir), `source must be under ${generatedImagesDir}`)
  assert.match(path.basename(absoluteSource), /^ig_.*\.(png|webp|jpe?g)$/i, 'source filename must look like a selected imagegen output, for example ig_*.png')
  return absoluteSource
}

function findJob(manifest, jobId, animation) {
  if (jobId) return manifest.jobs.find((job) => job.jobId === jobId)
  if (animation) return manifest.jobs.find((job) => job.animation === animation)
  return null
}

function recordResult() {
  const runDir = normalize(argValue('--run-dir') ?? defaultRunDir)
  const manifestPath = path.join(runDir, 'imagegen-jobs.json')
  const jobId = argValue('--job-id')
  const animation = argValue('--animation')
  const sourceArg = argValue('--source')
  const qaNote = argValue('--qa-note')

  assert.ok(jobId || animation, 'pass --job-id or --animation')
  assert.ok(sourceArg, 'pass --source /absolute/path/to/$CODEX_HOME/generated_images/.../ig_*.png')
  assert.ok(qaNote && qaNote.trim().length >= 12, 'pass --qa-note with a short visual QA note')

  const source = assertGeneratedImageSource(sourceArg)
  const manifest = readJson(manifestPath)
  const job = findJob(manifest, jobId, animation)
  assert.ok(job, `job not found: ${jobId || animation}`)

  job.status = 'recorded-imagegen'
  job.selectedSource = source
  job.qaNote = qaNote.trim()
  job.recordedAt = new Date().toISOString()
  manifest.status = manifest.jobs.every((item) => item.status === 'recorded-imagegen')
    ? 'recorded-imagegen'
    : 'pending-imagegen'

  writeJson(manifestPath, manifest)
  console.log(`Recorded imagegen result for ${job.jobId}`)
  console.log(`Source: ${source}`)
}

recordResult()
