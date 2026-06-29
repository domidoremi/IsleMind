const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
  if (result.signal) {
    console.error(`Command terminated by signal ${result.signal}`)
    process.exit(1)
  }
}

function main() {
  run(['scripts/build-local-android-apk.js', ...process.argv.slice(2)])
  run(['scripts/validate-android-16kb-apk.js', '--strict'])
}

main()
