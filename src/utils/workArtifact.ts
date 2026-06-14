export type WorkArtifactKind =
  | 'summary'
  | 'decision'
  | 'action'
  | 'risk'
  | 'question'
  | 'evidence'
  | 'shareable'

export type WorkArtifactLanguage = 'en' | 'zh-CN' | 'ja'

export interface WorkArtifactItem {
  kind: WorkArtifactKind
  text: string
  sectionTitle: string
  lineNumber: number
  owner?: string
  nextStep?: string
  due?: string
  trigger?: string
}

export interface WorkArtifactSection {
  kind: WorkArtifactKind
  title: string
  items: WorkArtifactItem[]
}

export interface WorkArtifactSummary {
  hasWorkArtifact: boolean
  language: WorkArtifactLanguage
  quality: 'none' | 'partial' | 'actionable' | 'complete'
  sections: WorkArtifactSection[]
  itemCount: number
  actionItemCount: number
  executableActionCount: number
  decisionCount: number
  riskCount: number
  openQuestionCount: number
  evidenceCount: number
  missingKinds: WorkArtifactKind[]
  primaryNextStep?: string
  qualitySummary: string
  followUpPrompt: string
  shareableText: string
  handoffText: string
}

export type WorkArtifactQualityAuditIssueCode =
  | 'work_artifact_missing'
  | 'item_count_too_low'
  | 'action_missing'
  | 'executable_action_missing'
  | 'primary_next_step_missing'
  | 'quality_summary_missing'
  | 'follow_up_prompt_missing'
  | 'handoff_text_missing'
  | 'coverage_missing'
  | 'quality_inconsistent'

export interface WorkArtifactQualityAuditIssue {
  code: WorkArtifactQualityAuditIssueCode
  message: string
  kind?: WorkArtifactKind
  expected?: string | number | boolean
  actual?: string | number | boolean
}

export interface WorkArtifactQualityAuditOptions {
  minItemCount?: number
  requireCompleteCoverage?: boolean
  requirePrimaryNextStep?: boolean
  requireFollowUpPrompt?: boolean
  requireHandoffText?: boolean
}

export interface WorkArtifactQualityAuditResult {
  ok: boolean
  quality: WorkArtifactSummary['quality']
  missingKinds: WorkArtifactKind[]
  errors: WorkArtifactQualityAuditIssue[]
  warnings: WorkArtifactQualityAuditIssue[]
  checks: {
    hasWorkArtifact: boolean
    hasMinimumItems: boolean
    hasAction: boolean
    hasExecutableAction: boolean
    hasPrimaryNextStep: boolean
    hasQualitySummary: boolean
    hasFollowUpPrompt: boolean
    hasHandoffText: boolean
    hasCompleteCoverage: boolean
  }
}

const SECTION_LABELS: Record<WorkArtifactKind, string> = {
  summary: 'Summary',
  decision: 'Decision log',
  action: 'Action items',
  risk: 'Risks',
  question: 'Open questions',
  evidence: 'Evidence',
  shareable: 'Shareable version',
}

const LOCALIZED_SECTION_LABELS: Record<WorkArtifactLanguage, Record<WorkArtifactKind, string>> = {
  en: SECTION_LABELS,
  'zh-CN': {
    summary: '摘要',
    decision: '决策记录',
    action: '行动项',
    risk: '风险',
    question: '待确认问题',
    evidence: '证据',
    shareable: '可分享版本',
  },
  ja: {
    summary: '要約',
    decision: '決定ログ',
    action: 'アクション項目',
    risk: 'リスク',
    question: '確認事項',
    evidence: '根拠',
    shareable: '共有版',
  },
}

const HANDOFF_LABELS: Record<WorkArtifactLanguage, {
  title: string
  quality: string
  primaryNextStep: string
  missingGates: string
  missingGatesNone: string
  continuePrompt: string
  executableActions: string
  itemCounts: string
}> = {
  en: {
    title: 'Work artifact handoff',
    quality: 'Quality',
    primaryNextStep: 'Primary next step',
    missingGates: 'Missing gates',
    missingGatesNone: 'none',
    continuePrompt: 'Continue prompt',
    executableActions: 'Executable actions',
    itemCounts: 'Coverage',
  },
  'zh-CN': {
    title: '工作产物交接',
    quality: '质量',
    primaryNextStep: '主要下一步',
    missingGates: '缺失门槛',
    missingGatesNone: '无',
    continuePrompt: '继续提示',
    executableActions: '可执行行动',
    itemCounts: '覆盖范围',
  },
  ja: {
    title: '作業成果の引き継ぎ',
    quality: '品質',
    primaryNextStep: '主要な次の一歩',
    missingGates: '不足ゲート',
    missingGatesNone: 'なし',
    continuePrompt: '継続プロンプト',
    executableActions: '実行可能なアクション',
    itemCounts: 'カバレッジ',
  },
}

