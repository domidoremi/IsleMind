# Observability Compatibility Gates

## Scope

Observability, eval telemetry, and red-team traces are production-critical for modern agents, but IsleMind should prove its local trace contract before adopting Langfuse, Phoenix, OpenTelemetry, promptfoo, DeepEval, or similar tooling. This gate evaluates trace shape, provenance, eval outcomes, metrics, high-frequency event policy, repair replay, and privacy redaction without adding runtime dependencies.

Local gate:

- Schema: `islemind.observability-compatibility-eval.v1`
- Service: `src/services/observabilityCompatibilityEvaluation.ts`
- Script: `scripts/observability-compatibility-tests.js`
- Package entry: `bun run test:observability-compatibility`
- Runtime bridge: `buildObservabilityFixtureFromRuntimeEvents()` converts `islemind.runtime-event.v1` envelopes into trace spans before any external sink is adopted.
- Sink export schema: `islemind.observability-sink-export.v1`
- Sink export bridge: `buildObservabilitySinkExportBatch()` converts internal spans into bounded, redacted OpenTelemetry, Langfuse, or Phoenix export batches.
- Sink preview schema: `islemind.observability-sink-preview.v1`
- Sink preview gate: `buildObservabilitySinkExportPreview()` runs the policy gate and builds a bounded dry-run export batch for local diagnostics or fully consented external sinks, without network calls.
- Sink adapter payload schema: `islemind.observability-sink-adapter-payload.v1`
- Sink adapter payload bridge: `buildObservabilitySinkAdapterPayload()` converts a dry-run batch into an OTLP-shaped payload for OpenTelemetry, Langfuse OTEL ingest, or Phoenix/OpenInference, while keeping transport marked dry-run and non-networked.
- Sink policy schema: `islemind.observability-sink-policy.v1`
- Sink policy gate: `evaluateObservabilitySinkPolicy()` blocks network export unless the sink is explicitly enabled, consented, authenticated where required, redacted, and budgeted.
- Settings surface: `Settings.observabilitySink*` keeps export mode, target, endpoint, consent gates, attribute budgets, high-frequency policy, and API-key configured state persisted, with defaults set to `off`.
- Secure key storage: the sink API key is stored under secure storage, cleared by full resets/import restores, and never read by runtime diagnostics.
- Runtime diagnostics: `buildRuntimeDiagnosticsSummary()` evaluates the sink policy from settings, builds a bounded sink preview from runtime events, and the settings screen shows the effective network/local decision, endpoint class, preview status, span counts, block reasons, and warnings.

Reference stacks:

- Langfuse
- Phoenix
- OpenTelemetry
- promptfoo
- DeepEval

These are compatibility targets and development/eval references, not required mobile runtime dependencies.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `provider-fallback-trace` | Provider routing and fallback | Records route, upstream error, fallback decision, source event ids, durations, metrics, failure code, and redacted prompt fields. |
| `mcp-tool-call-trace` | MCP tool gateway result | Records tool source, server id, tool name, permission class, argument shape, output metric, and redacted arguments. |
| `rag-citation-eval-trace` | RAG retrieval and citation eval | Records retrieval metrics, source ids, citation coverage, eval schema, and passed eval outcome without raw context leakage. |
| `agent-security-redteam-trace` | Agent security/red-team result | Records blocked eval outcome, blocked tool-call metric, failure code, and redacted prompt/tool arguments. |
| `context-compression-trace` | Context planning and compression | Records fragment counts, pressure ratio, saved-token estimate, compact reason, and no raw context leakage. |
| `token-usage-coalescing` | High-frequency token usage | Records coalesced token metrics while skipping persistence and subscriber notification for high-frequency updates. |
| `runtime-repair-replay-trace` | Runtime repair provenance | Records replay submission, applied repair, source event count, and repair target/scope. |
| `privacy-redaction-boundary` | Telemetry privacy boundary | Records redaction markers and redacted-field metrics while rejecting raw prompt, context, tool-argument, and secret leakage. |

## Diagnostic Contract

Each diagnostic records:

- reference stacks,
- span count,
- required and present span kinds,
- source event id count,
- metric keys,
- privacy leak status,
- high-frequency persistence/subscriber policy,
- eval outcome counts,
- failure codes.

Runtime-event bridge spans additionally preserve:

- source runtime event id,
- runtime event schema,
- provider, model, conversation, turn, and message ids,
- mapped span kind and status,
- duration and numeric runtime metrics,
- runtime high-frequency persistence/subscriber policy,
- redacted runtime event data.

Sink export batches additionally enforce:

- explicit sink target: `opentelemetry`, `langfuse`, or `phoenix`,
- trace id and deterministic span ids,
- status mapping for `OK`, `ERROR`, and `UNSET`,
- source runtime event ids on every exported span,
- numeric metrics only,
- bounded attribute counts and bounded string values,
- redacted or summarized prompt, context, content, body, data, credential, token, and tool-argument fields,
- target hints such as OpenTelemetry scope, Langfuse observation type, or Phoenix/OpenInference span kind.

Sink export previews additionally enforce:

- no network calls before an adapter is explicitly added,
- bounded runtime event input before span conversion,
- no batch construction when external export is blocked by consent, auth, endpoint, schema, redaction, or high-frequency policy,
- local-only previews can build local diagnostic batches while keeping `exportable` false,
- failure codes, trace id, span count, attribute budget application, and high-frequency suppression are visible in runtime diagnostics.

Sink adapter payloads additionally enforce:

- `resourceSpans`, `scopeSpans`, and span payloads are built before any sender exists,
- trace and span ids are deterministic OTLP-sized hex ids derived from the internal batch,
- source event ids, redaction markers, high-frequency policy, target hints, and numeric metrics survive serialization,
- transport remains `dry-run` with `networkCallsAllowed: false`,
- payload diagnostics report serialized size, resource/scope counts, privacy leak checks, and adapter failure codes.

Sink policy decisions additionally enforce:

- default mode is `off`,
- `local-only` allows local diagnostics but blocks network export,
- remote network export requires `external` mode, supported target, safe endpoint, explicit user opt-in, workspace consent, and the sink export schema,
- settings endpoints are sanitized through the shared URL policy before they reach diagnostics,
- HTTPS remote endpoints require authentication configured through secure storage,
- localhost HTTP is allowed only when marked development-only,
- raw payload export is blocked,
- per-event high-frequency export is blocked; use `drop` or `coalesced`,
- attribute limits above the policy maximum are blocked.

## Adoption Rule

Before adding external trace sinks, eval dashboards, OpenTelemetry export, promptfoo/DeepEval suites, or in-app observability surfaces, this gate must pass and the external adapter must use or match `buildObservabilityFixtureFromRuntimeEvents()`, `buildObservabilitySinkExportPreview()`, `buildObservabilitySinkExportBatch()`, `buildObservabilitySinkAdapterPayload()`, and `evaluateObservabilitySinkPolicy()`. Any trace path that cannot preserve source event provenance, failure codes, eval outcomes, metrics, high-frequency suppression, explicit opt-in, attribute budgets, dry-run preview visibility, adapter payload diagnostics, and redaction markers should stay blocked or local-only.
