const INPUT_CONTEXT_RATIO = 0.7;
const RECENT_MESSAGE_TARGET = 8;

export type ContextPackingRole = "user" | "assistant";
export type LocalCompressionStrategy =
  | "none"
  | "structured-v2"
  | "single-message-truncation"
  | "application-model-summary";
export type SummarySectionId =
  | "constraints"
  | "decisions"
  | "failures"
  | "actions"
  | "references"
  | "recent";
type SummaryCandidatePriority = "critical" | "high" | "normal";

export interface ContextPackingMessage<TAttachment = unknown> {
  role: ContextPackingRole;
  content?: string | null;
  responseText?: string | null;
  attachments?: TAttachment[];
  status?: string;
}

export interface ContextPackingTokenMessage<TAttachment = unknown> {
  role: ContextPackingRole;
  content: string;
  attachments?: TAttachment[];
}

export interface PackChatMessagesInput<
  TAttachment = unknown,
  TReasoningEffort = unknown,
  TProvider = unknown,
  TProviderType = unknown,
> {
  messages: readonly ContextPackingMessage<TAttachment>[];
  contextPrompt?: string;
  modelContextWindow: number;
  maxOutputTokens: number;
  systemPrompt?: string;
  reasoningEffort?: TReasoningEffort;
  provider?: TProvider;
  providerType?: TProviderType;
  model?: string;
  localCompression?: boolean;
}

export interface PackedCompressionMetadata {
  schemaVersion: 2;
  strategy: LocalCompressionStrategy;
  triggerReason:
    | "message_budget_exceeded"
    | "single_message_budget_exceeded"
    | "disabled_or_unneeded";
  sourceMessageCount: number;
  keptMessageCount: number;
  sourceRoleCounts: PackedCompressionRoleCounts;
  keptRoleCounts: PackedCompressionRoleCounts;
  sourceTokens: number;
  compressedTokens: number;
  estimatedSavedTokens: number;
  compressionRatio: number;
  summaryTokenBudget: number;
  summaryTokens: number;
  summarySectionCount: number;
  summaryItemCount: number;
  summarySections: PackedCompressionSectionMetadata[];
}

export interface PackedCompressionSectionMetadata {
  id: SummarySectionId;
  title: string;
  itemCount: number;
}

export interface PackedCompressionRoleCounts {
  user: number;
  assistant: number;
}

export interface PackedChatMessages {
  messages: Array<{ role: ContextPackingRole; content: string }>;
  contextPrompt: string;
  estimatedInputTokens: number;
  budgetTokens: number;
  trimmedCount: number;
  fixedTokens: number;
  messageTokens: number;
  modelBudgetTokens: number;
  reservedOutputTokens: number;
  reasoningReserveTokens: number;
  compressionTriggered: boolean;
  truncatedSingleMessage: boolean;
  compressionMetadata: PackedCompressionMetadata;
}

export interface ContextPackingReasoningReserveInput<
  TReasoningEffort = unknown,
  TProvider = unknown,
  TProviderType = unknown,
> {
  reasoningEffort?: TReasoningEffort;
  provider?: TProvider;
  providerType?: TProviderType;
  model?: string;
}

export interface ContextPackingPolicyDependencies<
  TAttachment = unknown,
  TReasoningEffort = unknown,
  TProvider = unknown,
  TProviderType = unknown,
> {
  estimateTextTokens(text: string): number;
  estimateMessageTokens(
    messages: ContextPackingTokenMessage<TAttachment>[],
  ): number;
  estimateReasoningReserve(
    input: ContextPackingReasoningReserveInput<
      TReasoningEffort,
      TProvider,
      TProviderType
    >,
  ): number;
}

export interface ContextPackingPolicy<
  TAttachment = unknown,
  TReasoningEffort = unknown,
  TProvider = unknown,
  TProviderType = unknown,
> {
  packChatMessages(
    input: PackChatMessagesInput<
      TAttachment,
      TReasoningEffort,
      TProvider,
      TProviderType
    >,
  ): PackedChatMessages;
}

interface StructuredSummary {
  text: string;
  sectionCount: number;
  itemCount: number;
  sections: PackedCompressionSectionMetadata[];
}

interface SummarySectionConfig {
  id: SummarySectionId;
  title: string;
  maxItems: number;
  maxChars: number;
}