export function validateWorkArtifactQuality(
  summary: WorkArtifactSummary,
  options: WorkArtifactQualityAuditOptions = {}
): WorkArtifactQualityAuditResult {
  const minItemCount = Math.max(1, options.minItemCount ?? 2)
  const requireCompleteCoverage = options.requireCompleteCoverage ?? true
  const requirePrimaryNextStep = options.requirePrimaryNextStep ?? true
  const requireFollowUpPrompt = options.requireFollowUpPrompt ?? true
  const requireHandoffText = options.requireHandoffText ?? true
  const missingKinds = getMissingArtifactKinds({
    actionItemCount: summary.actionItemCount,
    decisionCount: summary.decisionCount,
    riskCount: summary.riskCount,
    openQuestionCount: summary.openQuestionCount,
    evidenceCount: summary.evidenceCount,
  })
  const checks = {
    hasWorkArtifact: summary.hasWorkArtifact,
    hasMinimumItems: summary.itemCount >= minItemCount,
    hasAction: summary.actionItemCount > 0,
    hasExecutableAction: summary.executableActionCount > 0,
    hasPrimaryNextStep: !!summary.primaryNextStep?.trim(),
    hasQualitySummary: !!summary.qualitySummary.trim(),
    hasFollowUpPrompt: !!summary.followUpPrompt.trim(),
    hasHandoffText: !!summary.handoffText.trim(),
    hasCompleteCoverage: missingKinds.length === 0,
  }
  const errors: WorkArtifactQualityAuditIssue[] = []
  const warnings: WorkArtifactQualityAuditIssue[] = []

  if (!checks.hasWorkArtifact) {
    errors.push(workArtifactAuditIssue('work_artifact_missing', 'Artifact must contain at least two populated recognized sections.'))
  }
  if (!checks.hasMinimumItems) {
    errors.push(workArtifactAuditIssue('item_count_too_low', 'Artifact must contain the minimum required item count.', undefined, minItemCount, summary.itemCount))
  }
  if (!checks.hasAction) {
    errors.push(workArtifactAuditIssue('action_missing', 'Artifact must include at least one action item.', 'action'))
  }
  if (!checks.hasExecutableAction) {
    errors.push(workArtifactAuditIssue('executable_action_missing', 'Artifact must include at least one executable action with a next step, due date, trigger, or execution verb.', 'action'))
  }
  if (requirePrimaryNextStep && !checks.hasPrimaryNextStep) {
    errors.push(workArtifactAuditIssue('primary_next_step_missing', 'Artifact must expose one primary next step.'))
  }
  if (!checks.hasQualitySummary) {
    errors.push(workArtifactAuditIssue('quality_summary_missing', 'Artifact must include a quality summary.'))
  }
  if (requireFollowUpPrompt && !checks.hasFollowUpPrompt) {
    errors.push(workArtifactAuditIssue('follow_up_prompt_missing', 'Artifact must include a continuation prompt.'))
  }
  if (requireHandoffText && !checks.hasHandoffText) {
    errors.push(workArtifactAuditIssue('handoff_text_missing', 'Artifact must include handoff text.'))
  }
  if (requireCompleteCoverage && !checks.hasCompleteCoverage) {
    errors.push(workArtifactAuditIssue(
      'coverage_missing',
      `Artifact must cover action, decision, risk, question, and evidence gates. Missing: ${missingKinds.map((kind) => SECTION_LABELS[kind]).join(', ')}.`,
      undefined,
      0,
      missingKinds.length
    ))
  }
  if (summary.quality === 'complete' && !checks.hasCompleteCoverage) {
    errors.push(workArtifactAuditIssue('quality_inconsistent', 'A complete artifact must not have missing coverage gates.', undefined, 'complete coverage', summary.quality))
  }
  if (!requireCompleteCoverage && !checks.hasCompleteCoverage) {
    warnings.push(workArtifactAuditIssue(
      'coverage_missing',
      `Artifact is executable but not complete. Missing: ${missingKinds.map((kind) => SECTION_LABELS[kind]).join(', ')}.`,
      undefined,
      0,
      missingKinds.length
    ))
  }

  return {
    ok: errors.length === 0,
    quality: summary.quality,
    missingKinds,
    errors,
    warnings,
    checks,
  }
}

