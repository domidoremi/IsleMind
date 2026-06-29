# Runtime Privacy Retention Compatibility Gates

## Scope

Runtime privacy and retention are the boundary between local diagnostics and durable user data. This gate keeps runtime logs, runtime events, portable export/import, full reset, restore, and observability previews bounded and redacted before IsleMind widens trace sinks, diagnostics, media workflows, provider-native state, or agent repair tooling.

## Default Behavior

- Runtime JSONL logging must default to off and require explicit stored settings.
- Runtime logs must use a finite byte cap, trim old entries, and expose a clear/delete path.
- Runtime log and runtime event envelopes must redact secrets, URL userinfo, sensitive query params, bearer/basic credentials, assignments, prompts, payload bodies, media, and file data.
- Runtime event history must be bounded by history count, list length, object field count, and nesting depth.
- High-frequency token usage events must skip persistent logs and subscriber fan-out.
- Portable exports must sanitize providers, settings URL fields, traces, attachments, and skills before serialization.
- Full reset and restore must clear runtime logs, compact state, provider health, local embedding artifacts, staged APK downloads, search keys, and observability keys where applicable.
- External observability sinks must remain policy-gated by opt-in, workspace consent, schema, redaction, and dry-run preview diagnostics before any network export.

## Evaluation Schema

The local gate is `islemind.runtime-privacy-retention-compatibility-eval.v1`.

Each diagnostic records:

- `fixtureId`
- `surface`
- `readiness`
- runtime log default state, byte cap, and clear behavior
- runtime log/event redaction and payload summary policy
- URL, query, header, and assignment secret redaction
- runtime event history, list, field, and depth limits
- high-frequency persistence/subscriber suppression
- portable export sanitization coverage
- full reset and restore cleanup coverage
- observability opt-in and consent policy
- raw prompt/context/tool/media blocking
- network-call status
- failure codes

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| `runtime-log-default-off` | Runtime JSONL logging defaults to off and remains opt-in. |
| `runtime-log-byte-retention-cap` | Runtime logs use finite byte retention and trim older lines. |
| `runtime-log-clear-delete` | Runtime log clear deletes the JSONL file idempotently. |
| `runtime-event-history-bounded` | Runtime event history is bounded and pruned. |
| `high-frequency-token-events-suppressed` | Token usage updates skip persistence and subscriber notification. |
| `runtime-event-data-shape-limits` | Runtime event data is capped by list length, object fields, and depth. |
| `payload-body-summary-redaction` | Raw prompts, content, responses, payloads, media, and file data persist only redacted summaries. |
| `query-userinfo-header-assignment-redaction` | Runtime diagnostics redact URL userinfo, sensitive queries, bearer/basic headers, API keys, and assignments. |
| `portable-export-sanitized` | Portable export sanitizes providers, settings URLs, traces, attachments, and skills. |
| `full-reset-clears-runtime-artifacts` | Full reset clears runtime logs, compact state, provider health, local embedding artifacts, staged APK downloads, and secure search/observability keys. |
| `restore-clears-prior-runtime-artifacts` | Import restore clears prior runtime artifacts before importing new state. |
| `observability-sink-consent-policy` | External observability export requires opt-in, workspace consent, schema, and redaction policy. |
| `blocked-raw-runtime-diagnostics` | Raw prompt, context, or tool-argument diagnostics fail closed. |
| `blocked-raw-media-file-retention` | Raw media/base64/image URL/file-data retention fails closed. |
| `blocked-unbounded-runtime-log` | Unbounded runtime logs fail closed. |
| `blocked-high-frequency-telemetry-persistence` | Per-event high-frequency telemetry persistence or fan-out fails closed. |
| `blocked-portable-export-secret-leak` | Portable export secret leaks fail closed. |
| `blocked-reset-retaining-runtime-artifacts` | Reset or restore paths that retain runtime artifacts fail closed. |

## Acceptance Criteria

- `node scripts/runtime-privacy-retention-compatibility-tests.js` passes.
- `bun run test:runtime-privacy-retention-compatibility` passes.
- The evaluation output includes every required fixture id and covers runtime-log, runtime-event, export-import, reset-restore, observability-sink, and blocked surfaces.
- All blocked fixtures produce expected failure codes before runtime diagnostics, portable export, reset, restore, or observability sink behavior can widen.
