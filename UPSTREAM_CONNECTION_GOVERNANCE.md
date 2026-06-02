# Upstream Connection Governance

## Scope

This plan adds a governed upstream request layer for IsleMind chat providers. The layer must deliver WebSocket transport, remote compact usage accounting, runtime JSONL log files, proxy policy, payload rules, and provider/model allowlist-blocklist enforcement without regressing the current HTTP/SSE chat path.

The default runtime remains HTTP/SSE. New capabilities must be additive, disabled or automatic by default, and reversible through settings.

## Current State

- `src/services/ai/base.ts` owns endpoint selection, body construction, HTTP/SSE request execution, stream parsing, usage extraction, and fallback behavior.
- `src/services/contextPacker.ts` performs local chat context packing, history summarization, message trimming, and single-message truncation.
- `src/services/rag.ts` performs local RAG source compression and context packing.
- `src/services/mcp.ts` stores `websocket` as a transport type but blocks it at runtime with `WebSocket transport is reserved but not enabled in this build.`
- Provider usage is stored per message through `MessageUsage`; compact-specific usage is not recorded.
- Runtime log files do not exist. Existing QA scripts scan evidence files for sensitive tokens.
- Proxy behavior is limited to provider `baseUrl` configuration and user-facing network error copy.
- Provider/model allowlist-blocklist rules do not exist.

## Architecture

Add these bounded modules:

```text
src/services/ai/transport/
  types.ts
  httpSseTransport.ts
  responsesWebSocketTransport.ts
  transportSelector.ts
  sessionLeasePool.ts

src/services/ai/compact/
  remoteCompact.ts
  compactUsage.ts
  compactStateStore.ts

src/services/ai/policy/
  payloadRules.ts
  providerModelAccess.ts
  proxyPolicy.ts

src/services/runtimeLog.ts
```

`streamChat` must become an orchestration boundary:

```text
hydrate credential
resolve provider/model access
build request payload
apply payload rules
resolve proxy policy
select transport
execute request
record trace, usage, log
fallback when allowed
```

Transport adapters must emit normalized events:

```ts
export type UpstreamStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'citation'; citations: MessageCitation[] }
  | { type: 'trace'; trace: ProcessTrace }
  | { type: 'usage'; usage: MessageUsage }
  | { type: 'done'; text: string; responseId?: string; compactStateId?: string }
  | { type: 'error'; code: ProviderOperationCode | ChatErrorCode | 'transport_error'; message: string; retryable: boolean }
```

## Settings Model

Extend `Settings` with optional fields:

```ts
transportMode?: 'auto' | 'http' | 'websocket'
remoteCompactMode?: 'off' | 'auto' | 'required'
remoteCompactThreshold?: number
payloadPolicyMode?: 'off' | 'warn' | 'block'
proxyMode?: 'off' | 'custom-base-url' | 'system-detected'
proxyBaseUrl?: string
providerAllowlist?: string[]
providerBlocklist?: string[]
modelAllowlist?: string[]
modelBlocklist?: string[]
runtimeLogEnabled?: boolean
runtimeLogMaxBytes?: number
sessionConcurrencyLimit?: number
sessionQueueTimeoutMs?: number
```

Default values:

```text
transportMode=auto
remoteCompactMode=off
remoteCompactThreshold=0.8
payloadPolicyMode=warn
proxyMode=off
runtimeLogEnabled=false
runtimeLogMaxBytes=1048576
sessionConcurrencyLimit=1
sessionQueueTimeoutMs=1500
```

Extend `ProviderCapabilities`:

```ts
responsesApi?: boolean
responsesWebSocket?: boolean
remoteCompact?: boolean
payloadPolicy?: boolean
```

Provider capability checks must not depend only on UI switches. Runtime request execution must enforce capability and policy decisions.

## WebSocket Transport

### Execution Policy

- `transportMode=http` must always use the existing HTTP/SSE adapter.
- `transportMode=websocket` must require `ProviderCapabilities.responsesApi=true` and `responsesWebSocket=true`.
- `transportMode=auto` must prefer HTTP/SSE unless provider capability, request shape, and runtime settings all allow WebSocket.
- WebSocket transport must target Responses-compatible providers only.
- Non-Responses providers must remain on HTTP/SSE.

### Session Lease

WebSocket session requests must acquire a lease:

```text
leaseKey = providerId + conversationId + sessionId
limit = settings.sessionConcurrencyLimit ?? 1
timeoutMs = settings.sessionQueueTimeoutMs ?? 1500
```

Lease release is mandatory on:

- normal completion
- provider error
- transport error
- user abort
- timeout
- fallback transition

### Failure Behavior

- WebSocket handshake failure falls back to HTTP/SSE when `transportMode=auto`.
- WebSocket handshake failure blocks the request when `transportMode=websocket`.
- Mid-stream WebSocket failure records a retryable transport error. Automatic retry is allowed once only when no assistant tokens have been emitted.
- Lease timeout returns a recoverable `session_queue_timeout` error and writes a log event.

