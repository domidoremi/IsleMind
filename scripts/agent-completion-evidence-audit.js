const fs = require('node:fs')
const path = require('node:path')

const SCHEMA = 'islemind.agent-completion-evidence-audit.v1'
const root = path.resolve(__dirname, '..')
const roadmapPath = path.join(root, 'docs', 'agentic-workflow-roadmap.md')
const packagePath = path.join(root, 'package.json')

const REQUIRED_ROADMAP_TITLE = 'Agentic Workflow Roadmap'
const REQUIRED_DURABLE_GOAL_CONTRACT_LABEL = 'Durable goal contract:'
const REQUIRED_PACKAGE_MANAGER = 'bun@1.3.14'
const REQUIRED_LOCKFILES = ['bun.lock']
const KNOWN_LOCKFILES = ['bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json']

const REQUIRED_TARGETS = [
  'Classify a user task that requires agentic handling',
  'Produce a bounded plan',
  'Execute allowed tools through one registry',
  'Record trace and citations',
  'Synthesize a final answer or structured artifact',
  'Preserve user state on failure',
  'Save user-approved workflows as visible skills',
  'Pass the existing release gates plus agent-specific contract tests',
]

const REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS = [
  'Each continuation pass must select one missing acceptance item',
  'Each pass must leave a source, contract, test, audit, or documentation delta',
  'Each pass must record the executed validation command or the observable blocker',
  'No pass may add arbitrary desktop control, hidden skill mutation, background autonomy, unbounded loops, or destructive default actions',
]

const REQUIRED_RISK_CONTROL_BULLETS = [
  'Android undo prompt source boundary must reject arbitrary message body JSON',
  'Handoff and diagnostic task intents route to the structured work artifact tool instead of stopping at `planner-tool-missing`',
  'Handoff and diagnostic task traces expose work artifact quality audit state and quality gaps without requiring a fabricated complete artifact',
  'Work artifact body fallback requires a passing work artifact quality audit',
]

const REQUIRED_ROADMAP_SECTION_SEQUENCE = [
  'Durable Execution Goal',
  'Execution Cadence',
  'Current Validation Baseline',
  'Completion Target',
  'Completion Evidence Map',
  'Risk Control',
]

const REQUIRED_EXECUTION_CADENCE_TEXT = 'The workflow engine must keep task classification, bounded planning, policy checks, tool execution, RAG evidence, trace recording, and final synthesis behind explicit service boundaries. Runtime changes must preserve reviewable user state and keep destructive actions behind confirmation.'

const REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT = 'Treat missing, stale, indirect, or narrow evidence as incomplete. Architecture and QA freshness gates must enforce the durable goal contract.'
const REQUIRED_COMPLETION_EVIDENCE_TABLE_HEADER = '| Target | Evidence |'
const REQUIRED_COMPLETION_EVIDENCE_TABLE_SEPARATOR = '| --- | --- |'

const REQUIRED_AGENT_WORKFLOW_SCRIPTS = [
  'scripts/agentic-workflow-tests.js',
  'scripts/agent-rag-quality-tests.js',
  'scripts/agent-trace-contract-tests.js',
  'scripts/agent-work-artifact-workflow-tests.js',
  'scripts/agent-tool-policy-tests.js',
  'scripts/agent-completion-evidence-audit.js',
]
const REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME = 'test:agent-workflow'
const REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND = REQUIRED_AGENT_WORKFLOW_SCRIPTS.map((scriptPath) => `node ${scriptPath}`).join(' && ')

const REQUIRED_VALIDATION_BASELINE_COMMANDS = [
  'bun run test:agent-workflow',
  'bun run type-check',
  'bun run test:provider-intelligence',
  'bun run test:work-artifact-smoke',
  'node scripts/architecture-boundary-audit.js',
]

const REQUIRED_PACKAGE_SCRIPTS = {
  'test:agent-completion-evidence': 'node scripts/agent-completion-evidence-audit.js',
  'test:agent-completion-evidence:json': 'node scripts/agent-completion-evidence-audit.js --json',
  'test:architecture-boundary': 'node scripts/architecture-boundary-audit.js',
  'test:provider-intelligence': 'node scripts/provider-intelligence-tests.js',
  'test:qa-audit:self': 'node scripts/qa-coverage-audit.js --self-test',
  'test:work-artifact-smoke': 'node scripts/collect-work-artifact-smoke.js',
  'test:work-artifact-smoke:self': 'node scripts/collect-work-artifact-smoke.js --self-test',
  'type-check': 'node node_modules/typescript/bin/tsc --noEmit',
}

const REQUIRED_VALIDATION_BASELINE_EXECUTION = {
  'bun run test:agent-workflow': {
    kind: 'package-script',
    packageScriptName: REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME,
    expectedPackageScriptCommand: REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND,
  },
  'bun run type-check': {
    kind: 'package-script',
    packageScriptName: 'type-check',
    expectedPackageScriptCommand: REQUIRED_PACKAGE_SCRIPTS['type-check'],
  },
  'bun run test:provider-intelligence': {
    kind: 'package-script',
    packageScriptName: 'test:provider-intelligence',
    expectedPackageScriptCommand: REQUIRED_PACKAGE_SCRIPTS['test:provider-intelligence'],
  },
  'bun run test:work-artifact-smoke': {
    kind: 'package-script',
    packageScriptName: 'test:work-artifact-smoke',
    expectedPackageScriptCommand: REQUIRED_PACKAGE_SCRIPTS['test:work-artifact-smoke'],
  },
  'node scripts/architecture-boundary-audit.js': {
    kind: 'node-file',
    packageScriptName: 'test:architecture-boundary',
    expectedPackageScriptCommand: REQUIRED_PACKAGE_SCRIPTS['test:architecture-boundary'],
    scriptPath: 'scripts/architecture-boundary-audit.js',
  },
}

const REQUIRED_TARGET_EVIDENCE = {
  'Classify a user task that requires agentic handling': [
    'src/services/agent/agentIntentClassifier.ts',
    'src/services/agent/agentPlanner.ts',
    'scripts/agentic-workflow-tests.js',
  ],
  'Produce a bounded plan': [
    'src/services/agent/agentPlanner.ts',
    'src/services/agent/agentPolicy.ts',
    'src/services/agent/agentOrchestrator.ts',
    'scripts/agentic-workflow-tests.js',
  ],
  'Execute allowed tools through one registry': [
    'src/services/agent/agentToolRegistry.ts',
    'src/services/agent/agentExecutor.ts',
    'src/services/chatRunner.ts',
    'scripts/agent-tool-policy-tests.js',
  ],
  'Record trace and citations': [
    'src/services/agent/agentTrace.ts',
    'src/components/chat/tracePresentation.ts',
    'app/source.tsx',
    'scripts/agent-trace-contract-tests.js',
    'scripts/agent-rag-quality-tests.js',
  ],
  'Synthesize a final answer or structured artifact': [
    'src/services/agent/agentOrchestrator.ts',
    'src/services/agent/workArtifactWorkflow.ts',
    'scripts/agent-work-artifact-workflow-tests.js',
  ],
  'Preserve user state on failure': [
    'src/services/agent/agentOrchestrator.ts',
    'src/services/agent/agentMessageAdapter.ts',
    'src/components/chat/ChatWorkspace.tsx',
    'scripts/agent-tool-policy-tests.js',
  ],
  'Save user-approved workflows as visible skills': [
    'src/services/agent/agentWorkflowSkills.ts',
    'src/components/settings/SkillSettingsContent.tsx',
    'app/settings/skills.tsx',
    'scripts/agent-tool-policy-tests.js',
  ],
  'Pass the existing release gates plus agent-specific contract tests': [
    'package.json',
    'scripts/architecture-boundary-audit.js',
    'scripts/qa-coverage-audit.js',
  ],
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function readJson(filePath) {
  return JSON.parse(readText(filePath))
}

function parseCompletionTargetBullets(markdown) {
  return parseMarkdownBulletListSection(markdown, 'Completion Target')
}

function parseDurableGoalContractBullets(markdown) {
  return parseMarkdownBulletListSection(markdown, 'Durable Execution Goal')
}

function parseRiskControlBullets(markdown) {
  return parseMarkdownBulletListSection(markdown, 'Risk Control')
}

function parseRoadmapTitle(markdown) {
  return markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? ''
}

function parseDurableGoalContractLabel(markdown) {
  const section = readSection(markdown, 'Durable Execution Goal')
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('-')) ?? ''
}

function parseRoadmapSectionSequence(markdown) {
  const sections = []
  const pattern = /^##\s+(.+?)\s*$/gm
  let match
  while ((match = pattern.exec(markdown))) sections.push(match[1].trim())
  return sections
}

function parseExecutionCadenceText(markdown) {
  return readSection(markdown, 'Execution Cadence')
}

