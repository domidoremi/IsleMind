const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist-apk')
const SIXTEEN_KB = 0x4000

function parseArgs(argv) {
  const args = {
    apkPaths: [],
    strict: false,
  }
  for (const item of argv) {
    if (item === '--strict') {
      args.strict = true
    } else if (item.includes('*')) {
      args.apkPaths.push(...expandSimpleGlob(item))
    } else {
      args.apkPaths.push(item)
    }
  }
  if (!args.apkPaths.length && fs.existsSync(distDir)) {
    args.apkPaths = fs.readdirSync(distDir)
      .filter((name) => name.endsWith('.apk'))
      .map((name) => path.join(distDir, name))
  }
  args.apkPaths = [...new Set(args.apkPaths.map((apk) => path.resolve(projectRoot, apk)))]
  return args
}

function expandSimpleGlob(pattern) {
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

function findZipalign() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!home) return null
  const buildTools = path.join(home, 'build-tools')
  if (!fs.existsSync(buildTools)) return null
  const exe = process.platform === 'win32' ? 'zipalign.exe' : 'zipalign'
  return fs.readdirSync(buildTools)
    .sort(compareVersionsDesc)
    .map((version) => path.join(buildTools, version, exe))
    .find((candidate) => fs.existsSync(candidate)) ?? null
}

function findReadelf() {
  if (process.env.LLVM_READELF && fs.existsSync(process.env.LLVM_READELF)) return process.env.LLVM_READELF
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!home) return null
  const ndkRoot = path.join(home, 'ndk')
  if (!fs.existsSync(ndkRoot)) return null
  const exe = process.platform === 'win32' ? 'llvm-readelf.exe' : 'llvm-readelf'
  return fs.readdirSync(ndkRoot)
    .sort(compareVersionsDesc)
    .map((version) => path.join(ndkRoot, version, 'toolchains', 'llvm', 'prebuilt'))
    .flatMap((prebuilt) => fs.existsSync(prebuilt) ? fs.readdirSync(prebuilt).map((host) => path.join(prebuilt, host, 'bin', exe)) : [])
    .find((candidate) => fs.existsSync(candidate)) ?? null
}

function compareVersionsDesc(a, b) {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
}

function checkZipAlignment(zipalign, apkPath) {
  if (!zipalign) return { ok: false, skipped: true, message: 'zipalign not found in ANDROID_HOME build-tools.' }
  const result = spawnSync(zipalign, ['-c', '-P', '16', '4', apkPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  return {
    ok: result.status === 0,
    skipped: false,
    message: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
  }
}

function readZipEntries(apkPath) {
  const buffer = fs.readFileSync(apkPath)
  const eocdOffset = findEocd(buffer)
  if (eocdOffset < 0) throw new Error(`Could not find ZIP central directory in ${apkPath}.`)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const entries = []
  let offset = centralDirectoryOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid central directory header at ${offset}.`)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return { buffer, entries }
}

function findEocd(buffer) {
  const start = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function extractZipEntry(zip, entry, targetPath) {
  const localOffset = entry.localHeaderOffset
  if (zip.buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid local header for ${entry.name}.`)
  }
  const nameLength = zip.buffer.readUInt16LE(localOffset + 26)
  const extraLength = zip.buffer.readUInt16LE(localOffset + 28)
  const dataOffset = localOffset + 30 + nameLength + extraLength
  const compressed = zip.buffer.subarray(dataOffset, dataOffset + entry.compressedSize)
  let data
  if (entry.method === 0) data = compressed
  else if (entry.method === 8) data = zlib.inflateRawSync(compressed)
  else throw new Error(`Unsupported ZIP method ${entry.method} for ${entry.name}.`)
  if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
    throw new Error(`Unexpected size for ${entry.name}: ${data.length}, expected ${entry.uncompressedSize}.`)
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, data)
}

