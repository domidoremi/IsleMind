export const DOCUMENT_INGESTION_BENCHMARK_SCHEMA = 'islemind.document-ingestion-benchmark.v1'
export const DOCUMENT_INGESTION_PARSERS = ['current-text', 'current-provider-pdf', 'markitdown', 'docling', 'unstructured', 'mineru'] as const

export type DocumentIngestionParserId = typeof DOCUMENT_INGESTION_PARSERS[number]
export type DocumentIngestionSourceKind = 'pdf' | 'office' | 'markdown' | 'spreadsheet'
export type DocumentIngestionFeature = 'tables' | 'formulas' | 'code-blocks' | 'mixed-language' | 'source-map'

export interface DocumentIngestionBenchmarkCase {
  id: string
  sourceKind: DocumentIngestionSourceKind
  mimeType: string
  title: string
  expectedTerms: string[]
  expectedTableCells: string[]
  expectedFormulaTokens: string[]
  expectedCodeTokens: string[]
  expectedLanguages: string[]
  expectedSourceAnchors: string[]
  expectedCitationSourceIds: string[]
  requiredFeatures: DocumentIngestionFeature[]
}

export interface DocumentIngestionParserOutput {
  parserId: DocumentIngestionParserId
  caseId: string
  text: string
  tables?: string[][]
  formulas?: string[]
  codeBlocks?: Array<{ language?: string; text: string }>
  languages?: string[]
  sourceAnchors?: string[]
  citationSourceIds?: string[]
  failureCode?: string
  fallbackOutput?: string
  latencyMs?: number
}

export interface DocumentIngestionCaseScore {
  parserId: DocumentIngestionParserId
  caseId: string
  extractionQuality: number
  termRecall: number
  tablePreservation: number
  formulaPreservation: number
  codeBlockPreservation: number
  mixedLanguageCoverage: number
  sourceMappingCoverage: number
  citationContinuity: number
  failureHandled: boolean
  readyForImport: boolean
  failureCode?: string
  fallbackOutput?: string
}

export interface DocumentIngestionCaseSummary {
  caseId: string
  sourceKind: DocumentIngestionSourceKind
  bestParserId: DocumentIngestionParserId
  bestExtractionQuality: number
  bestCitationContinuity: number
  parserCount: number
  failureCodes: string[]
}

export interface DocumentIngestionParserSummary {
  parserId: DocumentIngestionParserId
  caseCount: number
  readyCaseCount: number
  averageExtractionQuality: number
  averageCitationContinuity: number
  failureCodes: string[]
}

export interface DocumentIngestionQualityGate {
  passed: boolean
  minBestExtractionQuality: number
  minBestCitationContinuity: number
  failures: string[]
}

export interface DocumentIngestionBenchmarkRun {
  schema: typeof DOCUMENT_INGESTION_BENCHMARK_SCHEMA
  id: string
  ranAt: number
  parsers: DocumentIngestionParserId[]
  cases: DocumentIngestionBenchmarkCase[]
  scores: DocumentIngestionCaseScore[]
  caseSummaries: DocumentIngestionCaseSummary[]
  parserSummaries: Record<DocumentIngestionParserId, DocumentIngestionParserSummary>
  qualityGate: DocumentIngestionQualityGate
}

export interface DocumentIngestionBenchmarkOptions {
  now?: () => number
  cases?: DocumentIngestionBenchmarkCase[]
  outputs?: DocumentIngestionParserOutput[]
  minBestExtractionQuality?: number
  minBestCitationContinuity?: number
}