function parseCompletionEvidenceTargets(markdown) {
  const section = readSection(markdown, 'Completion Evidence Map')
  const rows = []
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    if (/^\|\s*-+\s*\|\s*-+\s*\|$/.test(line.trim())) continue
    const cells = splitMarkdownTableRow(line)
    if (cells.length < 2 || cells[0] === 'Target') continue
    rows.push({
      target: cells[0].replace(/\.$/, '').trim(),
      evidence: parseEvidenceEntries(cells[1]),
    })
  }
  return rows
}

function parseCompletionEvidenceTableShape(markdown) {
  const section = readSection(markdown, 'Completion Evidence Map')
  const tableLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
  return {
    header: tableLines[0] ?? '',
    separator: tableLines[1] ?? '',
    tableLineCount: tableLines.length,
  }
}

function parseCompletionEvidenceNoteText(markdown) {
  const section = readSection(markdown, 'Completion Evidence Map')
  const noteLines = []
  let seenTable = false
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|')) {
      seenTable = true
      continue
    }
    if (!seenTable || !trimmed) continue
    noteLines.push(trimmed)
  }
  return noteLines.join('\n').trim()
}

function parseCurrentValidationBaseline(markdown) {
  const section = readSection(markdown, 'Current Validation Baseline')
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+`([^`]+)`\s*$/)?.[1])
    .filter(Boolean)
    .map(normalizePackageCommandStep)
}

function summarizeCompletionEvidenceTarget(target, evidence, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const packageJson = options.packageJson ?? readJson(path.join(repoRoot, 'package.json'))
  const normalizedEvidence = evidence.map((item) => item.trim()).filter(Boolean)
  const invalidEvidenceEntries = normalizedEvidence.filter((item) => !isSafeRepositoryPath(item))
  const localPaths = normalizedEvidence.filter(isSafeRepositoryPath)
  const missingPaths = localPaths.filter((item) => !fs.existsSync(path.join(repoRoot, item)))
  const nonFilePaths = localPaths.filter((item) => fs.existsSync(path.join(repoRoot, item)) && !fs.statSync(path.join(repoRoot, item)).isFile())
  const scriptPaths = localPaths.filter((item) => item.startsWith('scripts/') && item.endsWith('.js'))
  const agentWorkflowScriptPaths = scriptPaths.filter((scriptPath) => REQUIRED_AGENT_WORKFLOW_SCRIPTS.includes(scriptPath))
  const requiredEvidence = REQUIRED_TARGET_EVIDENCE[target] ?? []
  const missingRequiredEvidence = requiredEvidence.filter((item) => !normalizedEvidence.includes(item))
  const unregisteredEvidenceEntries = normalizedEvidence.filter((item) => !requiredEvidence.includes(item))
  const evidenceSequenceMatches = arrayEquals(normalizedEvidence, requiredEvidence)
  const packageCoveredScriptCount = agentWorkflowScriptPaths
    .filter((scriptPath) => packageAgentWorkflowRunsScript(packageJson, scriptPath))
    .length
  const issues = []

  if (!normalizedEvidence.length) issues.push('missing-evidence')
  for (const missingEvidence of missingRequiredEvidence) issues.push(`missing-required-evidence:${missingEvidence}`)
  for (const unregisteredEvidence of unregisteredEvidenceEntries) issues.push(`unregistered-evidence:${unregisteredEvidence}`)
  if (!evidenceSequenceMatches) issues.push('evidence-sequence-drift')
  for (const invalidEvidence of invalidEvidenceEntries) issues.push(`invalid-evidence-entry:${invalidEvidence}`)
  for (const missingPath of missingPaths) issues.push(`missing-path:${missingPath}`)
  for (const nonFilePath of nonFilePaths) issues.push(`non-file-evidence-path:${nonFilePath}`)
  if (target === 'Pass the existing release gates plus agent-specific contract tests') {
    for (const issue of collectRequiredPackageScriptIssues(packageJson)) issues.push(issue)
  }
  if (agentWorkflowScriptPaths.length > 0 && packageCoveredScriptCount === 0) issues.push('package-script-coverage-missing')

  return {
    target,
    evidence: normalizedEvidence,
    evidenceCount: normalizedEvidence.length,
    requiredEvidence,
    missingRequiredEvidence,
    unregisteredEvidenceEntries,
    evidenceSequenceMatches,
    invalidEvidenceEntries,
    pathCount: localPaths.length,
    missingPaths,
    nonFilePaths,
    scriptPathCount: scriptPaths.length,
    packageCoveredScriptCount,
    passed: issues.length === 0,
    issues,
  }
}

function packageScriptRunsEvidenceScript(packageJson) {
  return packageScriptMatchesCommand(packageJson, 'test:agent-completion-evidence', 'node scripts/agent-completion-evidence-audit.js')
}

function collectRequiredPackageScriptIssues(packageJson) {
  const issues = []
  for (const [scriptName, expectedCommand] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
    if (!packageScriptMatchesCommand(packageJson, scriptName, expectedCommand)) {
      issues.push(`package-script-missing:${scriptName}`)
    }
  }
  return issues
}

function summarizeRequiredPackageScript(scriptName, expectedCommand, packageJson, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const actualCommand = packageJson.scripts?.[scriptName] ?? null
  const matches = packageScriptMatchesCommand(packageJson, scriptName, expectedCommand)
  const nodeFileSteps = typeof actualCommand === 'string'
    ? collectPackageScriptNodeFileSteps(actualCommand)
    : []
  const missingNodeFileSteps = nodeFileSteps.filter((scriptPath) => !localNodeFileExists(repoRoot, scriptPath))
  const issues = []

  if (typeof actualCommand !== 'string') {
    issues.push(`package-script-missing:${scriptName}`)
  } else if (!matches) {
    issues.push(`package-script-drift:${scriptName}`)
  }
  for (const scriptPath of missingNodeFileSteps) {
    issues.push(`package-script-node-file-missing:${scriptName}:${scriptPath}`)
  }

  return {
    scriptName,
    expectedCommand,
    actualCommand,
    matches,
    nodeFileSteps,
    missingNodeFileSteps,
    covered: issues.length === 0,
    issues,
  }
}

function summarizeRequiredPackageScripts(packageJson, options = {}) {
  return Object.entries(REQUIRED_PACKAGE_SCRIPTS).map(([scriptName, expectedCommand]) => summarizeRequiredPackageScript(
    scriptName,
    expectedCommand,
    packageJson,
    options,
  ))
}

function summarizeValidationBaselineCommand(command, validationBaselineCommands, packageJson, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const contract = REQUIRED_VALIDATION_BASELINE_EXECUTION[command]
  const commandListed = validationBaselineCommands.includes(command)
  const issues = []
  if (!commandListed) issues.push(`validation-baseline-command-not-listed:${command}`)
  if (!contract) {
    return {
      command,
      commandListed,
      kind: 'unregistered',
      covered: false,
      issues: [...issues, `validation-baseline-command-unregistered:${command}`],
    }
  }

  const actualPackageScriptCommand = contract.packageScriptName
    ? packageJson.scripts?.[contract.packageScriptName] ?? null
    : null
  const packageScriptMatches = contract.packageScriptName
    ? packageScriptMatchesCommand(packageJson, contract.packageScriptName, contract.expectedPackageScriptCommand)
    : null
  const nodeFileSteps = typeof actualPackageScriptCommand === 'string'
    ? collectPackageScriptNodeFileSteps(actualPackageScriptCommand)
    : []
  const missingNodeFileSteps = nodeFileSteps.filter((scriptPath) => !localNodeFileExists(repoRoot, scriptPath))
  let nodeScriptExists = null
  if (contract.scriptPath) {
    nodeScriptExists = localNodeFileExists(repoRoot, contract.scriptPath)
  }

  if (contract.packageScriptName && typeof actualPackageScriptCommand !== 'string') {
    issues.push(`validation-baseline-package-script-missing:${contract.packageScriptName}`)
  } else if (contract.packageScriptName && !packageScriptMatches) {
    issues.push(`validation-baseline-package-script-drift:${contract.packageScriptName}`)
  }
  if (contract.scriptPath && !nodeScriptExists) {
    issues.push(`validation-baseline-node-script-missing:${contract.scriptPath}`)
  }
  for (const scriptPath of missingNodeFileSteps) {
    issues.push(`validation-baseline-package-script-node-file-missing:${contract.packageScriptName}:${scriptPath}`)
  }

  return {
    command,
    commandListed,
    kind: contract.kind,
    packageScriptName: contract.packageScriptName ?? null,
    expectedPackageScriptCommand: contract.expectedPackageScriptCommand ?? null,
    actualPackageScriptCommand,
    packageScriptMatches,
    nodeFileSteps,
    missingNodeFileSteps,
    scriptPath: contract.scriptPath ?? null,
    nodeScriptExists,
    covered: issues.length === 0,
    issues,
  }
}

function summarizeValidationBaselineCommands(validationBaselineCommands, packageJson, options = {}) {
  return REQUIRED_VALIDATION_BASELINE_COMMANDS.map((command) => summarizeValidationBaselineCommand(
    command,
    validationBaselineCommands,
    packageJson,
    options,
  ))
}

function collectRepositoryLockfiles(repoRoot) {
  return KNOWN_LOCKFILES.filter((lockfile) => fs.existsSync(path.join(repoRoot, lockfile)))
}

function packageScriptMatchesCommand(packageJson, scriptName, expectedCommand) {
  const command = packageJson.scripts?.[scriptName]
  return typeof command === 'string' && normalizePackageCommandStep(command) === normalizePackageCommandStep(expectedCommand)
}

function packageScriptRunsNodeFile(packageJson, scriptName, scriptPath) {
  const command = packageJson.scripts?.[scriptName]
  if (typeof command !== 'string') return false
  return splitPackageCommandSteps(command).some((step) => step === `node ${scriptPath}`)
}

function runAudit(options = {}) {
  const repoRoot = options.repoRoot ?? root
  const markdown = options.markdown ?? readText(path.join(repoRoot, 'docs', 'agentic-workflow-roadmap.md'))
  const packageJson = options.packageJson ?? readJson(path.join(repoRoot, 'package.json'))
  const lockfiles = options.lockfiles ?? collectRepositoryLockfiles(repoRoot)
  const roadmapTitle = parseRoadmapTitle(markdown)
  const durableGoalContractLabel = parseDurableGoalContractLabel(markdown)
  const roadmapSectionSequence = parseRoadmapSectionSequence(markdown)
  const executionCadenceText = parseExecutionCadenceText(markdown)
  const durableGoalContractBullets = parseDurableGoalContractBullets(markdown)
  const riskControlBullets = parseRiskControlBullets(markdown)
  const completionTargets = parseCompletionTargetBullets(markdown)
  const evidenceTargets = parseCompletionEvidenceTargets(markdown)
  const completionEvidenceTableShape = parseCompletionEvidenceTableShape(markdown)
  const completionEvidenceNoteText = parseCompletionEvidenceNoteText(markdown)
  const validationBaselineCommands = parseCurrentValidationBaseline(markdown)
  const validationBaselineSummaries = summarizeValidationBaselineCommands(validationBaselineCommands, packageJson, { repoRoot })
  const packageScriptSummaries = summarizeRequiredPackageScripts(packageJson, { repoRoot })
  const evidenceByTarget = new Map(evidenceTargets.map((item) => [item.target, item]))
  const targetSummaries = completionTargets.map((target) => summarizeCompletionEvidenceTarget(
    target,
    evidenceByTarget.get(target)?.evidence ?? [],
    { repoRoot, packageJson },
  ))
  const issues = []
  if (packageJson.packageManager !== REQUIRED_PACKAGE_MANAGER) issues.push('package-manager-drift')
  for (const lockfile of REQUIRED_LOCKFILES) {
    if (!lockfiles.includes(lockfile)) issues.push(`package-lockfile-missing:${lockfile}`)
  }
  for (const lockfile of lockfiles) {
    if (!REQUIRED_LOCKFILES.includes(lockfile)) issues.push(`package-lockfile-unregistered:${lockfile}`)
  }
  if (roadmapTitle !== REQUIRED_ROADMAP_TITLE) issues.push('roadmap-title-drift')
  if (durableGoalContractLabel !== REQUIRED_DURABLE_GOAL_CONTRACT_LABEL) issues.push('durable-goal-contract-label-drift')
  for (const section of duplicateValues(roadmapSectionSequence)) issues.push(`duplicate-roadmap-section:${section}`)
  for (const section of roadmapSectionSequence) {
    if (!REQUIRED_ROADMAP_SECTION_SEQUENCE.includes(section)) issues.push(`unregistered-roadmap-section:${section}`)
  }
  for (const section of REQUIRED_ROADMAP_SECTION_SEQUENCE) {
    if (!roadmapSectionSequence.includes(section)) issues.push(`missing-roadmap-section:${section}`)
  }
  if (!arrayEquals(roadmapSectionSequence, REQUIRED_ROADMAP_SECTION_SEQUENCE)) issues.push('roadmap-section-sequence-drift')
  if (executionCadenceText !== REQUIRED_EXECUTION_CADENCE_TEXT) issues.push('execution-cadence-text-drift')
  if (!arrayEquals(durableGoalContractBullets, REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS)) issues.push('durable-goal-contract-sequence-drift')
  if (!arrayEquals(riskControlBullets, REQUIRED_RISK_CONTROL_BULLETS)) issues.push('risk-control-sequence-drift')
  if (!arrayEquals(completionTargets, REQUIRED_TARGETS)) issues.push('completion-target-sequence-drift')
  if (!arrayEquals(evidenceTargets.map((item) => item.target), REQUIRED_TARGETS)) issues.push('evidence-map-row-sequence-drift')
  if (completionEvidenceTableShape.header !== REQUIRED_COMPLETION_EVIDENCE_TABLE_HEADER) issues.push('completion-evidence-table-header-drift')
  if (completionEvidenceTableShape.separator !== REQUIRED_COMPLETION_EVIDENCE_TABLE_SEPARATOR) issues.push('completion-evidence-table-separator-drift')
  if (completionEvidenceTableShape.tableLineCount !== REQUIRED_TARGETS.length + 2) issues.push('completion-evidence-table-row-count-drift')
  if (completionEvidenceNoteText !== REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT) issues.push('completion-evidence-note-text-drift')
  if (!arrayEquals(validationBaselineCommands, REQUIRED_VALIDATION_BASELINE_COMMANDS)) issues.push('validation-baseline-sequence-drift')
  for (const bullet of duplicateValues(durableGoalContractBullets)) issues.push(`duplicate-durable-goal-contract-bullet:${bullet}`)
  for (const bullet of duplicateValues(riskControlBullets)) issues.push(`duplicate-risk-control-bullet:${bullet}`)
  for (const target of duplicateValues(completionTargets)) issues.push(`duplicate-completion-target:${target}`)
  for (const target of duplicateValues(evidenceTargets.map((item) => item.target))) issues.push(`duplicate-evidence-map-row:${target}`)
  for (const command of duplicateValues(validationBaselineCommands)) issues.push(`duplicate-validation-baseline-command:${command}`)
  for (const bullet of durableGoalContractBullets) {
    if (!REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS.includes(bullet)) issues.push(`unregistered-durable-goal-contract-bullet:${bullet}`)
  }
  for (const bullet of riskControlBullets) {
    if (!REQUIRED_RISK_CONTROL_BULLETS.includes(bullet)) issues.push(`unregistered-risk-control-bullet:${bullet}`)
  }
  for (const target of completionTargets) {
    if (!REQUIRED_TARGETS.includes(target)) issues.push(`unregistered-completion-target:${target}`)
  }
  for (const command of validationBaselineCommands) {
    if (!REQUIRED_VALIDATION_BASELINE_COMMANDS.includes(command)) issues.push(`unregistered-validation-baseline-command:${command}`)
  }

  for (const bullet of REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS) {
    if (!durableGoalContractBullets.includes(bullet)) issues.push(`missing-durable-goal-contract-bullet:${bullet}`)
  }
  for (const bullet of REQUIRED_RISK_CONTROL_BULLETS) {
    if (!riskControlBullets.includes(bullet)) issues.push(`missing-risk-control-bullet:${bullet}`)
  }
  for (const target of REQUIRED_TARGETS) {
    if (!completionTargets.includes(target)) issues.push(`missing-completion-target:${target}`)
    if (!evidenceByTarget.has(target)) issues.push(`missing-evidence-map-row:${target}`)
  }
  for (const command of REQUIRED_VALIDATION_BASELINE_COMMANDS) {
    if (!validationBaselineCommands.includes(command)) issues.push(`missing-validation-baseline-command:${command}`)
  }
  for (const row of evidenceTargets) {
    if (!completionTargets.includes(row.target)) issues.push(`stale-evidence-map-row:${row.target}`)
    for (const evidence of duplicateValues(row.evidence)) issues.push(`${row.target}:duplicate-evidence:${evidence}`)
  }
  for (const summary of targetSummaries) {
    for (const issue of summary.issues) issues.push(`${summary.target}:${issue}`)
  }
  for (const summary of validationBaselineSummaries) {
    for (const issue of summary.issues) issues.push(issue)
  }
  for (const summary of packageScriptSummaries) {
    for (const issue of summary.issues) issues.push(issue)
  }
  for (const scriptPath of REQUIRED_AGENT_WORKFLOW_SCRIPTS) {
    if (!packageAgentWorkflowRunsScript(packageJson, scriptPath)) issues.push(`agent-workflow-script-not-run:${scriptPath}`)
  }
  if (!packageAgentWorkflowMatchesRequiredSequence(packageJson)) issues.push('agent-workflow-script-sequence-drift')
  if (!packageScriptMatchesCommand(packageJson, REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME, REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND)) {
    issues.push('agent-workflow-package-script-command-drift')
  }
  if (!packageScriptRunsEvidenceScript(packageJson)) issues.push('package-script-does-not-run-agent-completion-evidence')

  return {
    schema: SCHEMA,
    ranAt: new Date().toISOString(),
    roadmap: path.relative(repoRoot, roadmapPath).replace(/\\/g, '/'),
    requiredPackageManager: REQUIRED_PACKAGE_MANAGER,
    packageManager: packageJson.packageManager ?? null,
    requiredLockfiles: REQUIRED_LOCKFILES,
    knownLockfiles: KNOWN_LOCKFILES,
    lockfiles,
    lockfileCount: lockfiles.length,
    requiredRoadmapTitle: REQUIRED_ROADMAP_TITLE,
    roadmapTitle,
    requiredDurableGoalContractLabel: REQUIRED_DURABLE_GOAL_CONTRACT_LABEL,
    durableGoalContractLabel,
    requiredRoadmapSectionSequence: REQUIRED_ROADMAP_SECTION_SEQUENCE,
    roadmapSectionSequence,
    roadmapSectionCount: roadmapSectionSequence.length,
    requiredExecutionCadenceText: REQUIRED_EXECUTION_CADENCE_TEXT,
    executionCadenceText,
    requiredDurableGoalContractBullets: REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS,
    durableGoalContractBullets,
    durableGoalContractCount: durableGoalContractBullets.length,
    requiredRiskControlBullets: REQUIRED_RISK_CONTROL_BULLETS,
    riskControlBullets,
    riskControlCount: riskControlBullets.length,
    requiredCompletionTargets: REQUIRED_TARGETS,
    completionTargets,
    completionTargetCount: completionTargets.length,
    requiredTargetEvidence: REQUIRED_TARGET_EVIDENCE,
    evidenceTargets,
    evidenceTargetCount: evidenceTargets.length,
    completionEvidenceTableShape,
    completionEvidenceNoteText,
    requiredValidationBaselineCommands: REQUIRED_VALIDATION_BASELINE_COMMANDS,
    validationBaselineCommands,
    validationBaselineCommandCount: validationBaselineCommands.length,
    requiredValidationBaselineExecution: REQUIRED_VALIDATION_BASELINE_EXECUTION,
    validationBaselineSummaries,
    validationBaselineExecutableCount: validationBaselineSummaries.filter((summary) => summary.covered).length,
    targetSummaries,
    requiredAgentWorkflowScripts: REQUIRED_AGENT_WORKFLOW_SCRIPTS,
    requiredAgentWorkflowPackageScriptName: REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME,
    requiredAgentWorkflowPackageScriptCommand: REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND,
    agentWorkflowPackageScriptCommand: packageJson.scripts?.[REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME] ?? null,
    agentWorkflowPackageScriptMatches: packageScriptMatchesCommand(packageJson, REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME, REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND),
    packageCoveredScriptCount: REQUIRED_AGENT_WORKFLOW_SCRIPTS
      .filter((scriptPath) => packageAgentWorkflowRunsScript(packageJson, scriptPath))
      .length,
    packageScriptRunsEvidenceScript: packageScriptRunsEvidenceScript(packageJson),
    requiredPackageScripts: REQUIRED_PACKAGE_SCRIPTS,
    requiredPackageScriptCount: Object.keys(REQUIRED_PACKAGE_SCRIPTS).length,
    packageScriptSummaries,
    packageScriptCoveredCount: packageScriptSummaries.filter((summary) => summary.covered).length,
    passed: issues.length === 0,
    issues,
  }
}

function runSelfTest() {
  const evidenceRow = (target) => `| ${target} | ${REQUIRED_TARGET_EVIDENCE[target].map((item) => `\`${item}\``).join(', ')} |`
  const fixtureMarkdown = [
    '# Agentic Workflow Roadmap',
    '',
    '## Durable Execution Goal',
    '',
    'Durable goal contract:',
    '',
    ...REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS.map((bullet) => `- ${bullet}.`),
    '',
    '## Execution Cadence',
    '',
    REQUIRED_EXECUTION_CADENCE_TEXT,
    '',
    '## Current Validation Baseline',
    '',
    ...REQUIRED_VALIDATION_BASELINE_COMMANDS.map((command) => `- \`${command}\``),
    '',
    '## Completion Target',
    '',
    ...REQUIRED_TARGETS.map((target) => `- ${target}.`),
    '',
    '## Completion Evidence Map',
    '',
    '| Target | Evidence |',
    '| --- | --- |',
    ...REQUIRED_TARGETS.map(evidenceRow),
    '',
    REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT,
    '',
    '## Risk Control',
    '',
    ...REQUIRED_RISK_CONTROL_BULLETS.map((bullet) => `- ${bullet}.`),
  ].join('\n')
  const fixturePackage = {
    packageManager: REQUIRED_PACKAGE_MANAGER,
    scripts: {
      [REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME]: REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND,
      'test:agent-completion-evidence': 'node scripts/agent-completion-evidence-audit.js',
      'test:agent-completion-evidence:json': 'node scripts/agent-completion-evidence-audit.js --json',
      'test:architecture-boundary': 'node scripts/architecture-boundary-audit.js',
      'test:provider-intelligence': 'node scripts/provider-intelligence-tests.js',
      'test:qa-audit:self': 'node scripts/qa-coverage-audit.js --self-test',
      'test:work-artifact-smoke': 'node scripts/collect-work-artifact-smoke.js',
      'test:work-artifact-smoke:self': 'node scripts/collect-work-artifact-smoke.js --self-test',
      'type-check': 'node node_modules/typescript/bin/tsc --noEmit',
    },
  }
  const audit = runAudit({ markdown: fixtureMarkdown, packageJson: fixturePackage, repoRoot: root })
  if (!audit.passed) throw new Error(`Self-test rejected complete fixture: ${audit.issues.join(', ')}`)
  const missingPackageManagerAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: { ...fixturePackage, packageManager: 'npm@10.0.0' },
    lockfiles: REQUIRED_LOCKFILES,
    repoRoot: root,
  })
  if (!missingPackageManagerAudit.issues.some((issue) => issue.includes('package-manager-drift'))) {
    throw new Error(`Self-test missed package manager drift: ${missingPackageManagerAudit.issues.join(', ')}`)
  }
  const missingLockfileAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: fixturePackage,
    lockfiles: [],
    repoRoot: root,
  })
  if (!missingLockfileAudit.issues.some((issue) => issue.includes('package-lockfile-missing:bun.lock'))) {
    throw new Error(`Self-test missed missing Bun lockfile: ${missingLockfileAudit.issues.join(', ')}`)
  }
  const mixedLockfileAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: fixturePackage,
    lockfiles: ['bun.lock', 'package-lock.json'],
    repoRoot: root,
  })
  if (!mixedLockfileAudit.issues.some((issue) => issue.includes('package-lockfile-unregistered:package-lock.json'))) {
    throw new Error(`Self-test missed mixed package manager lockfile: ${mixedLockfileAudit.issues.join(', ')}`)
  }
  const driftedRoadmapTitleAudit = runAudit({
    markdown: fixtureMarkdown.replace('# Agentic Workflow Roadmap', '# Agent Workflow Roadmap'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!driftedRoadmapTitleAudit.issues.some((issue) => issue.includes('roadmap-title-drift'))) {
    throw new Error(`Self-test missed roadmap title drift: ${driftedRoadmapTitleAudit.issues.join(', ')}`)
  }
  const driftedDurableGoalContractLabelAudit = runAudit({
    markdown: fixtureMarkdown.replace(REQUIRED_DURABLE_GOAL_CONTRACT_LABEL, 'Goal contract:'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!driftedDurableGoalContractLabelAudit.issues.some((issue) => issue.includes('durable-goal-contract-label-drift'))) {
    throw new Error(`Self-test missed durable goal contract label drift: ${driftedDurableGoalContractLabelAudit.issues.join(', ')}`)
  }
  const missingExecutionCadenceAudit = runAudit({
    markdown: fixtureMarkdown.replace(`## Execution Cadence\n\n${REQUIRED_EXECUTION_CADENCE_TEXT}\n\n`, ''),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (
    !missingExecutionCadenceAudit.issues.some((issue) => issue.includes('missing-roadmap-section:Execution Cadence')) ||
    !missingExecutionCadenceAudit.issues.some((issue) => issue.includes('execution-cadence-text-drift'))
  ) {
    throw new Error(`Self-test missed missing execution cadence section: ${missingExecutionCadenceAudit.issues.join(', ')}`)
  }
  const driftedExecutionCadenceAudit = runAudit({
    markdown: fixtureMarkdown.replace(REQUIRED_EXECUTION_CADENCE_TEXT, 'The workflow engine may keep task state in implicit ad-hoc code paths.'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!driftedExecutionCadenceAudit.issues.some((issue) => issue.includes('execution-cadence-text-drift'))) {
    throw new Error(`Self-test missed execution cadence text drift: ${driftedExecutionCadenceAudit.issues.join(', ')}`)
  }
  const reorderedRoadmapSectionAudit = runAudit({
    markdown: fixtureMarkdown
      .replace('## Current Validation Baseline', '## __SECTION_SWAP__')
      .replace('## Completion Target', '## Current Validation Baseline')
      .replace('## __SECTION_SWAP__', '## Completion Target'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedRoadmapSectionAudit.issues.some((issue) => issue.includes('roadmap-section-sequence-drift'))) {
    throw new Error(`Self-test missed roadmap section reorder: ${reorderedRoadmapSectionAudit.issues.join(', ')}`)
  }
  const reorderedDurableGoalAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      `- ${REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS[0]}.\n- ${REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS[1]}.`,
      `- ${REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS[1]}.\n- ${REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS[0]}.`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedDurableGoalAudit.issues.some((issue) => issue.includes('durable-goal-contract-sequence-drift'))) {
    throw new Error(`Self-test missed durable goal contract reorder: ${reorderedDurableGoalAudit.issues.join(', ')}`)
  }
  const reorderedValidationBaselineAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      `- \`${REQUIRED_VALIDATION_BASELINE_COMMANDS[0]}\`\n- \`${REQUIRED_VALIDATION_BASELINE_COMMANDS[1]}\``,
      `- \`${REQUIRED_VALIDATION_BASELINE_COMMANDS[1]}\`\n- \`${REQUIRED_VALIDATION_BASELINE_COMMANDS[0]}\``,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedValidationBaselineAudit.issues.some((issue) => issue.includes('validation-baseline-sequence-drift'))) {
    throw new Error(`Self-test missed validation baseline reorder: ${reorderedValidationBaselineAudit.issues.join(', ')}`)
  }
  const reorderedCompletionTargetAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      `- ${REQUIRED_TARGETS[0]}.\n- ${REQUIRED_TARGETS[1]}.`,
      `- ${REQUIRED_TARGETS[1]}.\n- ${REQUIRED_TARGETS[0]}.`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedCompletionTargetAudit.issues.some((issue) => issue.includes('completion-target-sequence-drift'))) {
    throw new Error(`Self-test missed completion target reorder: ${reorderedCompletionTargetAudit.issues.join(', ')}`)
  }
  const reorderedEvidenceRowAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      `${evidenceRow(REQUIRED_TARGETS[0])}\n${evidenceRow(REQUIRED_TARGETS[1])}`,
      `${evidenceRow(REQUIRED_TARGETS[1])}\n${evidenceRow(REQUIRED_TARGETS[0])}`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedEvidenceRowAudit.issues.some((issue) => issue.includes('evidence-map-row-sequence-drift'))) {
    throw new Error(`Self-test missed evidence row reorder: ${reorderedEvidenceRowAudit.issues.join(', ')}`)
  }
  const driftedEvidenceTableHeaderAudit = runAudit({
    markdown: fixtureMarkdown.replace(REQUIRED_COMPLETION_EVIDENCE_TABLE_HEADER, '| Target | Proof |'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!driftedEvidenceTableHeaderAudit.issues.some((issue) => issue.includes('completion-evidence-table-header-drift'))) {
    throw new Error(`Self-test missed completion evidence table header drift: ${driftedEvidenceTableHeaderAudit.issues.join(', ')}`)
  }
  const driftedEvidenceTableSeparatorAudit = runAudit({
    markdown: fixtureMarkdown.replace(REQUIRED_COMPLETION_EVIDENCE_TABLE_SEPARATOR, '| :--- | :--- |'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!driftedEvidenceTableSeparatorAudit.issues.some((issue) => issue.includes('completion-evidence-table-separator-drift'))) {
    throw new Error(`Self-test missed completion evidence table separator drift: ${driftedEvidenceTableSeparatorAudit.issues.join(', ')}`)
  }
  const extraEvidenceTableRowAudit = runAudit({
    markdown: fixtureMarkdown.replace(REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT, `| Unregistered workflow target | \`package.json\` |\n\n${REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT}`),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!extraEvidenceTableRowAudit.issues.some((issue) => issue.includes('completion-evidence-table-row-count-drift'))) {
    throw new Error(`Self-test missed completion evidence table row count drift: ${extraEvidenceTableRowAudit.issues.join(', ')}`)
  }
  const missingCompletionEvidenceNoteAudit = runAudit({
    markdown: fixtureMarkdown.replace(`\n${REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT}\n`, '\n'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!missingCompletionEvidenceNoteAudit.issues.some((issue) => issue.includes('completion-evidence-note-text-drift'))) {
    throw new Error(`Self-test missed missing completion evidence note: ${missingCompletionEvidenceNoteAudit.issues.join(', ')}`)
  }
  const driftedCompletionEvidenceNoteAudit = runAudit({
    markdown: fixtureMarkdown.replace(REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT, 'Treat narrow evidence as acceptable when tests are green.'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!driftedCompletionEvidenceNoteAudit.issues.some((issue) => issue.includes('completion-evidence-note-text-drift'))) {
    throw new Error(`Self-test missed completion evidence note drift: ${driftedCompletionEvidenceNoteAudit.issues.join(', ')}`)
  }
  const reorderedRiskControlAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      `- ${REQUIRED_RISK_CONTROL_BULLETS[0]}.\n- ${REQUIRED_RISK_CONTROL_BULLETS[1]}.`,
      `- ${REQUIRED_RISK_CONTROL_BULLETS[1]}.\n- ${REQUIRED_RISK_CONTROL_BULLETS[0]}.`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedRiskControlAudit.issues.some((issue) => issue.includes('risk-control-sequence-drift'))) {
    throw new Error(`Self-test missed risk control reorder: ${reorderedRiskControlAudit.issues.join(', ')}`)
  }
  const missingDurableGoalAudit = runAudit({
    markdown: fixtureMarkdown.replace(`- ${REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS[0]}.\n`, ''),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!missingDurableGoalAudit.issues.some((issue) => issue.includes('missing-durable-goal-contract-bullet'))) {
    throw new Error(`Self-test missed missing durable goal contract bullet: ${missingDurableGoalAudit.issues.join(', ')}`)
  }
  const unregisteredDurableGoalAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Execution Cadence', '- Allow unbounded background agent loops.\n\n## Execution Cadence'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!unregisteredDurableGoalAudit.issues.some((issue) => issue.includes('unregistered-durable-goal-contract-bullet'))) {
    throw new Error(`Self-test missed unregistered durable goal contract bullet: ${unregisteredDurableGoalAudit.issues.join(', ')}`)
  }
  const duplicateDurableGoalAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Execution Cadence', `- ${REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS[0]}.\n\n## Execution Cadence`),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!duplicateDurableGoalAudit.issues.some((issue) => issue.includes('duplicate-durable-goal-contract-bullet'))) {
    throw new Error(`Self-test missed duplicate durable goal contract bullet: ${duplicateDurableGoalAudit.issues.join(', ')}`)
  }
  const missingRiskControlAudit = runAudit({
    markdown: fixtureMarkdown.replace(`- ${REQUIRED_RISK_CONTROL_BULLETS[0]}.\n`, ''),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!missingRiskControlAudit.issues.some((issue) => issue.includes('missing-risk-control-bullet'))) {
    throw new Error(`Self-test missed missing risk control bullet: ${missingRiskControlAudit.issues.join(', ')}`)
  }
  const unregisteredRiskControlAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Risk Control', '## Risk Control\n\n- Allow arbitrary undo prompt JSON.'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!unregisteredRiskControlAudit.issues.some((issue) => issue.includes('unregistered-risk-control-bullet'))) {
    throw new Error(`Self-test missed unregistered risk control bullet: ${unregisteredRiskControlAudit.issues.join(', ')}`)
  }
  const duplicateRiskControlAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Risk Control', `## Risk Control\n\n- ${REQUIRED_RISK_CONTROL_BULLETS[0]}.`),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!duplicateRiskControlAudit.issues.some((issue) => issue.includes('duplicate-risk-control-bullet'))) {
    throw new Error(`Self-test missed duplicate risk control bullet: ${duplicateRiskControlAudit.issues.join(', ')}`)
  }
  const missingRowAudit = runAudit({
    markdown: fixtureMarkdown.replace(`${evidenceRow(REQUIRED_TARGETS[0])}\n`, ''),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!missingRowAudit.issues.some((issue) => issue.includes('missing-evidence-map-row'))) {
    throw new Error(`Self-test missed missing evidence row: ${missingRowAudit.issues.join(', ')}`)
  }
  const missingPackageScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: { scripts: { ...fixturePackage.scripts, 'test:agent-completion-evidence': 'node scripts/other.js' } },
    repoRoot: root,
  })
  if (!missingPackageScriptAudit.issues.some((issue) => issue.includes('agent-completion-evidence'))) {
    throw new Error(`Self-test missed package script drift: ${missingPackageScriptAudit.issues.join(', ')}`)
  }
  const missingJsonPackageScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: { scripts: { ...fixturePackage.scripts, 'test:agent-completion-evidence:json': 'node scripts/agent-completion-evidence-audit.js' } },
    repoRoot: root,
  })
  if (!missingJsonPackageScriptAudit.issues.some((issue) => issue.includes('package-script-missing:test:agent-completion-evidence:json'))) {
    throw new Error(`Self-test missed JSON package script drift: ${missingJsonPackageScriptAudit.issues.join(', ')}`)
  }
  const missingWorkArtifactSmokeSelfPackageScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: { scripts: { ...fixturePackage.scripts, 'test:work-artifact-smoke:self': 'node scripts/collect-work-artifact-smoke.js' } },
    repoRoot: root,
  })
  if (!missingWorkArtifactSmokeSelfPackageScriptAudit.issues.some((issue) => issue.includes('package-script-missing:test:work-artifact-smoke:self'))) {
    throw new Error(`Self-test missed work artifact smoke self-test script drift: ${missingWorkArtifactSmokeSelfPackageScriptAudit.issues.join(', ')}`)
  }
  const suffixReleaseScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      scripts: {
        ...fixturePackage.scripts,
        'test:architecture-boundary': 'node scripts/architecture-boundary-audit.js.disabled',
        'test:qa-audit:self': 'node scripts/qa-coverage-audit.js.disabled --self-test',
      },
    },
    repoRoot: root,
  })
  if (
    !suffixReleaseScriptAudit.issues.some((issue) => issue.includes('package-script-missing:test:architecture-boundary')) ||
    !suffixReleaseScriptAudit.issues.some((issue) => issue.includes('package-script-missing:test:qa-audit:self'))
  ) {
    throw new Error(`Self-test accepted suffix-matched release script drift: ${suffixReleaseScriptAudit.issues.join(', ')}`)
  }
  const missingProviderGatePackageAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: { scripts: { ...fixturePackage.scripts, 'test:provider-intelligence': 'node scripts/provider-intelligence-tests.js.disabled' } },
    repoRoot: root,
  })
  if (!missingProviderGatePackageAudit.issues.some((issue) => issue.includes('package-script-missing:test:provider-intelligence'))) {
    throw new Error(`Self-test missed provider gate package script drift: ${missingProviderGatePackageAudit.issues.join(', ')}`)
  }
  const missingBaselineAudit = runAudit({
    markdown: fixtureMarkdown.replace('- `bun run type-check`\n', ''),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!missingBaselineAudit.issues.some((issue) => issue.includes('missing-validation-baseline-command:bun run type-check'))) {
    throw new Error(`Self-test missed missing validation baseline command: ${missingBaselineAudit.issues.join(', ')}`)
  }
  const missingBaselinePackageScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      packageManager: REQUIRED_PACKAGE_MANAGER,
      scripts: Object.fromEntries(Object.entries(fixturePackage.scripts).filter(([scriptName]) => scriptName !== 'type-check')),
    },
    repoRoot: root,
  })
  if (!missingBaselinePackageScriptAudit.issues.some((issue) => issue.includes('validation-baseline-package-script-missing:type-check'))) {
    throw new Error(`Self-test missed missing validation baseline package script: ${missingBaselinePackageScriptAudit.issues.join(', ')}`)
  }
  const driftedBaselinePackageScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      packageManager: REQUIRED_PACKAGE_MANAGER,
      scripts: {
        ...fixturePackage.scripts,
        'test:work-artifact-smoke': 'node scripts/collect-work-artifact-smoke.js --dry-run',
      },
    },
    repoRoot: root,
  })
  if (!driftedBaselinePackageScriptAudit.issues.some((issue) => issue.includes('validation-baseline-package-script-drift:test:work-artifact-smoke'))) {
    throw new Error(`Self-test missed drifted validation baseline package script: ${driftedBaselinePackageScriptAudit.issues.join(', ')}`)
  }
  const missingBaselineNodeScriptAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: fixturePackage,
    repoRoot: path.join(root, '.missing-agent-baseline-fixture'),
  })
  if (!missingBaselineNodeScriptAudit.issues.some((issue) => issue.includes('validation-baseline-node-script-missing:scripts/architecture-boundary-audit.js'))) {
    throw new Error(`Self-test missed missing validation baseline node script: ${missingBaselineNodeScriptAudit.issues.join(', ')}`)
  }
  if (!missingBaselineNodeScriptAudit.issues.some((issue) => issue.includes('validation-baseline-package-script-node-file-missing:test:agent-workflow:scripts/agentic-workflow-tests.js'))) {
    throw new Error(`Self-test missed missing validation baseline package script node file: ${missingBaselineNodeScriptAudit.issues.join(', ')}`)
  }
  if (!missingBaselineNodeScriptAudit.issues.some((issue) => issue.includes('package-script-node-file-missing:test:agent-completion-evidence:scripts/agent-completion-evidence-audit.js'))) {
    throw new Error(`Self-test missed missing required package script node file: ${missingBaselineNodeScriptAudit.issues.join(', ')}`)
  }
  const unregisteredBaselineAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Completion Target', '- `bun run test:unknown-gate`\n\n## Completion Target'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!unregisteredBaselineAudit.issues.some((issue) => issue.includes('unregistered-validation-baseline-command:bun run test:unknown-gate'))) {
    throw new Error(`Self-test missed unregistered validation baseline command: ${unregisteredBaselineAudit.issues.join(', ')}`)
  }
  const missingAgentWorkflowRunAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      scripts: {
        ...fixturePackage.scripts,
        'test:agent-workflow': REQUIRED_AGENT_WORKFLOW_SCRIPTS
          .filter((scriptPath) => scriptPath !== 'scripts/agent-completion-evidence-audit.js')
          .map((scriptPath) => `node ${scriptPath}`)
          .join(' && '),
      },
    },
    repoRoot: root,
  })
  if (!missingAgentWorkflowRunAudit.issues.some((issue) => issue.includes('agent-workflow-script-not-run:scripts/agent-completion-evidence-audit.js'))) {
    throw new Error(`Self-test missed agent workflow script omission: ${missingAgentWorkflowRunAudit.issues.join(', ')}`)
  }
  const suffixAgentWorkflowRunAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      scripts: {
        ...fixturePackage.scripts,
        'test:agent-workflow': REQUIRED_AGENT_WORKFLOW_SCRIPTS
          .map((scriptPath) => scriptPath === 'scripts/agent-completion-evidence-audit.js'
            ? 'node scripts/agent-completion-evidence-audit.js.disabled'
            : `node ${scriptPath}`)
          .join(' && '),
      },
    },
    repoRoot: root,
  })
  if (!suffixAgentWorkflowRunAudit.issues.some((issue) => issue.includes('agent-workflow-script-not-run:scripts/agent-completion-evidence-audit.js'))) {
    throw new Error(`Self-test accepted suffix-matched package script drift: ${suffixAgentWorkflowRunAudit.issues.join(', ')}`)
  }
  const reorderedAgentWorkflowRunAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      scripts: {
        ...fixturePackage.scripts,
        'test:agent-workflow': [
          'scripts/agent-rag-quality-tests.js',
          'scripts/agentic-workflow-tests.js',
          ...REQUIRED_AGENT_WORKFLOW_SCRIPTS.slice(2),
        ].map((scriptPath) => `node ${scriptPath}`).join(' && '),
      },
    },
    repoRoot: root,
  })
  if (!reorderedAgentWorkflowRunAudit.issues.some((issue) => issue.includes('agent-workflow-script-sequence-drift'))) {
    throw new Error(`Self-test missed reordered agent workflow script sequence: ${reorderedAgentWorkflowRunAudit.issues.join(', ')}`)
  }
  if (!reorderedAgentWorkflowRunAudit.issues.some((issue) => issue.includes('agent-workflow-package-script-command-drift'))) {
    throw new Error(`Self-test missed agent workflow package script command drift: ${reorderedAgentWorkflowRunAudit.issues.join(', ')}`)
  }
  const extraAgentWorkflowRunAudit = runAudit({
    markdown: fixtureMarkdown,
    packageJson: {
      scripts: {
        ...fixturePackage.scripts,
        'test:agent-workflow': [
          ...REQUIRED_AGENT_WORKFLOW_SCRIPTS.map((scriptPath) => `node ${scriptPath}`),
          'node scripts/unregistered-agent-workflow-gate.js',
        ].join(' && '),
      },
    },
    repoRoot: root,
  })
  if (!extraAgentWorkflowRunAudit.issues.some((issue) => issue.includes('agent-workflow-script-sequence-drift'))) {
    throw new Error(`Self-test missed extra agent workflow script sequence: ${extraAgentWorkflowRunAudit.issues.join(', ')}`)
  }
  const weakEvidenceAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      evidenceRow(REQUIRED_TARGETS[0]),
      `| ${REQUIRED_TARGETS[0]} | \`package.json\` |`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!weakEvidenceAudit.issues.some((issue) => issue.includes('missing-required-evidence'))) {
    throw new Error(`Self-test accepted weak target evidence: ${weakEvidenceAudit.issues.join(', ')}`)
  }
  const extraEvidenceAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      evidenceRow(REQUIRED_TARGETS[0]),
      `| ${REQUIRED_TARGETS[0]} | ${REQUIRED_TARGET_EVIDENCE[REQUIRED_TARGETS[0]].map((item) => `\`${item}\``).join(', ')}, \`package.json\` |`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (
    !extraEvidenceAudit.issues.some((issue) => issue.includes('unregistered-evidence:package.json')) ||
    !extraEvidenceAudit.issues.some((issue) => issue.includes('evidence-sequence-drift'))
  ) {
    throw new Error(`Self-test accepted extra target evidence: ${extraEvidenceAudit.issues.join(', ')}`)
  }
  const reorderedEvidenceAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      evidenceRow(REQUIRED_TARGETS[0]),
      `| ${REQUIRED_TARGETS[0]} | ${[
        REQUIRED_TARGET_EVIDENCE[REQUIRED_TARGETS[0]][1],
        REQUIRED_TARGET_EVIDENCE[REQUIRED_TARGETS[0]][0],
        REQUIRED_TARGET_EVIDENCE[REQUIRED_TARGETS[0]][2],
      ].map((item) => `\`${item}\``).join(', ')} |`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!reorderedEvidenceAudit.issues.some((issue) => issue.includes('evidence-sequence-drift'))) {
    throw new Error(`Self-test accepted reordered target evidence: ${reorderedEvidenceAudit.issues.join(', ')}`)
  }
  const duplicateTargetAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Completion Evidence Map', `- ${REQUIRED_TARGETS[0]}.\n\n## Completion Evidence Map`),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!duplicateTargetAudit.issues.some((issue) => issue.includes('duplicate-completion-target'))) {
    throw new Error(`Self-test missed duplicate completion target: ${duplicateTargetAudit.issues.join(', ')}`)
  }
  const duplicateEvidenceAudit = runAudit({
    markdown: fixtureMarkdown.replace('| --- | --- |', `| --- | --- |\n| ${REQUIRED_TARGETS[0]} | \`package.json\` |`),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!duplicateEvidenceAudit.issues.some((issue) => issue.includes('duplicate-evidence-map-row'))) {
    throw new Error(`Self-test missed duplicate evidence row: ${duplicateEvidenceAudit.issues.join(', ')}`)
  }
  const unregisteredTargetAudit = runAudit({
    markdown: fixtureMarkdown.replace('## Completion Evidence Map', '- Unregistered workflow target.\n\n## Completion Evidence Map'),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!unregisteredTargetAudit.issues.some((issue) => issue.includes('unregistered-completion-target'))) {
    throw new Error(`Self-test missed unregistered completion target: ${unregisteredTargetAudit.issues.join(', ')}`)
  }
  const duplicateEvidenceEntryAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      evidenceRow(REQUIRED_TARGETS[0]),
      `| ${REQUIRED_TARGETS[0]} | \`package.json\`, \`package.json\` |`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!duplicateEvidenceEntryAudit.issues.some((issue) => issue.includes('duplicate-evidence:package.json'))) {
    throw new Error(`Self-test missed duplicate evidence entry: ${duplicateEvidenceEntryAudit.issues.join(', ')}`)
  }
  const invalidEvidenceEntryAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      evidenceRow(REQUIRED_TARGETS[0]),
      `| ${REQUIRED_TARGETS[0]} | \`src/services/agent/agentPlanner.ts\`, \`src\\services\\agent\\agentIntentClassifier.ts\`, \`https://example.invalid/evidence\`, \`src/../package.json\` |`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (
    !invalidEvidenceEntryAudit.issues.some((issue) => issue.includes('invalid-evidence-entry:src\\services\\agent\\agentIntentClassifier.ts')) ||
    !invalidEvidenceEntryAudit.issues.some((issue) => issue.includes('invalid-evidence-entry:https://example.invalid/evidence')) ||
    !invalidEvidenceEntryAudit.issues.some((issue) => issue.includes('invalid-evidence-entry:src/../package.json'))
  ) {
    throw new Error(`Self-test missed invalid evidence entries: ${invalidEvidenceEntryAudit.issues.join(', ')}`)
  }
  const nonFileEvidencePathAudit = runAudit({
    markdown: fixtureMarkdown.replace(
      evidenceRow(REQUIRED_TARGETS[0]),
      `| ${REQUIRED_TARGETS[0]} | ${REQUIRED_TARGET_EVIDENCE[REQUIRED_TARGETS[0]].map((item) => `\`${item}\``).join(', ')}, \`src/services/agent\` |`,
    ),
    packageJson: fixturePackage,
    repoRoot: root,
  })
  if (!nonFileEvidencePathAudit.issues.some((issue) => issue.includes('non-file-evidence-path:src/services/agent'))) {
    throw new Error(`Self-test missed non-file evidence path: ${nonFileEvidencePathAudit.issues.join(', ')}`)
  }
  const jsonAuditOutput = formatAuditOutput(audit, { json: true })
  const parsedJsonAuditOutput = JSON.parse(jsonAuditOutput)
  if (parsedJsonAuditOutput.schema !== SCHEMA || parsedJsonAuditOutput.passed !== true) {
    throw new Error(`Self-test produced invalid JSON audit output: ${jsonAuditOutput}`)
  }
  if (
    parsedJsonAuditOutput.requiredPackageManager !== REQUIRED_PACKAGE_MANAGER ||
    !arrayEquals(parsedJsonAuditOutput.requiredLockfiles, REQUIRED_LOCKFILES) ||
    !arrayEquals(parsedJsonAuditOutput.knownLockfiles, KNOWN_LOCKFILES) ||
    parsedJsonAuditOutput.lockfileCount !== REQUIRED_LOCKFILES.length
  ) {
    throw new Error(`Self-test produced incomplete package manager JSON audit output: ${jsonAuditOutput}`)
  }
  if (
    !arrayEquals(parsedJsonAuditOutput.requiredValidationBaselineCommands, REQUIRED_VALIDATION_BASELINE_COMMANDS) ||
    !arrayEquals(parsedJsonAuditOutput.validationBaselineCommands, REQUIRED_VALIDATION_BASELINE_COMMANDS) ||
    parsedJsonAuditOutput.requiredValidationBaselineExecution?.['bun run test:work-artifact-smoke']?.packageScriptName !== 'test:work-artifact-smoke' ||
    parsedJsonAuditOutput.validationBaselineSummaries?.length !== REQUIRED_VALIDATION_BASELINE_COMMANDS.length ||
    parsedJsonAuditOutput.validationBaselineSummaries?.some((summary) => summary.covered !== true) ||
    parsedJsonAuditOutput.validationBaselineSummaries?.some((summary) => summary.nodeFileSteps?.length > 0 && summary.missingNodeFileSteps?.length !== 0) ||
    parsedJsonAuditOutput.validationBaselineExecutableCount !== REQUIRED_VALIDATION_BASELINE_COMMANDS.length ||
    !arrayEquals(parsedJsonAuditOutput.requiredAgentWorkflowScripts, REQUIRED_AGENT_WORKFLOW_SCRIPTS) ||
    parsedJsonAuditOutput.requiredAgentWorkflowPackageScriptName !== REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME ||
    parsedJsonAuditOutput.requiredAgentWorkflowPackageScriptCommand !== REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND ||
    parsedJsonAuditOutput.agentWorkflowPackageScriptCommand !== REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND ||
    parsedJsonAuditOutput.agentWorkflowPackageScriptMatches !== true ||
    parsedJsonAuditOutput.packageScriptSummaries?.length !== Object.keys(REQUIRED_PACKAGE_SCRIPTS).length ||
    parsedJsonAuditOutput.packageScriptSummaries?.some((summary) => summary.covered !== true) ||
    parsedJsonAuditOutput.packageScriptSummaries?.some((summary) => summary.nodeFileSteps?.length > 0 && summary.missingNodeFileSteps?.length !== 0) ||
    parsedJsonAuditOutput.packageScriptCoveredCount !== Object.keys(REQUIRED_PACKAGE_SCRIPTS).length ||
    parsedJsonAuditOutput.requiredPackageScripts?.['test:work-artifact-smoke:self'] !== 'node scripts/collect-work-artifact-smoke.js --self-test'
  ) {
    throw new Error(`Self-test produced incomplete gate contract JSON audit output: ${jsonAuditOutput}`)
  }
  if (
    parsedJsonAuditOutput.requiredRoadmapTitle !== REQUIRED_ROADMAP_TITLE ||
    parsedJsonAuditOutput.requiredDurableGoalContractLabel !== REQUIRED_DURABLE_GOAL_CONTRACT_LABEL ||
    !arrayEquals(parsedJsonAuditOutput.requiredRoadmapSectionSequence, REQUIRED_ROADMAP_SECTION_SEQUENCE) ||
    !arrayEquals(parsedJsonAuditOutput.roadmapSectionSequence, REQUIRED_ROADMAP_SECTION_SEQUENCE) ||
    parsedJsonAuditOutput.requiredExecutionCadenceText !== REQUIRED_EXECUTION_CADENCE_TEXT ||
    !arrayEquals(parsedJsonAuditOutput.requiredDurableGoalContractBullets, REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS) ||
    !arrayEquals(parsedJsonAuditOutput.durableGoalContractBullets, REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS) ||
    !arrayEquals(parsedJsonAuditOutput.requiredRiskControlBullets, REQUIRED_RISK_CONTROL_BULLETS) ||
    !arrayEquals(parsedJsonAuditOutput.riskControlBullets, REQUIRED_RISK_CONTROL_BULLETS) ||
    !arrayEquals(parsedJsonAuditOutput.requiredCompletionTargets, REQUIRED_TARGETS) ||
    !arrayEquals(parsedJsonAuditOutput.completionTargets, REQUIRED_TARGETS) ||
    parsedJsonAuditOutput.requiredTargetEvidence?.[REQUIRED_TARGETS[0]]?.[0] !== REQUIRED_TARGET_EVIDENCE[REQUIRED_TARGETS[0]][0] ||
    parsedJsonAuditOutput.evidenceTargets?.length !== REQUIRED_TARGETS.length
  ) {
    throw new Error(`Self-test produced incomplete roadmap contract JSON audit output: ${jsonAuditOutput}`)
  }
  const textAuditOutput = formatAuditOutput(audit)
  if (textAuditOutput !== formatAuditSuccessMessage(audit)) {
    throw new Error(`Self-test produced invalid text audit output: ${textAuditOutput}`)
  }
  const failedJsonAuditOutput = formatAuditOutput(missingRowAudit, { json: true })
  const parsedFailedJsonAuditOutput = JSON.parse(failedJsonAuditOutput)
  if (parsedFailedJsonAuditOutput.passed !== false || !parsedFailedJsonAuditOutput.issues.some((issue) => issue.includes('missing-evidence-map-row'))) {
    throw new Error(`Self-test produced invalid failing JSON audit output: ${failedJsonAuditOutput}`)
  }
  console.log('Agent completion evidence audit self-test passed')
}

