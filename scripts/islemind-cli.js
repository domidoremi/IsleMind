#!/usr/bin/env node

const { createServer } = require('node:http')
const { randomBytes } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { readFileSync, statSync } = require('node:fs')

const CLI_SCHEMA = 'islemind.cli.v0'
const CLI_DOCTOR_SCHEMA = 'islemind.cli-doctor.v0'
const CLI_SKILL_VALIDATION_SCHEMA = 'islemind.skill-validation.v0'
const CLI_GIT_COMMIT_PREVIEW_SCHEMA = 'islemind.git-commit-preview.v0'
const MCP_PROTOCOL_VERSION = '2025-03-26'
const MCP_SESSION_TTL_MS = 30 * 60 * 1000
const MCP_SESSION_LIMIT = 100
const MCP_REQUEST_MAX_BYTES = 64 * 1024
const SKILL_FILE_MAX_BYTES = 1024 * 1024

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  if (!args.length) return { ok: false, code: 'command_required' }
  if (args[0] === 'doctor' && args.length === 1) return { ok: true, command: 'doctor' }
  if (args[0] === 'skill' && args[1] === 'validate') return parseSkillValidateArgs(args.slice(2))
  if (args[0] === 'mcp' && args[1] === 'serve') return parseMcpServeArgs(args.slice(2))
  if (args[0] === 'git' && args[1] === 'commit-preview' && args.length === 2) return { ok: true, command: 'git-commit-preview' }
  return { ok: false, code: 'command_unavailable' }
}

function parseSkillValidateArgs(args) {
  if (args.length !== 2 || args[0] !== '--path' || !isSafeFileArgument(args[1])) return { ok: false, code: 'invalid_skill_validate_input' }
  return { ok: true, command: 'skill-validate', path: args[1] }
}

function parseMcpServeArgs(args) {
  let transport
  let host = '127.0.0.1'
  let port = 8765
  const seenFlags = new Set()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (typeof value !== 'string' || seenFlags.has(flag)) return { ok: false, code: 'invalid_mcp_serve_input' }
    seenFlags.add(flag)
    if (flag === '--transport') transport = value
    else if (flag === '--host') host = value
    else if (flag === '--port') port = Number(value)
    else return { ok: false, code: 'invalid_mcp_serve_input' }
  }
  if (transport !== 'streamable-http' || !isAllowedMcpBindHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, code: 'invalid_mcp_serve_input' }
  }
  return { ok: true, command: 'mcp-serve', transport, host, port }
}

function isSafeFileArgument(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\0\r\n]/.test(value)
}

function isAllowedMcpBindHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '::'
}

function createDoctorReport(nodeVersion = process.versions.node) {
  const major = Number.parseInt(String(nodeVersion).split('.')[0], 10)
  const nodeReady = Number.isInteger(major) && major >= 20
  return {
    schema: CLI_DOCTOR_SCHEMA,
    status: nodeReady ? 'ready' : 'blocked',
    node: {
      major: Number.isInteger(major) ? major : 0,
      minimumMajor: 20,
      ready: nodeReady,
    },
    commands: {
      skillValidate: true,
      mcpServeStreamableHttp: true,
      gitCommitPreview: true,
    },
  }
}

function validateSkillFile(path, dependencies = {}) {
  if (!isSafeFileArgument(path)) return { schema: CLI_SKILL_VALIDATION_SCHEMA, ok: false, code: 'invalid_input' }
  try {
    const stat = dependencies.stat ?? statSync
    const read = dependencies.read ?? readFileSync
    const metadata = stat(path)
    if (!metadata.isFile() || metadata.size > SKILL_FILE_MAX_BYTES) return { schema: CLI_SKILL_VALIDATION_SCHEMA, ok: false, code: 'file_rejected' }
    const parsed = JSON.parse(read(path, 'utf8'))
    const skill = resolvePortableSkill(parsed)
    if (!skill) return { schema: CLI_SKILL_VALIDATION_SCHEMA, ok: false, code: 'schema_mismatch' }
    const variableCount = Array.isArray(skill.variables) ? skill.variables.filter(isSafeSkillVariable).length : 0
    return {
      schema: CLI_SKILL_VALIDATION_SCHEMA,
      ok: true,
      skillSchema: typeof parsed.schema === 'string' ? parsed.schema : 'islemind.skill.v1',
      variableCount: Math.min(variableCount, 24),
      hasSystemPrompt: typeof skill.systemPrompt === 'string' && skill.systemPrompt.length > 0,
    }
  } catch {
    return { schema: CLI_SKILL_VALIDATION_SCHEMA, ok: false, code: 'file_unavailable' }
  }
}

