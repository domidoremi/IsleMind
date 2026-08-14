export const WORK_ARTIFACT_WORKFLOW_CONTRACT =
  "islemind.agent.work-artifact-workflow.v1";

export type WorkArtifactWorkflowKind =
  | "summary"
  | "decision"
  | "action"
  | "risk"
  | "question"
  | "evidence"
  | "shareable";

export type WorkArtifactWorkflowLanguage = "en" | "zh-CN" | "ja";
export type WorkArtifactWorkflowQuality =
  | "none"
  | "partial"
  | "actionable"
  | "complete";

export interface WorkArtifactWorkflowSummaryItem {
  kind: WorkArtifactWorkflowKind;
  text: string;
  sectionTitle: string;
  lineNumber: number;
  owner?: string;
  nextStep?: string;
  due?: string;
  trigger?: string;
}

export interface WorkArtifactWorkflowSummarySection {
  kind: WorkArtifactWorkflowKind;
  title: string;
  items: WorkArtifactWorkflowSummaryItem[];
}

export interface WorkArtifactWorkflowSummary {
  hasWorkArtifact: boolean;
  language: WorkArtifactWorkflowLanguage;
  quality: WorkArtifactWorkflowQuality;
  sections: WorkArtifactWorkflowSummarySection[];
  itemCount: number;
  actionItemCount: number;
  executableActionCount: number;
  decisionCount: number;
  riskCount: number;
  openQuestionCount: number;
  evidenceCount: number;
  missingKinds: WorkArtifactWorkflowKind[];
  primaryNextStep?: string;
  qualitySummary: string;
  followUpPrompt: string;
  shareableText: string;
  handoffText: string;
}

export interface WorkArtifactWorkflowQualityAuditIssue {
  code: string;
  message: string;
  kind?: WorkArtifactWorkflowKind;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
}

export interface WorkArtifactWorkflowQualityAuditResult {
  ok: boolean;
  quality: WorkArtifactWorkflowQuality;
  missingKinds: WorkArtifactWorkflowKind[];
  errors: WorkArtifactWorkflowQualityAuditIssue[];
  warnings: WorkArtifactWorkflowQualityAuditIssue[];
  checks: {
    hasWorkArtifact: boolean;
    hasMinimumItems: boolean;
    hasAction: boolean;
    hasExecutableAction: boolean;
    hasPrimaryNextStep: boolean;
    hasQualitySummary: boolean;
    hasFollowUpPrompt: boolean;
    hasHandoffText: boolean;
    hasCompleteCoverage: boolean;
  };
}

export interface WorkArtifactWorkflowCitationReference {
  id?: string;
  label?: string;
  title?: string;
  url?: string;
  excerpt?: string;
}

export interface BuildWorkArtifactWorkflowOutputOptions {
  sourceMessageId?: string;
  citations?: WorkArtifactWorkflowCitationReference[];
}

export interface WorkArtifactWorkflowItem extends WorkArtifactWorkflowSummaryItem {
  sourceMessageId?: string;
}

export interface WorkArtifactWorkflowEvidence extends WorkArtifactWorkflowItem {
  citations: WorkArtifactWorkflowCitationReference[];
}

export interface WorkArtifactWorkflowQualityGap {
  code: string;
  severity: "error" | "warning";
  message: string;
  kind?: WorkArtifactWorkflowKind;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
}

export interface WorkArtifactWorkflowArtifact {
  hasWorkArtifact: boolean;
  language: WorkArtifactWorkflowLanguage;
  quality: WorkArtifactWorkflowQuality;
  summary: WorkArtifactWorkflowItem[];
  actionItems: WorkArtifactWorkflowItem[];
  decisions: WorkArtifactWorkflowItem[];
  risks: WorkArtifactWorkflowItem[];
  openQuestions: WorkArtifactWorkflowItem[];
  sourceEvidence: WorkArtifactWorkflowEvidence[];
  shareableText: string;
  handoffText: string;
  primaryNextStep?: string;
  qualitySummary: string;
  followUpPrompt: string;
}