export const DOCUMENT_INGESTION_BENCHMARK_CASES: DocumentIngestionBenchmarkCase[] = [
  {
    id: 'pdf-layout-table-formula',
    sourceKind: 'pdf',
    mimeType: 'application/pdf',
    title: 'PDF layout with table and formulas',
    expectedTerms: ['gross margin', 'Section 2', 'Euler identity'],
    expectedTableCells: ['Q1', 'Revenue', '42', 'Gross margin'],
    expectedFormulaTokens: ['E = mc^2', 'a^2 + b^2 = c^2'],
    expectedCodeTokens: [],
    expectedLanguages: ['en'],
    expectedSourceAnchors: ['pdf:p1', 'pdf:p2'],
    expectedCitationSourceIds: ['pdf:p1', 'pdf:p2'],
    requiredFeatures: ['tables', 'formulas', 'source-map'],
  },
  {
    id: 'office-mixed-language-table',
    sourceKind: 'office',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    title: 'Office mixed-language decision table',
    expectedTerms: ['Project Alpha', '决策', '課題'],
    expectedTableCells: ['Owner', '状态', 'Tanaka', 'blocked'],
    expectedFormulaTokens: [],
    expectedCodeTokens: [],
    expectedLanguages: ['en', 'zh-CN', 'ja'],
    expectedSourceAnchors: ['docx:p1', 'docx:table1'],
    expectedCitationSourceIds: ['docx:p1', 'docx:table1'],
    requiredFeatures: ['tables', 'mixed-language', 'source-map'],
  },
  {
    id: 'markdown-code-csv',
    sourceKind: 'markdown',
    mimeType: 'text/markdown',
    title: 'Markdown with code and CSV-style table',
    expectedTerms: ['retry budget', 'provider matrix', 'fallback route'],
    expectedTableCells: ['provider', 'supportsTools', 'openai', 'true'],
    expectedFormulaTokens: [],
    expectedCodeTokens: ['function routeProvider', 'maxRetries'],
    expectedLanguages: ['en'],
    expectedSourceAnchors: ['md:h1', 'md:code', 'md:table'],
    expectedCitationSourceIds: ['md:h1', 'md:code', 'md:table'],
    requiredFeatures: ['tables', 'code-blocks', 'source-map'],
  },
]