function resolvePortableSkill(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const envelope = value
  if (envelope.schema === 'islemind.skill.portable.v2') {
    if (!envelope.skill || typeof envelope.skill !== 'object' || Array.isArray(envelope.skill)) return undefined
    return envelope.skill
  }
  return envelope
}

function isSafeSkillVariable(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(value.name)
}

function createGitCommitPreview(run = execFileSync, cwd = process.cwd()) {
  try {
    const statusOutput = String(run('git', ['status', '--porcelain=v1', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024, windowsHide: true }))
    const numstatOutput = String(run('git', ['diff', '--cached', '--numstat', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024, windowsHide: true }))
    const statuses = statusOutput.split('\0').filter((entry) => /^[ MADRCU?!]{2} /.test(entry)).map((entry) => entry.slice(0, 2))
    const numstats = numstatOutput.split('\0').map((entry) => entry.split('\t')).filter((entry) => entry.length >= 2)
    return {
      schema: CLI_GIT_COMMIT_PREVIEW_SCHEMA,
      ok: true,
      clean: statuses.length === 0,
      changedFileCount: statuses.length,
      stagedFileCount: statuses.filter((status) => status !== '??' && status[0] !== ' ').length,
      unstagedFileCount: statuses.filter((status) => status !== '??' && status[1] !== ' ').length,
      untrackedFileCount: statuses.filter((status) => status === '??').length,
      stagedAddedLines: numstats.reduce((sum, entry) => sum + safeNumstatCount(entry[0]), 0),
      stagedDeletedLines: numstats.reduce((sum, entry) => sum + safeNumstatCount(entry[1]), 0),
    }
  } catch {
    return { schema: CLI_GIT_COMMIT_PREVIEW_SCHEMA, ok: false, code: 'git_unavailable' }
  }
}

function safeNumstatCount(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function createMcpGatewayProtocol(now = () => Date.now()) {
  const sessions = new Map()
  const pruneSessions = () => {
    const current = now()
    for (const [id, expiresAt] of sessions) {
      if (expiresAt <= current) sessions.delete(id)
    }
    while (sessions.size > MCP_SESSION_LIMIT) sessions.delete(sessions.keys().next().value)
  }
  const isSessionValid = (sessionId) => {
    pruneSessions()
    return typeof sessionId === 'string' && /^[a-f0-9]{32,64}$/.test(sessionId) && (sessions.get(sessionId) ?? 0) > now()
  }
  const issueSession = () => {
    pruneSessions()
    const id = randomBytes(24).toString('hex')
    sessions.set(id, now() + MCP_SESSION_TTL_MS)
    return id
  }
  const handle = (message, sessionId) => {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return mcpErrorResponse(null, -32600, 'Invalid request.', 400)
    }
    const id = safeMcpRequestId(message.id)
    if (message.method === 'initialize') {
      const nextSession = issueSession()
      return {
        status: 200,
        headers: { 'Mcp-Session-Id': nextSession },
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'islemind-cli', version: '0.1.0' },
          },
        },
      }
    }
    if (!isSessionValid(sessionId)) return mcpErrorResponse(id, -32001, 'Session is unavailable.', 404)
    if (message.method === 'notifications/initialized') return { status: 202, headers: {}, body: undefined }
    if (message.method === 'tools/list') {
      return mcpResultResponse(id, {
        tools: [{
          name: 'islemind_doctor',
          description: 'Return a bounded IsleMind CLI runtime health report.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }],
      })
    }
    if (message.method === 'resources/list') return mcpResultResponse(id, { resources: [] })
    if (message.method === 'prompts/list') return mcpResultResponse(id, { prompts: [] })
    if (message.method === 'tools/call') {
      const name = message.params && typeof message.params === 'object' ? message.params.name : undefined
      if (name !== 'islemind_doctor') return mcpErrorResponse(id, -32602, 'Unknown tool.', 400)
      return mcpResultResponse(id, { content: [{ type: 'text', text: JSON.stringify(createDoctorReport()) }] })
    }
    return mcpErrorResponse(id, -32601, 'Method not found.', 404)
  }
  return { handle }
}

