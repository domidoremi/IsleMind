const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const petDir = path.join(root, 'assets', 'pets', 'isle')
const planPath = path.join(petDir, 'extended-animation-plan.json')
const petJsonPath = path.join(petDir, 'pet.json')
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

function readPngSize(filePath) {
  const file = fs.readFileSync(filePath)
  assert.equal(file.readUInt32BE(0), 0x89504e47, `${filePath} is a PNG file`)
  assert.equal(file.toString('ascii', 12, 16), 'IHDR', `${filePath} has a PNG IHDR chunk`)
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  }
}

function normalize(filePath) {
  return path.resolve(filePath)
}

function isInside(child, parent) {
  const relative = path.relative(normalize(parent), normalize(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function rowKey(atlasId, row) {
  return `${atlasId}:${row}`
}

function assertGeneratedImageSource(sourcePath, jobId) {
  const absoluteSource = normalize(sourcePath)
  const generatedImagesDir = path.join(defaultCodexHome, 'generated_images')
  assert.ok(fs.existsSync(absoluteSource), `${jobId} selected source exists: ${absoluteSource}`)
  assert.ok(isInside(absoluteSource, generatedImagesDir), `${jobId} selected source is under ${generatedImagesDir}`)
  assert.match(path.basename(absoluteSource), /^ig_.*\.(png|webp|jpe?g)$/i, `${jobId} selected source looks like imagegen output`)
}

function validateJobRecording(job) {
  if (job.status === 'pending-imagegen') {
    assert.equal(job.selectedSource, null, `${job.jobId} has no fake selected source`)
    assert.equal(job.qaNote, null, `${job.jobId} has no fake QA note`)
    assert.equal(job.recordedAt, undefined, `${job.jobId} has no fake recorded timestamp`)
    return
  }

  assert.equal(job.status, 'recorded-imagegen', `${job.jobId} has a valid imagegen status`)
  assertGeneratedImageSource(job.selectedSource, job.jobId)
  assert.ok(job.qaNote && job.qaNote.trim().length >= 12, `${job.jobId} has a visual QA note`)
  assert.ok(job.recordedAt && !Number.isNaN(Date.parse(job.recordedAt)), `${job.jobId} has a valid recorded timestamp`)
}

function validateRun(runDir) {
  const plan = readJson(planPath)
  const pet = readJson(petJsonPath)
  const manifestPath = path.join(runDir, 'imagegen-jobs.json')
  const manifest = readJson(manifestPath)
  const plannedRows = []

  for (const atlas of plan.atlasSpecs) {
    for (const row of atlas.rows) {
      plannedRows.push({ ...row, atlasId: atlas.atlasId, outputPath: atlas.outputPath })
    }
  }

  assert.equal(manifest.schemaVersion, 1, 'run manifest schema version matches')
  assert.ok(['pending-imagegen', 'recorded-imagegen'].includes(manifest.status), 'run manifest has a valid imagegen status')
  assert.equal(manifest.petId, plan.petId, 'run manifest pet id matches plan')
  assert.equal(normalize(manifest.planFile), normalize(planPath), 'run manifest points to the active plan file')
  assert.equal(normalize(manifest.runDir), normalize(runDir), 'run manifest points to its run directory')
  assert.equal(manifest.jobs.length, plannedRows.length, 'run manifest covers every planned row')

  for (const requiredFile of ['README.md', 'animation-rows.md', 'subagent-handoff.md']) {
    assert.ok(fs.existsSync(path.join(runDir, requiredFile)), `${requiredFile} exists`)
  }

  const jobsByRow = new Map()
  for (const job of manifest.jobs) {
    validateJobRecording(job)
    assert.ok(!jobsByRow.has(rowKey(job.atlasId, job.row)), `${job.jobId} uses a unique atlas row`)
    jobsByRow.set(rowKey(job.atlasId, job.row), job)

    const animation = pet.animations[job.animation]
    assert.ok(animation, `${job.jobId} animation exists in pet.json`)
    assert.equal(animation.atlasId, job.atlasId, `${job.jobId} atlas matches pet.json`)
    assert.equal(animation.row, job.row, `${job.jobId} row matches pet.json`)
    assert.equal(animation.frames, job.frames, `${job.jobId} frame count matches pet.json`)
    assert.equal(animation.fps, job.fps, `${job.jobId} fps matches pet.json`)

    assert.ok(fs.existsSync(job.promptFile), `${job.jobId} prompt file exists`)
    const prompt = fs.readFileSync(job.promptFile, 'utf8')
    assert.ok(prompt.includes(job.animation), `${job.jobId} prompt names the animation`)
    assert.ok(prompt.includes(`#00ff00`), `${job.jobId} prompt includes chroma-key requirement`)
    assert.ok(prompt.includes(`exactly ${job.frames} separated frames`), `${job.jobId} prompt includes frame count`)
    assert.ok(prompt.includes(`${plan.geometry.cellWidth}x${plan.geometry.cellHeight}px`), `${job.jobId} prompt includes cell geometry`)
    assert.ok(prompt.includes('layout guide'), `${job.jobId} prompt references the layout guide`)

    assert.equal(job.inputs.length, plan.sourceReferences.length + 1, `${job.jobId} lists references plus layout guide`)
    for (const input of job.inputs) {
      assert.ok(fs.existsSync(input.path), `${job.jobId} input exists: ${input.path}`)
      assert.ok(input.role, `${job.jobId} input has a role: ${input.path}`)
    }

    const guideInput = job.inputs.find((input) => input.role === 'layout-only frame guide')
    assert.ok(guideInput, `${job.jobId} has a layout guide input`)
    const guideSize = readPngSize(guideInput.path)
    assert.equal(guideSize.width, job.frames * plan.geometry.cellWidth, `${job.jobId} guide width matches frame count`)
    assert.equal(guideSize.height, plan.geometry.cellHeight, `${job.jobId} guide height matches cell height`)
    assert.equal(job.expectedStrip.width, guideSize.width, `${job.jobId} expected strip width matches guide`)
    assert.equal(job.expectedStrip.height, guideSize.height, `${job.jobId} expected strip height matches guide`)
    assert.equal(job.expectedStrip.cellWidth, plan.geometry.cellWidth, `${job.jobId} expected cell width matches plan`)
    assert.equal(job.expectedStrip.cellHeight, plan.geometry.cellHeight, `${job.jobId} expected cell height matches plan`)
  }

  for (const planned of plannedRows) {
    const job = jobsByRow.get(rowKey(planned.atlasId, planned.row))
    assert.ok(job, `${planned.atlasId} row ${planned.row} has a job`)
    assert.equal(job.animation, planned.animation, `${job.jobId} animation matches plan row`)
    assert.equal(path.basename(job.targetAtlas), path.basename(planned.outputPath), `${job.jobId} target atlas matches plan`)
  }

  const allRecorded = manifest.jobs.every((job) => job.status === 'recorded-imagegen')
  assert.equal(
    manifest.status,
    allRecorded ? 'recorded-imagegen' : 'pending-imagegen',
    'run manifest status matches job recording state'
  )

  return {
    runDir,
    jobs: manifest.jobs.length,
    pendingCount: manifest.jobs.filter((job) => job.status === 'pending-imagegen').length,
    recordedCount: manifest.jobs.filter((job) => job.status === 'recorded-imagegen').length,
    promptCount: manifest.jobs.filter((job) => fs.existsSync(job.promptFile)).length,
    guideCount: manifest.jobs.filter((job) => job.inputs.some((input) => input.role === 'layout-only frame guide' && fs.existsSync(input.path))).length,
  }
}

const runDir = path.resolve(argValue('--run-dir') ?? defaultRunDir)
const summary = validateRun(runDir)
console.log(`Isle pet extension run valid: ${summary.jobs} jobs, ${summary.promptCount} prompts, ${summary.guideCount} layout guides, ${summary.recordedCount} recorded, ${summary.pendingCount} pending`)
