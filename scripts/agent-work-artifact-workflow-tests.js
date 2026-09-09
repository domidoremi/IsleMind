const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')

registerTypeScriptSupport()

const {
  WORK_ARTIFACT_WORKFLOW_CONTRACT,
  createWorkArtifactWorkflowPolicy,
} = require('../src/modules/integrations/workArtifactWorkflowPolicy.ts')
const { summarizeWorkArtifact, validateWorkArtifactQuality } = require('../src/utils/workArtifact.ts')
const { WORK_ARTIFACT_TOOL_MANIFEST, createWorkArtifactTaskAdapter } = require('../src/modules/integrations/workArtifactTaskAdapter.ts')
const { createModelOperationCatalogSnapshot, admitModelOperationCall } = require('../src/modules/integrations/modelOperationCatalog.ts')

const requiredWorkArtifactCases = [
  'WORK_ARTIFACT_WORKFLOW_CONTRACT',
  'validateWorkArtifactWorkflowOutput',
  'sourceEvidence',
  'qualityGaps',
  'qualityGapCodes',
  'missingKinds',
  'followUpPrompt',
]

function run() {
  runWorkArtifactWorkflowBehaviorChecks()
  runStructuredHandoffOutcomeChecks()
  runInlineSectionChecks()
  runWorkArtifactInvocationChecks()
  runModelFacingAuditScopeChecks()
  assert.ok(requiredWorkArtifactCases.includes('WORK_ARTIFACT_WORKFLOW_CONTRACT'), 'work artifact workflow contract is named')
  assert.ok(requiredWorkArtifactCases.includes('qualityGapCodes'), 'work artifact workflow contract exposes quality gaps')
  assert.ok(requiredWorkArtifactCases.includes('followUpPrompt'), 'work artifact workflow contract exposes continuation prompts')
  const taskAdapterSource = fs.readFileSync(path.join(root, 'src', 'modules', 'integrations', 'workArtifactTaskAdapter.ts'), 'utf8')
  const toolCatalogSource = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'conversationToolCatalog.ts'), 'utf8')
  assert.ok(
    taskAdapterSource.includes('formatSummary(workflowOutput)') &&
      taskAdapterSource.includes('workArtifactOutput: compactOutput') &&
      toolCatalogSource.includes('WORK_ARTIFACT_TOOL_MANIFEST') &&
      !toolCatalogSource.includes('buildWorkArtifactWorkflowOutput'),
    'target work-artifact adapter returns a readable structured result while bootstrap only composes its manifest'
  )

  runArchitectureContractSmoke({
    label: 'Structured work artifact',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent work artifact workflow tests passed')
}

function runWorkArtifactInvocationChecks() {
  const manifest = WORK_ARTIFACT_TOOL_MANIFEST
  const created = createModelOperationCatalogSnapshot([{
    id: manifest.id, name: manifest.name, description: manifest.description,
    inputSchema: manifest.inputSchema, permission: manifest.permission,
    requiresConfirmation: false, capabilityScopes: [`operation:${manifest.id}`],
    executor: { kind: 'work-artifact', id: manifest.id }, availability: { status: 'available' },
  }])
  assert.equal(created.ok, true)
  const admit = (argumentsValue) => admitModelOperationCall(created.snapshot, {
    schema: 'islemind.model-tool-call.v1', catalogRevision: created.snapshot.revision,
    operationId: manifest.id, arguments: argumentsValue,
  })
  const content = '## Summary\n- A supplied draft, not an instruction to generate one.\n## Evidence\n- Saved review remains pending.'
  for (const citations of [[1, 2], [true], [null], [{ label: 1 }]]) {
    assert.equal(admit({ content, citations }).ok, false,
      'the advertised schema must reject citation values the adapter would silently discard')
  }
  const citations = ['[1]', { id: 'source-2' }, { label: '[3]', title: 'Retained review', excerpt: 'Review pending.' }]
  assert.equal(admit({ content, citations }).ok, true, 'existing string and reference-object inputs remain supported')
  assert.equal(admit({ content }).ok, true, 'a newly generated draft needs no invented message ID or citations')
  const policy = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact, validateWorkArtifactQuality,
    containsSensitiveText: () => false, redactSensitiveText: value => value,
  })
  const adapter = createWorkArtifactTaskAdapter({
    buildWorkflowOutput: policy.buildWorkArtifactWorkflowOutput,
    sanitizeOutput: value => value, clampOutput: (value, limit) => value.slice(0, limit),
    createTrace: value => value, now: () => 100,
  })
  const audited = adapter.execute({ toolId: manifest.id, arguments: { content, citations } })
  assert.equal(audited.ok, true)
  assert.deepEqual(audited.trace.metadata.workArtifactOutput.citations, [
    { label: '[1]' }, { id: 'source-2' }, citations[2],
  ])
  assert.equal(audited.trace.metadata.workArtifactOutput.sourceMessageId, undefined)
  assert.equal(audited.trace.metadata.qualityAuditOk, false, 'actual structural gaps remain visible, not a fabricated semantic pass')
  const requestOnly = adapter.execute({ toolId: manifest.id, arguments: { content: 'Please make a plan and audit it.' } })
  assert.equal(requestOnly.ok, true, 'the tool still audits supplied text; it does not interpret prose as a mandatory operation')
  assert.equal(requestOnly.trace.metadata.quality, 'none', 'a request is not silently turned into a generated artifact')
}