export const DOCUMENT_INGESTION_PARSER_FIXTURES: DocumentIngestionParserOutput[] = [
  output('current-provider-pdf', 'pdf-layout-table-formula', {
    text: 'Section 2 says gross margin improved. The PDF extraction mentions Euler identity but flattens table structure.',
    formulas: ['E = mc^2'],
    sourceAnchors: ['pdf:p1'],
    citationSourceIds: ['pdf:p1'],
    latencyMs: 4200,
  }),
  output('markitdown', 'pdf-layout-table-formula', {
    text: 'Section 2 gross margin. Markdown table: Q1 Revenue 42 Gross margin. Formula text: E = mc^2.',
    tables: [['Q1', 'Revenue', '42'], ['Q1', 'Gross margin', '0.42']],
    formulas: ['E = mc^2'],
    sourceAnchors: ['pdf:p1'],
    citationSourceIds: ['pdf:p1'],
    latencyMs: 900,
  }),
  output('docling', 'pdf-layout-table-formula', {
    text: 'Section 2 explains gross margin and the Euler identity with page-aware blocks.',
    tables: [['Q1', 'Revenue', '42'], ['Q1', 'Gross margin', '0.42']],
    formulas: ['E = mc^2', 'a^2 + b^2 = c^2'],
    sourceAnchors: ['pdf:p1', 'pdf:p2'],
    citationSourceIds: ['pdf:p1', 'pdf:p2'],
    latencyMs: 1400,
  }),
  output('unstructured', 'pdf-layout-table-formula', {
    text: 'Section 2 gross margin. Q1 Revenue 42. Euler identity appears in extracted narrative.',
    tables: [['Q1', 'Revenue', '42']],
    formulas: ['E = mc^2'],
    sourceAnchors: ['pdf:p1', 'pdf:p2'],
    citationSourceIds: ['pdf:p1', 'pdf:p2'],
    latencyMs: 1600,
  }),
  output('mineru', 'pdf-layout-table-formula', {
    text: 'Section 2: gross margin. MinerU preserves mathematical layout and reading order for the Euler identity.',
    tables: [['Q1', 'Revenue', '42'], ['Q1', 'Gross margin', '0.42']],
    formulas: ['E = mc^2', 'a^2 + b^2 = c^2'],
    sourceAnchors: ['pdf:p1', 'pdf:p2'],
    citationSourceIds: ['pdf:p1', 'pdf:p2'],
    latencyMs: 2100,
  }),
  output('current-text', 'office-mixed-language-table', {
    text: '',
    failureCode: 'unsupported-office-document',
    fallbackOutput: 'Ask the user to export Office documents as text, Markdown, or PDF before indexing.',
  }),
  output('markitdown', 'office-mixed-language-table', {
    text: 'Project Alpha 决策: proceed. 課題: blocked by review. Owner Tanaka 状态 blocked.',
    tables: [['Owner', '状态'], ['Tanaka', 'blocked']],
    languages: ['en', 'zh-CN', 'ja'],
    sourceAnchors: ['docx:p1', 'docx:table1'],
    citationSourceIds: ['docx:p1', 'docx:table1'],
    latencyMs: 800,
  }),
  output('docling', 'office-mixed-language-table', {
    text: 'Project Alpha contains a decision section and mixed-language issue notes: 决策, 課題.',
    tables: [['Owner', '状态'], ['Tanaka', 'blocked']],
    languages: ['en', 'zh-CN', 'ja'],
    sourceAnchors: ['docx:p1', 'docx:table1'],
    citationSourceIds: ['docx:p1', 'docx:table1'],
    latencyMs: 1300,
  }),
  output('unstructured', 'office-mixed-language-table', {
    text: 'Project Alpha decision. 决策 proceed. 課題 blocked. Owner Tanaka 状态 blocked.',
    tables: [['Owner', '状态'], ['Tanaka', 'blocked']],
    languages: ['en', 'zh-CN', 'ja'],
    sourceAnchors: ['docx:p1', 'docx:table1'],
    citationSourceIds: ['docx:p1', 'docx:table1'],
    latencyMs: 1100,
  }),
  output('mineru', 'office-mixed-language-table', {
    text: '',
    failureCode: 'unsupported-office-document',
    fallbackOutput: 'Use MinerU for layout-heavy PDFs; route Office documents to MarkItDown, Docling, or Unstructured.',
  }),
  output('current-text', 'markdown-code-csv', {
    text: '# Provider matrix\nretry budget and fallback route\nprovider,supportsTools\nopenai,true\n```ts\nfunction routeProvider(maxRetries: number) { return maxRetries }\n```',
    tables: [['provider', 'supportsTools'], ['openai', 'true']],
    codeBlocks: [{ language: 'ts', text: 'function routeProvider(maxRetries: number) { return maxRetries }' }],
    languages: ['en'],
    sourceAnchors: ['md:h1', 'md:code', 'md:table'],
    citationSourceIds: ['md:h1', 'md:code', 'md:table'],
    latencyMs: 120,
  }),
  output('markitdown', 'markdown-code-csv', {
    text: '# Provider matrix\nretry budget and fallback route\n| provider | supportsTools |\n| openai | true |\n```ts\nfunction routeProvider(maxRetries: number) { return maxRetries }\n```',
    tables: [['provider', 'supportsTools'], ['openai', 'true']],
    codeBlocks: [{ language: 'ts', text: 'function routeProvider(maxRetries: number) { return maxRetries }' }],
    languages: ['en'],
    sourceAnchors: ['md:h1', 'md:code', 'md:table'],
    citationSourceIds: ['md:h1', 'md:code', 'md:table'],
    latencyMs: 180,
  }),
  output('docling', 'markdown-code-csv', {
    text: 'Provider matrix includes retry budget, fallback route, and a TypeScript function routeProvider.',
    tables: [['provider', 'supportsTools'], ['openai', 'true']],
    codeBlocks: [{ language: 'typescript', text: 'function routeProvider(maxRetries: number) { return maxRetries }' }],
    languages: ['en'],
    sourceAnchors: ['md:h1', 'md:code', 'md:table'],
    citationSourceIds: ['md:h1', 'md:code', 'md:table'],
    latencyMs: 600,
  }),
  output('unstructured', 'markdown-code-csv', {
    text: 'Provider matrix retry budget fallback route provider supportsTools openai true function routeProvider maxRetries',
    tables: [['provider', 'supportsTools'], ['openai', 'true']],
    codeBlocks: [{ language: 'typescript', text: 'function routeProvider(maxRetries: number)' }],
    languages: ['en'],
    sourceAnchors: ['md:h1', 'md:table'],
    citationSourceIds: ['md:h1', 'md:table'],
    latencyMs: 480,
  }),
  output('mineru', 'markdown-code-csv', {
    text: '',
    failureCode: 'unsupported-markdown',
    fallbackOutput: 'Use the current text importer or MarkItDown for Markdown and CSV-style tables.',
  }),
]