## Remote Compact

### Execution Policy

- `remoteCompactMode=off` must use local `contextPacker`.
- `remoteCompactMode=auto` may call remote compact when provider capability allows it and estimated context pressure is at or above `remoteCompactThreshold`.
- `remoteCompactMode=required` must block when provider capability does not allow remote compact.
- Remote compact output must be stored as opaque state. It must not be rendered as user-visible summary text.
- Provider changes, model changes, credential changes, or incompatible endpoint changes must invalidate stored compact state.

### State Contract

Add a compact state store backed by SQLite:

```text
id
conversationId
providerId
model
responseId
sessionId
compactItemJson
sourceMessageStartIndex
sourceMessageEndIndex
inputTokens
outputTokens
estimatedSavedTokens
status
failureCode
createdAt
updatedAt
expiresAt
```

### Usage Accounting

Remote compact usage must be recorded separately from assistant message generation:

```text
compact.request.count
compact.inputTokens
compact.outputTokens
compact.estimatedSavedTokens
compact.failure.count
compact.fallback.local.count
```

Message trace metadata must include:

```text
compactMode=off|local|remote|remote_fallback_local|remote_required_failed
compactInputTokens
compactOutputTokens
compactEstimatedSavedTokens
compactFailureCode
```

### Failure Behavior

- Explicit upstream unsupported errors fall back to local compact when `remoteCompactMode=auto`.
- Explicit upstream unsupported errors block when `remoteCompactMode=required`.
- Authentication and rate-limit errors must not retry remote compact repeatedly in the same request.
- Corrupt or incompatible compact state must be discarded and logged; `auto` mode falls back to local compact.

## Runtime Log File

### Log Format

Runtime logs must use JSONL:

```json
{"schema":"islemind.runtime-log.v1","ts":"2026-05-29T00:00:00.000Z","event":"upstream.request","conversationId":"...","providerId":"...","model":"...","transport":"http_sse","policy":"warn"}
```

Required event families:

- `upstream.request`
- `upstream.response`
- `upstream.error`
- `transport.fallback`
- `session.lease`
- `compact.request`
- `compact.usage`
- `payload.rule`
- `access.policy`
- `proxy.policy`

### Redaction Policy

Logs must not contain:

- full API keys
- bearer tokens
- authorization headers
- complete payload body
- complete user prompt
- complete assistant response
- file attachment base64

Allowed payload evidence:

- provider id
- model id
- endpoint host
- request body keys
- message count
- attachment count
- estimated token counts
- hash of redacted payload
- first 80 characters of non-sensitive error messages

### Storage Policy

- Default log file path must be app document storage.
- Log rotation must respect `runtimeLogMaxBytes`.
- Export must be explicit.
- Clear logs must remove all runtime log files.
- QA audit must scan exported logs and test evidence logs for full-length secrets.

## Proxy Policy

### Capability Boundary

Expo/React Native must not claim full OS proxy enforcement unless runtime verification proves it. Proxy policy must expose observable behavior:

```text
proxyMode=off
proxyMode=custom-base-url
proxyMode=system-detected
```

`custom-base-url` rewrites eligible provider base URLs to a user-configured gateway or proxy endpoint. `system-detected` records detected proxy state when available, but does not claim that all upstream requests are routed through it.

### Failure Behavior

- Invalid proxy URL blocks requests only when selected provider requires proxy.
- Proxy health check failure records `proxy.policy` and falls back to direct only when fallback is enabled.
- Provider credential material must never be written to proxy diagnostics.

## Payload Rules

### Rule Contract

Payload rules execute after provider body construction and before transport selection:

```text
ChatRequest
provider body
PayloadRuleEngine
ProviderModelAccess
TransportAdapter
```

Rule result:

```ts
export interface PayloadRuleResult {
  status: 'passed' | 'warned' | 'blocked'
  ruleId: string
  message: string
  sanitizedPayload?: unknown
  metadata?: Record<string, unknown>
}
```

### Initial Rules

- `max-input-tokens`: warns or blocks when estimated input exceeds configured limit.
- `forbid-attachments`: blocks image, PDF, audio, or document payloads for providers that do not support them.
- `force-stream`: enforces stream mode where required.
- `parameter-range`: clamps or blocks invalid temperature, top-p, max-token, and reasoning-effort values.
- `forbid-unsupported-tools`: blocks tool fields for providers without tool capability.
- `redact-debug-fields`: strips debug-only fields before transport execution.
- `endpoint-host-policy`: blocks endpoints outside allowed host patterns when configured.

### Failure Behavior