function runModelFacingAuditScopeChecks() {
  const policy = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact, validateWorkArtifactQuality,
    containsSensitiveText: () => false, redactSensitiveText: value => value,
  })
  const adapter = createWorkArtifactTaskAdapter({
    buildWorkflowOutput: policy.buildWorkArtifactWorkflowOutput,
    sanitizeOutput: value => value, clampOutput: (value, limit) => value.slice(0, limit),
    createTrace: value => value, now: () => 100,
  })
  const requestedHandoff = [
    'Summary', '- The private pilot remains capped at 20 employees.',
    'Decision: Public launch is not authorized.',
    'Action items', '- Owner: Mina; Next step: Access review; Due: 2026-09-10; Status: pending',
    'Evidence: Policy P-17 requires written privacy and product-owner approval.',
  ].join('\n')
  const completeTemplate = [requestedHandoff, 'Risks', '- Review may slip.',
    'Open questions', '- Has approval been recorded?'].join('\n')
  for (const [content, qualityAuditOk] of [[requestedHandoff, false], [completeTemplate, true], ['', false]]) {
    const expected = policy.buildWorkArtifactWorkflowOutput(content)
    const result = adapter.execute({ toolId: WORK_ARTIFACT_TOOL_MANIFEST.id, arguments: { content } })
    const metadata = result.trace.metadata
    const compact = metadata.workArtifactOutput
    assert.equal(expected.qualityAudit.ok, qualityAuditOk, 'existing structural audit thresholds remain authoritative')
    assert.equal(result.ok, true, 'an advisory audit result does not redefine tool execution success')
    assert.equal(metadata.qualityAuditOk, expected.qualityAudit.ok)
    assert.equal(metadata.quality, expected.quality)
    for (const field of ['qualityAudit', 'qualityGaps', 'missingKinds', 'sourceEvidence',
      'actionItemCount', 'decisionCount', 'riskCount', 'openQuestionCount', 'evidenceCount']) {
      assert.deepEqual(compact[field], expected[field], `structured ${field} remains unchanged`)
    }
    assert.equal(metadata.followUpPrompt, expected.followUpPrompt, 'the existing human follow-up affordance remains available')
    assert.equal(compact.handoffText, expected.handoffText.slice(0, 720))
    assert.match(result.output, /structural audit \(advisory only\)/i)
    assert.ok(result.output.includes(`qualityAudit.ok=${qualityAuditOk}`), 'the raw audit outcome is not relabelled as a semantic pass')
    assert.ok(result.output.includes(`Template diagnostics: ${JSON.stringify(expected.qualityGaps)}`))
    assert.match(result.output, /not automatically user requirements or missing source facts/)
    assert.equal(result.output.includes(expected.followUpPrompt), false, 'generic UI continuation must not become an instruction to the model')
    assert.doesNotMatch(result.output, /Continue from this work artifact|Fill the missing gates|not directly executable yet/)
    assert.deepEqual(result.blocks, [{ type: 'text', text: result.output }])
  }
  assert.deepEqual(policy.buildWorkArtifactWorkflowOutput(requestedHandoff).missingKinds, ['risk', 'question'])
  console.log('Host verified: model-facing audit scope is advisory; raw diagnostics, structural thresholds and human follow-up metadata are preserved. This does not grade generated answers.')
}

