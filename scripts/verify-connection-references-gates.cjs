const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const out = path.resolve(root, process.argv[2] || 'test-evidence/qa/islemind-connection-references-20261106/gates-i1')
assert(out.startsWith(root + path.sep) && !fs.existsSync(out), 'Use fresh workspace evidence')
fs.mkdirSync(out, { recursive: true })
const commands = [
  ['types', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['dependencies', process.execPath, ['scripts/architecture-dependency-audit.js', '--include-type', '--gate']],
  ['dependency-self-test', process.execPath, ['scripts/architecture-dependency-audit.js', '--self-test']],
  ['modules', process.execPath, ['scripts/module-architecture-boundary-tests.js']],
  ['module-self-test', process.execPath, ['scripts/module-architecture-boundary-tests.js', '--self-test']],
  ['architecture', process.execPath, ['scripts/architecture-boundary-audit.js']],
  ['architecture-self-test', process.execPath, ['scripts/architecture-boundary-audit.js', '--self-test']],
  ['architecture-contracts', 'bun', ['--no-env-file', 'scripts/architecture-contract-tests.js']],
  ['themes', process.execPath, ['scripts/theme-system-audit.js']],
  ['theme-source', process.execPath, ['scripts/verify-theme-web-render.js', '--source-only']],
  ['contrast', 'bun', ['--no-env-file', 'scripts/theme-contrast-selftest.js']],
  ['mobile-layout', process.execPath, ['scripts/product-mobile-layout-tests.js']],
  ['font-scale', process.execPath, ['scripts/android-font-scale-tests.js']],
  ['naming', process.execPath, ['scripts/ui-naming-audit.js']],
  ['guide', process.execPath, ['scripts/user-guide.js', '--check']],
  ['guide-tests', process.execPath, ['scripts/user-guide-tests.js']],
]
const receipt = { schema: 'islemind.connection-references-gates.v1', startedAt: new Date().toISOString(), gates: [], pass: false }
async function run([name, executable, args]) {
  const file = path.join(out, `${name}.log`)
  const stream = fs.createWriteStream(file)
  const startedAt = new Date().toISOString()
  const result = await new Promise(resolve => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, EXPO_NO_DOTENV: '1' } })
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false })
    child.on('error', error => { stream.write(error.stack); resolve({ exitCode: -1 }) })
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  await new Promise(resolve => stream.end(resolve))
  const entry = { name, executable, args, startedAt, completedAt: new Date().toISOString(), log: path.basename(file), ...result }
  receipt.gates.push(entry)
  console.log(JSON.stringify({ name, exitCode: entry.exitCode }))
}
async function main() {
  let index = 0
  async function worker() { while (index < commands.length) await run(commands[index++]) }
  const workers = await Promise.allSettled([worker(), worker(), worker()])
  for (const result of workers) assert.equal(result.status, 'fulfilled')
  receipt.gates.sort((a, b) => commands.findIndex(item => item[0] === a.name) - commands.findIndex(item => item[0] === b.name))
  receipt.pass = receipt.gates.length === commands.length && receipt.gates.every(entry => entry.exitCode === 0)
  receipt.completedAt = new Date().toISOString()
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(receipt, null, 2))
  assert(receipt.pass, 'Connection reference gates failed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
