const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  DOCUMENT_INGESTION_BENCHMARK_CASES,
  DOCUMENT_INGESTION_BENCHMARK_SCHEMA,
  DOCUMENT_INGESTION_PARSERS,
  runDocumentIngestionBenchmark,
} = require('../src/services/documentIngestionBenchmark.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isDocumentIngestionBenchmarkHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
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
  hook.isDocumentIngestionBenchmarkHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function score(run, caseId, parserId) {
  const item = run.scores.find((candidate) => candidate.caseId === caseId && candidate.parserId === parserId)
  assert.ok(item, `score exists for ${caseId}/${parserId}`)
  return item
}

function run() {
  assert.equal(DOCUMENT_INGESTION_BENCHMARK_SCHEMA, 'islemind.document-ingestion-benchmark.v1', 'document ingestion benchmark schema is versioned')
  assert.deepEqual(
    DOCUMENT_INGESTION_PARSERS,
    ['current-text', 'current-provider-pdf', 'markitdown', 'docling', 'unstructured', 'mineru'],
    'document ingestion benchmark tracks current and frontier parser candidates'
  )
  for (const sourceKind of ['pdf', 'office', 'markdown']) {
    assert.ok(DOCUMENT_INGESTION_BENCHMARK_CASES.some((item) => item.sourceKind === sourceKind), `benchmark corpus covers ${sourceKind}`)
  }

  const benchmark = runDocumentIngestionBenchmark({ now: () => 2000000000000 })
  assert.equal(benchmark.schema, DOCUMENT_INGESTION_BENCHMARK_SCHEMA, 'benchmark run carries schema')
  assert.equal(benchmark.qualityGate.passed, true, `document ingestion quality gate should pass: ${benchmark.qualityGate.failures.join(', ')}`)
  assert.equal(benchmark.caseSummaries.length, DOCUMENT_INGESTION_BENCHMARK_CASES.length, 'benchmark summarizes every corpus case')

  const pdfSummary = benchmark.caseSummaries.find((item) => item.caseId === 'pdf-layout-table-formula')
  assert.ok(pdfSummary, 'PDF case summary exists')
  assert.ok(['docling', 'mineru'].includes(pdfSummary.bestParserId), 'layout-heavy PDF is best served by layout-aware parsers')
  assert.ok(score(benchmark, 'pdf-layout-table-formula', 'docling').formulaPreservation >= 1, 'Docling fixture preserves formulas')
  assert.ok(score(benchmark, 'pdf-layout-table-formula', 'mineru').sourceMappingCoverage >= 1, 'MinerU fixture preserves PDF source mapping')

  const officeSummary = benchmark.caseSummaries.find((item) => item.caseId === 'office-mixed-language-table')
  assert.ok(officeSummary, 'Office case summary exists')
  assert.ok(['markitdown', 'docling', 'unstructured'].includes(officeSummary.bestParserId), 'Office imports prefer text/layout parser candidates')
  assert.equal(score(benchmark, 'office-mixed-language-table', 'mineru').failureCode, 'unsupported-office-document', 'MinerU fixture reports unsupported Office documents')
  assert.ok(score(benchmark, 'office-mixed-language-table', 'mineru').fallbackOutput, 'unsupported parser cases include fallback output')
  assert.ok(score(benchmark, 'office-mixed-language-table', 'markitdown').mixedLanguageCoverage >= 1, 'MarkItDown fixture preserves mixed-language content')

  const markdownSummary = benchmark.caseSummaries.find((item) => item.caseId === 'markdown-code-csv')
  assert.ok(markdownSummary, 'Markdown case summary exists')
  assert.ok(['current-text', 'markitdown'].includes(markdownSummary.bestParserId), 'Markdown and CSV-like text can remain on the lightweight local path')
  assert.ok(score(benchmark, 'markdown-code-csv', 'current-text').codeBlockPreservation >= 1, 'current text path preserves code blocks')
  assert.ok(score(benchmark, 'markdown-code-csv', 'current-text').citationContinuity >= 1, 'current text path preserves citation anchors')

  for (const summary of benchmark.caseSummaries) {
    assert.ok(summary.bestExtractionQuality >= benchmark.qualityGate.minBestExtractionQuality, `${summary.caseId} meets extraction quality threshold`)
    assert.ok(summary.bestCitationContinuity >= benchmark.qualityGate.minBestCitationContinuity, `${summary.caseId} meets citation continuity threshold`)
  }
  for (const item of benchmark.scores.filter((candidate) => candidate.failureCode)) {
    assert.ok(item.fallbackOutput, `${item.caseId}/${item.parserId} reports fallback output with failure code`)
  }

  console.log('Document ingestion benchmark tests passed')
}

if (require.main === module) run()

module.exports = { run }
