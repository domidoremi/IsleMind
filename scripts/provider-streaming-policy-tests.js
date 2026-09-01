const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')

registerTypeScriptSupport()

const { resolveProviderStreamingPolicy } = require('../src/modules/providers/providerStreamingPolicy.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderStreamingPolicyHook) return
  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isProviderStreamingPolicyHook = true
  require.extensions['.ts'] = hook
}

function run() {
  assert.deepEqual(
    resolveProviderStreamingPolicy({ provider: {}, requested: true, modelSupportsStreaming: true }),
    { stream: true, reason: 'enabled' },
    'streaming remains enabled when request, provider, and model permit it',
  )
  assert.deepEqual(
    resolveProviderStreamingPolicy({ provider: {}, requested: false, modelSupportsStreaming: true }),
    { stream: false, reason: 'request-disabled' },
    'caller can deliberately select non-streaming mode',
  )
  assert.deepEqual(
    resolveProviderStreamingPolicy({ provider: { capabilities: { streaming: false } }, requested: true, modelSupportsStreaming: true }),
    { stream: false, reason: 'provider-disabled' },
    'provider capability opt-out overrides the default streaming request',
  )
  assert.deepEqual(
    resolveProviderStreamingPolicy({ provider: {}, requested: true, modelSupportsStreaming: false }),
    { stream: false, reason: 'model-disabled' },
    'model metadata opt-out overrides the default streaming request',
  )
  assert.deepEqual(
    resolveProviderStreamingPolicy({ provider: { capabilities: { streaming: false } }, requested: false, modelSupportsStreaming: false }),
    { stream: false, reason: 'request-disabled' },
    'explicit request opt-out takes precedence over provider and model opt-outs',
  )
  assert.deepEqual(
    resolveProviderStreamingPolicy({ provider: { capabilities: { streaming: false } }, requested: true, modelSupportsStreaming: false }),
    { stream: false, reason: 'provider-disabled' },
    'provider opt-out takes precedence over model opt-out',
  )

  const pipelineSource = fs.readFileSync(path.join(root, 'src/bootstrap/providerRuntimePipeline.ts'), 'utf8')
  assert.ok(pipelineSource.includes("from '@/modules/providers'"), 'runtime pipeline imports the target streaming policy through the provider public API')
  assert.ok(pipelineSource.includes('const stream = streamingPolicy.stream'), 'runtime pipeline uses the shared effective streaming decision before route assembly')

  const matrixSource = fs.readFileSync(path.join(root, 'src/modules/providers/providerParameterMatrixPolicy.ts'), 'utf8')
  assert.ok(matrixSource.includes("capability: 'streaming'"), 'provider parameter matrix exposes a streaming capability row')
  assert.ok(matrixSource.includes('resolveProviderStreamingPolicy'), 'provider parameter matrix shares runtime streaming gates')
  assert.ok(matrixSource.includes("from './providerStreamingPolicy'"), 'same-owner parameter matrix imports the target streaming policy without crossing a module boundary')
  assert.equal(fs.existsSync(path.join(root, 'src/services/ai/providerStreamingPolicy.ts')), false, 'legacy provider streaming-policy service is deleted')

  console.log('Provider streaming policy tests passed')
}

if (require.main === module) run()

module.exports = { run }