function readSection(markdown, title) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, 'm')
  const match = pattern.exec(markdown)
  if (!match) return ''
  const start = match.index + match[0].length
  const rest = markdown.slice(start)
  const next = /^##\s+/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function parseEvidenceEntries(cell) {
  const entries = []
  const codePattern = /`([^`]+)`/g
  let match
  while ((match = codePattern.exec(cell))) entries.push(match[1].trim())
  if (entries.length) return entries
  return cell.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseMarkdownBulletListSection(markdown, title) {
  const section = readSection(markdown, title)
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .map((value) => value.replace(/\.$/, '').trim())
}

function isRepositoryPath(value) {
  return /^(app|docs|scripts|src|package\.json)(\/|$)/.test(value)
}

function isSafeRepositoryPath(value) {
  if (!isRepositoryPath(value)) return false
  if (value.includes('\\') || value.includes('\0')) return false
  if (path.isAbsolute(value) || value.includes('..')) return false
  return path.posix.normalize(value) === value
}

function packageAgentWorkflowRunsScript(packageJson, scriptPath) {
  return packageScriptRunsNodeFile(packageJson, REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME, scriptPath)
}

function packageAgentWorkflowMatchesRequiredSequence(packageJson) {
  const command = packageJson.scripts?.[REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME]
  if (typeof command !== 'string') return false
  const expectedSteps = splitPackageCommandSteps(REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND)
  const actualSteps = splitPackageCommandSteps(command)
  return actualSteps.length === expectedSteps.length &&
    actualSteps.every((step, index) => step === expectedSteps[index])
}

function splitPackageCommandSteps(command) {
  return command
    .split(/\s+&&\s+/)
    .map(normalizePackageCommandStep)
    .filter(Boolean)
}

function collectPackageScriptNodeFileSteps(command) {
  return splitPackageCommandSteps(command)
    .map((step) => step.match(/^node\s+([^\s]+)(?:\s|$)/)?.[1])
    .filter(Boolean)
    .map((scriptPath) => scriptPath.replace(/^\.\//, ''))
}

function localNodeFileExists(repoRoot, scriptPath) {
  const fullPath = path.join(repoRoot, scriptPath)
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()
}

function normalizePackageCommandStep(command) {
  return command.trim().replace(/\\/g, '/').replace(/\s+/g, ' ').replace(/^node\s+\.\//, 'node ')
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function arrayEquals(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wantsJsonOutput(argv) {
  return argv.includes('--json')
}

function formatAuditSuccessMessage(audit) {
  return `Agent completion evidence audit passed (${audit.completionTargetCount} targets, ${audit.packageCoveredScriptCount} package-covered scripts)`
}

function formatAuditOutput(audit, options = {}) {
  if (options.json) return JSON.stringify(audit, null, 2)
  if (!audit.passed) return JSON.stringify(audit, null, 2)
  return formatAuditSuccessMessage(audit)
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }
  const audit = runAudit()
  const json = wantsJsonOutput(process.argv)
  const output = formatAuditOutput(audit, { json })
  if (!audit.passed) {
    console.error(output)
    process.exitCode = 1
    return
  }
  console.log(output)
}

if (require.main === module) main()

module.exports = {
  SCHEMA,
  parseRoadmapTitle,
  parseDurableGoalContractLabel,
  parseDurableGoalContractBullets,
  parseExecutionCadenceText,
  parseCompletionEvidenceNoteText,
  parseCompletionEvidenceTableShape,
  parseRiskControlBullets,
  parseCompletionEvidenceTargets,
  parseCompletionTargetBullets,
  parseRoadmapSectionSequence,
  summarizeCompletionEvidenceTarget,
  summarizeRequiredPackageScript,
  summarizeRequiredPackageScripts,
  summarizeValidationBaselineCommand,
  summarizeValidationBaselineCommands,
  isSafeRepositoryPath,
  packageAgentWorkflowMatchesRequiredSequence,
  packageAgentWorkflowRunsScript,
  packageScriptMatchesCommand,
  packageScriptRunsNodeFile,
  packageScriptRunsEvidenceScript,
  collectPackageScriptNodeFileSteps,
  collectRepositoryLockfiles,
  formatAuditOutput,
  formatAuditSuccessMessage,
  runAudit,
  wantsJsonOutput,
  REQUIRED_COMPLETION_EVIDENCE_NOTE_TEXT,
  REQUIRED_COMPLETION_EVIDENCE_TABLE_HEADER,
  REQUIRED_COMPLETION_EVIDENCE_TABLE_SEPARATOR,
  REQUIRED_DURABLE_GOAL_CONTRACT_LABEL,
  REQUIRED_EXECUTION_CADENCE_TEXT,
  REQUIRED_AGENT_WORKFLOW_SCRIPTS,
  REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_NAME,
  REQUIRED_AGENT_WORKFLOW_PACKAGE_SCRIPT_COMMAND,
  REQUIRED_DURABLE_GOAL_CONTRACT_BULLETS,
  KNOWN_LOCKFILES,
  REQUIRED_LOCKFILES,
  REQUIRED_PACKAGE_MANAGER,
  REQUIRED_PACKAGE_SCRIPTS,
  REQUIRED_VALIDATION_BASELINE_EXECUTION,
  REQUIRED_RISK_CONTROL_BULLETS,
  REQUIRED_VALIDATION_BASELINE_COMMANDS,
  REQUIRED_ROADMAP_TITLE,
  REQUIRED_ROADMAP_SECTION_SEQUENCE,
  REQUIRED_TARGETS,
  REQUIRED_TARGET_EVIDENCE,
}