function safeMcpRequestId(value) {
  return typeof value === 'string' || typeof value === 'number' || value === null ? value : null
}

function mcpResultResponse(id, result) {
  return { status: 200, headers: {}, body: { jsonrpc: '2.0', id, result } }
}

function mcpErrorResponse(id, code, message, status) {
  return { status, headers: {}, body: { jsonrpc: '2.0', id, error: { code, message } } }
}

function startMcpGateway(options, write = writeJson) {
  const protocol = createMcpGatewayProtocol()
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    const body = await readMcpRequestBody(request)
    const result = body.ok
      ? protocol.handle(body.value, request.headers['mcp-session-id'])
      : mcpErrorResponse(null, -32600, 'Invalid request.', 400)
    response.writeHead(result.status, { 'Content-Type': 'application/json', ...result.headers })
    response.end(result.body === undefined ? undefined : JSON.stringify(result.body))
  })
  server.listen(options.port, options.host, () => {
    write({
      schema: 'islemind.mcp-gateway.v0',
      status: 'ready',
      transport: 'streamable-http',
      endpoint: `http://${formatMcpHost(options.host)}:${options.port}/mcp`,
    })
  })
  return server
}

function readMcpRequestBody(request) {
  return new Promise((resolve) => {
    let bytes = 0
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes <= MCP_REQUEST_MAX_BYTES) text += chunk
    })
    request.on('end', () => {
      if (bytes > MCP_REQUEST_MAX_BYTES) return resolve({ ok: false })
      try {
        return resolve({ ok: true, value: JSON.parse(text) })
      } catch {
        return resolve({ ok: false })
      }
    })
    request.on('error', () => resolve({ ok: false }))
  })
}

function formatMcpHost(host) {
  return host.includes(':') ? `[${host}]` : host
}

async function runCli(argv = process.argv.slice(2), write = writeJson) {
  const parsed = parseCliArgs(argv)
  if (!parsed.ok) {
    write({ schema: CLI_SCHEMA, ok: false, code: parsed.code })
    return 2
  }
  if (parsed.command === 'doctor') {
    write(createDoctorReport())
    return 0
  }
  if (parsed.command === 'skill-validate') {
    const report = validateSkillFile(parsed.path)
    write(report)
    return report.ok ? 0 : 1
  }
  if (parsed.command === 'git-commit-preview') {
    const preview = createGitCommitPreview()
    write(preview)
    return preview.ok ? 0 : 1
  }
  startMcpGateway(parsed, write)
  return 0
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (require.main === module) {
  runCli().then((exitCode) => {
    if (exitCode) process.exitCode = exitCode
  }).catch(() => {
    writeJson({ schema: CLI_SCHEMA, ok: false, code: 'internal_error' })
    process.exitCode = 1
  })
}

module.exports = {
  CLI_DOCTOR_SCHEMA,
  CLI_GIT_COMMIT_PREVIEW_SCHEMA,
  CLI_SCHEMA,
  CLI_SKILL_VALIDATION_SCHEMA,
  createDoctorReport,
  createGitCommitPreview,
  createMcpGatewayProtocol,
  parseCliArgs,
  runCli,
  validateSkillFile,
}
