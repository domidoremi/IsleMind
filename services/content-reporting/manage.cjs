// Local container/host administration only. No HTTP admin surface or embedded secret.
const { openStore, ReportError } = require('./store.cjs')
const { configuration } = require('./server.cjs')
async function main() {
  process.umask(0o077)
  const config = configuration(process.env)
  const [command, id, option] = process.argv.slice(2)
  if (!['stats', 'list', 'show', 'review', 'purge'].includes(command)) throw new Error('invalid_command')
  const store = openStore(config.filename, config)
  try {
    let result
    if (command === 'stats') result = store.stats()
    if (command === 'list') result = store.list(id || 'received', option === undefined ? 50 : Number(option))
    if (command === 'show') result = store.show(id)
    if (command === 'review') {
      // Review notes on stdin, not shell arguments/history. Bounded input, JSON string only.
      const chunks = []; let length = 0
      for await (const chunk of process.stdin) {
        length += chunk.length
        if (length > 16_384) throw new Error('invalid_review')
        chunks.push(chunk)
      }
      const note = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      store.review(id, option, note); result = { status: option }
    }
    if (command === 'purge') {
      if (option !== '--confirm') throw new Error('confirmation_required')
      store.purge(id); result = { status: 'purged' }
    }
    // JSON escaping prevents untrusted report text from becoming terminal control sequences.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally { store.close() }
}
main().catch(error => {
  const code = error instanceof ReportError ? error.code : 'management_failed_check_arguments_and_storage'
  process.stderr.write(`${code}\n`); process.exitCode = 1
})