export interface WorkArtifactWorkflowOutput {
  contract: typeof WORK_ARTIFACT_WORKFLOW_CONTRACT;
  artifact: WorkArtifactWorkflowArtifact;
  qualityAudit: WorkArtifactWorkflowQualityAuditResult;
  qualityGaps: WorkArtifactWorkflowQualityGap[];
  sourceEvidence: WorkArtifactWorkflowEvidence[];
  sourceMessageId?: string;
  citations: WorkArtifactWorkflowCitationReference[];
  hasWorkArtifact: boolean;
  quality: WorkArtifactWorkflowQuality;
  actionItemCount: number;
  decisionCount: number;
  riskCount: number;
  openQuestionCount: number;
  evidenceCount: number;
  missingKinds: WorkArtifactWorkflowKind[];
  primaryNextStep?: string;
  qualitySummary: string;
  followUpPrompt: string;
  handoffText: string;
}

export interface WorkArtifactWorkflowContractValidation {
  ok: boolean;
  errors: string[];
}

export interface WorkArtifactWorkflowPolicyDependencies {
  summarizeWorkArtifact(content: string): WorkArtifactWorkflowSummary;
  validateWorkArtifactQuality(
    summary: WorkArtifactWorkflowSummary,
  ): WorkArtifactWorkflowQualityAuditResult;
  containsSensitiveText(input: string): boolean;
  redactSensitiveText(input: string): string;
}

export interface WorkArtifactWorkflowPolicy {
  contract: typeof WORK_ARTIFACT_WORKFLOW_CONTRACT;
  buildWorkArtifactWorkflowOutput(
    content: string,
    options?: BuildWorkArtifactWorkflowOutputOptions,
  ): WorkArtifactWorkflowOutput;
  validateWorkArtifactWorkflowOutput(
    value: unknown,
  ): WorkArtifactWorkflowContractValidation;
  parseWorkArtifactWorkflowOutputJson(
    value: string | undefined,
  ): WorkArtifactWorkflowOutput | undefined;
}