export function summarizeWorkArtifact(content: string): WorkArtifactSummary {
  const language = detectWorkArtifactLanguage(content)
  const sections: WorkArtifactSection[] = []
  let current: WorkArtifactSection | null = null

  content.split(/\r?\n/).forEach((line, index) => {
    const parsedSection = parseSectionLine(line)
    if (parsedSection) {
      current = {
        kind: parsedSection.kind,
        title: parsedSection.title,
        items: [],
      }
      sections.push(current)
      if (parsedSection.inlineText) {
        current.items.push(buildItem(current, parsedSection.inlineText, index + 1))
      }
      return
    }

    if (!current) return
    const itemText = normalizeItemLine(line)
    if (!itemText) return
    current.items.push(buildItem(current, itemText, index + 1))
  })

  const nonEmptySections = sections.filter((section) => section.items.length > 0)
  const items = nonEmptySections.flatMap((section) => section.items)
  const actionItemCount = items.filter((item) => item.kind === 'action').length
  const decisionCount = items.filter((item) => item.kind === 'decision').length
  const riskCount = items.filter((item) => item.kind === 'risk').length
  const openQuestionCount = items.filter((item) => item.kind === 'question').length
  const evidenceCount = items.filter((item) => item.kind === 'evidence').length
  const executableActionCount = items.filter(isExecutableAction).length
  const missingKinds = getMissingArtifactKinds({
    actionItemCount,
    decisionCount,
    riskCount,
    openQuestionCount,
    evidenceCount,
  })
  const primaryNextStep = selectPrimaryNextStep(items)
  const hasWorkArtifact = nonEmptySections.length >= 2 && items.length >= 2
  const quality = classifyWorkArtifactQuality(hasWorkArtifact, missingKinds, executableActionCount)
  const qualitySummary = buildWorkArtifactQualitySummary({
    language,
    quality,
    missingKinds,
    executableActionCount,
  })
  const followUpPrompt = buildWorkArtifactFollowUpPrompt({
    language,
    quality,
    missingKinds,
    primaryNextStep,
  })

  return {
    hasWorkArtifact,
    language,
    quality,
    sections: nonEmptySections,
    itemCount: items.length,
    actionItemCount,
    executableActionCount,
    decisionCount,
    riskCount,
    openQuestionCount,
    evidenceCount,
    missingKinds,
    primaryNextStep,
    qualitySummary,
    followUpPrompt,
    shareableText: formatWorkArtifactSections(nonEmptySections, language),
    handoffText: formatWorkArtifactHandoff({
      language,
      quality,
      sections: nonEmptySections,
      actionItemCount,
      executableActionCount,
      decisionCount,
      riskCount,
      openQuestionCount,
      evidenceCount,
      missingKinds,
      primaryNextStep,
      qualitySummary,
      followUpPrompt,
    }),
  }
}

export function formatWorkArtifactSections(sections: WorkArtifactSection[], language: WorkArtifactLanguage = 'en'): string {
  const sectionLabels = LOCALIZED_SECTION_LABELS[language]
  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => {
      const title = sectionLabels[section.kind]
      const items = section.items.map((item) => `- ${item.text}`).join('\n')
      return `${title}\n${items}`
    })
    .join('\n\n')
}

