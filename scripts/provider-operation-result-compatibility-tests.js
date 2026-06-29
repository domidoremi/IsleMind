const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load

registerTypeScriptSupport()

const {
  PROVIDER_OPERATION_RESULT_SCHEMA,
  ProviderHttpError,
  classifyHttpStatus,
  extractProviderErrorDetail,
  failure,
  formatProviderHttpError,
  providerFetchFailure,
  success,
} = require('../src/services/ai/providerOperationResult.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderOperationResultCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === '@/i18n/service') {
      return {
        st: (key, values = {}) => `${key}${Object.keys(values).length ? ` ${JSON.stringify(values)}` : ''}`,
      }
    }
    if (request === '@/utils/traceSafety') {
      return {
        redactSensitiveText: (value) => String(value)
          .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
          .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
          .replace(/api[_-]?key\s*[:=]\s*[^,\s}]+/gi, 'api_key=[redacted]'),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const hook = function compileTypeScript(module, filename) {
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
  hook.isProviderOperationResultCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertNoSecret(value, label) {
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes('sk-secret-provider'), false, `${label} omits provider API keys`)
  assert.equal(serialized.includes('Bearer secret-provider'), false, `${label} omits bearer tokens`)
  assert.equal(serialized.includes('api_key=secret-provider'), false, `${label} omits api_key assignments`)
}

function run() {
  assert.equal(PROVIDER_OPERATION_RESULT_SCHEMA, 'islemind.provider-operation-result.v1', 'provider operation result schema is versioned')
  assert.deepEqual(success('ok', { value: 1 }, 'group-a'), { ok: true, code: 'ok', message: 'ok', data: { value: 1 }, credentialGroupId: 'group-a' }, 'success helper keeps public result shape')
  assert.deepEqual(failure('bad_auth', 'bad key', undefined, 'group-b'), { ok: false, code: 'bad_auth', message: 'bad key', data: undefined, credentialGroupId: 'group-b' }, 'failure helper keeps public result shape')

  const statusCases = [
    [401, 'invalid api key', '', undefined, 'bad_auth'],
    [403, 'permission denied', '', undefined, 'bad_auth'],
    [408, '', '', undefined, 'timeout'],
    [504, '', '', undefined, 'timeout'],
    [429, 'quota exceeded', '', undefined, 'rate_limited'],
    [404, 'missing model', 'model-a', undefined, 'model_unavailable'],
    [404, 'missing endpoint', '', undefined, 'models_endpoint_unavailable'],
    [400, 'model does not exist', '', undefined, 'model_unavailable'],
    [400, 'invalid base url', '', { type: 'openai-compatible' }, 'bad_base_url'],
    [400, 'bad request', '', { type: 'xiaomi-mimo' }, 'unknown'],
    [500, 'upstream failed', '', undefined, 'network_error'],
    [422, 'maximum context length exceeded', '', undefined, 'max_tokens_exceeded'],
  ]
  for (const [status, text, model, provider, code] of statusCases) {
    assert.equal(classifyHttpStatus(status, text, model, provider), code, `HTTP ${status} maps to ${code}`)
  }
  assert.equal(classifyHttpStatus(503, 'model_not_found: no available channel'), 'model_unavailable', 'relay model-not-found channel failures map to model unavailable')
  assert.equal(classifyHttpStatus(400, 'too many tokens'), 'max_tokens_exceeded', 'token-limit messages map to max token errors')

  const jsonDetail = extractProviderErrorDetail(JSON.stringify({
    error: {
      type: 'invalid_request_error',
      message: 'bad request with sk-secret-provider and Bearer secret-provider',
      request_id: 'req_123',
    },
  }))
  assert.ok(jsonDetail.includes('invalid_request_error'), 'JSON error details preserve error type')
  assert.ok(jsonDetail.includes('req_123'), 'JSON error details preserve request id')
  assertNoSecret(jsonDetail, 'JSON error detail')

  const plainDetail = extractProviderErrorDetail('plain upstream error api_key=secret-provider request_id=req_plain_1')
  assert.ok(plainDetail.includes('req_plain_1'), 'plain error details preserve request id')
  assertNoSecret(plainDetail, 'plain error detail')
  assert.equal(extractProviderErrorDetail('<html>bad gateway</html>').includes('providerOperation.http.htmlResponse'), true, 'HTML error responses are summarized')

  assert.equal(providerFetchFailure(new ProviderHttpError(429, 'quota exceeded'), 'group-c').code, 'rate_limited', 'HTTP fetch failure maps through status classifier')
  assert.equal(providerFetchFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })).code, 'timeout', 'AbortError maps to timeout')
  assert.equal(providerFetchFailure(new Error('Network request failed')).code, 'network_error', 'network failures map to network_error')
  const unknownFailure = providerFetchFailure(new Error('failed with sk-secret-provider'))
  assert.equal(unknownFailure.code, 'unknown', 'unknown errors keep unknown code')
  assertNoSecret(unknownFailure, 'unknown fetch failure')

  const formatted = formatProviderHttpError(500, JSON.stringify({ error: { message: 'failed with sk-secret-provider', request_id: 'req_500' } }), { name: 'Provider A' }, 'model-a')
  assert.ok(formatted.includes('req_500'), 'formatted HTTP errors preserve request ids')
  assertNoSecret(formatted, 'formatted HTTP error')

  const source = readSource('src/services/ai/providerOperationResult.ts')
  assert.ok(source.includes('PROVIDER_OPERATION_RESULT_SCHEMA'), 'provider operation result source declares the schema')
  assert.ok(source.includes('redactSensitiveText'), 'provider operation result source redacts error details')
  assert.ok(source.includes('looksLikeModelUnavailable'), 'provider operation result source centralizes model-unavailable text classification')
  assert.ok(source.includes('findRequestId'), 'provider operation result source extracts request ids')

  console.log('Provider operation result compatibility tests passed')
}

if (require.main === module) {
  try {
    run()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

module.exports = { run }