export function createWorkArtifactWorkflowPolicy(
  dependencies: WorkArtifactWorkflowPolicyDependencies,
): WorkArtifactWorkflowPolicy {
  function buildWorkArtifactWorkflowOutput(
    content: string,
    options: BuildWorkArtifactWorkflowOutputOptions = {},
  ): WorkArtifactWorkflowOutput {
    const summary = dependencies.summarizeWorkArtifact(content);
    const qualityAudit = dependencies.validateWorkArtifactQuality(summary);
    const citations = normalizeCitations(options.citations);
    const sourceMessageId = safeOptionalText(options.sourceMessageId);
    const artifact = buildWorkflowArtifact(summary, citations, sourceMessageId);
    const sourceEvidence = artifact.sourceEvidence;
    const handoffText = artifact.handoffText;

    return {
      contract: WORK_ARTIFACT_WORKFLOW_CONTRACT,
      artifact,
      qualityAudit,
      qualityGaps: buildQualityGaps(summary, qualityAudit),
      sourceEvidence,
      ...(sourceMessageId ? { sourceMessageId } : {}),
      citations,
      hasWorkArtifact: summary.hasWorkArtifact,
      quality: summary.quality,
      actionItemCount: summary.actionItemCount,
      decisionCount: summary.decisionCount,
      riskCount: summary.riskCount,
      openQuestionCount: summary.openQuestionCount,
      evidenceCount: summary.evidenceCount,
      missingKinds: summary.missingKinds,
      primaryNextStep: safeOptionalText(summary.primaryNextStep),
      qualitySummary: safeText(summary.qualitySummary),
      followUpPrompt: safeText(summary.followUpPrompt),
      handoffText,
    };
  }

  function validateWorkArtifactWorkflowOutput(
    value: unknown,
  ): WorkArtifactWorkflowContractValidation {
    const errors: string[] = [];
    if (!isRecord(value)) {
      return {
        ok: false,
        errors: ["Work artifact workflow output must be an object."],
      };
    }
    if (value.contract !== WORK_ARTIFACT_WORKFLOW_CONTRACT) {
      errors.push("Work artifact workflow output must record the v1 contract.");
    }
    const artifact = value.artifact;
    if (!isRecord(artifact)) {
      errors.push(
        "Work artifact workflow output must include artifact fields.",
      );
    } else {
      for (const field of [
        "summary",
        "actionItems",
        "decisions",
        "risks",
        "openQuestions",
        "sourceEvidence",
      ] as const) {
        if (!Array.isArray(artifact[field])) {
          errors.push(`Work artifact artifact.${field} must be an array.`);
        }
      }
      if (
        typeof artifact.qualitySummary !== "string" ||
        !artifact.qualitySummary.trim()
      ) {
        errors.push("Work artifact artifact.qualitySummary must be non-empty.");
      }
      if (
        typeof artifact.followUpPrompt !== "string" ||
        !artifact.followUpPrompt.trim()
      ) {
        errors.push("Work artifact artifact.followUpPrompt must be non-empty.");
      }
      if (
        typeof artifact.handoffText !== "string" ||
        !artifact.handoffText.trim()
      ) {
        errors.push("Work artifact artifact.handoffText must be non-empty.");
      }
    }
    if (
      !isRecord(value.qualityAudit) ||
      typeof value.qualityAudit.ok !== "boolean"
    ) {
      errors.push(
        "Work artifact workflow output must include a qualityAudit result.",
      );
    }
    if (!Array.isArray(value.qualityGaps)) {
      errors.push("Work artifact workflow output must include qualityGaps.");
    }
    if (!Array.isArray(value.sourceEvidence)) {
      errors.push("Work artifact workflow output must include sourceEvidence.");
    }
    if (
      typeof value.evidenceCount !== "number" ||
      !Number.isInteger(value.evidenceCount) ||
      value.evidenceCount < 0
    ) {
      errors.push("Work artifact workflow output must record evidenceCount.");
    }
    if (
      typeof value.primaryNextStep !== "string" ||
      !value.primaryNextStep.trim()
    ) {
      errors.push("Work artifact workflow output must expose primaryNextStep.");
    }
    if (
      typeof value.qualitySummary !== "string" ||
      !value.qualitySummary.trim()
    ) {
      errors.push("Work artifact workflow output must expose qualitySummary.");
    }
    if (
      typeof value.followUpPrompt !== "string" ||
      !value.followUpPrompt.trim()
    ) {
      errors.push("Work artifact workflow output must expose followUpPrompt.");
    }
    if (dependencies.containsSensitiveText(JSON.stringify(value))) {
      errors.push("Work artifact workflow output must redact sensitive text.");
    }
    return { ok: errors.length === 0, errors };
  }

  function parseWorkArtifactWorkflowOutputJson(
    value: string | undefined,
  ): WorkArtifactWorkflowOutput | undefined {
    if (!value?.trim()) return undefined;
    try {
      const parsed = JSON.parse(value) as unknown;
      return validateWorkArtifactWorkflowOutput(parsed).ok
        ? (parsed as WorkArtifactWorkflowOutput)
        : undefined;
    } catch {
      return undefined;
    }
  }

  function buildWorkflowArtifact(
    summary: WorkArtifactWorkflowSummary,
    citations: WorkArtifactWorkflowCitationReference[],
    sourceMessageId?: string,
  ): WorkArtifactWorkflowArtifact {
    return {
      hasWorkArtifact: summary.hasWorkArtifact,
      language: summary.language,
      quality: summary.quality,
      summary: itemsForKind(summary.sections, "summary", sourceMessageId),
      actionItems: itemsForKind(summary.sections, "action", sourceMessageId),
      decisions: itemsForKind(summary.sections, "decision", sourceMessageId),
      risks: itemsForKind(summary.sections, "risk", sourceMessageId),
      openQuestions: itemsForKind(
        summary.sections,
        "question",
        sourceMessageId,
      ),
      sourceEvidence: itemsForKind(
        summary.sections,
        "evidence",
        sourceMessageId,
      ).map((item) => ({
        ...item,
        citations,
      })),
      shareableText: limitWorkflowText(summary.shareableText, 900),
      handoffText: buildCompactHandoffText(summary),
      primaryNextStep: safeOptionalText(summary.primaryNextStep),
      qualitySummary: safeText(summary.qualitySummary),
      followUpPrompt: safeText(summary.followUpPrompt),
    };
  }

  function buildCompactHandoffText(
    summary: WorkArtifactWorkflowSummary,
  ): string {
    return [
      "Work artifact handoff",
      `Quality: ${summary.quality}`,
      `Primary next step: ${safeOptionalText(summary.primaryNextStep) ?? "missing"}`,
      `Coverage: actions=${summary.actionItemCount}, decisions=${summary.decisionCount}, risks=${summary.riskCount}, questions=${summary.openQuestionCount}, evidence=${summary.evidenceCount}`,
      summary.missingKinds.length
        ? `Missing gates: ${summary.missingKinds.join(", ")}`
        : "Missing gates: none",
      safeText(summary.qualitySummary),
      safeText(summary.followUpPrompt),
    ]
      .filter((line) => line.trim())
      .join("\n");
  }

  function limitWorkflowText(value: string, limit: number): string {
    const text = safeText(value).trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 22)).trimEnd()}\n[output truncated]`;
  }

  function itemsForKind(
    sections: WorkArtifactWorkflowSummarySection[],
    kind: WorkArtifactWorkflowKind,
    sourceMessageId?: string,
  ): WorkArtifactWorkflowItem[] {
    return sections
      .filter((section) => section.kind === kind)
      .flatMap((section) => section.items)
      .map((item) => ({
        ...redactWorkflowItem(item),
        ...(sourceMessageId ? { sourceMessageId } : {}),
      }));
  }

  function buildQualityGaps(
    summary: WorkArtifactWorkflowSummary,
    audit: WorkArtifactWorkflowQualityAuditResult,
  ): WorkArtifactWorkflowQualityGap[] {
    const issues = [
      ...audit.errors.map((issue) => fromAuditIssue(issue, "error" as const)),
      ...audit.warnings.map((issue) =>
        fromAuditIssue(issue, "warning" as const),
      ),
    ];
    const missingKinds = summary.missingKinds.map((kind) => ({
      code: `${kind}_missing`,
      severity: "error" as const,
      kind,
      message: `Artifact must include ${kind} coverage before it is complete.`,
    }));
    const seen = new Set<string>();
    return [...issues, ...missingKinds].filter((gap) => {
      const key = `${gap.code}:${gap.kind ?? ""}:${gap.severity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function fromAuditIssue(
    issue: WorkArtifactWorkflowQualityAuditIssue,
    severity: WorkArtifactWorkflowQualityGap["severity"],
  ): WorkArtifactWorkflowQualityGap {
    return {
      code: issue.code,
      severity,
      message: safeText(issue.message),
      ...(issue.kind ? { kind: issue.kind } : {}),
      ...(issue.expected !== undefined
        ? { expected: redactQualityGapValue(issue.expected) }
        : {}),
      ...(issue.actual !== undefined
        ? { actual: redactQualityGapValue(issue.actual) }
        : {}),
    };
  }

  function normalizeCitations(
    citations: WorkArtifactWorkflowCitationReference[] | undefined,
  ): WorkArtifactWorkflowCitationReference[] {
    if (!Array.isArray(citations)) return [];
    return citations
      .map(redactCitation)
      .filter((citation) => Object.keys(citation).length > 0);
  }

  function redactWorkflowItem(
    item: WorkArtifactWorkflowSummaryItem,
  ): WorkArtifactWorkflowItem {
    return {
      ...item,
      text: safeText(item.text),
      sectionTitle: safeText(item.sectionTitle),
      ...(item.owner ? { owner: safeText(item.owner) } : {}),
      ...(item.nextStep ? { nextStep: safeText(item.nextStep) } : {}),
      ...(item.due ? { due: safeText(item.due) } : {}),
      ...(item.trigger ? { trigger: safeText(item.trigger) } : {}),
    };
  }

  function redactCitation(
    citation: WorkArtifactWorkflowCitationReference,
  ): WorkArtifactWorkflowCitationReference {
    return {
      ...(safeOptionalText(citation.id)
        ? { id: safeOptionalText(citation.id) }
        : {}),
      ...(safeOptionalText(citation.label)
        ? { label: safeOptionalText(citation.label) }
        : {}),
      ...(safeOptionalText(citation.title)
        ? { title: safeOptionalText(citation.title) }
        : {}),
      ...(safeOptionalText(citation.url)
        ? { url: safeOptionalText(citation.url) }
        : {}),
      ...(safeOptionalText(citation.excerpt)
        ? { excerpt: safeOptionalText(citation.excerpt) }
        : {}),
    };
  }

  function redactQualityGapValue(
    value: string | number | boolean,
  ): string | number | boolean {
    return typeof value === "string" ? safeText(value) : value;
  }

  function safeOptionalText(value: string | undefined): string | undefined {
    const text = typeof value === "string" ? safeText(value).trim() : "";
    return text || undefined;
  }

  function safeText(value: string): string {
    return dependencies.redactSensitiveText(value);
  }

  return {
    contract: WORK_ARTIFACT_WORKFLOW_CONTRACT,
    buildWorkArtifactWorkflowOutput,
    validateWorkArtifactWorkflowOutput,
    parseWorkArtifactWorkflowOutputJson,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
