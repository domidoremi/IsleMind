# Document Ingestion Benchmark

## Scope

- Schema: `islemind.document-ingestion-benchmark.v1`.
- Runtime entry: `runDocumentIngestionBenchmark()` in `src/services/documentIngestionBenchmark.ts`.
- Test entry: `bun run test:document-ingestion-benchmark`.
- Goal: evaluate parser candidates before adding heavy runtime dependencies or optional parser services.

## Current Corpus

The first corpus is deterministic and offline. It compares current IsleMind import paths with MarkItDown, Docling, Unstructured, and MinerU candidate outputs.

| Case | Source kind | Required evidence |
| --- | --- | --- |
| `pdf-layout-table-formula` | PDF | Extraction quality, table preservation, formula preservation, page/source mapping, citation continuity. |
| `office-mixed-language-table` | Office | Mixed-language extraction, table preservation, failure fallback for unsupported parsers, citation continuity. |
| `markdown-code-csv` | Markdown | Lightweight local text path, code-block preservation, CSV-style table preservation, citation anchors. |

## Metrics

Each parser output is scored for:

- term recall,
- table preservation,
- formula preservation,
- code-block preservation,
- mixed-language coverage,
- source mapping coverage,
- RAG citation continuity,
- failure code and fallback output when unsupported.

The gate passes only when every corpus case has a candidate above the extraction and citation-continuity thresholds, and every unsupported parser output includes fallback copy.

## Parser Policy

- Keep current text import for Markdown, plain text, JSON, CSV, XML, and code-like files unless a candidate shows measurable improvement.
- Treat MarkItDown, Docling, Unstructured, and MinerU as optional parser candidates until package size, Android compatibility, security, and fallback behavior are proven.
- Prefer service or desktop-side parser boundaries for heavy document parsing before bundling native dependencies into the mobile runtime.
- Preserve source/page anchors so RAG citations still point to stable provenance after conversion.

## Validation

Run:

```bash
node --check src/services/documentIngestionBenchmark.ts
node --check scripts/document-ingestion-benchmark-tests.js
bun run test:document-ingestion-benchmark
```