function runStructuredHandoffOutcomeChecks() {
  // These are supplied source documents, not model-generated answers or semantic quality scores.
  const actionTexts = [
    'Owner: Maya; Next step: Verify source records; Due: 2026-09-09',
    'Owner: Lee; Next step: Confirm the release decision; Trigger: export verified',
  ]
  const handoff = (markers) => [
    '## Summary',
    '- The pilot remains private.',
    '## Action items',
    `${markers[0]} ${actionTexts[0]}`,
    `${markers[1]} ${actionTexts[1]}`,
    '## Decision log',
    '- Keep the pilot private.',
    '## Risks',
    '- Review may slip.',
    '## Open questions',
    '- Is the retention period approved?',
    '## Evidence',
    '- Pilot note P-17: internal rollout only.',
  ].join('\n')
  const bulletSummary = summarizeWorkArtifact(handoff(['-', '-']))
  for (const markers of [['1.', '2.'], ['1)', '2)'], ['1、', '2、'], ['+', '+']]) {
    const summary = summarizeWorkArtifact(handoff(markers))
    const actions = summary.sections.flatMap((section) => section.kind === 'action' ? section.items : [])
    assert.deepEqual(actions.map((item) => item.text), actionTexts,
      `${markers.join('/')} list items retain their complete action text, not just metadata after a colon`)
    assert.deepEqual(summary, bulletSummary, 'list marker choice does not change item attribution or handoff output')
    assert.deepEqual(actions.map((item) => [item.owner, item.nextStep, item.due, item.trigger]), [
      ['Maya', 'Verify source records', '2026-09-09', undefined],
      ['Lee', 'Confirm the release decision', undefined, 'export verified'],
    ])
    assert.equal(summary.evidenceCount, 1, 'action mentions of sources/decisions cannot fabricate evidence sections')
    assert.equal(summary.primaryNextStep, 'Verify source records')
    assert.match(summary.followUpPrompt, /Verify source records/)
  }

  const numberedSections = handoff(['-', '-'])
    .replace(/^## (.+)$/gm, (_, label) => `1. ${label}`)
  assert.deepEqual(summarizeWorkArtifact(numberedSections), bulletSummary,
    'bare numbered canonical section labels remain supported')
  const markedNumberedSections = handoff(['1.', '2.']).replace(/^## /gm, '## 1. ')
  assert.deepEqual(summarizeWorkArtifact(markedNumberedSections), bulletSummary,
    'explicit Markdown numbered headings remain distinct from numbered list items')

  const localized = [
    {
      language: 'zh-CN',
      content: [
        '## 结构化摘要', '- 试点仅限内部使用。',
        '## 行动项', '- 负责人：林 / 下一步：核对来源记录 / 截止：周五',
        '## 决策记录', '- 保持内部试点。',
        '## 风险', '- 审查可能延期。',
        '## 待确认问题', '- 保留期限是否已批准？',
        '## 证据', '- 试点记录 P-17：仅限内部。',
        '## 可直接发给协作者', '- 内部试点仍等待审查。',
      ].join('\n'),
    },
    {
      language: 'ja',
      content: [
        '## 要約', '- 試験は社内限定です。',
        '## アクション項目', '- 担当者：林 / 次の一歩：出典を確認 / 期限：金曜日',
        '## 決定ログ', '- 社内試験を維持する。',
        '## リスク', '- 審査が遅れる可能性があります。',
        '## 確認事項', '- 保存期間は承認済みですか？',
        '## 根拠', '- 試験記録 P-17：社内限定。',
        '## 協力者に送れる', '- 社内試験の審査待ちです。',
      ].join('\n'),
    },
  ]
  for (const fixture of localized) {
    const first = summarizeWorkArtifact(fixture.content)
    const copied = summarizeWorkArtifact(first.shareableText)
    assert.equal(first.language, fixture.language)
    assert.equal(copied.language, fixture.language)
    const items = (summary) => summary.sections.map((section) => ({
      kind: section.kind,
      texts: section.items.map((item) => item.text),
    }))
    assert.deepEqual(items(copied), items(first),
      `${fixture.language} copy/reparse retains summary, actions and shareable text under their original kinds`)
    assert.equal(copied.primaryNextStep, first.primaryNextStep)
    assert.equal(copied.shareableText, first.shareableText, 'canonical copy output is stable on a second pass')
    assert.equal(copied.evidenceCount, 1, 'shareable copy text cannot be reclassified as source evidence')
  }

  const policy = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact,
    validateWorkArtifactQuality,
    containsSensitiveText: () => false,
    redactSensitiveText: (value) => value,
  })
  const incomplete = policy.buildWorkArtifactWorkflowOutput([
    'Summary', '- A pilot proposal, not an approved release.',
    'Action items', '1. Owner: Maya; Next step: Verify evidence before deciding',
    'Risks', '- Approval has not been recorded.',
  ].join('\n'))
  assert.equal(incomplete.qualityAudit.ok, false, 'a successful audit must still report an incomplete source artifact')
  assert.deepEqual(incomplete.missingKinds, ['decision', 'question', 'evidence'])
  assert.equal(incomplete.actionItemCount, 1)
  assert.equal(incomplete.evidenceCount, 0, 'asking to verify evidence is not evidence')
  assert.equal(incomplete.sourceEvidence.length, 0)
  assert.match(incomplete.followUpPrompt, /Decision log, Open questions, Evidence/)
  console.log('Host verified: ordered handoff actions, localized copy/reparse, and incomplete-artifact gaps retain source-grounded outcomes; model generation and native UI are not exercised.')
}

