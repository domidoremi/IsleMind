const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const root = path.resolve(__dirname, '..')
const petDir = path.join(root, 'assets', 'pets', 'isle')
const planPath = path.join(petDir, 'extended-animation-plan.json')
const petJsonPath = path.join(petDir, 'pet.json')
const defaultOutDir = path.join(root, 'test-evidence', 'qa', 'isle-pet-extension-run')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function rel(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function writePng(filePath, width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rawRow = y * (width * 4 + 1)
    raw[rawRow] = 0
    rgba.copy(raw, rawRow + 1, y * width * 4, (y + 1) * width * 4)
  }

  const idat = zlib.deflateSync(raw)
  fs.writeFileSync(filePath, Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND'),
  ]))
}

function createCanvas(width, height, color) {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(data, width, height, x, y, color)
    }
  }
  return data
}

function setPixel(data, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const offset = (y * width + x) * 4
  data[offset] = color[0]
  data[offset + 1] = color[1]
  data[offset + 2] = color[2]
  data[offset + 3] = color[3]
}

function fillRect(data, width, height, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let col = x; col < x + rectWidth; col += 1) {
      setPixel(data, width, height, col, row, color)
    }
  }
}

function strokeRect(data, width, height, x, y, rectWidth, rectHeight, color, lineWidth = 1) {
  fillRect(data, width, height, x, y, rectWidth, lineWidth, color)
  fillRect(data, width, height, x, y + rectHeight - lineWidth, rectWidth, lineWidth, color)
  fillRect(data, width, height, x, y, lineWidth, rectHeight, color)
  fillRect(data, width, height, x + rectWidth - lineWidth, y, lineWidth, rectHeight, color)
}

function drawGuide(filePath, rowSpec, geometry) {
  const width = rowSpec.frames * geometry.cellWidth
  const height = geometry.cellHeight
  const colors = {
    background: [248, 251, 253, 255],
    frame: [43, 105, 161, 255],
    safe: [236, 161, 63, 255],
    center: [138, 171, 201, 255],
    used: [223, 235, 246, 255],
  }
  const data = createCanvas(width, height, colors.background)

  for (let frame = 0; frame < rowSpec.frames; frame += 1) {
    const x = frame * geometry.cellWidth
    fillRect(data, width, height, x + 1, 1, geometry.cellWidth - 2, height - 2, colors.used)
    strokeRect(data, width, height, x, 0, geometry.cellWidth, height, colors.frame, 2)
    strokeRect(data, width, height, x + 14, 14, geometry.cellWidth - 28, height - 28, colors.safe, 1)
    fillRect(data, width, height, x + Math.floor(geometry.cellWidth / 2), 10, 1, height - 20, colors.center)
    fillRect(data, width, height, x + 10, Math.floor(height / 2), geometry.cellWidth - 20, 1, colors.center)
  }

  writePng(filePath, width, height, data)
}