- `payloadPolicyMode=off` records no blocking result.
- `payloadPolicyMode=warn` records traces and logs but sends the request when transport accepts it.
- `payloadPolicyMode=block` blocks any rule with blocking severity.

## Provider And Model Access Policy

### Enforcement Points

Allowlist-blocklist rules must run at:

- Provider picker display
- Model picker display
- Provider model sync
- Conversation creation
- Conversation model switch
- Request send
- Import provider batch validation

### Matching Rules

- Provider ids match exact ids.
- Provider preset ids match `preset:<id>`.
- Provider hosts match `host:<domain>`.
- Model ids match exact ids.
- Model families match `family:<prefix>`.
- Regular expression rules must be disabled unless explicitly enabled in developer settings.

Blocklist wins over allowlist.

### Failure Behavior

- Blocked provider returns `provider_blocked`.
- Blocked model returns `model_blocked`.
- A conversation with a now-blocked provider/model must show a recoverable configuration banner and must not send until changed.

## Migration Mapping

1. Add type fields as optional and preserve persisted settings compatibility.
2. Add runtime log service with no call sites and tests for redaction.
3. Add policy modules and unit tests.
4. Wrap existing HTTP/SSE logic in `HttpSseTransport` without behavior changes.
5. Move `streamChat` orchestration to `transportSelector`.
6. Add compact state store and remote compact module behind `remoteCompactMode=off`.
7. Enable compact `auto` mode for capable Responses providers.
8. Add WebSocket transport behind `transportMode=websocket` and then `auto`.
9. Add settings UI after service behavior and tests exist.
10. Add QA audit coverage for runtime logs and policy evidence.

## Landing Status

Implemented service-layer defaults and contracts:

- `Settings` now includes additive optional fields for transport, remote compact, payload policy, proxy policy, runtime logs, session concurrency, and provider/model access lists.
- `ProviderCapabilities` now includes additive optional flags for Responses API, Responses WebSocket, remote compact, and payload policy.
- Runtime log output exists as redacted JSONL with bounded file size and event families for upstream, transport, compact, payload, access, and proxy policy events.
- Provider/model allowlist-blocklist enforcement runs before upstream requests. Blocklist wins.
- Provider/model allowlist-blocklist matching accepts provider ids, `preset:<id>` rules, `host:<domain>` rules, and `family:<prefix>` model rules.
- Payload rules run after provider body construction and before transport execution. `warn` is default, `block` stops invalid payloads.
- Proxy policy supports `off`, `custom-base-url`, and `system-detected` with non-enforcement semantics for system proxy detection.
- Remote compact `required` blocks unsupported providers. `auto` records compact usage and enables Responses `context_management` when capability and threshold allow it.
- Responses WebSocket transport exists behind capability, runtime, and setting gates. It falls back to HTTP/SSE on pre-token handshake failure when `transportMode=auto`.
- Session lease pooling guards gated WebSocket execution and releases leases on completion, error, abort, and fallback.
- Settings UI exposes transport, remote compact, payload policy, proxy policy, runtime log, session concurrency, and provider/model allowlist-blocklist fields.
- Completed remote compact responses record provider usage, estimated saved tokens, response IDs, runtime log evidence, and compact state rows when a response ID exists.
- Provider-intelligence tests cover Responses WebSocket success, pre-token failure, mid-stream failure, abort, session lease release, runtime log file redaction, log rotation, runtime fallback, provider health persistence, and store-level provider/model access enforcement.
- QA audit now requires `provider-runtime-android-results.json` with current emulator evidence for Provider settings, provider import keyboard, chat model switch, blocked-model recovery, runtime fallback trace, provider health state, Android Back, restart recovery, APK identity, device id, and sensitive-data status.
- Provider import keyboard evidence must include `keyboardState.imeVisible=true`, `keyboardState.editableFocused=true`, a normalized repository-relative keyboard-state JSON evidence file, at least one positive IME visibility signal, and at least one positive editable-focus signal.
- Provider Runtime Android run logs must be written after sensitive-evidence scanning so `fullCredentialLeak` records the final scan state.
- Provider Runtime Android errors and scenario state text must redact credential-shaped values before writing result JSON or run logs.
- Provider Runtime Android sensitive-evidence scanning must include captured evidence files, the final result JSON body, and the run log lines scheduled for append.
- Provider Runtime Android text evidence files, including UIA XML and logcat-derived logs, must redact credential-shaped values before persisted local evidence is treated as reusable.
- Provider Runtime Android sensitive-evidence patterns must stay aligned with the QA audit gate for OpenAI-style keys, MiMo Token Plan keys, GitHub tokens, Google API keys, Google OAuth access tokens, bearer tokens, and high-entropy credential assignments.
- `scripts/sensitive-evidence-contract.js` owns credential scan patterns, redaction behavior, and scanned text-evidence extensions. QA audit and Provider Runtime Android collection must consume the shared contract instead of declaring private extension sets or private credential redaction patterns.
- Provider Runtime Android result evidence must record `sensitiveData.scannedFiles` as a positive integer, `sensitiveData.scannedPaths` with unique normalized repository-relative paths including the final result JSON and run log, and `sensitiveData.hits` as an empty array; `fullCredentialLeak=false` alone is not sufficient.
- Provider Runtime Android result evidence must record expected app config and installed package provenance. The QA gate must compare recorded `packageVersion`, `expoVersion`, `androidPackage`, and `androidVersionCode` with the current repository config, must require `installed.deviceSerial` to match top-level `deviceSerial`, and must pass only when `installed.cleanInstall=true` and a finite `installed.cleanInstallWindowMs` value proves the current APK was clean-installed inside the accepted install-time window.
- `scripts/release-validation-contract.js` owns Android package identity and the clean-install window. Current APK smoke, QA audit, Provider Runtime Android collection, memory-review smoke, work-artifact smoke, and provider-intelligence release fixtures must consume `defaultReleaseAppPackageName` and `cleanInstallState` instead of duplicating package identity or timestamp policy.
- Provider Runtime Android collector pass state and QA audit result gate must use the shared result-level contract for schema, UTC ISO-8601 `generatedAt`, device state, normalized repository-relative `.apk` path, package name, `sensitiveData`, required scenarios, duplicate scenario rejection, `errors`, `passed`, `contractIssues`, and `diagnostics`. `device.serial` must match top-level `deviceSerial`, and `device.abi` plus `device.sdk` must be present. `errors` must be an array of non-empty strings, and `diagnostics.errorCount` must derive from that array. Scenario arrays must contain only required scenario ids and must reject extra records, missing ids, non-object records, and duplicate required scenarios. `diagnostics` must summarize required scenario counts, failed scenario ids, contract issue count, collector error count, sensitive evidence hit count, and scanned file count. The scenario record contract requires `status=passed`, `expectedState`, `actualState`, `fixEntry`, normalized repository-relative top-level `png`/`uia`, optional `log`, per-step `png`/`uia`, and provider-import keyboard state evidence.
- `npm run test:provider-runtime-android` collects the Provider Runtime Android evidence file. `node scripts/collect-provider-runtime-android.js --self-test` validates the collector schema without adb or emulator execution.