interface SummaryCandidate {
  value: string;
  priority: SummaryCandidatePriority;
}

const SUMMARY_SECTIONS: SummarySectionConfig[] = [
  { id: "constraints", title: "用户约束", maxItems: 5, maxChars: 150 },
  { id: "decisions", title: "已确认决策", maxItems: 5, maxChars: 150 },
  { id: "failures", title: "失败与风险", maxItems: 4, maxChars: 150 },
  { id: "actions", title: "待办与下一步", maxItems: 5, maxChars: 150 },
  { id: "references", title: "重要引用", maxItems: 6, maxChars: 130 },
  { id: "recent", title: "近期旧消息", maxItems: 6, maxChars: 140 },
];

export function createContextPackingPolicy<
  TAttachment = unknown,
  TReasoningEffort = unknown,
  TProvider = unknown,
  TProviderType = unknown,
>(
  dependencies: ContextPackingPolicyDependencies<
    TAttachment,
    TReasoningEffort,
    TProvider,
    TProviderType
  >,
): ContextPackingPolicy<
  TAttachment,
  TReasoningEffort,
  TProvider,
  TProviderType
> {
  const packChatMessages = (
    input: PackChatMessagesInput<
      TAttachment,
      TReasoningEffort,
      TProvider,
      TProviderType
    >,
  ): PackedChatMessages => {
    const reasoningReserveTokens = dependencies.estimateReasoningReserve({
      reasoningEffort: input.reasoningEffort,
      provider: input.provider,
      providerType: input.providerType,
      model: input.model,
    });
    const reservedOutputTokens = input.maxOutputTokens + reasoningReserveTokens;
    const modelBudget = Math.max(
      512,
      Math.floor(input.modelContextWindow * INPUT_CONTEXT_RATIO) -
        reservedOutputTokens,
    );
    const baseContextPrompt = input.contextPrompt ?? "";
    const fixedTokens = dependencies.estimateTextTokens(
      [input.systemPrompt, baseContextPrompt].filter(Boolean).join("\n\n"),
    );
    const budgetTokens = Math.max(256, modelBudget - fixedTokens);
    const cleanMessages = input.messages
      .filter(
        (message) =>
          message.status !== "error" && message.status !== "cancelled",
      )
      .map((message) => ({
        role: message.role,
        content: (message.responseText ?? message.content ?? "").trim(),
        attachments: message.attachments,
      }))
      .filter((message) => message.content || message.attachments?.length);

    let selected = cleanMessages;
    let estimatedInputTokens = dependencies.estimateMessageTokens(selected);
    if (
      estimatedInputTokens <= budgetTokens ||
      input.localCompression === false
    ) {
      return {
        messages: selected.map(toRequestMessage),
        contextPrompt: baseContextPrompt,
        estimatedInputTokens,
        budgetTokens,
        trimmedCount: 0,
        fixedTokens,
        messageTokens: estimatedInputTokens,
        modelBudgetTokens: modelBudget,
        reservedOutputTokens,
        reasoningReserveTokens,
        compressionTriggered: false,
        truncatedSingleMessage: false,
        compressionMetadata: emptyCompressionMetadata(),
      };
    }

    let truncatedSingleMessage = false;
    selected = [];
    for (let index = cleanMessages.length - 1; index >= 0; index -= 1) {
      const candidate = [cleanMessages[index], ...selected];
      const estimatedCandidateTokens =
        dependencies.estimateMessageTokens(candidate);
      if (
        estimatedCandidateTokens > budgetTokens * 0.72 &&
        selected.length >= RECENT_MESSAGE_TARGET
      )
        break;
      if (estimatedCandidateTokens > budgetTokens && selected.length >= 2)
        break;
      selected = candidate;
    }
    const trimmed = cleanMessages.slice(
      0,
      Math.max(0, cleanMessages.length - selected.length),
    );
    const trimmedTokens = dependencies.estimateMessageTokens(trimmed);
    const selectedTokens = dependencies.estimateMessageTokens(selected);
    const summaryBudget = Math.max(
      80,
      budgetTokens - selectedTokens - 24,
    );
    const summary = summarizeMessages(
      trimmed,
      summaryBudget,
      dependencies.estimateTextTokens,
    );
    const summaryPrompt = summary.text ? `历史摘要\n${summary.text}` : "";
    const contextPrompt = [
      baseContextPrompt,
      summaryPrompt,
    ]
      .filter(Boolean)
      .join("\n\n");
    const summaryPromptTokens = dependencies.estimateTextTokens(summaryPrompt);
    estimatedInputTokens =
      dependencies.estimateMessageTokens(selected) +
      summaryPromptTokens;

    while (estimatedInputTokens > budgetTokens && selected.length > 1) {
      selected = selected.slice(1);
      estimatedInputTokens =
        dependencies.estimateMessageTokens(selected) +
        summaryPromptTokens;
    }

    let truncatedSourceTokens = 0;
    let truncatedCompressedTokens = 0;
    if (estimatedInputTokens > budgetTokens && selected.length === 1) {
      truncatedSourceTokens = dependencies.estimateMessageTokens(selected);
      truncatedSingleMessage = true;
      selected = [
        {
          ...selected[0],
          content: truncateToTokenBudget(
            selected[0].content,
            Math.max(
              128,
              budgetTokens - summaryPromptTokens - 12,
            ),
            dependencies.estimateTextTokens,
          ),
        },
      ];
      truncatedCompressedTokens = dependencies.estimateMessageTokens(selected);
      estimatedInputTokens =
        dependencies.estimateMessageTokens(selected) +
        summaryPromptTokens;
    }
    const summaryTokens = dependencies.estimateTextTokens(summary.text);
    const sourceTokens = trimmedTokens + truncatedSourceTokens;
    const compressedTokens = summaryTokens + truncatedCompressedTokens;
    const estimatedSavedTokens = Math.max(0, sourceTokens - compressedTokens);

    return {
      messages: selected.map(toRequestMessage),
      contextPrompt,
      estimatedInputTokens,
      budgetTokens,
      trimmedCount: trimmed.length,
      fixedTokens,
      messageTokens: dependencies.estimateMessageTokens(selected),
      modelBudgetTokens: modelBudget,
      reservedOutputTokens,
      reasoningReserveTokens,
      compressionTriggered: true,
      truncatedSingleMessage,
      compressionMetadata: {
        strategy: summary.text
          ? "structured-v2"
          : truncatedSingleMessage
            ? "single-message-truncation"
            : "structured-v2",
        schemaVersion: 2,
        triggerReason: truncatedSingleMessage
          ? "single_message_budget_exceeded"
          : "message_budget_exceeded",
        sourceMessageCount: trimmed.length,
        keptMessageCount: selected.length,
        sourceRoleCounts: countMessageRoles(trimmed),
        keptRoleCounts: countMessageRoles(selected),
        sourceTokens,
        compressedTokens,
        estimatedSavedTokens,
        compressionRatio: estimateCompressionRatio(
          sourceTokens,
          compressedTokens,
        ),
        summaryTokenBudget: summaryBudget,
        summaryTokens,
        summarySectionCount: summary.sectionCount,
        summaryItemCount: summary.itemCount,
        summarySections: summary.sections,
      },
    };
  };

  return { packChatMessages };
}