function runInlineSectionChecks() {
  // Captured Atlas draft input from the pinned 8B host campaign, not a rewritten model answer.
  const evidence = 'According to [1], a public pilot is NOT authorized. Public launch requires written approval from the privacy reviewer and the product owner.'
  const draft = [
    'Based on the provided context, here is a concise handoff:', '',
    'Decision: A public pilot cannot launch now.',
    `Evidence: ${evidence}`,
    'Next Actions:',
    '1. Access Review - Owned by Mina, due 2026-09-10.',
    '2. Privacy Review - Owned by Jules, due 2026-09-12.',
    '3. Product-owner Approval for public launch - Pending, no due date provided.', '',
    'Please review the above summary to ensure accuracy.',
  ].join('\n')
  const summary = summarizeWorkArtifact(draft)
  assert.equal(summary.evidenceCount, 1, 'long inline evidence must not become another decision')
  assert.equal(summary.decisionCount, 1)
  assert.equal(summary.actionItemCount, 3)
  const evidenceItems = summary.sections.flatMap(section => section.kind === 'evidence' ? section.items : [])
  assert.deepEqual(evidenceItems.map(item => [item.text, item.lineNumber]), [[evidence, 4]],
    'the full supplied evidence is retained exactly once with its original line number')
  assert.deepEqual(summary.missingKinds, ['risk', 'question'])
  assert.equal(summary.quality, 'partial', 'recognizing an evidence field does not complete the draft')
  const policy = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact, validateWorkArtifactQuality,
    containsSensitiveText: () => false, redactSensitiveText: value => value,
  })
  const audited = policy.buildWorkArtifactWorkflowOutput(draft)
  assert.equal(audited.sourceEvidence.length, 1, 'the workflow audit receives the supplied evidence item')
  assert.deepEqual(audited.missingKinds, ['risk', 'question'])
  assert.equal(audited.qualityAudit.ok, false, 'the remaining structural gaps still require repair')

  for (const [label, separator] of [['Evidence', ':'], ['证据', '：'], ['根拠', '：']]) {
    const inline = summarizeWorkArtifact(`## **${label}**${separator} ${evidence}`)
    assert.equal(inline.evidenceCount, 1, 'Markdown/localized labels use the heading limit, not the body length')
    assert.equal(inline.sections[0].items[0].text, evidence)
  }
  const conflict = summarizeWorkArtifact('Decision: Evidence and risk remain pending.')
  assert.equal(conflict.decisionCount, 1, 'body keywords cannot override an explicit inline section label')
  assert.equal(conflict.evidenceCount, 0)
  assert.equal(conflict.riskCount, 0)

  const actionLines = ['- Evidence: Verify the note.', '[ ] Evidence: Verify the note.', '1. Evidence: Verify the note.']
  const actions = summarizeWorkArtifact(['Action items', ...actionLines].join('\n'))
  assert.equal(actions.actionItemCount, 3, 'bullets, checkboxes and numbered action items do not become inline headings')
  assert.equal(actions.evidenceCount, 0)
  const oversized = `Evidence ${'x'.repeat(90)}: ${evidence}`
  const bounded = summarizeWorkArtifact(`Summary\n${oversized}`)
  assert.equal(bounded.evidenceCount, 0, 'the 96-character limit still rejects an oversized heading label')
  assert.equal(bounded.sections[0].items[0].text, oversized)
}

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isWorkArtifactWorkflowHook) return
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }
  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isWorkArtifactWorkflowHook = true
  require.extensions['.ts'] = hook
}