export function formatWorkArtifactHandoff(input: Pick<WorkArtifactSummary, 'language' | 'quality' | 'sections' | 'actionItemCount' | 'executableActionCount' | 'decisionCount' | 'riskCount' | 'openQuestionCount' | 'evidenceCount' | 'missingKinds' | 'primaryNextStep' | 'qualitySummary' | 'followUpPrompt'>): string {
  const labels = HANDOFF_LABELS[input.language]
  const lines = [
    labels.title,
    `${labels.quality}: ${input.quality}`,
    `${labels.executableActions}: ${input.executableActionCount}/${input.actionItemCount}`,
    `${labels.itemCounts}: ${formatCoverageCounts(input)}`,
  ]

  if (input.primaryNextStep) {
    lines.push(`${labels.primaryNextStep}: ${input.primaryNextStep}`)
  }

  if (input.missingKinds.length) {
    lines.push(`${labels.missingGates}: ${formatKindList(input.missingKinds, input.language)}`)
  } else {
    lines.push(`${labels.missingGates}: ${labels.missingGatesNone}`)
  }

  if (input.qualitySummary.trim()) {
    lines.push(input.qualitySummary)
  }

  const sectionText = formatWorkArtifactSections(input.sections, input.language)
  if (sectionText) {
    lines.push('', sectionText)
  }

  if (input.followUpPrompt.trim()) {
    lines.push('', labels.continuePrompt, input.followUpPrompt)
  }

  return lines.join('\n')
}

function workArtifactAuditIssue(
  code: WorkArtifactQualityAuditIssueCode,
  message: string,
  kind?: WorkArtifactKind,
  expected?: string | number | boolean,
  actual?: string | number | boolean
): WorkArtifactQualityAuditIssue {
  const issue: WorkArtifactQualityAuditIssue = { code, message }
  if (kind) issue.kind = kind
  if (expected !== undefined) issue.expected = expected
  if (actual !== undefined) issue.actual = actual
  return issue
}

function detectWorkArtifactLanguage(content: string): WorkArtifactLanguage {
  if (/[\u3040-\u30ff]|要約|現在の状態|完了した作業|残っている作業|構造化|質問|確認事項|根拠|検証|出典|アクション|次の一歩|最初の|必ず完了|結論|推奨|決定|担当者|期限|発火条件|協力者/.test(content)) {
    return 'ja'
  }
  if (/[\u4e00-\u9fff]/.test(content)) return 'zh-CN'
  return 'en'
}

function parseSectionLine(line: string): { kind: WorkArtifactKind; title: string; inlineText?: string } | null {
  if (/^\s*[-*•]\s+/.test(line) || /^\s*\[[ xX]\]\s+/.test(line)) return null
  const normalized = normalizeHeadingLine(line)
  if (!normalized || normalized.length > 96) return null
  const kind = classifySection(normalized)
  if (!kind) return null

  const inlineMatch = normalized.match(/^(.+?)[:：]\s*(.+)$/)
  const inlineText = inlineMatch && classifySection(inlineMatch[1]) === kind
    ? inlineMatch[2].trim()
    : undefined

  return {
    kind,
    title: inlineMatch?.[1]?.trim() || normalized,
    inlineText,
  }
}

function classifySection(value: string): WorkArtifactKind | null {
  const text = value.toLowerCase()
  if (/(shareable|short version|send to collaborators|sent to collaborators|copy to someone|可直接发给|发给协作者|協力者に送れる|コピーできる)/i.test(value)) return 'shareable'
  if (/(open question|question|待确认|待確認|未确认|未確認|问题|質問|確認事項)/i.test(value)) return 'question'
  if (/(risk|blocker|counter-evidence|风险|阻塞|リスク|ブロッカー|反証)/i.test(value)) return 'risk'
  if (/(evidence|verification|citation|source|验证|证据|引用|根拠|検証|出典)/i.test(value)) return 'evidence'
  if (/(action item|next action|next step|first step|must finish|today's goal|行动项|行动|下一步|第一步|必须完成|アクション|次の|最初の|必ず完了)/i.test(value)) return 'action'
  if (/(decision|recommendation|recommended|conclusion|decide|决策|决定|推荐方案|推荐结论|結論|推奨|決定)/i.test(value)) return 'decision'
  if (/(summary|current state|completed work|remaining work|structured summary|背景|当前状态|已完成|未完成|结构化摘要|要約|現在の状態|完了した作業|残っている作業|構造化)/i.test(value)) return 'summary'
  if (text === 'todo' || text === 'todos') return 'action'
  return null
}

function normalizeHeadingLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/^\*\*(.+?)\*\*$/, '$1')
    .replace(/\*\*/g, '')
    .trim()
}