function toRequestMessage(message: {
  role: ContextPackingRole;
  content: string;
}) {
  return { role: message.role, content: message.content };
}

function summarizeMessages(
  messages: Array<{ role: ContextPackingRole; content: string }>,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): StructuredSummary {
  if (!messages.length)
    return { text: "", sectionCount: 0, itemCount: 0, sections: [] };
  const sections = collectStructuredSummarySections(messages);
  let text = renderStructuredSummary(sections, SUMMARY_SECTIONS);
  if (!text) {
    text = messages
      .slice(-8)
      .map(
        (message) =>
          `${roleLabel(message.role)}: ${normalizeSummaryText(message.content).slice(0, 180)}`,
      )
      .join("\n");
  }
  text = clampSummaryToTokenBudget(text, tokenBudget, estimateTextTokens);
  const summarySections = collectRenderedSummarySections(text);
  return {
    text,
    sectionCount: summarySections.length,
    itemCount: summarySections.reduce(
      (sum, section) => sum + section.itemCount,
      0,
    ),
    sections: summarySections,
  };
}

function emptyCompressionMetadata(): PackedCompressionMetadata {
  return {
    schemaVersion: 2,
    strategy: "none",
    triggerReason: "disabled_or_unneeded",
    sourceMessageCount: 0,
    keptMessageCount: 0,
    sourceRoleCounts: { user: 0, assistant: 0 },
    keptRoleCounts: { user: 0, assistant: 0 },
    sourceTokens: 0,
    compressedTokens: 0,
    estimatedSavedTokens: 0,
    compressionRatio: 0,
    summaryTokenBudget: 0,
    summaryTokens: 0,
    summarySectionCount: 0,
    summaryItemCount: 0,
    summarySections: [],
  };
}

