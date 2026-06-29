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
  PLUGIN_HOOK_POINTS,
  PLUGIN_MANIFEST_CATALOG_SCHEMA,
  PLUGIN_MANIFEST_SCHEMA,
  buildPluginManifestCatalogRuntimeEventData,
  buildPluginManifestCatalogSnapshot,
  createPluginManifestFromMcpServer,
  createPluginManifestFromWorkflowSkill,
  emitPluginManifestCatalogSnapshotEvent,
  validatePluginManifest,
} = require('../src/services/pluginManifest.ts')
const { createAgentWorkflowDefinition } = require('../src/services/agent/agentWorkflowDefinitions.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isPluginManifestCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === '@/services/mcp') return { listMcpServers: async () => [] }
    if (request === '@/services/skills') return { listSkills: async () => [] }
    if (request === '@/services/runtimeEvents') {
      return {
        emitRuntimeEvent: async (input) => ({
          schema: 'islemind.runtime-event.v1',
          id: 'runtime-event-plugin-manifest-test',
          ts: '2026-06-29T00:00:00.000Z',
          event: input.event,
          data: input.data ?? {},
          redaction: { applied: true, strategy: 'runtime-log-redaction-v1' },
        }),
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
  hook.isPluginManifestCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(source, marker, label) {
  assert.ok(source.includes(marker), label)
}

async function run() {
  assert.equal(PLUGIN_MANIFEST_SCHEMA, 'islemind.plugin.v1', 'plugin manifest schema is versioned')
  assert.equal(PLUGIN_MANIFEST_CATALOG_SCHEMA, 'islemind.plugin-catalog.v1', 'plugin catalog schema is versioned')
  assert.deepEqual(
    PLUGIN_HOOK_POINTS,
    [
      'chat.beforeSend',
      'context.afterPlan',
      'provider.beforeRequest',
      'provider.afterResponse',
      'tool.beforeCall',
      'tool.afterResult',
      'context.afterCompact',
      'chat.afterComplete',
    ],
    'plugin hook points are explicit and finite',
  )

  const workflow = createAgentWorkflowDefinition({
    id: 'workflow-plugin-review',
    name: 'Plugin review workflow',
    description: 'Represent imported workflow skills in a plugin manifest.',
    enabled: false,
    permissionCeiling: 'read-only',
    steps: [{
      id: 'step-1',
      title: 'Read context',
      toolRequest: { toolId: 'rag:context_pack', source: 'rag', name: 'rag.context_pack', arguments: { query: 'manifest' } },
      acceptance: ['context evidence present'],
    }],
    expectedOutput: 'rag-evidence',
    now: 1234,
  })
  const workflowSkill = {
    schema: 'islemind.skill.v1',
    id: 'skill-agent-workflow-plugin-review',
    name: 'Plugin review workflow',
    layer: 'base',
    version: '1.2.3',
    description: 'Imported workflow skill.',
    tags: ['agent-workflow', 'workflow:workflow-plugin-review', 'workflow-import:review-required', 'workflow-status:disabled'],
    priority: 4,
    systemPrompt: `Workflow definition:\n${JSON.stringify(workflow, null, 2)}`,
    createdAt: 1234,
    updatedAt: 1234,
  }
  const workflowSkillBefore = JSON.stringify(workflowSkill)
  const workflowManifest = createPluginManifestFromWorkflowSkill(workflowSkill, 5678)
  assert.equal(workflowManifest.schema, PLUGIN_MANIFEST_SCHEMA, 'workflow plugin manifest uses the versioned schema')
  assert.equal(workflowManifest.enabled, false, 'workflow plugin manifests stay disabled while review is required')
  assert.equal(workflowManifest.review.state, 'unreviewed', 'workflow plugin manifests preserve visible review state')
  assert.equal(workflowManifest.skills[0].workflow.id, workflow.id, 'workflow skill entries represent imported workflow definitions')
  assert.ok(workflowManifest.requiredCapabilities.includes('agent-workflow'), 'workflow plugin manifest records workflow capability requirements')
  assert.equal(JSON.stringify(workflowSkill), workflowSkillBefore, 'workflow plugin conversion does not mutate skill definitions')
  const workflowManifestValidation = validatePluginManifest(workflowManifest)
  assert.equal(workflowManifestValidation.ok, true, `workflow plugin manifest validates: ${workflowManifestValidation.errors.join('; ')}`)

  const hookManifestValidation = validatePluginManifest({
    schema: PLUGIN_MANIFEST_SCHEMA,
    id: 'plugin:hook-review',
    name: 'Hook review',
    version: '1.0.0',
    enabled: true,
    permissions: ['read-only'],
    requiredCapabilities: ['runtime-events'],
    review: { state: 'approved', summary: 'reviewed' },
    hooks: [{
      id: 'hook:chat-before-send',
      name: 'Before send',
      point: 'chat.beforeSend',
      handlerRef: 'workflow-plugin-review.beforeSend',
      enabled: true,
      permission: 'read-only',
    }],
    mcp: [{
      id: 'mcp:github',
      name: 'GitHub MCP',
      serverId: 'github',
      permission: 'read-only',
      transport: 'sse',
    }],
  })
  assert.equal(hookManifestValidation.ok, true, `hook plugin manifest validates: ${hookManifestValidation.errors.join('; ')}`)
  assert.equal(hookManifestValidation.sanitized.hooks[0].enabled, false, 'plugin hooks are forced disabled by default')
  assert.equal(hookManifestValidation.sanitized.hooks[0].execution, 'noop', 'plugin hooks record no-op execution until review')
  assert.ok(hookManifestValidation.warnings.some((warning) => warning.includes('disabled')), 'plugin manifest warns when hooks request execution')
  assert.equal(hookManifestValidation.sanitized.mcp[0].permission, 'read-only', 'plugin MCP references remain permission-bound')

  const mcpServerForPluginManifest = {
    id: 'mcp-plugin-review',
    name: 'Plugin MCP',
    url: 'https://example.com/mcp',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    manifestTtlMs: 1000,
    manifestCachedAt: 1234,
    tools: [
      { name: 'read_repo', description: 'Read', inputSchema: {}, permission: 'read-only', serverId: 'mcp-plugin-review', enabled: true },
      { name: 'write_issue', description: 'Write', inputSchema: {}, permission: 'read-write', serverId: 'mcp-plugin-review', enabled: false },
    ],
    resources: [{ uri: 'repo://main', serverId: 'mcp-plugin-review' }],
    prompts: [{ name: 'triage', serverId: 'mcp-plugin-review' }],
    approvedToolNames: ['read_repo'],
    createdAt: 1234,
    updatedAt: 1234,
  }
  const mcpManifest = createPluginManifestFromMcpServer(mcpServerForPluginManifest, 5678)
  assert.equal(mcpManifest.schema, PLUGIN_MANIFEST_SCHEMA, 'MCP plugin manifests use the versioned schema')
  assert.ok(mcpManifest.requiredCapabilities.includes('mcp'), 'MCP plugin manifests declare MCP capability requirements')
  assert.ok(mcpManifest.permissions.includes('read-only'), 'MCP plugin manifests keep read-only tool permissions')
  assert.ok(mcpManifest.permissions.includes('read-write'), 'MCP plugin manifests keep read-write tool permissions')
  assert.equal(mcpManifest.mcp[0].permission, 'read-write', 'MCP plugin manifest entries use the highest requested permission')
  assert.equal(mcpManifest.mcp[0].serverId, 'mcp-plugin-review', 'MCP plugin manifest entries preserve stable server ids')
  const mcpManifestValidation = validatePluginManifest(mcpManifest)
  assert.equal(mcpManifestValidation.ok, true, `MCP plugin manifest validates: ${mcpManifestValidation.errors.join('; ')}`)

  const invalidManifestValidation = validatePluginManifest({
    schema: PLUGIN_MANIFEST_SCHEMA,
    id: 'bad id',
    name: 'Bad plugin',
    version: '1',
    enabled: false,
    hooks: [{ id: 'hook:bad', name: 'Bad hook', point: 'chat.afterToken', handlerRef: 'bad' }],
    mcp: [{ id: 'mcp:bad', name: 'Bad MCP', serverId: 'github' }],
  })
  assert.equal(invalidManifestValidation.ok, false, 'plugin manifest validator rejects invalid manifests')
  assert.ok(invalidManifestValidation.errors.some((error) => error.includes('stable plugin id')), 'plugin manifest validator requires stable ids')
  assert.ok(invalidManifestValidation.errors.some((error) => error.includes('semver')), 'plugin manifest validator requires semver versions')
  assert.ok(invalidManifestValidation.errors.some((error) => error.includes('disabledReason')), 'plugin manifest validator requires disabled reasons')
  assert.ok(invalidManifestValidation.errors.some((error) => error.includes('point is invalid')), 'plugin manifest validator rejects unknown hook points')
  assert.ok(invalidManifestValidation.errors.some((error) => error.includes('permission is required')), 'plugin manifest validator requires MCP permissions')

  const pluginCatalog = buildPluginManifestCatalogSnapshot({
    skills: [workflowSkill],
    mcpServers: [mcpServerForPluginManifest],
    manifests: [
      { manifest: hookManifestValidation.sanitized, sourceKind: 'manual', sourceId: 'hook-review' },
      { manifest: invalidManifestValidation.sanitized, sourceKind: 'manual', sourceId: 'invalid-review' },
    ],
    now: 9876,
  })
  assert.equal(pluginCatalog.schema, PLUGIN_MANIFEST_CATALOG_SCHEMA, 'plugin catalog snapshot uses a versioned schema')
  assert.equal(pluginCatalog.generatedAt, 9876, 'plugin catalog snapshot preserves the generation timestamp')
  assert.equal(pluginCatalog.counts.total, 4, 'plugin catalog summarizes workflow, MCP, hook, and invalid manifests')
  assert.equal(pluginCatalog.counts.valid, 3, 'plugin catalog counts valid manifests')
  assert.equal(pluginCatalog.counts.invalid, 1, 'plugin catalog counts invalid manifests')
  assert.equal(pluginCatalog.counts.hooks, 2, 'plugin catalog counts declared hooks, including invalid manifests')
  assert.equal(pluginCatalog.counts.noopHooks, 2, 'plugin catalog records no-op hook execution')
  assert.equal(pluginCatalog.counts.executableHooks, 0, 'plugin catalog keeps executable hooks at zero by default')
  assert.equal(pluginCatalog.reviewStates.approved, 2, 'plugin catalog counts approved manifests')
  assert.equal(pluginCatalog.reviewStates.unreviewed, 2, 'plugin catalog counts unreviewed manifests')
  assert.equal(pluginCatalog.permissions['read-write'], 1, 'plugin catalog aggregates highest MCP permissions')
  assert.equal(pluginCatalog.requiredCapabilities['agent-workflow'], 1, 'plugin catalog aggregates workflow capabilities')
  assert.equal(pluginCatalog.requiredCapabilities.mcp, 1, 'plugin catalog aggregates MCP capabilities')
  assert.equal(pluginCatalog.requiredCapabilities['runtime-events'], 1, 'plugin catalog aggregates hook capabilities')
  assert.ok(pluginCatalog.entries.some((entry) => entry.sourceKind === 'workflow-skill' && entry.sourceId === workflowSkill.id), 'plugin catalog preserves workflow skill sources')
  assert.ok(pluginCatalog.entries.some((entry) => entry.sourceKind === 'mcp-server' && entry.sourceId === mcpServerForPluginManifest.id), 'plugin catalog preserves MCP server sources')

  const pluginCatalogEventData = buildPluginManifestCatalogRuntimeEventData(pluginCatalog, 'contract-test')
  assert.equal(pluginCatalogEventData.catalogSchema, PLUGIN_MANIFEST_CATALOG_SCHEMA, 'plugin catalog runtime event data carries the catalog schema')
  assert.equal(pluginCatalogEventData.trigger, 'contract-test', 'plugin catalog runtime event data records the trigger')
  assert.equal(pluginCatalogEventData.entryCount, pluginCatalog.entries.length, 'plugin catalog runtime event data records bounded entry count')
  assert.equal(pluginCatalogEventData.entryLimitApplied, false, 'plugin catalog runtime event data records whether entry limits were applied')
  assert.deepEqual(pluginCatalogEventData.sourceKinds['workflow-skill'], 1, 'plugin catalog runtime event data summarizes workflow skill sources')
  assert.deepEqual(pluginCatalogEventData.sourceKinds['mcp-server'], 1, 'plugin catalog runtime event data summarizes MCP sources')
  assert.ok(pluginCatalogEventData.requiredCapabilityKeys.includes('agent-workflow'), 'plugin catalog runtime event data includes bounded capability keys')
  assert.equal(pluginCatalogEventData.entries, undefined, 'plugin catalog runtime event data omits catalog entries')
  assert.equal(JSON.stringify(pluginCatalogEventData).includes('Workflow definition'), false, 'plugin catalog runtime event data omits workflow prompt text')

  const emitted = await emitPluginManifestCatalogSnapshotEvent(pluginCatalog, 'contract-test')
  assert.equal(emitted.event, 'plugin.catalog.snapshot.created', 'plugin catalog emits a typed runtime event')
  assert.equal(emitted.data.catalogSchema, PLUGIN_MANIFEST_CATALOG_SCHEMA, 'plugin catalog runtime event carries catalog schema')

  const pluginManifestSource = readSource('src/services/pluginManifest.ts')
  assertSourceIncludes(pluginManifestSource, 'CATALOG_ENTRY_LIMIT = 80', 'plugin catalog has an entry limit')
  assertSourceIncludes(pluginManifestSource, 'CATALOG_RUNTIME_CAPABILITY_LIMIT = 12', 'plugin catalog has a runtime capability limit')
  assertSourceIncludes(pluginManifestSource, "execution: 'noop'", 'plugin hooks remain no-op by default')
  assertSourceIncludes(pluginManifestSource, 'emitPluginManifestCatalogSnapshotEvent', 'plugin catalog can emit typed runtime events')

  console.log('Plugin manifest compatibility tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