function buildPrompt(plan, atlasSpec, rowSpec, outputDir) {
  const sourceLines = plan.sourceReferences.map((reference) => {
    const absolutePath = path.join(root, reference.path)
    return `- ${absolutePath} - ${reference.role}`
  })
  const guidePath = path.join(outputDir, 'layout-guides', atlasSpec.atlasId, `${rowSpec.animation}.png`)
  sourceLines.push(`- ${guidePath} - layout-only frame guide`)

  return [
    `Isle pet animation extension row: ${atlasSpec.atlasId}/${rowSpec.animation}`,
    '',
    'Use this prompt as the authoritative visual spec for hatch-pet row generation.',
    '',
    'Input images:',
    ...sourceLines,
    '',
    'Pet identity lock:',
    plan.identityLock.description,
    '',
    'Preserve:',
    ...plan.identityLock.preserve.map((item) => `- ${item}`),
    '',
    'Avoid:',
    ...plan.identityLock.avoid.map((item) => `- ${item}`),
    '',
    'Row request:',
    rowSpec.prompt,
    '',
    'Geometry:',
    `- Create exactly ${rowSpec.frames} separated frames in one horizontal row.`,
    `- Each frame slot is ${plan.geometry.cellWidth}x${plan.geometry.cellHeight}px.`,
    `- The expected row strip size is ${rowSpec.frames * plan.geometry.cellWidth}x${plan.geometry.cellHeight}px.`,
    '- Keep the complete pet inside each frame, centered with safe padding.',
    '- Keep poses separated; no body part or effect may cross into a neighboring frame.',
    '- The attached layout guide is for frame geometry only. Do not copy guide pixels, borders, colors, center lines, or marks into the generated art.',
    '',
    'Transparency and background:',
    '- Generate on a perfectly flat solid #00ff00 chroma-key background for later removal.',
    '- The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.',
    '- Do not use #00ff00 anywhere in the pet, markings, highlights, or allowed attached effects.',
    '- No cast shadow, contact shadow, glow, reflection, watermark, UI, text, frame number, or scenery.',
    '',
    'State motion brief:',
    rowSpec.motionBrief,
    '',
    'Acceptance checklist before returning an imagegen source:',
    `- ${rowSpec.frames} clear frames in a single horizontal strip.`,
    '- Same Isle identity as the reference image and core spritesheet.',
    '- Clean flat chroma-key background.',
    '- Complete, separated, unclipped poses.',
    '- No forbidden detached effects, symbols, shadows, text, scenery, guide marks, or slot-crossing artifacts.',
    '',
  ].join('\n')
}

function buildJob(plan, atlasSpec, rowSpec, outputDir) {
  const jobId = `${atlasSpec.atlasId}-${String(rowSpec.row).padStart(2, '0')}-${rowSpec.animation}`
  const promptFile = path.join(outputDir, 'prompts', atlasSpec.atlasId, `${rowSpec.animation}.txt`)
  const layoutGuide = path.join(outputDir, 'layout-guides', atlasSpec.atlasId, `${rowSpec.animation}.png`)
  const inputs = [
    ...plan.sourceReferences.map((reference) => ({
      path: path.join(root, reference.path),
      role: reference.role,
    })),
    {
      path: layoutGuide,
      role: 'layout-only frame guide',
    },
  ]

  return {
    jobId,
    status: 'pending-imagegen',
    atlasId: atlasSpec.atlasId,
    animation: rowSpec.animation,
    row: rowSpec.row,
    frames: rowSpec.frames,
    fps: rowSpec.fps,
    promptFile,
    inputs,
    expectedStrip: {
      width: rowSpec.frames * plan.geometry.cellWidth,
      height: plan.geometry.cellHeight,
      cellWidth: plan.geometry.cellWidth,
      cellHeight: plan.geometry.cellHeight,
    },
    targetAtlas: path.join(root, atlasSpec.outputPath),
    selectedSource: null,
    qaNote: null,
  }
}