export function runDocumentIngestionBenchmark(options: DocumentIngestionBenchmarkOptions = {}): DocumentIngestionBenchmarkRun {
  const now = options.now ?? (() => Date.now())
  const cases = options.cases ?? DOCUMENT_INGESTION_BENCHMARK_CASES
  const outputs = options.outputs ?? DOCUMENT_INGESTION_PARSER_FIXTURES
  const scores = outputs
    .filter((item) => cases.some((testCase) => testCase.id === item.caseId))
    .map((item) => scoreParserOutput(requireCase(cases, item.caseId), item))
  const caseSummaries = summarizeCases(cases, scores)
  const parserSummaries = summarizeParsers(scores)
  const qualityGate = evaluateQualityGate(caseSummaries, scores, {
    minBestExtractionQuality: options.minBestExtractionQuality ?? 0.78,
    minBestCitationContinuity: options.minBestCitationContinuity ?? 0.78,
  })
  return {
    schema: DOCUMENT_INGESTION_BENCHMARK_SCHEMA,
    id: `document-ingestion-benchmark-${now()}`,
    ranAt: now(),
    parsers: [...DOCUMENT_INGESTION_PARSERS],
    cases,
    scores,
    caseSummaries,
    parserSummaries,
    qualityGate,
  }
}

export function scoreParserOutput(testCase: DocumentIngestionBenchmarkCase, parserOutput: DocumentIngestionParserOutput): DocumentIngestionCaseScore {
  const text = searchableText(parserOutput)
  const termRecall = coverage(testCase.expectedTerms, text)
  const tablePreservation = testCase.expectedTableCells.length ? coverage(testCase.expectedTableCells, tableText(parserOutput)) : 1
  const formulaPreservation = testCase.expectedFormulaTokens.length ? coverage(testCase.expectedFormulaTokens, formulaText(parserOutput)) : 1
  const codeBlockPreservation = testCase.expectedCodeTokens.length ? coverage(testCase.expectedCodeTokens, codeText(parserOutput)) : 1
  const mixedLanguageCoverage = testCase.expectedLanguages.length
    ? coverage(testCase.expectedLanguages, (parserOutput.languages ?? []).join(' '))
    : 1
  const sourceMappingCoverage = testCase.expectedSourceAnchors.length
    ? coverage(testCase.expectedSourceAnchors, (parserOutput.sourceAnchors ?? []).join(' '))
    : 1
  const citationContinuity = testCase.expectedCitationSourceIds.length
    ? coverage(testCase.expectedCitationSourceIds, (parserOutput.citationSourceIds ?? []).join(' '))
    : 1
  const extractionQuality = weightedAverage([
    [termRecall, 0.28],
    [tablePreservation, testCase.requiredFeatures.includes('tables') ? 0.18 : 0.08],
    [formulaPreservation, testCase.requiredFeatures.includes('formulas') ? 0.16 : 0.04],
    [codeBlockPreservation, testCase.requiredFeatures.includes('code-blocks') ? 0.14 : 0.04],
    [mixedLanguageCoverage, testCase.requiredFeatures.includes('mixed-language') ? 0.12 : 0.04],
    [sourceMappingCoverage, testCase.requiredFeatures.includes('source-map') ? 0.12 : 0.08],
    [citationContinuity, 0.1],
  ])
  const failureHandled = parserOutput.failureCode ? Boolean(parserOutput.fallbackOutput?.trim()) : true
  return {
    parserId: parserOutput.parserId,
    caseId: testCase.id,
    extractionQuality,
    termRecall,
    tablePreservation,
    formulaPreservation,
    codeBlockPreservation,
    mixedLanguageCoverage,
    sourceMappingCoverage,
    citationContinuity,
    failureHandled,
    readyForImport: !parserOutput.failureCode && extractionQuality >= 0.72 && citationContinuity >= 0.72,
    failureCode: parserOutput.failureCode,
    fallbackOutput: parserOutput.fallbackOutput,
  }
}

function output(
  parserId: DocumentIngestionParserId,
  caseId: string,
  value: Omit<DocumentIngestionParserOutput, 'parserId' | 'caseId'>
): DocumentIngestionParserOutput {
  return { parserId, caseId, ...value }
}

