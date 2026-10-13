const http = require('node:http')
const { openStore, validateReport, ReportError } = require('./store.cjs')

const BODY_LIMIT = 32 * 1024
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid reporting service integer configuration')
  return Number(value)
}
function configuration(env) {
  const origins = (env.REPORT_WEB_ORIGINS || '').split(',').filter(Boolean)
  if (origins.some(origin => {
    try { const u = new URL(origin); return u.protocol !== 'https:' || u.origin !== origin || !!u.username || !!u.password }
    catch { return true }
  })) throw new Error('REPORT_WEB_ORIGINS must be exact HTTPS origins')
  return {
    port: integer(env.PORT, 8787, 1, 65535), host: env.HOST || '127.0.0.1',
    filename: env.REPORT_DB_PATH || '/data/reports.sqlite', origins,
    maxReports: integer(env.REPORT_MAX_RECORDS, 10_000, 1, 100_000),
    maxSubmissionsPerHour: integer(env.REPORT_MAX_NEW_PER_HOUR, 500, 1, 10_000),
    requestsPerMinute: integer(env.REPORT_REQUESTS_PER_MINUTE, 120, 1, 10_000),
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], length = 0
    const timer = setTimeout(() => finish(new ReportError(408, 'request_timeout')), 5000)
    const fail = () => finish(new ReportError(400, 'incomplete_request'))
    const data = chunk => {
      length += chunk.length
      if (length > BODY_LIMIT) finish(new ReportError(413, 'body_too_large'))
      else chunks.push(chunk)
    }
    const end = () => {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) }
      catch { finish(new ReportError(400, 'invalid_json')) }
    }
    function finish(error, value) {
      clearTimeout(timer)
      req.off('data', data); req.off('end', end); req.off('aborted', fail); req.off('error', fail)
      chunks = []
      if (error) { req.resume(); reject(error) } else resolve(value)
    }
    req.on('data', data); req.on('end', end); req.on('aborted', fail); req.on('error', fail)
  })
}
function createService(config, { now = Date.now, onEvent = () => {} } = {}) {
  const store = openStore(config.filename, { ...config, now })
  let windowStart = now(), requests = 0
  const server = http.createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10_000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    const reply = (status, value, headers = {}) => {
      const body = status === 204 ? '' : JSON.stringify(value)
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body), Connection: 'close', ...headers })
      res.end(body)
    }
    try {
      // No administration, report lookups, credentials, redirects or policy placeholders on HTTP.
      if (req.url === '/healthz' && req.method === 'GET') { store.health(); reply(200, { status: 'ok' }); return }
      if (req.url !== '/v1/reports') { reply(404, { error: 'not_found' }); return }
      if (now() - windowStart >= 60_000) { windowStart = now(); requests = 0 }
      if (++requests > config.requestsPerMinute) throw new ReportError(429, 'rate_limited')
      const origin = req.headers.origin
      if (origin !== undefined && !config.origins.includes(origin)) throw new ReportError(403, 'origin_denied')
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
      if (req.method === 'OPTIONS') {
        const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
        if (!origin || req.headers['access-control-request-method'] !== 'POST'
          || headers.some(value => !['content-type', 'idempotency-key', 'accept'].includes(value))) throw new ReportError(403, 'preflight_denied')
        reply(204, '', { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Accept' }); return
      }
      if (req.method !== 'POST') { reply(405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' }); return }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')
        || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw new ReportError(415, 'unsupported_media_type')
      if (req.headers.authorization || req.headers.cookie) throw new ReportError(400, 'unexpected_credentials')
      if (Number(req.headers['content-length']) > BODY_LIMIT) throw new ReportError(413, 'body_too_large')
      const report = validateReport(await readBody(req), req.headers['idempotency-key'])
      const created = store.receive(report)
      // FULL-synchronous transaction has committed before acknowledging success.
      reply(created ? 201 : 200, { reportId: report.reportId, status: 'received' })
    } catch (error) {
      const known = error instanceof ReportError
      // Never log raw exceptions, requests, IPs, identifiers or report content.
      if (!known || error.status === 503) onEvent('storage_unavailable')
      reply(known ? error.status : 503, { error: known ? error.code : 'temporarily_unavailable' },
        { ...((known && error.status === 429) ? { 'Retry-After': '60' } : {}) })
    }
  })
  server.maxConnections = 128
  server.keepAliveTimeout = 1000
  server.on('close', () => store.close())
  return { server, store }
}
if (require.main === module) {
  process.umask(0o077)
  try {
    const config = configuration(process.env)
    const { server } = createService(config, { onEvent: code => process.stderr.write(`${code}\n`) })
    server.on('error', () => { process.stderr.write('report_service_unavailable\n'); process.exit(1) })
    server.listen(config.port, config.host, () => process.stdout.write('report_service_ready\n'))
    const stop = () => { server.close(); server.closeAllConnections() }
    process.once('SIGTERM', stop); process.once('SIGINT', stop)
  } catch { process.stderr.write('report_service_start_failed\n'); process.exitCode = 1 }
}
module.exports = { configuration, createService }