function countMessageRoles(
  messages: Array<{ role: ContextPackingRole }>,
): PackedCompressionRoleCounts {
  return messages.reduce<PackedCompressionRoleCounts>(
    (counts, message) => {
      counts[message.role] += 1;
      return counts;
    },
    { user: 0, assistant: 0 },
  );
}

function collectStructuredSummarySections(
  messages: Array<{ role: ContextPackingRole; content: string }>,
): Map<SummarySectionId, SummaryCandidate[]> {
  const sections = new Map<SummarySectionId, SummaryCandidate[]>();
  const seen = new Set<string>();

  messages.forEach((message) => {
    const text = normalizeSummaryText(message.content);
    if (!text) return;
    const line = `${roleLabel(message.role)}: ${text}`;
    const importance = classifySummaryImportance(text);
    if (
      /(必须|务必|不要|不能|禁止|保留|默认|要求|约束|must|should|never|require|constraint)/i.test(
        text,
      )
    ) {
      pushSummaryItem(
        sections,
        seen,
        "constraints",
        line,
        escalateSummaryPriority(importance, "high"),
      );
    }
    if (
      /(决定|已确认|结论|采用|选择|改为|移除|删除|完成|decided|decision|adopt|choose|confirmed)/i.test(
        text,
      )
    ) {
      pushSummaryItem(sections, seen, "decisions", line, importance);
    }
    if (
      /(失败|报错|错误|异常|阻断|风险|超时|unauthorized|timeout|failed|failure|error|blocked|risk|TS\d+)/i.test(
        text,
      )
    ) {
      pushSummaryItem(
        sections,
        seen,
        "failures",
        line,
        escalateSummaryPriority(importance, "high"),
      );
    }
    if (
      /(下一步|待办|需要|修复|验证|检查|运行|实现|todo|next|fix|verify|run|implement|inspect)/i.test(
        text,
      )
    ) {
      pushSummaryItem(sections, seen, "actions", line, importance);
    }
    for (const reference of extractReferences(text)) {
      const referencePriority =
        /(?:src|app|scripts|docs)\//i.test(reference) ||
        /(?:bun run|node scripts\/|git |adb |pwsh )/i.test(reference)
          ? "high"
          : importance;
      pushSummaryItem(
        sections,
        seen,
        "references",
        `${roleLabel(message.role)}: ${reference}`,
        referencePriority,
      );
    }
  });

  messages.slice(-8).forEach((message) => {
    const text = normalizeSummaryText(message.content);
    if (!text) return;
    pushSummaryItem(
      sections,
      seen,
      "recent",
      `${roleLabel(message.role)}: ${text}`,
      classifyRecentPriority(text),
    );
  });

  return sections;
}

function pushSummaryItem(
  sections: Map<SummarySectionId, SummaryCandidate[]>,
  seen: Set<string>,
  section: SummarySectionId,
  value: string,
  priority: SummaryCandidatePriority,
): void {
  const normalized = value.toLowerCase();
  if (seen.has(`${section}:${normalized}`)) return;
  seen.add(`${section}:${normalized}`);
  const items = sections.get(section) ?? [];
  items.push({ value, priority });
  sections.set(section, items);
}

function extractReferences(text: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /\b(?:src|app|scripts|docs|assets|test-evidence|output)\/[A-Za-z0-9_./-]+\b/g,
    /\b[A-Za-z]:\\[^\s"'<>|\uff0c\u3002\uff1b;]+/g,
    /\b(?:bun run|node scripts\/|npx |git |adb |pwsh |powershell )[^\n\u3002\uff1b;]{1,120}/gi,
    /\b[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|ps1|sql|db)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizeReferenceMatch(match[0].trim());
      matches.add(value);
    }
  }
  return Array.from(matches).slice(0, 10);
}

