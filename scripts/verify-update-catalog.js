const fs = require('node:fs')
const { TextDecoder } = require('node:util')
const { loadUpdateDeliveryContract } = require('./load-update-delivery-contracts')
const { verifyEd25519CatalogSignature } = require('./update-catalog-crypto')

const { verifySignedUpdateCatalog, parseUpdateCatalogCheckpoint } = loadUpdateDeliveryContract('src/core/signedUpdateCatalog.ts')

function readBoundedText(filename) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) throw new Error('Verification inputs must be bounded regular files.')
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(filename))
}
function readBoundedJson(filename) {
  return JSON.parse(readBoundedText(filename))
}

async function runVerifyUpdateCatalog(args, fixedNowMs) {
  const readNowMs = fixedNowMs === undefined ? () => Date.now() : () => fixedNowMs
  const nowMs = readNowMs()
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    if (!['--catalog', '--trust', '--checkpoint'].includes(name) || !args[index + 1]
      || Object.hasOwn(options, name)) throw new Error('Use --catalog FILE --trust FILE [--checkpoint FILE].')
    options[name] = args[index + 1]
  }
  if (!options['--catalog'] || !options['--trust']) throw new Error('A signed catalog and independently pinned trust file are required.')
  const input = readBoundedJson(options['--trust'])
  if (Object.keys(input).sort().join(',') !== 'channel,keys,minimumSequence,repository,schema'
    || input.schema !== 'islemind.update-catalog-trust.v1') throw new Error('Unsupported pinned trust file.')
  const previous = options['--checkpoint'] ? parseUpdateCatalogCheckpoint(readBoundedJson(options['--checkpoint'])) : undefined
  const verified = await verifySignedUpdateCatalog(readBoundedText(options['--catalog']), {
    repository: input.repository, channel: input.channel, minimumSequence: input.minimumSequence,
    keys: input.keys, nowMs, previous,
  }, verifyEd25519CatalogSignature, { readNowMs })
  return {
    schema: 'islemind.update-catalog-verification.v1',
    metadataVerified: true, applied: false, checkpointPersisted: false,
    keyId: verified.keyId, proposedCheckpoint: verified.checkpoint,
    expectedPrevious: verified.expectedPrevious ?? null,
    releases: verified.catalog.releases.length, changes: verified.catalog.changes.length,
    artifacts: verified.catalog.artifacts.length,
  }
}

if (require.main === module) {
  runVerifyUpdateCatalog(process.argv.slice(2)).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }).catch((error) => {
    console.error(`Catalog verification refused: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { runVerifyUpdateCatalog }
