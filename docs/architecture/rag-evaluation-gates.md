# RAG Evaluation Gates

## Scope

RAG evaluation is the boundary between local knowledge retrieval and any future retrieval-stack replacement. This gate keeps baseline FTS-style retrieval, hybrid retrieval, agentic retrieval, citation quality, fallback diagnostics, latency, and offline behavior measurable before IsleMind changes indexing, vector storage, parser dependencies, rerankers, or external retrieval services.

## Default Behavior

- Keep current local hybrid and agentic retrieval as the acceptance baseline.
- Compare baseline, hybrid, and agentic modes on the same deterministic corpus.
- Require source ids, citation coverage, context precision, confidence, warning codes, fallback reasons, latency, and estimated context tokens for every mode.
- Treat empty index, missing embedding model, corrupted local model file, provider embedding fallback, and local embedding fallback as required scenarios.
- Require retrieval changes to improve measurable recall, citation correctness, latency, or fallback clarity without breaking offline behavior.

## Evaluation Schema

The local gate is `islemind.rag-retrieval-eval.v1`.

Each benchmark run records:

- evaluation schema and run id
- registered modes: `baseline`, `hybrid`, and `agentic`
- deterministic case evaluations
- expected source ids and fallback reasons
- per-mode source ids, source count, candidate count, hit count, recall, hit coverage, citation coverage, context precision, confidence, missing-evidence status, warning codes, fallback reasons, latency, and estimated context tokens
- best mode per case
- mode summaries
- fallback scenario coverage
- aggregate fallback reasons and warning codes
- quality-gate thresholds and failures

## Required Fixtures

| Fixture/scenario | Required behavior |
| --- | --- |
| Gold local citation cases | Baseline, hybrid, and agentic retrieval preserve expected local evidence and citations. |
| `empty-index` | Empty knowledge indexes produce missing-evidence status and explicit warning codes. |
| `missing-model` | Missing embedding models fall back to deterministic hash retrieval with visible fallback reasons. |
| `corrupted-model-file` | Corrupted local embedding models are rejected and downgraded without blocking citation retrieval. |
| `provider-embedding-fallback` | Provider embedding failures fall back locally while preserving citation surfaces. |
| `local-embedding-fallback` | Offline local embedding unavailability degrades to FTS/hash retrieval with visible fallback reasons. |

## Acceptance Criteria

- `node scripts/rag-retrieval-eval-tests.js` passes.
- `bun run test:rag-retrieval-eval` passes.
- `node scripts/agent-rag-quality-tests.js` still passes because the broader agent workflow gate depends on the same retrieval benchmark.
- The evaluation output includes every required scenario and every registered retrieval mode.
- Average recall and citation coverage meet the configured quality-gate floors before retrieval behavior can widen.