function checkElfAlignment(readelf, apkPath) {
  if (!readelf) return { skipped: true, bad64: [], bad32: [], message: 'llvm-readelf not found in ANDROID_HOME NDK.' }
  const zip = readZipEntries(apkPath)
  const libEntries = zip.entries.filter((entry) => /^lib\/[^/]+\/[^/]+\.so$/.test(entry.name))
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-16kb-'))
  const bad64 = []
  const bad32 = []
  try {
    for (const entry of libEntries) {
      const [, abi, fileName] = entry.name.split('/')
      const target = path.join(tempDir, abi, fileName)
      extractZipEntry(zip, entry, target)
      const result = spawnSync(readelf, ['-l', target], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 })
      if (result.status !== 0) {
        const item = { abi, fileName, alignments: ['readelf-error'], detail: result.stderr || result.stdout || 'readelf failed' }
        if (isSixtyFourBitAbi(abi)) bad64.push(item)
        else bad32.push(item)
        continue
      }
      const alignments = parseLoadAlignments(result.stdout)
      const badAlignments = alignments.filter((alignment) => alignment < SIXTEEN_KB)
      if (badAlignments.length) {
        const item = { abi, fileName, alignments: badAlignments.map((value) => `0x${value.toString(16)}`) }
        if (isSixtyFourBitAbi(abi)) bad64.push(item)
        else bad32.push(item)
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
  return { skipped: false, bad64, bad32 }
}

function parseLoadAlignments(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => /^\s*LOAD\s/.test(line))
    .map((line) => {
      const parts = line.trim().split(/\s+/)
      const value = parts[parts.length - 1] ?? '0'
      return Number.parseInt(value, 16)
    })
    .filter((value) => Number.isFinite(value))
}

function isSixtyFourBitAbi(abi) {
  return abi === 'arm64-v8a' || abi === 'x86_64'
}

function formatBad(items) {
  return items.map((item) => `${item.abi}/${item.fileName} (${item.alignments.join(', ')})`).join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.apkPaths.length) {
    console.error('No APK files found. Pass APK paths or build into dist-apk first.')
    process.exit(1)
  }
  const zipalign = findZipalign()
  const readelf = findReadelf()
  let hasBlockingIssue = false

  for (const apkPath of args.apkPaths) {
    if (!fs.existsSync(apkPath)) {
      console.error(`Missing APK: ${apkPath}`)
      hasBlockingIssue = true
      continue
    }
    console.log(`\n16 KB compatibility report: ${path.relative(projectRoot, apkPath)}`)
    const zip = checkZipAlignment(zipalign, apkPath)
    if (zip.skipped) {
      console.log(`- ZIP page alignment: skipped (${zip.message})`)
    } else if (zip.ok) {
      console.log('- ZIP page alignment: OK (zipalign -P 16)')
    } else {
      hasBlockingIssue = true
      console.log('- ZIP page alignment: FAILED')
      if (zip.message) console.log(indent(zip.message))
    }

    const elf = checkElfAlignment(readelf, apkPath)
    if (elf.skipped) {
      console.log(`- ELF LOAD alignment: skipped (${elf.message})`)
      continue
    }
    if (!elf.bad64.length) {
      console.log('- ELF LOAD alignment: OK for 64-bit ABIs')
    } else {
      hasBlockingIssue = true
      console.log(`- ELF LOAD alignment: ${elf.bad64.length} 64-bit native library issue(s)`)
      console.log(indent(formatBad(elf.bad64)))
    }
    if (elf.bad32.length) {
      console.log(`- 32-bit ABI note: ${elf.bad32.length} library issue(s), reported separately from the 64-bit Android 16 KB requirement.`)
      console.log(indent(formatBad(elf.bad32.slice(0, 12))))
      if (elf.bad32.length > 12) console.log(indent(`...and ${elf.bad32.length - 12} more`))
    }
  }

  if (hasBlockingIssue) {
    const message = args.strict
      ? '16 KB APK validation failed.'
      : '16 KB APK validation found issues. Re-run with --strict to make this fatal.'
    console.log(`\n${message}`)
    process.exit(args.strict ? 1 : 0)
  }
  console.log('\n16 KB APK validation passed.')
}

function indent(value) {
  return String(value).split(/\r?\n/).map((line) => `  ${line}`).join('\n')
}

main()