function renderStructuredSummary(
  sections: Map<SummarySectionId, SummaryCandidate[]>,
  sectionConfigs: SummarySectionConfig[],
): string {
  return sectionConfigs
    .map((section) => {
      const items = rankSummaryCandidates(
        section.id,
        sections.get(section.id) ?? [],
      ).slice(0, section.maxItems);
      if (!items.length) return "";
      return [
        section.title,
        ...items.map(
          (item) =>
            `- ${
              section.id === "references"
                ? clampReferenceSummaryLine(
                    item.value,
                    Math.max(section.maxChars, 420),
                  )
                : clampSummaryLine(item.value, section.maxChars)
            }`,
        ),
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function collectRenderedSummarySections(
  text: string,
): PackedCompressionSectionMetadata[] {
  const sectionByTitle = new Map(
    SUMMARY_SECTIONS.map((section) => [section.title, section]),
  );
  const sections: PackedCompressionSectionMetadata[] = [];
  let current: PackedCompressionSectionMetadata | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const config = sectionByTitle.get(line);
    if (config) {
      current = { id: config.id, title: config.title, itemCount: 0 };
      sections.push(current);
      continue;
    }
    if (current && line.startsWith("- ")) current.itemCount += 1;
  }
  return sections;
}

function estimateCompressionRatio(
  sourceTokens: number,
  compressedTokens: number,
): number {
  if (!Number.isFinite(sourceTokens) || sourceTokens <= 0) return 0;
  if (!Number.isFinite(compressedTokens) || compressedTokens <= 0) return 0;
  return Math.round((compressedTokens / sourceTokens) * 1000) / 1000;
}

function normalizeSummaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function roleLabel(role: ContextPackingRole): string {
  return role === "user" ? "用户" : "助手";
}

function clampSummaryLine(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, Math.max(24, maxChars - 3))}...`
    : trimmed;
}

function clampReferenceSummaryLine(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const pathMatch = trimmed.match(
    /[A-Za-z]:\\[^\s"'<>|]+|(?:src|app|scripts|docs|assets)\/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|ps1|sql|db)\b/,
  );
  if (!pathMatch) return clampSummaryLine(trimmed, maxChars);
  const pathValue = pathMatch[0];
  const prefix = trimmed.slice(0, pathMatch.index ?? 0).trimEnd();
  if (pathValue.length <= maxChars)
    return prefix ? `${prefix} ${pathValue}` : pathValue;
  const pathBudget = Math.max(96, maxChars - Math.min(prefix.length + 1, 48));
  const preservedPath = preserveHeadTail(pathValue, pathBudget).replace(
    /\n\.\.\.\n/g,
    "...",
  );
  const next = prefix ? `${prefix} ${preservedPath}` : preservedPath;
  return next.length > maxChars ? next : next;
}

function clampSummaryToTokenBudget(
  summary: string,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): string {
  let next = summary.trim();
  let lineBudget = 140;
  while (
    estimateTextTokens(next) > tokenBudget &&
    next.length > 240 &&
    lineBudget > 48
  ) {
    lineBudget = Math.floor(lineBudget * 0.78);
    next = next
      .split("\n")
      .map((line) => {
        if (!line.startsWith("- ")) return line;
        return /(?:src|app|scripts|docs|assets)\/|[A-Za-z]:\\/.test(line)
          ? clampReferenceSummaryLine(line, Math.max(lineBudget, 220))
          : clampSummaryLine(line, lineBudget);
      })
      .join("\n");
  }
  while (
    estimateTextTokens(next) > tokenBudget &&
    next.includes("\n近期旧消息\n")
  ) {
    next = next.replace(/\n近期旧消息\n[\s\S]*$/u, "");
  }
  if (estimateTextTokens(next) > tokenBudget) {
    next = compactStructuredSummarySections(
      next,
      tokenBudget,
      estimateTextTokens,
    );
  }
  return next.trim();
}

function compactStructuredSummarySections(
  summary: string,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): string {
  const sections = parseStructuredSummarySections(summary);
  if (!sections.length) {
    return truncateSummaryHeadToTokenBudget(
      summary,
      tokenBudget,
      estimateTextTokens,
    );
  }

  let next = renderStructuredSummarySections(sections);
  while (estimateTextTokens(next) > tokenBudget) {
    const sectionWithExtraItem = [...sections]
      .filter((section) => section.items.length > 1)
      .sort((left, right) => {
        const extraItemDelta = right.items.length - left.items.length;
        if (extraItemDelta !== 0) return extraItemDelta;
        return longestSummaryItemLength(right) - longestSummaryItemLength(left);
      })[0];
    if (!sectionWithExtraItem) break;
    sectionWithExtraItem.items.pop();
    next = renderStructuredSummarySections(sections);
  }

  for (const maxChars of [112, 88, 68, 52, 40]) {
    if (estimateTextTokens(next) <= tokenBudget) break;
    for (const section of sections) {
      section.items = section.items.map((item) =>
        clampSummaryLine(item, maxChars),
      );
    }
    next = renderStructuredSummarySections(sections);
  }

  while (estimateTextTokens(next) > tokenBudget) {
    const removable = [...sections]
      .filter(
        (section) => section.id === "recent" || section.items.length === 0,
      )
      .at(-1);
    if (!removable) break;
    sections.splice(sections.indexOf(removable), 1);
    next = renderStructuredSummarySections(sections);
  }

  const removalOrder: SummarySectionId[] = [
    "recent",
    "references",
    "decisions",
    "actions",
    "failures",
  ];
  while (estimateTextTokens(next) > tokenBudget && sections.length > 1) {
    const removableId = removalOrder.find((id) =>
      sections.some((section) => section.id === id),
    );
    const removableIndex = removableId
      ? sections.findIndex((section) => section.id === removableId)
      : sections.length - 1;
    sections.splice(removableIndex, 1);
    next = renderStructuredSummarySections(sections);
  }

  if (estimateTextTokens(next) > tokenBudget && sections[0]?.items[0]) {
    sections[0].items = [
      truncateSummaryHeadToTokenBudget(
        sections[0].items[0],
        Math.max(24, tokenBudget - estimateTextTokens(sections[0].title)),
        estimateTextTokens,
      ),
    ];
    next = renderStructuredSummarySections(sections);
  }

  return next;
}

function parseStructuredSummarySections(
  summary: string,
): Array<{ id: SummarySectionId; title: string; items: string[] }> {
  const configByTitle = new Map(
    SUMMARY_SECTIONS.map((section) => [section.title, section]),
  );
  const sections: Array<{
    id: SummarySectionId;
    title: string;
    items: string[];
  }> = [];
  let current:
    | { id: SummarySectionId; title: string; items: string[] }
    | undefined;
  for (const rawLine of summary.split("\n")) {
    const line = rawLine.trim();
    const config = configByTitle.get(line);
    if (config) {
      current = { id: config.id, title: config.title, items: [] };
      sections.push(current);
      continue;
    }
    if (current && line.startsWith("- ")) current.items.push(line);
  }
  return sections;
}

function renderStructuredSummarySections(
  sections: Array<{ title: string; items: string[] }>,
): string {
  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => [section.title, ...section.items].join("\n"))
    .join("\n");
}

function longestSummaryItemLength(section: { items: string[] }): number {
  return section.items.reduce((max, item) => Math.max(max, item.length), 0);
}

function truncateSummaryHeadToTokenBudget(
  text: string,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): string {
  const source = text.trim();
  let next = source;
  while (estimateTextTokens(next) > tokenBudget && next.length > 24) {
    next = preserveHeadTail(
      next,
      Math.max(120, Math.floor(next.length * 0.78)),
    );
  }
  if (next.length >= source.length) return next;
  const truncated = `${next}\n[历史摘要已截断]`;
  return estimateTextTokens(truncated) <= tokenBudget ? truncated : next;
}

function truncateToTokenBudget(
  text: string,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): string {
  const source = text.trim();
  const prefix = "[前文过长，已保留开头与末尾]\n";
  if (estimateTextTokens(source) <= tokenBudget) return source;
  if (estimateTextTokens(prefix) >= tokenBudget) {
    return preserveHeadTail(
      source,
      Math.max(120, Math.floor(source.length * 0.72)),
    );
  }
  let next = source;
  while (estimateTextTokens(next) > tokenBudget && next.length > 180) {
    next = preserveHeadTail(
      next,
      Math.max(120, Math.floor(next.length * 0.72)),
    );
  }
  if (next.length >= source.length) return next;
  let prefixed = `${prefix}${next}`;
  while (estimateTextTokens(prefixed) > tokenBudget && next.length > 120) {
    next = preserveHeadTail(next, Math.max(96, Math.floor(next.length * 0.84)));
    prefixed = `${prefix}${next}`;
  }
  return estimateTextTokens(prefixed) <= tokenBudget ? prefixed : next;
}

function preserveHeadTail(text: string, keepChars: number): string {
  const source = text.trim();
  if (source.length <= keepChars) return source;
  const ellipsis = "\n...\n";
  const available = Math.max(48, keepChars - ellipsis.length);
  const headLength = Math.max(24, Math.ceil(available * 0.42));
  const tailLength = Math.max(24, available - headLength);
  return `${source.slice(0, headLength).trimEnd()}${ellipsis}${source
    .slice(Math.max(headLength, source.length - tailLength))
    .trimStart()}`;
}

function classifySummaryImportance(text: string): SummaryCandidatePriority {
  if (
    /(?:\b(?:fatal|critical|blocker|blocked|cannot|must|required|forbidden|security|unauthorized|denied|timeout|traceback|exception)\b|TS\d+|HTTP\s*\d{3}|line\s+\d+|:[0-9]{1,5}\b|```|Error:|失败|阻断|必须|禁止|报错|超时|异常|安全|未授权|权限)/i.test(
      text,
    )
  ) {
    return "critical";
  }
  if (
    /(?:\b(?:todo|next|verify|inspect|implement|fix|patch|config|command|file|diff|test)\b|src\/|app\/|scripts\/|docs\/|[A-Za-z]:\\|bun run|node scripts\/|git |adb |pwsh |步骤|待办|下一步|验证|修复|实现|检查|文件|命令)/i.test(
      text,
    )
  ) {
    return "high";
  }
  return "normal";
}

