# Provider Operation Result Compatibility Gates

## Scope

Provider operation results are the shared boundary for provider test calls, model discovery, runtime HTTP errors, and credential-group operations. This gate keeps result shapes stable, error classification consistent, request ids visible, and provider error text redacted before IsleMind expands provider families, hosted chains, relay routes, or automatic repair.

## Default Behavior

- Provider operation result compatibility uses the versioned `islemind.provider-operation-result.v1` schema marker.
- `success()` and `failure()` keep the existing public result shape: `ok`, `code`, `message`, optional `data`, and optional `credentialGroupId`.
- HTTP status and provider text map to stable operation codes for auth, timeout, rate limit, max tokens, model unavailable, models endpoint unavailable, bad base URL, network error, and unknown failures.
- Relay-style `model_not_found`, no-channel, and localized model-unavailable text classify as model unavailable.
- Abort errors map to timeout; network fetch errors map to network error.
- JSON, plain-text, and HTML provider error bodies produce bounded user-facing summaries.
- JSON and plain-text summaries preserve request ids when available.
- Provider operation summaries redact API keys, bearer tokens, and API-key assignments.

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| Public result shape | `success()` and `failure()` remain backward compatible for existing callers. |
| HTTP classifier | Common statuses and provider text map to stable `ProviderOperationCode` values. |
| Relay errors | Model-not-found and no-channel relay text maps to `model_unavailable`. |
| Fetch failure | `ProviderHttpError`, `AbortError`, network errors, and unknown errors map to safe result codes. |
| Error detail extraction | JSON, plain text, and HTML response bodies produce bounded summaries with request ids when present. |
| Redaction | API keys, bearer tokens, and API-key assignments are omitted from result messages and formatted errors. |

## Acceptance Criteria

- `node scripts/provider-operation-result-compatibility-tests.js` passes.
- `bun run test:provider-operation-result-compatibility` passes.
- The evaluation covers result shape, HTTP status classification, provider text classification, relay failures, fetch failures, error formatting, request-id extraction, source guardrails, and redaction.
- Provider operation changes do not break public result shape or leak provider secrets in user-visible diagnostics.
