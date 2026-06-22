const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const providerCompatibilityLiveSmokePlanSchema = 'islemind.provider-compatibility-live-smoke-plan.v1'
const defaultOutputPath = 'test-evidence/qa/provider-compatibility-live-smoke-plan.json'

registerTypeScriptSupport()

const {
  PROVIDER_COMPATIBILITY_EVIDENCE,
  resolveProviderCompatibilityLiveSmokeStatus,
} = require('../src/services/ai/providerCompatibilityContract.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderCompatibilityLiveSmokePlanHook) return
  const previousTsHook = require.extensions['.ts']
  const hook = function compileTypeScript(module, filename) {
    if (previousTsHook && !filename.startsWith(path.join(root, 'src'))) {
      return previousTsHook(module, filename)
    }
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isProviderCompatibilityLiveSmokePlanHook = true
  require.extensions['.ts'] = hook
}

function collectProviderCompatibilityLiveSmokePlan(options = {}) {
  const env = options.env ?? process.env
  const providerIds = options.providerIds?.length
    ? options.providerIds
    : Object.keys(PROVIDER_COMPATIBILITY_EVIDENCE)
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const providers = providerIds.map((providerId) => {
    const evidence = PROVIDER_COMPATIBILITY_EVIDENCE[providerId]
    if (!evidence) throw new Error(`Unknown provider compatibility evidence id: ${providerId}`)
    const gates = resolveProviderCompatibilityLiveSmokeStatus(providerId, env).map((status) => ({
      id: status.gate.id,
      kind: status.gate.kind,
      status: status.ready ? 'ready' : 'skipped',
      requiredEnv: [...status.gate.requiredEnv],
      missingEnv: [...status.missingEnv],
      validates: [...status.gate.validates],
      skipReason: status.ready ? null : status.gate.skippedWithout,
    }))
    return {
      providerId,
      auditState: evidence.auditState,
      gates,
    }
  }).filter((provider) => provider.gates.length > 0)

  return {
    schema: providerCompatibilityLiveSmokePlanSchema,
    generatedAt,
    mode: 'plan-only',
    summary: summarizeProviderCompatibilityLiveSmokePlan(providers),
    providers,
  }
}

function summarizeProviderCompatibilityLiveSmokePlan(providers) {
  const gates = providers.flatMap((provider) => provider.gates)
  const missingEnv = [...new Set(gates.flatMap((gate) => gate.missingEnv))].sort()
  return {
    providerCount: providers.length,
    gateCount: gates.length,
    readyGateCount: gates.filter((gate) => gate.status === 'ready').length,
    skippedGateCount: gates.filter((gate) => gate.status === 'skipped').length,
    missingEnv,
  }
}

function writeProviderCompatibilityLiveSmokePlan(plan, outputPath = defaultOutputPath) {
  const resolved = path.isAbsolute(outputPath) ? outputPath : path.join(root, outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  return resolved
}

function formatProviderCompatibilityLiveSmokePlanSummary(plan) {
  const lines = [
    `${plan.schema}`,
    `generatedAt=${plan.generatedAt}`,
    `mode=${plan.mode}`,
    `providers=${plan.summary.providerCount}`,
    `gates=${plan.summary.gateCount}`,
    `ready=${plan.summary.readyGateCount}`,
    `skipped=${plan.summary.skippedGateCount}`,
  ]
  for (const provider of plan.providers) {
    const states = provider.gates.map((gate) => `${gate.id}:${gate.status}`).join(', ')
    lines.push(`${provider.providerId} ${provider.auditState} ${states}`)
  }
  return lines.join('\n')
}

function runSelfTest() {
  const emptyPlan = collectProviderCompatibilityLiveSmokePlan({ env: {}, generatedAt: '2026-06-21T00:00:00.000Z' })
  assert.equal(emptyPlan.schema, providerCompatibilityLiveSmokePlanSchema, 'live smoke plan uses the expected schema')
  assert.ok(emptyPlan.summary.gateCount > 0, 'live smoke plan includes contract gates')
  assert.equal(emptyPlan.summary.readyGateCount, 0, 'empty env keeps every live smoke gate skipped')
  assert.ok(emptyPlan.summary.missingEnv.includes('ISLEMIND_SUB2API_BASE_URL'), 'plan records missing Sub2API env without a value')
  assert.ok(emptyPlan.providers.some((provider) => provider.providerId === 'aws-bedrock'), 'plan includes hosted providers with live gates')
  assert.ok(emptyPlan.providers.some((provider) => provider.providerId === 'ollama'), 'plan includes local runtime providers with live gates')
  assert.doesNotMatch(JSON.stringify(emptyPlan), /secret-value|AKIDEXAMPLE|ya29\.example/, 'plan does not serialize env values')

  const readyBedrockPlan = collectProviderCompatibilityLiveSmokePlan({
    env: {
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret-value',
      AWS_REGION: 'us-east-1',
      ISLEMIND_AWS_BEDROCK_RUNTIME_MODEL: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    },
    providerIds: ['aws-bedrock'],
    generatedAt: '2026-06-21T00:00:00.000Z',
  })
  const runtimeGate = readyBedrockPlan.providers[0].gates.find((gate) => gate.id === 'aws-bedrock-runtime-invoke')
  assert.equal(runtimeGate?.status, 'ready', 'Bedrock Runtime gate becomes ready with SigV4 env')
  assert.ok(
    readyBedrockPlan.providers[0].gates.some((gate) => gate.id === 'aws-bedrock-mantle-chat' && gate.status === 'skipped'),
    'Bedrock Mantle stays skipped when only Runtime env is present'
  )
  assert.doesNotMatch(JSON.stringify(readyBedrockPlan), /secret-value|AKIDEXAMPLE/, 'ready plan still omits credential values')

  const sub2apiPlan = collectProviderCompatibilityLiveSmokePlan({
    env: {
      ISLEMIND_SUB2API_BASE_URL: ' ',
      ISLEMIND_SUB2API_API_KEY: 'sub2api-secret',
      ISLEMIND_SUB2API_MODEL: 'supplier/gpt-5.2',
    },
    providerIds: ['sub2api'],
    generatedAt: '2026-06-21T00:00:00.000Z',
  })
  assert.deepEqual(sub2apiPlan.providers[0].gates[0].missingEnv, ['ISLEMIND_SUB2API_BASE_URL'], 'blank env is missing')
  assert.doesNotMatch(JSON.stringify(sub2apiPlan), /sub2api-secret/, 'Sub2API API key value is not serialized')

  const summary = formatProviderCompatibilityLiveSmokePlanSummary(emptyPlan)
  assert.match(summary, /islemind\.provider-compatibility-live-smoke-plan\.v1/, 'summary includes schema')
  assert.match(summary, /skipped=/, 'summary includes skipped count')
  console.log(`Provider compatibility live smoke plan self-test passed (${emptyPlan.summary.gateCount} gates).`)
}

function parseArgs(argv) {
  const options = { providerIds: [], outputPath: defaultOutputPath, format: 'summary', selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') {
      options.selfTest = true
    } else if (arg === '--json') {
      options.format = 'json'
    } else if (arg === '--summary') {
      options.format = 'summary'
    } else if (arg === '--provider') {
      const value = argv[index + 1]
      if (!value) throw new Error('--provider requires a provider id')
      options.providerIds.push(value)
      index += 1
    } else if (arg === '--output') {
      const value = argv[index + 1]
      if (!value) throw new Error('--output requires a path')
      options.outputPath = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) {
    runSelfTest()
    return
  }
  const plan = collectProviderCompatibilityLiveSmokePlan({ providerIds: options.providerIds })
  const output = writeProviderCompatibilityLiveSmokePlan(plan, options.outputPath)
  if (options.format === 'json') {
    console.log(JSON.stringify({ output: path.relative(root, output).replace(/\\/g, '/'), ...plan }, null, 2))
  } else {
    console.log(formatProviderCompatibilityLiveSmokePlanSummary(plan))
    console.log(`output=${path.relative(root, output).replace(/\\/g, '/')}`)
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error?.message ?? error)
    process.exitCode = 1
  }
}

module.exports = {
  providerCompatibilityLiveSmokePlanSchema,
  defaultOutputPath,
  collectProviderCompatibilityLiveSmokePlan,
  formatProviderCompatibilityLiveSmokePlanSummary,
  summarizeProviderCompatibilityLiveSmokePlan,
  writeProviderCompatibilityLiveSmokePlan,
  runSelfTest,
}