function classifyRecentPriority(text: string): SummaryCandidatePriority {
  return /(?:\b(?:done|fixed|verified|passed|ready)\b|完成|已修复|已验证|通过)/i.test(
    text,
  )
    ? "normal"
    : classifySummaryImportance(text);
}

function escalateSummaryPriority(
  current: SummaryCandidatePriority,
  minimum: Exclude<SummaryCandidatePriority, "normal">,
): SummaryCandidatePriority {
  const rank = { normal: 0, high: 1, critical: 2 } as const;
  return rank[current] >= rank[minimum] ? current : minimum;
}

function rankSummaryCandidates(
  section: SummarySectionId,
  items: SummaryCandidate[],
): SummaryCandidate[] {
  const priorityRank = { critical: 0, high: 1, normal: 2 } as const;
  return [...items].sort((left, right) => {
    const byPriority =
      priorityRank[left.priority] - priorityRank[right.priority];
    if (byPriority !== 0) return byPriority;
    if (section === "references") {
      const leftScore = referenceStabilityScore(left.value);
      const rightScore = referenceStabilityScore(right.value);
      if (leftScore !== rightScore) return rightScore - leftScore;
    }
    return right.value.length - left.value.length;
  });
}

function referenceStabilityScore(value: string): number {
  let score = 0;
  if (/(?:src|app|scripts|docs)\//i.test(value)) score += 4;
  if (/\b[A-Za-z]:\\/.test(value)) score += 4;
  if (/\.(?:ts|tsx|js|jsx|json|md|yml|yaml|ps1|sql|db)\b/i.test(value))
    score += 2;
  if (/(?:bun run|node scripts\/|git |adb |pwsh |powershell )/i.test(value))
    score += 1;
  return score;
}

function normalizeReferenceMatch(value: string): string {
  const normalizedWindows = value.replace(/\\/g, "/");
  const repoRelative = normalizedWindows.match(
    /(?:^|\/)(src|app|scripts|docs|assets|test-evidence|output\/?)[A-Za-z0-9_./-]*/i,
  );
  if (repoRelative) return repoRelative[0].replace(/^\/+/, "");
  return value;
}
