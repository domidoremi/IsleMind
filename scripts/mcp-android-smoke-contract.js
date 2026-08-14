const fs = require('node:fs')
const path = require('node:path')

const mcpAndroidSmokeSchema = 'islemind.settings-mcp-android-smoke-result.v1'
const requiredMcpOfflineChecks = ['keyboard-open-input', 'server-added', 'offline-sync-failure-visible']
const requiredMcpMethods = ['initialize', 'notifications/initialized', 'resources/list', 'prompts/list', 'tools/list']
const requiredBuiltInCaptureKeys = ['png', 'uia']
const requiredOfflineCapturePairs = [
  ['keyboardPng', 'keyboardUia'],
  ['addedPng', 'addedUia'],
  ['offlinePng', 'offlineUia'],
  ['deleteConfirmPng', 'deleteConfirmUia'],
  ['deletedPng', 'deletedUia'],
]
const requiredOnlineCapturePairs = [
  ['keyboardPng', 'keyboardUia'],
  ['addedPng', 'addedUia'],
  ['syncPng', 'syncUia'],
  ['togglePng', 'toggleUia'],
  ['deleteConfirmPng', 'deleteConfirmUia'],
  ['deletedPng', 'deletedUia'],
]

function validateMcpAndroidSmokeResult(result, options = {}) {
  const issues = []
  const validatePath = options.validatePath ?? ((value) => validateRepositoryPath(options.root ?? path.resolve(__dirname, '..'), value))
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['MCP Android smoke result must be an object.']
  if (result.schema !== mcpAndroidSmokeSchema) issues.push(`MCP Android smoke result schema must be ${mcpAndroidSmokeSchema}.`)
  if (typeof result.runToken !== 'string' || !/^[A-Z0-9]{4,32}$/.test(result.runToken)) issues.push('MCP Android smoke result must record a valid runToken.')
  if (!isIsoDate(result.generatedAt)) issues.push('MCP Android smoke result generatedAt must be an ISO timestamp.')
  if (typeof result.device !== 'string' || !result.device.trim()) issues.push('MCP Android smoke result must record a device.')
  if (!Array.isArray(result.errors)) issues.push('MCP Android smoke result errors must be an array.')
  else if (result.errors.length) issues.push(`MCP Android smoke recorded ${result.errors.length} error(s).`)

  const builtIn = result.builtInServer
  if (!builtIn || typeof builtIn !== 'object') {
    issues.push('MCP built-in server evidence is missing.')
  } else {
    if (!['已连接', 'Connected'].includes(builtIn.status)) issues.push('MCP built-in server status is not connected.')
    issues.push(...validateCapturePairs(builtIn, requiredBuiltInCaptureKeys.map((key) => [key, key]), 'MCP built-in', validatePath))
  }

  const offline = result.offlineServer
  if (!offline || typeof offline !== 'object') {
    issues.push('MCP offline server evidence is missing.')
  } else {
    if (typeof offline.name !== 'string' || !offline.name.trim()) issues.push('MCP offline server name is missing.')
    if (typeof offline.url !== 'string' || !/\/mcp$/.test(offline.url)) issues.push('MCP offline server URL must end in /mcp.')
    const checks = Array.isArray(offline.checks) ? offline.checks : []
    const checkNames = checks.map((check) => check?.name)
    if (checks.length !== requiredMcpOfflineChecks.length || new Set(checkNames).size !== requiredMcpOfflineChecks.length || checkNames.some((name) => !requiredMcpOfflineChecks.includes(name))) {
      issues.push(`MCP offline checks must be exactly ${requiredMcpOfflineChecks.join(', ')}.`)
    }
    for (const name of requiredMcpOfflineChecks) {
      const check = checks.find((item) => item?.name === name)
      if (!check || check.status !== 'passed') issues.push(`MCP offline check ${name} must pass.`)
    }
    issues.push(...validateCapturePairs(offline.captures, requiredOfflineCapturePairs, 'MCP offline', validatePath))
    const evidenceByCheck = {
      'keyboard-open-input': offline.captures?.keyboardUia,
      'server-added': offline.captures?.addedUia,
      'offline-sync-failure-visible': offline.captures?.offlineUia,
    }
    for (const check of checks) {
      if (evidenceByCheck[check?.name] && check.evidence !== evidenceByCheck[check.name]) {
        issues.push(`MCP offline check ${check.name} evidence must reference its UIA capture.`)
      }
    }
    for (const [key, expected] of [
      ['syncTapped', true],
      ['deleteTapped', true],
      ['deleteConfirmVisible', true],
      ['deleteConfirmed', true],
      ['confirmed', true],
      ['deleted', true],
    ]) {
      if (offline.captures?.[key] !== expected) issues.push(`MCP offline capture must record ${key}=${expected}.`)
    }
  }

  const online = result.externalOnlineServer
  if (!online || typeof online !== 'object') {
    issues.push('MCP online server evidence is missing.')
  } else {
    if (online.status !== 'passed') issues.push('MCP online server status must be passed.')
    if (!Array.isArray(online.methods) || requiredMcpMethods.some((method) => !online.methods.includes(method))) {
      issues.push(`MCP online methods must include ${requiredMcpMethods.join(', ')}.`)
    }
    if (!online.emulatorUrl && !online.deviceUrl) issues.push('MCP online server endpoint is missing.')
    issues.push(...validateCapturePairs(online.captures, requiredOnlineCapturePairs, 'MCP online', validatePath))
    for (const [key, expected] of [
      ['syncTapped', true],
      ['syncSucceeded', true],
      ['toggleTapped', true],
      ['toggleSucceeded', true],
      ['deleteTapped', true],
      ['deleteConfirmVisible', true],
      ['deleteConfirmed', true],
      ['confirmed', true],
      ['deleted', true],
    ]) {
      if (online.captures?.[key] !== expected) issues.push(`MCP online capture must record ${key}=${expected}.`)
    }
  }

  const requestLogIssue = validatePath(result.requestLog)
  if (typeof result.requestLog !== 'string' || requestLogIssue) issues.push(`MCP request log is ${requestLogIssue ?? 'missing'}.`)
  return issues
}