function normalizeItemLine(line: string): string {
  const cleaned = line
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/\*\*/g, '')
    .trim()

  if (!cleaned || /^[-_=]{3,}$/.test(cleaned)) return ''
  return cleaned
}

function buildItem(section: WorkArtifactSection, text: string, lineNumber: number): WorkArtifactItem {
  if (section.kind !== 'action') {
    return {
      kind: section.kind,
      text,
      sectionTitle: section.title,
      lineNumber,
    }
  }

  return {
    kind: section.kind,
    text,
    sectionTitle: section.title,
    lineNumber,
    owner: extractMetadata(text, [/owner\s*[:：]\s*([^/|;；]+)/i, /负责人\s*[:：]\s*([^/|;；]+)/, /担当者\s*[:：]\s*([^/|;；]+)/]),
    nextStep: extractMetadata(text, [/next(?: step)?\s*[:：]\s*([^/|;；]+)/i, /下一步\s*[:：]\s*([^/|;；]+)/, /次の一歩\s*[:：]\s*([^/|;；]+)/]),
    due: extractMetadata(text, [/(?:deadline|due)\s*[:：]\s*([^/|;；]+)/i, /截止\s*[:：]\s*([^/|;；]+)/, /期限\s*[:：]\s*([^/|;；]+)/]),
    trigger: extractMetadata(text, [/trigger\s*[:：]\s*([^/|;；]+)/i, /触发条件\s*[:：]\s*([^/|;；]+)/, /発火条件\s*[:：]\s*([^/|;；]+)/]),
  }
}

function getMissingArtifactKinds({
  actionItemCount,
  decisionCount,
  riskCount,
  openQuestionCount,
  evidenceCount,
}: {
  actionItemCount: number
  decisionCount: number
  riskCount: number
  openQuestionCount: number
  evidenceCount: number
}): WorkArtifactKind[] {
  const missing: WorkArtifactKind[] = []
  if (actionItemCount === 0) missing.push('action')
  if (decisionCount === 0) missing.push('decision')
  if (riskCount === 0) missing.push('risk')
  if (openQuestionCount === 0) missing.push('question')
  if (evidenceCount === 0) missing.push('evidence')
  return missing
}

function classifyWorkArtifactQuality(
  hasWorkArtifact: boolean,
  missingKinds: WorkArtifactKind[],
  executableActionCount: number
): WorkArtifactSummary['quality'] {
  if (!hasWorkArtifact) return 'none'
  if (executableActionCount === 0) return 'partial'
  if (missingKinds.length === 0) return 'complete'
  return 'actionable'
}

function isExecutableAction(item: WorkArtifactItem): boolean {
  if (item.kind !== 'action') return false
  return !!(item.nextStep || item.due || item.trigger || /(next|first|start|verify|ship|capture|publish|下一步|第一步|开始|验证|发布|整理|確認|検証|公開)/i.test(item.text))
}

function selectPrimaryNextStep(items: WorkArtifactItem[]): string | undefined {
  const action = items.find((item) => item.kind === 'action' && item.nextStep) ??
    items.find((item) => item.kind === 'action') ??
    items.find((item) => item.kind === 'question') ??
    items.find((item) => item.kind === 'evidence')

  return action?.nextStep ?? action?.text
}

function formatKindList(kinds: WorkArtifactKind[], language: WorkArtifactLanguage): string {
  const labels = LOCALIZED_SECTION_LABELS[language]
  return kinds.map((kind) => labels[kind]).join(language === 'en' ? ', ' : '、')
}

function formatCoverageCounts(input: Pick<WorkArtifactSummary, 'language' | 'decisionCount' | 'riskCount' | 'openQuestionCount' | 'evidenceCount'>): string {
  const labels = LOCALIZED_SECTION_LABELS[input.language]
  const parts = [
    `${labels.decision} ${input.decisionCount}`,
    `${labels.risk} ${input.riskCount}`,
    `${labels.question} ${input.openQuestionCount}`,
    `${labels.evidence} ${input.evidenceCount}`,
  ]
  return parts.join(input.language === 'en' ? ', ' : '、')
}