function runWorkArtifactWorkflowBehaviorChecks() {
  assert.equal(WORK_ARTIFACT_WORKFLOW_CONTRACT, 'islemind.agent.work-artifact-workflow.v1')
  assert.equal(typeof createWorkArtifactWorkflowPolicy, 'function', 'Integrations exposes the work-artifact policy factory')
  assert.equal(fs.readFileSync(path.join(root, 'src/modules/integrations/index.ts'), 'utf8').includes("export * from './workArtifactWorkflowPolicy'"), true, 'Integrations public API exports the work-artifact policy')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/workArtifactWorkflow.ts')), false, 'covered work-artifact service stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/index.ts')), false, 'the obsolete Agent service barrel stays deleted')

  const item = Object.freeze({
    kind: 'evidence',
    text: 'Evidence secret',
    sectionTitle: 'Evidence secret',
    lineNumber: 9,
    owner: 'Owner secret',
  })
  const sections = Object.freeze([
    Object.freeze({ kind: 'summary', title: 'Summary', items: Object.freeze([{ kind: 'summary', text: 'Summary secret', sectionTitle: 'Summary', lineNumber: 1 }]) }),
    Object.freeze({ kind: 'action', title: 'Actions', items: Object.freeze([{ kind: 'action', text: 'Act secret', sectionTitle: 'Actions', lineNumber: 3, nextStep: 'Next secret' }]) }),
    Object.freeze({ kind: 'decision', title: 'Decisions', items: Object.freeze([{ kind: 'decision', text: 'Decide', sectionTitle: 'Decisions', lineNumber: 5 }]) }),
    Object.freeze({ kind: 'evidence', title: 'Evidence', items: Object.freeze([item]) }),
  ])
  const summary = Object.freeze({
    hasWorkArtifact: true,
    language: 'en',
    quality: 'partial',
    sections,
    itemCount: 4,
    actionItemCount: 1,
    executableActionCount: 1,
    decisionCount: 1,
    riskCount: 0,
    openQuestionCount: 0,
    evidenceCount: 1,
    missingKinds: Object.freeze(['risk', 'question']),
    primaryNextStep: '  Ship secret  ',
    qualitySummary: 'Quality secret',
    followUpPrompt: 'Follow secret',
    shareableText: `  ${'x'.repeat(920)} secret  `,
    handoffText: 'unused legacy handoff',
  })
  const audit = Object.freeze({
    ok: false,
    quality: 'partial',
    missingKinds: summary.missingKinds,
    errors: Object.freeze([
      Object.freeze({ code: 'risk_missing', kind: 'risk', message: 'First issue', expected: 'coverage', actual: false }),
      Object.freeze({ code: 'risk_missing', kind: 'risk', message: 'Duplicate issue' }),
    ]),
    warnings: Object.freeze([Object.freeze({ code: 'question_warning', kind: 'question', message: 'Warn issue', actual: 0 })]),
    checks: Object.freeze({
      hasWorkArtifact: true,
      hasMinimumItems: true,
      hasAction: true,
      hasExecutableAction: true,
      hasPrimaryNextStep: true,
      hasQualitySummary: true,
      hasFollowUpPrompt: true,
      hasHandoffText: true,
      hasCompleteCoverage: false,
    }),
  })
  const citations = Object.freeze([
    Object.freeze({ id: '  cite-secret  ', title: '  Title secret  ', excerpt: '' }),
    Object.freeze({ label: '   ' }),
  ])
  const options = Object.freeze({ sourceMessageId: '  message-secret  ', citations })
  const before = JSON.stringify({ summary, audit, options })
  const policy = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact: () => summary,
    validateWorkArtifactQuality: (value) => {
      assert.equal(value, summary, 'quality validation receives the exact summary instance')
      return audit
    },
    containsSensitiveText: (value) => value.includes('secret'),
    redactSensitiveText: (value) => value.replaceAll('secret', '[redacted]'),
  })
  const output = policy.buildWorkArtifactWorkflowOutput('ignored', options)

  assert.equal(output.contract, WORK_ARTIFACT_WORKFLOW_CONTRACT)
  assert.equal(output.actionItemCount, 1)
  assert.equal(output.decisionCount, 1)
  assert.equal(output.evidenceCount, 1)
  assert.equal(output.sourceMessageId, 'message-[redacted]')
  assert.deepEqual(output.citations, [{ id: 'cite-[redacted]', title: 'Title [redacted]' }], 'citations are redacted, trimmed, ordered, and empty entries are removed')
  assert.equal(output.sourceEvidence[0].citations, output.citations, 'every evidence item uses the normalized citation list')
  assert.equal(JSON.stringify(output).includes('secret'), false, 'nested workflow output is redacted')
  assert.equal(output.artifact.shareableText.length <= 900, true, 'shareable output stays bounded')
  assert.equal(output.artifact.shareableText.endsWith('\n[output truncated]'), true, 'bounded shareable output records truncation')
  assert.deepEqual(output.qualityGaps.map((gap) => `${gap.code}:${gap.severity}`), [
    'risk_missing:error',
    'question_warning:warning',
    'question_missing:error',
  ], 'quality gaps retain error/warning/missing ordering and first-wins deduplication')
  assert.equal(output.qualityGaps[0].actual, false, 'false audit values are preserved')
  assert.equal(output.qualityGaps[1].actual, 0, 'zero audit values are preserved')
  assert.ok(output.handoffText.includes('Primary next step: Ship [redacted]'))
  assert.ok(output.handoffText.includes('Coverage: actions=1, decisions=1, risks=0, questions=0, evidence=1'))
  assert.equal(JSON.stringify({ summary, audit, options }), before, 'frozen summaries, audits, citations, and options are not mutated')
  assert.deepEqual(policy.buildWorkArtifactWorkflowOutput('ignored', options), output, 'identical dependency results are deterministic')

  const independent = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact: () => summary,
    validateWorkArtifactQuality: () => audit,
    containsSensitiveText: () => false,
    redactSensitiveText: (value) => value.replaceAll('secret', 'other'),
  }).buildWorkArtifactWorkflowOutput('ignored', options)
  assert.equal(independent.sourceMessageId, 'message-other', 'independent factories keep injected redactors isolated')

  const invalid = {
    contract: 'wrong',
    artifact: {},
    qualityAudit: {},
    qualityGaps: null,
    sourceEvidence: null,
    evidenceCount: -1,
    primaryNextStep: '',
    qualitySummary: '',
    followUpPrompt: '',
    extra: 'secret',
  }
  assert.deepEqual(policy.validateWorkArtifactWorkflowOutput(invalid).errors, [
    'Work artifact workflow output must record the v1 contract.',
    'Work artifact artifact.summary must be an array.',
    'Work artifact artifact.actionItems must be an array.',
    'Work artifact artifact.decisions must be an array.',
    'Work artifact artifact.risks must be an array.',
    'Work artifact artifact.openQuestions must be an array.',
    'Work artifact artifact.sourceEvidence must be an array.',
    'Work artifact artifact.qualitySummary must be non-empty.',
    'Work artifact artifact.followUpPrompt must be non-empty.',
    'Work artifact artifact.handoffText must be non-empty.',
    'Work artifact workflow output must include a qualityAudit result.',
    'Work artifact workflow output must include qualityGaps.',
    'Work artifact workflow output must include sourceEvidence.',
    'Work artifact workflow output must record evidenceCount.',
    'Work artifact workflow output must expose primaryNextStep.',
    'Work artifact workflow output must expose qualitySummary.',
    'Work artifact workflow output must expose followUpPrompt.',
    'Work artifact workflow output must redact sensitive text.',
  ], 'invalid output errors retain exact order')
  assert.deepEqual(policy.validateWorkArtifactWorkflowOutput(null), { ok: false, errors: ['Work artifact workflow output must be an object.'] })
  assert.deepEqual(policy.parseWorkArtifactWorkflowOutputJson(JSON.stringify(output)), output, 'valid JSON round-trips through contract admission')
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson(undefined), undefined)
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson('  '), undefined)
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson('{'), undefined)
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson(JSON.stringify(invalid)), undefined, 'invalid or sensitive JSON fails closed')
}

if (require.main === module) run()

module.exports = { run, requiredWorkArtifactCases }