Validation evidence recorded on 2026-06-02:

- `node scripts/collect-provider-runtime-android.js --self-test` passed.
- `node scripts/qa-coverage-audit.js --self-test` passed.
- `node scripts/provider-intelligence-tests.js` passed.
- `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` passed.
- `npm run test:provider-intelligence` passed.
- `npm run test:qa-audit:self` passed.
- `npm run type-check -- --incremental false` passed.
- `npm run test:ui-naming` passed.
- `node scripts/architecture-boundary-audit.js` passed with 10 checks, 0 blocking issues, and 0 review findings.

Remaining implementation work:

- Persist upstream-returned compacted window payloads if the provider returns explicit compact items beyond standard Responses response IDs.
- Add device/upstream integration tests for real Responses WebSocket authorization, reconnect, and mid-stream failure behavior.
- Run `npm run test:provider-runtime-android` against the current clean-installed emulator APK and resolve any failed Provider Runtime Android scenario before treating `test-evidence/qa/provider-runtime-android-results.json` as release evidence. Provider import keyboard acceptance requires screenshot, UIA, and parsed `keyboardState` evidence.
- Add picker-level filtering for provider/model allowlist-blocklist if future policy scopes expand beyond provider id, preset, host, and family matching.

## Acceptance Criteria

- Existing HTTP/SSE chat passes current provider intelligence tests.
- Type check passes.
- Transport selector tests prove `http`, `websocket`, and `auto` selection behavior.
- WebSocket tests prove handshake failure, mid-stream failure, abort, fallback, and lease release behavior.
- Remote compact tests prove unsupported fallback, required-mode blocking, state invalidation, and usage accounting.
- Runtime log tests prove JSONL schema, rotation, export, clear, and secret redaction.
- Proxy policy tests prove custom-base-url routing and system-detected non-enforcement semantics.
- Payload rule tests prove warn/block/off behavior.
- Provider/model access tests prove blocklist precedence and all enforcement points.
- QA audit scans generated runtime logs for full-length credentials and blocks missing Provider Runtime Android emulator evidence, including machine-readable keyboard-open state for provider import.

## Risk Control

- `src/services/ai/base.ts` must not receive additional feature branches for each new capability. It must delegate to transport, policy, compact, and log modules.
- `Settings` and `AIProvider` changes must remain additive until migration tests pass.
- WebSocket and remote compact must stay disabled by default until HTTP/SSE parity tests pass.
- Runtime logs must default off until redaction tests and QA scanning are in place.
- Proxy behavior must not claim OS-wide routing without runtime evidence.