function buildRowsMarkdown(plan) {
  const lines = [
    '# Isle Extended Animation Rows',
    '',
    'These rows are generated from assets/pets/isle/extended-animation-plan.json.',
    'The real row art must be produced with imagegen and must preserve the Isle identity.',
    '',
    '| Atlas | Row | Animation | Frames | FPS | Fallback | Motion brief |',
    '| --- | ---: | --- | ---: | ---: | --- | --- |',
  ]

  for (const atlas of plan.atlasSpecs) {
    for (const row of atlas.rows) {
      lines.push(`| ${atlas.atlasId} | ${row.row} | ${row.animation} | ${row.frames} | ${row.fps} | ${row.fallbackAnimation} | ${row.motionBrief} |`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function buildHandoff(jobs) {
  const lines = [
    '# Isle Pet Extension Subagent Handoff',
    '',
    'Use one job per subagent unless explicitly batching adjacent simple rows.',
    'Each subagent must use imagegen only. Do not draw, tile, edit, or synthesize sprites with local scripts.',
    'The parent agent records selected imagegen outputs and assembles atlases.',
    '',
  ]

  for (const job of jobs) {
    lines.push(`## ${job.jobId}`)
    lines.push('')
    lines.push(`Generate the ${job.animation} row for the Isle pet extension.`)
    lines.push('')
    lines.push(`Prompt file: ${job.promptFile}`)
    lines.push('Input images:')
    for (const input of job.inputs) {
      lines.push(`- ${input.path} - ${input.role}`)
    }
    lines.push('')
    lines.push('Read and follow the row prompt exactly, including the transparency and artifact rules.')
    lines.push('Before returning, visually check exact frame count, Isle identity, clean chroma-key background, complete separated poses, and no forbidden artifacts.')
    lines.push('Return only:')
    lines.push('selected_source=/absolute/path/to/$CODEX_HOME/generated_images/.../ig_*.png')
    lines.push('qa_note=<one sentence>')
    lines.push('')
  }

  return lines.join('\n')
}

function buildReadme(outputDir, jobs) {
  return [
    '# Isle Pet Animation Extension Run',
    '',
    'This folder is a deterministic preparation package for generating the missing Isle RAG and provider pet atlases.',
    '',
    'Generated artifacts:',
    '- prompts/: one imagegen prompt per atlas row',
    '- layout-guides/: one geometry-only PNG guide per atlas row',
    '- imagegen-jobs.json: pending job manifest for the parent agent',
    '- animation-rows.md: row table for QA',
    '- subagent-handoff.md: copyable row generation instructions',
    '',
    'Important boundary:',
    'The files here do not contain generated pet row art. Real spritesheets must still be produced with imagegen, then reviewed and assembled before assets/pets/isle/rag-spritesheet.webp and assets/pets/isle/provider-spritesheet.webp can be marked available.',
    '',
    `Prepared jobs: ${jobs.length}`,
    `Run directory: ${outputDir}`,
    '',
  ].join('\n')
}

function prepare() {
  const outputArg = argValue('--out-dir')
  const outputDir = path.resolve(outputArg ?? defaultOutDir)
  const plan = readJson(planPath)
  readJson(petJsonPath)

  ensureDir(outputDir)
  ensureDir(path.join(outputDir, 'prompts'))
  ensureDir(path.join(outputDir, 'layout-guides'))

  const jobs = []
  for (const atlasSpec of plan.atlasSpecs) {
    ensureDir(path.join(outputDir, 'prompts', atlasSpec.atlasId))
    ensureDir(path.join(outputDir, 'layout-guides', atlasSpec.atlasId))

    for (const rowSpec of atlasSpec.rows) {
      const promptFile = path.join(outputDir, 'prompts', atlasSpec.atlasId, `${rowSpec.animation}.txt`)
      const guideFile = path.join(outputDir, 'layout-guides', atlasSpec.atlasId, `${rowSpec.animation}.png`)
      fs.writeFileSync(promptFile, buildPrompt(plan, atlasSpec, rowSpec, outputDir), 'utf8')
      drawGuide(guideFile, rowSpec, plan.geometry)
      jobs.push(buildJob(plan, atlasSpec, rowSpec, outputDir))
    }
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'pending-imagegen',
    petId: plan.petId,
    planFile: planPath,
    runDir: outputDir,
    jobs,
  }

  fs.writeFileSync(path.join(outputDir, 'imagegen-jobs.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(outputDir, 'animation-rows.md'), buildRowsMarkdown(plan), 'utf8')
  fs.writeFileSync(path.join(outputDir, 'subagent-handoff.md'), buildHandoff(jobs), 'utf8')
  fs.writeFileSync(path.join(outputDir, 'README.md'), buildReadme(outputDir, jobs), 'utf8')

  console.log(`Prepared Isle pet animation extension run: ${outputDir}`)
  console.log(`Prompts: ${jobs.length}`)
  console.log(`Layout guides: ${jobs.length}`)
  console.log(`Job manifest: ${path.join(outputDir, 'imagegen-jobs.json')}`)
}

prepare()