function buildWorkArtifactQualitySummary({
  language,
  quality,
  missingKinds,
  executableActionCount,
}: Pick<WorkArtifactSummary, 'language' | 'quality' | 'missingKinds' | 'executableActionCount'>): string {
  const missing = missingKinds.length ? formatKindList(missingKinds, language) : ''
  if (language === 'zh-CN') {
    if (quality === 'complete') return '质量说明：产物已覆盖执行、决策、风险、证据和待确认问题，可以交接或继续执行。'
    if (quality === 'actionable') return `质量说明：产物已有 ${executableActionCount} 个可执行行动，但还缺少：${missing}。`
    if (quality === 'partial') return `质量说明：产物结构不足以直接执行，需要先补齐：${missing || '行动项、决策、风险、证据和待确认问题'}。`
    return '质量说明：未识别到可交接的结构化工作产物。'
  }
  if (language === 'ja') {
    if (quality === 'complete') return '品質メモ：実行、決定、リスク、根拠、確認事項がそろっているため、引き継ぎまたは継続実行できます。'
    if (quality === 'actionable') return `品質メモ：${executableActionCount} 件の実行可能なアクションがありますが、不足しています：${missing}。`
    if (quality === 'partial') return `品質メモ：この成果物はまだ直接実行できません。先に補完してください：${missing || 'アクション項目、決定ログ、リスク、根拠、確認事項'}。`
    return '品質メモ：引き継げる構造化作業成果を検出できませんでした。'
  }
  if (quality === 'complete') return 'Quality note: this artifact covers execution, decisions, risks, evidence, and open questions; it is ready to hand off or continue.'
  if (quality === 'actionable') return `Quality note: this artifact has ${executableActionCount} executable action(s), but still needs: ${missing}.`
  if (quality === 'partial') return `Quality note: this artifact is not directly executable yet; fill first: ${missing || 'Action items, Decision log, Risks, Evidence, Open questions'}.`
  return 'Quality note: no handoff-ready structured work artifact was detected.'
}

function buildWorkArtifactFollowUpPrompt({
  language,
  quality,
  missingKinds,
  primaryNextStep,
}: Pick<WorkArtifactSummary, 'language' | 'quality' | 'missingKinds' | 'primaryNextStep'>): string {
  if (quality === 'none') {
    if (language === 'zh-CN') {
      return '把上一条回复整理成结构化工作产物，必须包含摘要、决策记录、行动项、风险、待确认问题、所需证据和一个主要下一步。'
    }
    if (language === 'ja') {
      return '前の回答を構造化された作業成果に変換してください。要約、決定ログ、アクション項目、リスク、確認事項、必要な根拠、主要な次の一歩を必ず含めてください。'
    }
    return 'Turn the previous response into a structured work artifact with a summary, decision log, action items, risks, open questions, evidence needed, and one primary next step.'
  }

  if (missingKinds.length) {
    const gates = formatKindList(missingKinds, language)
    if (language === 'zh-CN') {
      return `从这个工作产物继续。补齐缺失门槛：${gates}。保留已有决策，并产出下一步可执行行动。`
    }
    if (language === 'ja') {
      return `この作業成果から続けてください。不足ゲートを補完してください：${gates}。既存の決定を保持し、次の実行可能なアクションを作成してください。`
    }
    return `Continue from this work artifact. Fill the missing gates: ${missingKinds.map((kind) => SECTION_LABELS[kind]).join(', ')}. Preserve existing decisions and produce the next executable action.`
  }

  if (primaryNextStep) {
    if (language === 'zh-CN') {
      return `从这个工作产物继续，并执行主要下一步：${primaryNextStep}。保持决策、风险、证据和待确认问题可见。`
    }
    if (language === 'ja') {
      return `この作業成果から続けて、主要な次の一歩を実行してください：${primaryNextStep}。決定、リスク、根拠、確認事項を見える状態に保ってください。`
    }
    return `Continue from this work artifact and execute the primary next step: ${primaryNextStep}. Keep decisions, risks, evidence, and open questions visible.`
  }

  if (language === 'zh-CN') {
    return '从这个完整工作产物继续，并把它推进成下一个具体交付物。'
  }
  if (language === 'ja') {
    return 'この完了済みの作業成果から続けて、次の具体的な成果物に進めてください。'
  }
  return 'Continue from this complete work artifact and turn it into the next concrete deliverable.'
}

function extractMetadata(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return undefined
}