function validateMcpOnlineRequestRows(rows, options = {}) {
  const issues = []
  const runToken = options.runToken
  if (!Array.isArray(rows) || !rows.length) return ['MCP request log must contain request rows.']
  if (typeof runToken !== 'string' || !runToken) issues.push('MCP request log validation requires the result runToken.')
  const methods = new Set()
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      issues.push(`MCP request row ${index + 1} is not an object.`)
      return
    }
    if (row.schema !== mcpAndroidSmokeSchema) issues.push(`MCP request row ${index + 1} schema is invalid.`)
    if (row.runToken !== runToken) issues.push(`MCP request row ${index + 1} runToken does not match the result.`)
    if (!isIsoDate(row.receivedAt)) issues.push(`MCP request row ${index + 1} timestamp is invalid.`)
    if (row.method !== 'POST') issues.push(`MCP request row ${index + 1} must be an HTTP POST.`)
    let endpoint
    try {
      endpoint = new URL(row.url)
    } catch {
      endpoint = null
    }
    if (!endpoint || endpoint.pathname !== '/mcp') issues.push(`MCP request row ${index + 1} endpoint must be /mcp.`)
    if (row.status !== 200) issues.push(`MCP request row ${index + 1} must record HTTP status 200.`)
    if (!row.payload || typeof row.payload !== 'object' || row.payload.parseError) {
      issues.push(`MCP request row ${index + 1} payload is invalid.`)
      return
    }
    if (row.payload.jsonrpc !== '2.0' || typeof row.payload.method !== 'string') issues.push(`MCP request row ${index + 1} JSON-RPC payload is invalid.`)
    if (!row.response || typeof row.response !== 'object' || row.response.jsonrpc !== '2.0' || !row.response.result || typeof row.response.result !== 'object') {
      issues.push(`MCP request row ${index + 1} JSON-RPC response is invalid.`)
      return
    }
    const method = row.payload.method
    methods.add(method)
    const responseResult = row.response.result
    if (method === 'initialize' && (typeof responseResult.protocolVersion !== 'string' || !responseResult.serverInfo || typeof responseResult.serverInfo.name !== 'string')) {
      issues.push('MCP initialize response shape is invalid.')
    }
    if (method === 'tools/list' && (!Array.isArray(responseResult.tools) || !responseResult.tools.some((tool) => tool?.name === 'qa_echo' && tool.inputSchema && typeof tool.inputSchema === 'object'))) {
      issues.push('MCP tools/list response does not contain qa_echo.')
    }
    if (method === 'resources/list' && (!Array.isArray(responseResult.resources) || !responseResult.resources.some((resource) => resource?.uri === 'qa://resource'))) {
      issues.push('MCP resources/list response does not contain qa://resource.')
    }
    if (method === 'prompts/list' && (!Array.isArray(responseResult.prompts) || !responseResult.prompts.some((prompt) => prompt?.name === 'qa_prompt'))) {
      issues.push('MCP prompts/list response does not contain qa_prompt.')
    }
  })
  for (const method of requiredMcpMethods) {
    if (!methods.has(method)) issues.push(`MCP request log is missing ${method}.`)
  }
  return issues
}

function validateCapturePairs(captures, pairs, label, validatePath) {
  const issues = []
  if (!captures || typeof captures !== 'object') return [`${label} captures are missing.`]
  for (const pair of pairs) {
    for (const key of pair) {
      const value = captures[key]
      const issue = validatePath(value)
      if (typeof value !== 'string' || issue || !value.toLowerCase().endsWith(key.toLowerCase().includes('uia') ? '.uia.xml' : '.png')) {
        issues.push(`${label} ${key} capture is ${issue ?? 'missing or has the wrong extension'}.`)
      }
    }
  }
  return issues
}

function validateRepositoryPath(root, value) {
  if (typeof value !== 'string' || !value.trim()) return 'missing'
  if (path.isAbsolute(value)) return 'not repository-relative'
  const resolved = path.resolve(root, value)
  const relative = path.relative(root, resolved).replace(/\\/g, '/')
  if (relative.startsWith('..') || path.isAbsolute(path.relative(root, resolved))) return 'outside the repository'
  if (value !== relative) return 'not normalized repository-relative'
  if (!fs.existsSync(resolved)) return 'missing'
  if (fs.statSync(resolved).size <= 0) return 'empty'
  return null
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

module.exports = {
  mcpAndroidSmokeSchema,
  requiredMcpOfflineChecks,
  requiredMcpMethods,
  validateMcpAndroidSmokeResult,
  validateMcpOnlineRequestRows,
}