function requireCase(cases: DocumentIngestionBenchmarkCase[], caseId: string): DocumentIngestionBenchmarkCase {
  const item = cases.find((candidate) => candidate.id === caseId)
  if (!item) throw new Error(`Unknown document ingestion benchmark case: ${caseId}`)
  return item
}

function summarizeCases(cases: DocumentIngestionBenchmarkCase[], scores: DocumentIngestionCaseScore[]): DocumentIngestionCaseSummary[] {
  return cases.map((item) => {
    const caseScores = scores.filter((score) => score.caseId === item.id)
    const best = [...caseScores].sort((left, right) => (
      right.extractionQuality - left.extractionQuality ||
      right.citationContinuity - left.citationContinuity
    ))[0]
    return {
      caseId: item.id,
      sourceKind: item.sourceKind,
      bestParserId: best?.parserId ?? 'current-text',
      bestExtractionQuality: best?.extractionQuality ?? 0,
      bestCitationContinuity: best?.citationContinuity ?? 0,
      parserCount: caseScores.length,
      failureCodes: unique(caseScores.map((score) => score.failureCode).filter(isString)),
    }
  })
}

function summarizeParsers(scores: DocumentIngestionCaseScore[]): Record<DocumentIngestionParserId, DocumentIngestionParserSummary> {
  return Object.fromEntries(DOCUMENT_INGESTION_PARSERS.map((parserId) => {
    const parserScores = scores.filter((score) => score.parserId === parserId)
    return [parserId, {
      parserId,
      caseCount: parserScores.length,
      readyCaseCount: parserScores.filter((score) => score.readyForImport).length,
      averageExtractionQuality: average(parserScores.map((score) => score.extractionQuality)),
      averageCitationContinuity: average(parserScores.map((score) => score.citationContinuity)),
      failureCodes: unique(parserScores.map((score) => score.failureCode).filter(isString)),
    }]
  })) as Record<DocumentIngestionParserId, DocumentIngestionParserSummary>
}

function evaluateQualityGate(
  caseSummaries: DocumentIngestionCaseSummary[],
  scores: DocumentIngestionCaseScore[],
  thresholds: { minBestExtractionQuality: number; minBestCitationContinuity: number }
): DocumentIngestionQualityGate {
  const failures: string[] = []
  for (const item of caseSummaries) {
    if (item.bestExtractionQuality < thresholds.minBestExtractionQuality) failures.push(`${item.caseId}:extraction-quality`)
    if (item.bestCitationContinuity < thresholds.minBestCitationContinuity) failures.push(`${item.caseId}:citation-continuity`)
  }
  for (const score of scores) {
    if (score.failureCode && !score.fallbackOutput?.trim()) failures.push(`${score.caseId}:${score.parserId}:missing-fallback-output`)
  }
  return {
    passed: failures.length === 0,
    minBestExtractionQuality: thresholds.minBestExtractionQuality,
    minBestCitationContinuity: thresholds.minBestCitationContinuity,
    failures,
  }
}

function searchableText(output: DocumentIngestionParserOutput): string {
  return [
    output.text,
    tableText(output),
    formulaText(output),
    codeText(output),
  ].filter(Boolean).join('\n')
}

function tableText(output: DocumentIngestionParserOutput): string {
  return (output.tables ?? []).map((row) => row.join(' ')).join('\n')
}

function formulaText(output: DocumentIngestionParserOutput): string {
  return (output.formulas ?? []).join('\n')
}

function codeText(output: DocumentIngestionParserOutput): string {
  return (output.codeBlocks ?? []).map((block) => `${block.language ?? ''}\n${block.text}`).join('\n')
}

function coverage(expected: string[], actual: string): number {
  if (!expected.length) return 1
  const normalized = normalize(actual)
  const hits = expected.filter((item) => normalized.includes(normalize(item))).length
  return round3(hits / expected.length)
}

function weightedAverage(values: Array<[number, number]>): number {
  const totalWeight = values.reduce((sum, [, weight]) => sum + weight, 0)
  if (!totalWeight) return 0
  return round3(values.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight)
}

function average(values: number[]): number {
  if (!values.length) return 0
  return round3(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function round3(value: number): number {
  return Number(value.toFixed(3))
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
