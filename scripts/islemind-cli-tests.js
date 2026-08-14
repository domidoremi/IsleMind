const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const {
  CLI_DOCTOR_SCHEMA,
  CLI_GIT_COMMIT_PREVIEW_SCHEMA,
  CLI_SKILL_VALIDATION_SCHEMA,
  createDoctorReport,
  createGitCommitPreview,
  createMcpGatewayProtocol,
  parseCliArgs,
  runCli,
  validateSkillFile,
} = require('./islemind-cli.js')

const CLI_SECRET = 'sk-cli-contract-must-not-leak'
const cliScript = path.join(__dirname, 'islemind-cli.js')

async function run() {
  assert.deepEqual(parseCliArgs(['doctor']), { ok: true, command: 'doctor' }, 'doctor command resolves exactly')
  assert.deepEqual(parseCliArgs(['skill', 'validate', '--path', 'skill.isleskill']), { ok: true, command: 'skill-validate', path: 'skill.isleskill' }, 'skill validation requires an explicit path flag')
  assert.deepEqual(parseCliArgs(['mcp', 'serve', '--transport', 'streamable-http', '--host', '127.0.0.1', '--port', '8765']), { ok: true, command: 'mcp-serve', transport: 'streamable-http', host: '127.0.0.1', port: 8765 }, 'MCP serve resolves only Streamable HTTP options')
  assert.equal(parseCliArgs(['mcp', 'serve', '--transport', 'stdio']).ok, false, 'stdio gateway requests fail closed')
  assert.equal(parseCliArgs(['mcp', 'serve', '--transport', 'streamable-http', '--port', '8765', '--port', '8765']).ok, false, 'duplicate MCP gateway flags fail closed')
  assert.equal(parseCliArgs(['git', 'commit-preview']).command, 'git-commit-preview', 'commit preview is a read-only explicit command')

  const readyDoctor = createDoctorReport('22.4.1')
  const blockedDoctor = createDoctorReport('18.19.0')
  assert.equal(readyDoctor.schema, CLI_DOCTOR_SCHEMA, 'doctor output is versioned')
  assert.equal(readyDoctor.status, 'ready', 'Node.js 20+ passes CLI doctor')
  assert.equal(blockedDoctor.status, 'blocked', 'older Node.js blocks CLI execution')

  const skillValidation = validateSkillFile('safe.isleskill', {
    stat: () => ({ isFile: () => true, size: 256 }),
    read: () => JSON.stringify({
      schema: 'islemind.skill.portable.v2',
      skill: {
        systemPrompt: `Do not expose ${CLI_SECRET}`,
        variables: [{ name: 'topic' }, { name: '../unsafe' }],
      },
    }),
  })
  assert.equal(skillValidation.schema, CLI_SKILL_VALIDATION_SCHEMA, 'skill validator output is versioned')
  assert.equal(skillValidation.ok, true, 'portable skill envelopes validate')
  assert.equal(skillValidation.variableCount, 1, 'skill validation keeps only safe variable identifiers')
  assert.equal(JSON.stringify(skillValidation).includes(CLI_SECRET), false, 'skill validation output omits source prompts and defaults')

  const gitPreview = createGitCommitPreview((command, args) => {
    assert.equal(command, 'git', 'commit preview invokes only git directly')
    if (args[0] === 'status') return 'M  app.tsx\0?? secret.env\0'
    return '12\t3\tapp.tsx\0'
  }, 'C:/workspace')
  assert.equal(gitPreview.schema, CLI_GIT_COMMIT_PREVIEW_SCHEMA, 'git preview output is versioned')
  assert.equal(gitPreview.ok, true, 'git preview accepts bounded status output')
  assert.equal(gitPreview.changedFileCount, 2, 'git preview counts changed files without exposing paths')
  assert.equal(gitPreview.stagedFileCount, 1, 'git preview does not classify untracked files as staged')
  assert.equal(gitPreview.untrackedFileCount, 1, 'git preview keeps untracked files in a separate count')
  assert.equal(gitPreview.stagedAddedLines, 12, 'git preview aggregates staged additions')
  assert.equal(JSON.stringify(gitPreview).includes('app.tsx'), false, 'git preview omits repository paths')
  assert.equal(createGitCommitPreview(() => { throw new Error(CLI_SECRET) }).code, 'git_unavailable', 'git failures do not leak process errors')

  let currentTime = 2_000_000_000_000
  const protocol = createMcpGatewayProtocol(() => currentTime)
  const initialize = protocol.handle({ jsonrpc: '2.0', id: 'init', method: 'initialize' })
  const sessionId = initialize.headers['Mcp-Session-Id']
  assert.equal(initialize.status, 200, 'gateway accepts MCP initialization')
  assert.match(sessionId, /^[a-f0-9]{32,64}$/, 'gateway creates opaque MCP session identifiers')
  assert.equal(protocol.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId).status, 202, 'gateway accepts initialized notifications with a valid session')
  const toolList = protocol.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId)
  assert.equal(toolList.body.result.tools[0].name, 'islemind_doctor', 'gateway exposes the bounded CLI doctor tool')
  const doctorCall = protocol.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'islemind_doctor', arguments: { token: CLI_SECRET } } }, sessionId)
  assert.equal(doctorCall.status, 200, 'gateway serves the bounded doctor tool')
  assert.equal(JSON.stringify(doctorCall.body).includes(CLI_SECRET), false, 'gateway never echoes MCP tool arguments')
  assert.equal(protocol.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, 'forged-session').status, 404, 'gateway rejects forged MCP sessions')
  currentTime += 31 * 60 * 1000
  assert.equal(protocol.handle({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, sessionId).status, 404, 'gateway expires stale MCP sessions')

  const directOutput = execFileSync(process.execPath, [cliScript, 'doctor'], { encoding: 'utf8' })
  const directReport = JSON.parse(directOutput)
  assert.equal(directReport.schema, CLI_DOCTOR_SCHEMA, 'node entrypoint emits JSON doctor output')
  const output = []
  assert.equal(await runCli(['doctor'], (record) => output.push(record)), 0, 'programmatic CLI doctor succeeds')
  assert.equal(output[0].schema, CLI_DOCTOR_SCHEMA, 'programmatic CLI writes the doctor record only')

  console.log('IsleMind CLI tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
