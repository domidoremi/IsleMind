# Security Scan 2026-06-17

## Executive Summary

This scan covered high-signal client security sinks across the current IsleMind worktree: source preview URLs, WebView usage, external navigation, secret storage, trace redaction, MCP tool output handling, dynamic execution sinks, storage, outbound fetch paths, and import/export temporary-file lifecycle boundaries.

Thirty-eight validated findings were fixed in this pass:

- **S-001, Medium:** `/source` could accept a route/citation URL and pass it to both the embedded WebView and `Linking.openURL()` without an app-level scheme allowlist. The fixed path now centralizes URL validation in `src/utils/sourceUrlSafety.ts`, allows only `http:` and `https:` source URLs, constrains WebView origins, and rejects active/local/custom schemes before preview or external opening.
- **S-002, Medium:** Custom and Bing-compatible search endpoints could be read from settings and used as credentialed fetch destinations without a service-layer HTTP(S) guard. The fixed path centralizes endpoint validation in `src/services/searchPolicy.ts`, rejects malformed and non-web schemes before fetch, and validates the final templated custom-search URL before attaching the custom search bearer token.
- **S-003, Medium:** Custom proxy base URLs could be read from settings and used to rewrite provider request destinations without an HTTP(S) scheme guard. The fixed path now rejects non-web proxy URLs before provider chat requests, Responses WebSocket upgrades, or diagnostics summaries treat the proxy as applied.
- **S-004, Medium:** Custom provider `baseUrl` values could still flow into provider chat/model-sync/probe/embedding/audio request assembly without a generalized service-layer HTTP(S) guard, as long as they were not the Xiaomi-specific mismatch cases already covered by `getProviderConfigIssue()`. The fixed path now rejects explicit non-web provider base URLs before provider preset probes, remote model discovery, provider model tests, provider sync, embedding requests, and provider speech/transcription requests attach credentials or assemble outbound endpoints.
- **S-005, Medium:** Persisted or imported MCP server URLs could bypass the add/edit form's HTTP(S) check and still reach MCP manifest refresh or tool-call fetch paths through stored state. The fixed path now centralizes MCP server URL validation, drops invalid persisted/imported MCP endpoints during normalization, and refuses manifest refresh or tool execution before any fetch runs when a non-web MCP URL appears at runtime.
- **S-006, Medium:** User-configured local-model mirror base URLs could reach fallback download assembly for model files without an HTTP(S) scheme guard. The fixed path now validates mirror URLs through the shared web-URL helper, so invalid `file:` or app-scheme mirror settings are ignored and cannot become fallback download destinations.
- **S-007, Medium:** APK update manifest and GitHub release asset URLs were accepted as non-empty strings and could reach release parsing or installer download logic without a shared HTTP(S) guard. The fixed path now requires explicit HTTP(S) URLs for manifest `releaseUrl`, manifest asset `url`, GitHub `browser_download_url`, and installer `apkUrl` inputs before update parsing or download proceeds.
- **S-008, Medium:** Provider import, skill import, knowledge import, and portable-data import paths could read selected files fully into memory before a shared size boundary. The fixed path centralizes import-file size checks, verifies declared size or filesystem metadata before reading, keeps ordinary imports working, and rejects oversized text/PDF/config imports before `readAsStringAsync()` runs.
- **S-009, Medium:** Android APK installer handoff accepted arbitrary `content://` URIs as APK-like input. The fixed path centralizes APK URI validation in `src/services/androidUriPolicy.ts` and applies the same rule to runtime installer handoff plus agent APK URI inference and workflow sanitization.
- **S-010, Medium:** Attachment and local-audio base64 conversion paths could still read selected files fully into memory when picker metadata omitted `size`, because they did not reuse the shared pre-read size boundary. The fixed path extends the shared guard to attachment base64 reads and local audio transcription before any base64 conversion runs.
- **S-011, Medium:** Knowledge import could still read selected files fully into memory when `DocumentPicker` omitted `size`, because `importKnowledgeFile()` normalized missing metadata to `0` before the shared import-size boundary and the PDF path then base64-read the full file. The fixed path resolves import size through the shared metadata fallback before any knowledge text or PDF read runs.
- **S-012, Medium:** Provider-backed text-to-speech playback wrote generated MP3 files into `cacheDirectory` and never deleted them, so spoken user/assistant content could linger on disk after playback ended or a later clip replaced it. The fixed path now tracks the active provider TTS temp file and deletes it on stop/replacement.
- **S-013, Medium:** Skill export wrote a portable `.isleskill` file into `cacheDirectory` for sharing and left it behind after the share flow completed. The fixed path now deletes the temp export file in a `finally` block after the share attempt finishes.
- **S-014, Medium:** Runtime diagnostics logging could persist provider route endpoints containing credential-bearing query parameters such as Google `?key=` URLs, because generic runtime-log string redaction did not normalize sensitive query assignments before writing JSONL records. The fixed path now redacts sensitive query-string and plain-text credential assignments in runtime-log strings before route-decision or other diagnostic records reach disk.
- **S-015, Medium:** DocumentPicker-based provider import, skill import, and portable backup import used `copyToCacheDirectory: true` but did not clear the cached picker copies after success or rejection, leaving imported configuration text and backups on disk longer than intended. The fixed path now centralizes temporary import cleanup and clears those cache copies in `finally` blocks after each reviewed import flow completes.
- **S-016, Medium:** Knowledge import used `copyToCacheDirectory: true`, persisted the temporary picker URI into knowledge provenance, and left FTS retrieval paths without stable document-source metadata. The fixed path now normalizes provenance to a stable label, clears the temporary picker copy after import, and keeps document/list/export/FTS retrieval provenance consistent without changing successful import behavior.
- **S-017, Medium:** Document attachment import used `copyToCacheDirectory: true`, converted the picked file to base64, and kept the temporary picker copy on disk after both successful reads and oversized-file rejection. The fixed path now reuses the shared pre-read size guard and clears the cached picker copy in a `finally` block after document attachment ingestion completes.
- **S-018, Medium:** Persisted conversations kept attachment metadata after stripping `base64`, so stale local attachment URIs could leak into SQLite/portable exports and could still skew retry-time attachment capability checks, token estimates, and native-search gating even though no sendable payload remained. The fixed path now centralizes attachment persistence/runtime normalization so stored history drops non-web local URIs and runtime attachment decisions only consider payload-bearing attachments.
- **S-019, Medium:** Image attachment intake compressed picked or captured images into temporary files, but did not centrally clear the compressed copy afterward and treated original-image cleanup inconsistently across picker and camera paths. The fixed path now centralizes conservative image attachment temp-copy cleanup, always deletes the compressed temp output after payload extraction, and only deletes the original image URI when it still looks like a temporary picker/cache copy.
- **S-020, Medium:** MCP tool identity matching accepted bare tool names and would return the first matching server when multiple servers exposed the same tool name, so a request without a server qualifier could become nondeterministic at the execution boundary. The fixed path now centralizes MCP tool identity resolution, preserves explicit `serverId:toolName` / `serverId/toolName` matches, and refuses ambiguous bare-name tool selection unless the name resolves to exactly one enabled tool.
- **S-021, Medium:** Agent workflow tool identity validation reused the same ambiguous bare-name behavior, so workflow steps could silently bind to the first matching manifest when more than one agent tool shared a name. The fixed path now routes agent tool lookup and workflow validation through the shared unique-identity helper, preserves explicit tool ids and scoped references, and fails ambiguous bare-name workflow steps closed at validation time.
- **S-022, Medium:** APK installer download and launch failures could leave the cached APK file behind on disk, because cleanup only happened on checksum/size verification failure and not on HTTP download failure, installer-launch exception, or invalid update URL refusal. The fixed path now validates installer URLs through the shared HTTP(S) guard and deletes the staged APK on HTTP failure and installer-launch failure while keeping successful install handoff behavior unchanged.
- **S-023, Low:** Remote speech playback only deleted its cached provider-TTS MP3 on manual stop or playback replacement, so a naturally finished clip could leave an app-created temp file behind until later cleanup. The fixed path now listens for `playbackStatusUpdate`, deletes the cached MP3 when `didJustFinish` arrives, and keeps existing local speech fallback behavior unchanged.
- **S-024, Low:** Runtime log redaction handled explicit secret fields and sensitive query/assignment fragments, but URL userinfo credentials such as `https://user:pass@host` could still be written into JSONL diagnostics as plain text. The fixed path now strips URL userinfo passwords before log serialization and keeps existing runtime-log rotation behavior unchanged.
- **S-025, Medium:** The shared HTTP(S) URL guard accepted `https://user:pass@host` values as valid web URLs, so embedded credentials could flow through multiple sensitive surfaces including source previews, custom search endpoints, MCP server URLs, local-model mirror URLs, APK update URLs, proxy base URLs, and explicit custom provider base URLs. The fixed path now rejects embedded userinfo at the shared network URL helper and aligned provider base-URL validation, keeping existing non-web scheme refusal behavior unchanged.
- **S-026, Medium:** Settings persistence and portable backup import/export still stored raw URL-bearing settings fields even after runtime guards rejected unsafe values, so embedded-credential or non-web URLs could survive in AsyncStorage/backup JSON and only fail later at use time. The fixed path now centralizes settings URL sanitization for `customSearchEndpoint`, `localModelDownloadMirrorBaseUrl`, and `proxyBaseUrl` at the settings-store and portable-storage boundaries, keeping valid HTTP(S) values unchanged while failing closed on invalid or credential-bearing values before persistence/export.
- **S-027, Low:** Runtime-log string redaction handled explicit secret fields and a small set of query-parameter names, but pre-signed URL families such as `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Signature`, and similar `X-Goog-*` parameters could still be serialized into JSONL diagnostics when callers logged full endpoint URLs. The fixed path now treats those pre-signed parameter names as sensitive in `src/services/runtimeLog.ts` and keeps the existing log schema and rotation behavior unchanged.
- **S-028, Medium:** The user-facing `runtimeLogEnabled` setting did not fully govern runtime-health logging: storage failures, render-guard crashes, and some MCP boundary events still forced JSONL writes through `runtimeHealthLog.ts` even when logging was turned off. The fixed path now centralizes stored runtime-log option loading in `src/services/runtimeLog.ts` and routes runtime-health logging through the same persisted setting boundary, keeping log redaction and event shape unchanged while honoring the explicit off switch.
- **S-029, Medium:** Context runtime-health logging still had one remaining settings-boundary drift after the broader `runtimeLogEnabled` hardening: `logContextOperation()` defaulted to `{ enabled: true }`, so context initialization/import/memory-extraction failures could still append `context.operation` JSONL entries unless each caller remembered to plumb stored runtime-log options manually. The fixed path now resolves stored runtime-log options inside `logContextOperation()` itself, removes duplicated per-call option plumbing from `src/services/context.ts`, and keeps the existing error propagation, redaction, and event fields unchanged while honoring the global off switch.
- **S-030, Medium:** The exported `clearAllData()` helper in `src/services/storage.ts` claimed a whole-app wipe boundary but only removed a small AsyncStorage key set and SQLite conversations, leaving knowledge documents/chunks, memories, provider/search secure keys, provider-health snapshots, local embedding model state, compact-state records, and runtime-log artifacts behind. The fixed path now clears those residual data stores through shared helpers and focused regression coverage, so future reuse of the exported “clear all data” entry cannot silently leave sensitive local artifacts on disk.
- **S-031, Low:** Provider removal and “clear all providers” flows in `src/store/settingsStore.ts` deleted visible provider rows and secure keys but left provider-health snapshots and remote-compact state behind, so re-adding the same provider id could inherit stale cooldown/circuit bias and old provider-bound compact artifacts. The fixed path now clears provider-scoped health records on single removal, clears the whole provider-health snapshot on provider reset, and invalidates related compact-state records through existing compact-state helpers with focused regression coverage.
- **S-032, Low:** Full IsleMind JSON restore rewrote conversations/settings/providers but left provider-health snapshots, compact runtime state, search-provider secure keys, and missing optional backup sections from the previous local installation behind, so a “restored from JSON” flow could inherit stale cooldown bias, remote-compact artifacts, old web-search credentials, old skills, old MCP servers, or old context unrelated to the imported backup. The fixed path now clears those runtime, secret, and optional-section artifacts before applying a full IsleMind backup restore, while keeping mem0-only import behavior unchanged.
- **S-035, Low:** Android app-cache cleanup built delete targets by directly appending `readDirectoryAsync(cacheDirectory)` entries to the cache URI. Normal Expo results are direct child names, but the deletion boundary did not explicitly reject malformed names before `deleteAsync()`. The fixed path now normalizes the cache root and deletes only valid direct child names, while malformed entries are reported as cleanup failures and never become deletion targets.
- **S-036, Low:** Staged APK cleanup trusted raw marker directory entries and cache-prefix marker payloads too broadly. Normal Expo results still work, but the fixed path now accepts only direct child marker files and direct child app-cache APK payloads before deleting staged installer artifacts.
- **S-037, Low:** Runtime-log string redaction handled explicit sensitive fields, query credentials, URL userinfo, and selected token literals, but free-text authorization header fragments such as `Authorization: Basic ...` or lowercase `proxy-authorization: bearer ...` could still persist credential values. The fixed path now redacts Basic and case-insensitive Bearer credential values inside arbitrary runtime-log strings while preserving the existing log schema, event shape, and rotation behavior.
- **S-038, Low:** Visible trace/tool-output redaction used a separate sanitizer from runtime logs, and header-like strings such as `Authorization: Basic ...` or lowercase `proxy-authorization: bearer ...` could leave credential fragments after the generic assignment redaction ran. The fixed path now redacts those header-like authorization strings centrally in `traceSafety` before traces, tool output summaries, and nested trace metadata reach UI or persistence boundaries.

No hardcoded provider secrets were found in the reviewed code paths. Provider API keys and search keys are routed through secure storage abstractions, while persisted traces and MCP tool output have redaction/truncation controls.

### S-033: Conversation Delete/Clear Paths Bypassed Active Stream Cancellation

Severity: Low

Location:

- `src/store/chatStore.ts` now aborts conversation-scoped active streams before `delete(id)` mutates store state and aborts all registered active streams before `clearAll()` clears conversations.
- `src/services/chatStreamLifecycle.ts` centralizes active-stream registration plus a narrow abort hook shared by `chatRunner` and `chatStore`.
- `src/services/chatRunner.ts` now registers `stopMessage()` as the shared stream aborter and routes active-stream bookkeeping through `chatStreamLifecycle.ts`.
- `scripts/provider-intelligence-tests.js` now extends the focused `--focus=provider-store-cleanup` lifecycle regression to prove chat delete and clear-all abort active streams before state removal.

Evidence before fix:

- `src/components/conversations/ConversationRow.tsx` confirmed deletion by calling `useChatStore((state) => state.delete)` directly after the dialog confirm path.
- `src/components/main/SettingsScreenContent.tsx` confirmed “clear chats” by calling `useChatStore((state) => state.clearAll)` directly.
- `src/store/chatStore.ts` previously removed conversations in `delete(id)` and cleared the whole store in `clearAll()` without first touching the live stream cancellation boundary.
- `src/services/chatRunner.ts` owned the actual active request lifecycle through `stopMessage(conversationId)` plus the in-memory active controller map, so deleting a streaming conversation could leave an in-flight controller alive until a later callback observed missing state.

Impact:

- This was not a remote code execution issue, but it weakened a user-visible data boundary: a user could delete or clear a conversation while its provider request was still live.
- That left room for avoidable late callbacks, extra provider work after the user deleted the conversation, and harder-to-review cleanup semantics around “user removed this conversation” versus “request is still in flight.”

Fix:

- Kept public UI/store APIs stable; `ConversationRow`, settings danger actions, and chat runner entry points are unchanged.
- Added `src/services/chatStreamLifecycle.ts` as a tiny shared lifecycle seam for active-stream registration and abort dispatch.
- `chatRunner` now registers `stopMessage()` as the abort callback and routes active-controller reads/writes through the shared lifecycle helper.
- `chatStore.delete(id)` now aborts the matching active stream before removing that conversation.
- `chatStore.clearAll()` now aborts all registered active streams before clearing local conversations.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=provider-store-cleanup`
- `rg -n "abortAllStreams|abortStream|registerStreamAborter|setActiveStream|getActiveStream|clearActiveStream" src/services/chatStreamLifecycle.ts src/store/chatStore.ts src/services/chatRunner.ts scripts/provider-intelligence-tests.js`
- `git diff --check`

Residual risk:

- This patch intentionally stays at the lifecycle boundary; it does not refactor broader chat runtime/store coupling.
- The next safe structural step is to keep shrinking `chatRunner.ts` with small helper extractions while preserving current chat semantics and keeping delete/clear parity coverage in focused regression tests.

### S-034: Successful APK Installer Handoff Left Staged Packages In Cache

Severity: Low

Location:

- `src/services/apkInstallCache.ts:1` adds a narrow staged-APK lifecycle helper for installer-cache deletion, delayed cleanup markers, and cache-only marker replay.
- `src/services/appUpdates.ts` now marks successful installer handoffs for later cleanup while preserving immediate installer availability, and still deletes staged APKs on failure paths.
- `src/hooks/useBootstrap.ts` now runs staged APK cleanup during bootstrap.
- `src/services/storage.ts` now includes staged APK cleanup inside `clearAllData()`.
- `scripts/provider-intelligence-tests.js` now exposes a focused `--focus=apk-install-cache` regression that covers successful installer handoff marker creation, next-pass cleanup, malicious marker refusal, and clear-all cleanup coverage.

Evidence before fix:

- `downloadAndOpenApkInstaller()` already deleted staged APKs on checksum mismatch, HTTP failure, and installer-launch failure.
- The successful installer handoff path returned `{ status: 'downloaded' }` after opening the Android installer but previously had no cleanup owner for the staged `cacheDirectory` APK.
- That meant a successfully handed-off APK could stay in app cache until unrelated cache eviction, even though the app had already finished its side of the install flow.

Impact:

- This was a low-severity local artifact-retention issue rather than an active code-execution bug.
- Successful update handoffs could leave large staged APK files behind in app cache longer than intended, which weakens the local data-retention boundary and makes later cache review noisier.

Fix:

- Preserved successful installer behavior: the APK remains available immediately after `IntentLauncher` opens the Android installer.
- Added `apkInstallCache.ts` to separate immediate failure cleanup from deferred successful-handoff cleanup.
- Successful handoff now writes a cache-only cleanup marker for app-cache `.apk` payloads.
- Bootstrap and `clearAllData()` now sweep those markers and delete only app-cache APK payloads, removing the marker even when the payload is rejected.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=apk-install-cache`
- `node scripts/provider-intelligence-tests.js --focus=clear-all-data`
- `node -e "JSON.parse(require('fs').readFileSync('src/i18n/resources/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/resources/zh-CN.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/resources/ja.json','utf8')); console.log('i18n json ok')"`
- `git diff --check -- src/services/apkInstallCache.ts src/services/appUpdates.ts src/hooks/useBootstrap.ts src/services/storage.ts scripts/provider-intelligence-tests.js src/i18n/resources/en.json src/i18n/resources/zh-CN.json src/i18n/resources/ja.json`

Residual risk:

- This patch intentionally avoids deleting the APK immediately after installer launch, because Android may still need the handed-off content URI during the system installer flow.
- If product later wants aggressive cache sweeping on app foreground/background transitions, that should be a separate lifecycle task with explicit Android behavior validation.

### S-035: Android App-Cache Cleanup Trusted Raw Directory Entries

Severity: Low

Location:

- `src/services/androidDeviceTools.ts` now routes `android.storage.clear_app_cache` delete target construction through a narrow cache-child URI helper.
- `scripts/provider-intelligence-tests.js` now exposes a focused `--focus=android-app-cache-cleanup` regression covering valid cache-child deletion and malformed entry refusal.

Evidence before fix:

- `clearAppCacheTool()` enumerated `FileSystem.cacheDirectory` through `readDirectoryAsync(cacheDirectory)`.
- Each returned entry was appended directly into `${cacheDirectory}${name}` before `FileSystem.deleteAsync()`.
- Normal Expo filesystem behavior returns direct child names, so ordinary app-cache cleanup worked. The boundary itself, however, did not document or enforce that `name` must be a plain direct child entry before constructing a deletion URI.

Impact:

- This was a defensive hardening issue, not a known production exploit path.
- A malformed or mocked filesystem entry such as `../outside`, a nested path, an absolute URI, or a whitespace-mutated name could make the app-cache cleanup boundary harder to audit and could produce unintended delete targets if a platform adapter ever returned unexpected names.

Fix:

- Added a cache-child URI construction helper that normalizes the cache root and accepts only non-empty direct child names.
- The helper rejects parent traversal, nested separators, control characters, absolute URI schemes, `.` / `..`, and leading/trailing whitespace.
- `android.storage.clear_app_cache` now reports rejected entries as cleanup failures and continues deleting valid cache children, preserving normal cleanup behavior and public tool metadata.

Validation:

- `node --check src/services/androidDeviceTools.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=android-app-cache-cleanup`

Residual risk:

- This patch intentionally does not add a broader cache janitor or age-based deletion policy.
- If future Android filesystem adapters expose richer directory-entry objects instead of names, this helper should remain the final URI construction boundary before deletion.

### S-036: Staged APK Cleanup Trusted Raw Marker Entries

Severity: Low

Location:

- `src/services/apkInstallCache.ts:22` now maps `readDirectoryAsync(cacheDirectory)` names through a direct-child marker URI helper before reading or deleting marker files.
- `src/services/apkInstallCache.ts:55` now validates staged APK payload URIs through a direct child app-cache file helper before deleting cached APKs.
- `scripts/provider-intelligence-tests.js:4454` through `scripts/provider-intelligence-tests.js:4489` now cover valid direct marker cleanup, parent-traversal marker entries, absolute marker entries, nested cache APK payloads, and cache-prefix-confusion payloads.

Evidence before fix:

- `clearStagedApkDownloads()` enumerated `FileSystem.cacheDirectory`, filtered marker names by prefix, and constructed marker URIs by appending the raw entry name to the cache directory.
- Marker payload validation checked that the staged APK URI started with the normalized cache directory and ended in `.apk`, but did not require the payload to be a direct cache child.
- Normal Expo filesystem behavior returns direct child names and the marker writer only writes cache-backed APK payloads, so ordinary successful installer cleanup worked. The boundary itself was still broader than the app-created marker contract.

Impact:

- This was defensive local artifact cleanup hardening, not a known production exploit path.
- A malformed or mocked directory entry such as `../islemind-apk-cleanup-parent.txt` or `file:///tmp/absolute-marker.txt` could make marker cleanup read/delete outside the intended marker set if a filesystem adapter returned unexpected names.
- A marker payload such as `file:///cache/nested/child.apk` or `file:///cacheprefix/confused.apk` could make the staged-APK deletion boundary harder to audit because it was not limited to the direct app-cache APK files created by the installer download flow.

Fix:

- Added `cacheMarkerUri()` so staged cleanup accepts only direct child marker filenames with the `islemind-apk-cleanup-` prefix and `.txt` suffix.
- Routed `isCacheApkUri()` and `isCacheFileUri()` through `directCacheFileUri()`, which requires the normalized URI to be inside `FileSystem.cacheDirectory` and to contain only one direct child filename.
- Added `isDirectChildName()` to reject empty names, whitespace-mutated names, `.` / `..`, slashes, backslashes, control characters, and absolute URI schemes.
- Preserved successful installer handoff behavior: the APK is still marked for delayed cleanup rather than deleted immediately after `IntentLauncher` opens the Android installer.

Validation:

- `node --check src/services/apkInstallCache.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=apk-install-cache`
- `node scripts/provider-intelligence-tests.js --focus=clear-all-data`
- `node scripts/architecture-boundary-audit.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/apkInstallCache.ts scripts/provider-intelligence-tests.js docs/architecture/security-scan-2026-06-17.md docs/architecture/modernization-and-ai-enhancement-plan.md`

Residual risk:

- This patch intentionally does not add a broader cache janitor, age-based cleanup, or immediate post-installer deletion.
- Future cleanup owners should reuse the same direct-child cache boundary before deleting app-created cache artifacts.

### S-037: Runtime Log Free-Text Authorization Header Redaction Gap

Severity: Low

Location:

- `src/services/runtimeLog.ts` now treats Bearer token strings case-insensitively and redacts Basic authorization credential values in the shared `redactString()` path before JSONL persistence.
- `scripts/provider-intelligence-tests.js` now extends runtime-log file behavior and direct redaction helper assertions for free-text `Authorization: Basic ...` and lowercase `proxy-authorization: bearer ...` strings.

Evidence before fix:

- `redactRuntimeLogValue()` already redacted structured keys such as `authorization`, payload/body fields, sensitive query parameters, URL userinfo, and several provider token literal shapes.
- Free-text diagnostic strings were not fully covered by those key-based guards. A logged string such as `Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==` or `proxy-authorization: bearer abcdefghijklmnopqrstuvwxyz123456` kept the credential value intact because the Bearer regex was case-sensitive and Basic auth was not recognized.
- A focused runtime-log regression failed before the fix with the raw Basic and lowercase bearer credential values still present in the JSONL fixture.

Impact:

- When runtime logging was enabled, caller-provided diagnostic text that copied request headers or proxy headers could persist authorization values even though structured header fields were already redacted.
- The issue required a caller to log header-like text into a generic string field, so this is lower severity than the structured provider request redaction boundaries.

Fix:

- Extended the centralized runtime-log string sanitizer to redact case-insensitive Bearer credential values and Basic authorization values.
- Preserved the visible authentication scheme name (`Bearer` or `Basic`) so diagnostics still show the credential type without retaining the credential value.
- Kept runtime-log event names, JSONL schema, payload-key summaries, query redaction, URL userinfo redaction, and file rotation unchanged.

Validation:

- `node --check src/services/runtimeLog.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=runtime-log`

Residual risk:

- This patch targets the shared runtime-log sanitizer only. Other redaction helpers should be reviewed separately if they accept raw header-like strings outside the runtime-log path.
- Future credential schemes should be added to the same shared sanitizer with focused runtime-log fixture coverage.

### S-038: Visible Trace Authorization Header Redaction Gap

Severity: Low

Location:

- `src/utils/traceSafety.ts` now recognizes header-like `Authorization: Basic ...` and lowercase `proxy-authorization: bearer ...` text in the shared visible-trace sanitizer before generic assignment redaction runs.
- `scripts/provider-intelligence-tests.js` now adds `assertTraceRedactionBehavior()` plus a focused `--focus=trace-redaction` regression covering visible trace title/content and nested trace metadata.

Evidence before fix:

- S-037 fixed runtime-log JSONL persistence, but visible traces, MCP/tool output summaries, agent traces, source trace copy, and trace metadata rely on `src/utils/traceSafety.ts` through `agentTrace`, `chatTraceUtils`, and related helpers.
- The generic `authorization` and `bearer` assignment pattern could redact only the `Authorization: Basic` or `proxy-authorization: bearer` prefix, leaving the following credential value in the string.
- A read-only reproduction against `redactSensitiveText()` returned `[redacted] QWxhZGRpbjpvcGVuIHNlc2FtZQ==; proxy-[redacted] abcdefghijklmnopqrstuvwxyz123456`, proving the Basic credential and lowercase proxy bearer value could survive visible-trace redaction.

Impact:

- If a trace title, trace content, MCP/tool text block, or non-sensitive metadata value copied raw request/proxy headers, UI-visible and exported trace surfaces could retain authorization credential values.
- Structured sensitive metadata keys were already redacted wholesale, so this gap affected generic string fields and is lower severity than request assembly or secure-storage boundaries.

Fix:

- Added a header-like authorization pattern ahead of the broader assignment patterns in the central `SECRET_PATTERNS` list.
- Kept public trace APIs, trace clamping, status settlement, safe token-count metadata, and trace shapes unchanged.
- Kept this as a focused sanitizer hardening rather than merging runtime-log and trace sanitizers, because those two paths intentionally preserve different output detail.

Validation:

- `node --check src/utils/traceSafety.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=trace-redaction`

Residual risk:

- The trace sanitizer still targets known credential schemes and header-like shapes. Future schemes should be added centrally with focused trace fixtures.
- A broader runtime-log/trace-sanitizer consolidation would be a separate refactor with parity checks because the two sanitizers intentionally produce different redaction text.

### S-030: Exported Clear-All Helper Left Sensitive Local Artifacts Behind

Severity: Medium

Location:

- `src/services/storage.ts:80` now clears whole-app persisted state through shared context, secure-key, provider-health, runtime-log, compact-state, and local-model cleanup helpers.
- `src/services/localEmbeddingModels.ts:291` now exposes `clearLocalEmbeddingModelState()` so reset-time callers can clear local-model metadata without repopulating cached state.
- `src/services/ai/compact/compactStateStore.ts:131` now exposes `clearAllCompactStates()` for true full-reset cleanup of persisted remote-compact state.
- `src/services/ai/secureKey.ts:70` now exposes `clearKnownSearchSecureKeys()` so search-provider secrets share the same clear-all boundary as provider credentials.
- `scripts/provider-intelligence-tests.js:3643` through `scripts/provider-intelligence-tests.js:3770` add a focused `--focus=clear-all-data` regression covering conversations, context, provider/search secrets, provider-health snapshots, local-model state/files, compact state, compact usage, and runtime logs.

Evidence before fix:

- `src/services/storage.ts` exported `clearAllData()` as a storage-level “clear all” helper, but the implementation only called `clearLanguagePreferenceSource()`, `AsyncStorage.multiRemove(Object.values(KEYS))`, and `localDataStore.clearConversations()`.
- The reviewed repository still persisted other high-signal local artifacts outside that small key list, including:
  - knowledge documents/chunks and memories in `contextStore.ts`,
  - provider and search secrets in secure storage,
  - provider health in `@islemind/provider-health`,
  - local embedding-model state in `@islemind/local-embedding-models`,
  - remote compact state in `compact_states`,
  - runtime logs in `islemind-runtime.jsonl`.
- `rg -n "clearAllData" .` showed the helper was exported but currently unreferenced, which makes it especially prone to future reuse as a seemingly safe whole-app wipe primitive.

Impact:

- Even though the current settings UI does not call `clearAllData()`, this exported helper lived at a natural future reset/delete boundary while silently leaving sensitive local artifacts behind.
- A later caller, maintenance script, or refactor could reasonably rely on the helper name and accidentally ship a partial wipe that preserved knowledge, memories, provider/search secrets, or runtime evidence on disk.

Fix:

- Kept the public API stable and strengthened the implementation behind `clearAllData()`.
- The helper now clears:
  - the existing AsyncStorage core keys,
  - SQLite conversations,
  - context memories/documents/chunks via `importContextSnapshot({ ...empty })`,
  - provider health snapshots,
  - provider and search secure keys,
  - local embedding-model AsyncStorage state plus downloaded model directories,
  - persisted and in-memory remote compact state,
  - runtime log files.
- The patch reused existing cleanup seams where possible and added only small helper exports where the cleanup boundary was previously missing.

Validation:

- `node --check src/services/storage.ts`
- `node --check src/services/ai/compact/compactStateStore.ts`
- `node --check src/services/localEmbeddingModels.ts`
- `node --check src/services/ai/secureKey.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=clear-all-data`

Residual risk:

- This patch deliberately does not change the current user-facing settings semantics, where “reset settings” and “clear chats” remain narrower actions.
- If product wants a visible “wipe all local data” control, that should be a separate UI/task decision with explicit copy and confirmation UX, now backed by a real whole-app cleanup primitive instead of a misleading partial one.

### S-031: Provider Removal Left Health And Compact State Behind

Severity: Low

Location:

- `src/store/settingsStore.ts` now routes `removeProvider()` through provider-health cleanup plus provider-scoped compact invalidation, and routes `clearAllProviders()` through whole-snapshot provider-health cleanup plus all-provider compact invalidation.
- `src/services/ai/providerHealthStore.ts` now exposes `removeProviderHealthRecordsByProviderId()` for provider-scoped snapshot cleanup without changing snapshot persistence format.
- `scripts/provider-intelligence-tests.js` now covers the boundary through the focused `--focus=provider-store-cleanup` lifecycle regression and extended SQLite mock support for `UPDATE compact_states ... invalidated`.

Evidence before fix:

- `src/store/settingsStore.ts` removed secure keys and provider rows in `removeProvider()` and `clearAllProviders()`, but those flows did not call `clearProviderHealthSnapshot()`, any provider-scoped health cleanup helper, `invalidateCompactStatesByProvider()`, or `invalidateAllCompactStates()`.
- `src/services/ai/base.ts` consumes persisted provider-health snapshots during failover/runtime selection, and `src/services/chatRunner.ts` persists and reuses remote compact state by provider/model.
- That meant deleting a provider from settings did not actually remove all provider-bound runtime state: stale health/cooldown records and active compact-state rows could survive the UI-level deletion boundary.

Impact:

- Re-adding the same provider id after deletion could inherit stale provider-health state such as cooldown or circuit-open bias from an older configuration.
- Provider reset flows could also leave compact-state artifacts keyed to deleted providers, which weakens the “provider removed” boundary and makes future runtime debugging/privacy review noisier than necessary.

Fix:

- Kept `settingsStore` public methods and UI behavior stable.
- Added a small provider-scoped provider-health cleanup helper in `providerHealthStore.ts`.
- `removeProvider(id)` now:
  - deletes secure keys as before,
  - removes provider-health records for that provider id,
  - invalidates active compact-state rows for that provider with reason `provider_removed`.
- `clearAllProviders()` now:
  - deletes secure keys as before,
  - clears the persisted provider-health snapshot,
  - invalidates all active compact-state rows with reason `providers_cleared`.

Validation:

- `node --check src/store/settingsStore.ts`
- `node --check src/services/ai/providerHealthStore.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js --focus=provider-store-cleanup`
- `node scripts/provider-intelligence-tests.js`

Residual risk:

- This patch deliberately invalidates compact-state rows instead of physically deleting them, because that matches the repo’s existing compact-state lifecycle semantics and keeps future diagnostics available.
- In-memory compact usage records are not provider-scoped today; if product later wants per-provider reset semantics for diagnostics summaries, that should be a separate small task.
- This patch deliberately does not widen the current user-facing reset scope into a whole-app wipe; it only makes `settingsStore.clearAll()` stop leaving provider-bound runtime state behind after settings UI reset removes provider configuration and secrets.

### S-032: Full Backup Restore Left Runtime Provider State Behind

Severity: Low

Location:

- `src/services/storage.ts` now clears provider-health snapshots, persisted compact-state rows, in-memory compact-usage records, the runtime log file, known search secure keys, and omitted optional backup sections before applying a full IsleMind backup payload inside `importAllDataDetailed()`.
- `scripts/provider-intelligence-tests.js` now extends the portable restore coverage to prove that full-backup restore clears stale runtime provider state before applying imported rows.

Evidence before fix:

- `importAllDataDetailed()` overwrote conversations, settings, providers, secure provider secrets, skills, MCP servers, and optional context data, but it did not clear:
  - `@islemind/provider-health`,
  - persisted `compact_states`,
  - in-memory compact usage records.
- The same full-restore path also did not clear search-provider secrets such as Tavily / Google / Bing / custom-search keys, even though those keys are not represented in the portable JSON payload.
- When older or hand-edited backups omitted optional `skills`, `mcpServers`, or `context` sections, the restore path skipped those stores entirely, leaving previous local skills, MCP servers, memories, and knowledge entries behind.
- The current settings import UI tells the user that “Chats and settings were restored from JSON.” In practice, a full IsleMind restore path therefore presented itself as a restore boundary while leaving unrelated runtime provider state from the previous local installation behind.
- Those stale artifacts are actively consumed elsewhere:
  - provider health is read by provider runtime/failover logic,
  - compact state and compact usage affect remote compact reuse and diagnostics.

Impact:

- Restoring a clean backup onto a device with older local runtime state could still inherit cooldown/circuit bias, remote compact artifacts, stale search credentials, or optional local assets that were not part of the imported backup.
- This makes restore behavior harder to reason about and weakens the backup boundary, because the visible restored configuration can differ from the still-live runtime state used afterward.

Fix:

- Kept the public import/export API and mem0-only import semantics unchanged.
- Added a small restore-time cleanup seam in `storage.ts`.
- Before applying a full IsleMind backup payload, `importAllDataDetailed()` now clears:
  - provider-health snapshots,
  - persisted compact-state rows,
  - in-memory compact-usage records,
  - runtime log file state,
  - known search secure keys.
  - omitted optional restore sections by saving empty skills/MCP lists and importing an empty context snapshot when those sections are missing.
- mem0-only imports still bypass this cleanup path so they remain additive review imports, not whole-app restores.

Validation:

- `node --check src/services/storage.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js`

Residual risk:

- If product wants additive or per-section partial import semantics later, that should be introduced as a separate import-policy task with explicit UI copy instead of overloading the existing full-backup restore path.

## Scope And Method

Snapshot date: 2026-06-17.

Current worktree state is dirty, so this report records current-source evidence and keeps runtime fixes scoped to reviewed source preview, search endpoint, provider proxy, provider base-url, MCP URL, local mirror, APK update URL, Android APK staged-file lifecycle boundaries, import-file resource boundaries, Android APK installer URI boundaries, attachment/local-audio pre-read resource boundaries, knowledge-import pre-read resource boundaries, attachment temp-file lifecycle boundaries, image attachment compression temp-file lifecycle boundaries, persisted attachment metadata boundaries, MCP tool identity boundaries, agent workflow tool identity boundaries, provider TTS temp-file lifecycle boundaries, skill-export temp-file lifecycle boundaries, import-temp-file lifecycle boundaries, and runtime-log credential redaction boundaries.

High-recall searches included:

- URL/navigation/WebView sinks: `Linking.openURL`, `WebView`, `originWhitelist`, `onShouldStartLoadWithRequest`, route `url` params.
- Dangerous execution and DOM-style sinks: `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, `postMessage`.
- Secret handling: `apiKey`, secure storage helpers, provider credential paths.
- Trace/log handling: redaction, trace metadata sanitization, MCP output truncation.
- Outbound request surfaces: generic `fetch()` paths and provider/MCP/search-specific clients.
- Audio temp-file lifecycle: provider TTS cache writes, playback completion, and post-playback cleanup ownership.

## Fixed Findings

### S-001: Source Preview Accepted Unconstrained URL Schemes

Severity: Medium

Location:

- `app/source.tsx:46` selects the explicit route URL or citation URL.
- `app/source.tsx:51` now derives `webUrl` through `safeHttpUrl()`.
- `app/source.tsx:100` opens only the sanitized `webUrl` externally.
- `app/source.tsx:231` constrains WebView origins to `http://*` and `https://*`.
- `app/source.tsx:233` applies `isAllowedWebViewNavigation()` to WebView navigations.
- `src/utils/sourceUrlSafety.ts:1` centralizes the source URL guard.
- `scripts/provider-intelligence-tests.js:2653` through `scripts/provider-intelligence-tests.js:2660` cover allowed and rejected schemes.

Evidence before fix:

- The source screen read `params.url` or `citation.url`, then used that value as the WebView `source.uri` and `Linking.openURL()` target.
- The reviewed path did not show an app-level protocol allowlist around the initial WebView URL or external open action.

Impact:

- A malicious or corrupted citation/route parameter could attempt to load `javascript:`, `file:`, `data:`, or app/custom schemes through the source preview surface. Platform behavior differs, but the app should not rely on WebView or system URL handlers as the first safety boundary.

Fix:

- Added `safeHttpUrl()` and `isAllowedWebViewNavigation()` in `src/utils/sourceUrlSafety.ts`.
- The source screen only renders WebReader/open-external actions when a URL parses as `http:` or `https:`.
- WebView is configured with `originWhitelist={['http://*', 'https://*']}` and a navigation callback that rejects non-web schemes while still allowing the internal `about:blank` load.
- Non-web citations fall back to the existing local source reader instead of being loaded as remote content.

Validation:

- `scripts/provider-intelligence-tests.js` now imports the shared source URL guard and asserts:
  - `https://example.com/source?q=1` is accepted.
  - `http://localhost:19006/source` is accepted.
  - `javascript:alert(1)` is rejected.
  - `file:///data/data/islemind/private.txt` is rejected.
  - `islemind://settings` is rejected.
  - WebView navigation allows `about:blank` and HTTPS, but rejects `data:text/html,...`.

Residual risk:

- This patch does not implement a domain allowlist. That is intentional for a source citation viewer that can legitimately preview arbitrary web sources. If future product requirements narrow trusted citation providers, origin allowlisting should be a separate behavior-changing task.

### S-002: Custom Search Endpoint Accepted Non-Web Schemes Before Credentialed Fetch

Severity: Medium

Location:

- `src/services/searchPolicy.ts:56` routes Bing-compatible endpoints through `safeCustomSearchEndpoint()`.
- `src/services/searchPolicy.ts:60` builds custom search URLs through `buildCustomSearchUrl()`.
- `src/services/searchPolicy.ts:69` centralizes custom search endpoint validation.
- `src/services/searchPolicy.ts:75` allows only `http:` and `https:` endpoints.
- `src/services/searchAdapters.ts:93` through `src/services/searchAdapters.ts:97` build and validate the custom JSON URL before `fetch()` attaches `Authorization: Bearer ...`.
- `scripts/provider-intelligence-tests.js:3687` through `scripts/provider-intelligence-tests.js:3692` cover blank, valid, malformed, and non-web endpoint cases.

Evidence before fix:

- `searchCustomJson()` trimmed `settings.customSearchEndpoint`, substituted `{query}` and `{limit}`, then called `fetch(url, apiKey ? { headers: { Authorization: ... } } : undefined)`.
- `getBingCompatibleEndpoint()` returned the trimmed endpoint directly, so the service boundary did not reject non-HTTP(S), malformed, or templated output that failed URL parsing before downstream use.

Impact:

- A malformed, corrupted, or imported settings value could reach search fetch code as a credentialed destination. React Native and platform fetch implementations generally expect web URLs, but the app should enforce the security boundary before adding search credentials or depending on platform behavior.

Fix:

- Added `safeCustomSearchEndpoint()` and `buildCustomSearchUrl()` to `src/services/searchPolicy.ts`.
- Bing-compatible and custom JSON search paths now share the same `http:`/`https:` endpoint policy.
- Custom JSON search returns no sources when endpoint validation fails, so invalid endpoint configuration does not attempt a credentialed request.
- The final templated URL is parsed again after `{query}` and `{limit}` replacement to prevent a template from producing a non-web destination.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - Blank Bing-compatible endpoints return `null`.
  - Trimmed HTTPS endpoints remain accepted.
  - `file:///tmp/search.json` is rejected before credentialed fetch.
  - `islemind://search` is rejected before credentialed fetch.
  - A valid HTTPS template produces an encoded query URL.
  - A template that resolves to a non-HTTP URL returns `null`.

Residual risk:

- This patch intentionally does not restrict custom search hosts. Custom/Bing-compatible search is a user-configured integration surface, so host ownership and trust remain a settings responsibility. A future origin allowlist or endpoint preset policy would be a behavior-changing product decision.

### S-003: Custom Proxy Base URL Accepted Non-Web Schemes Before Provider Requests

Severity: Medium

Location:

- `src/services/ai/policy/proxyPolicy.ts:17` resolves custom proxy policy for provider requests.
- `src/services/ai/policy/proxyPolicy.ts:22` now validates `proxyBaseUrl` through shared HTTP(S) URL safety logic.
- `src/services/ai/base.ts:733` resolves the proxy policy before provider chat requests.
- `src/services/ai/base.ts:785`, `src/services/ai/base.ts:829`, and `src/services/ai/base.ts:849` use `proxyPolicy.effectiveUrl` for Responses WebSocket and HTTP/SSE provider traffic.
- `src/services/runtimeDiagnostics.ts:124` now summarizes custom proxy configuration through the same HTTP(S) guard.
- `scripts/provider-intelligence-tests.js:1679` through `scripts/provider-intelligence-tests.js:1693` and `scripts/provider-intelligence-tests.js:3252` through `scripts/provider-intelligence-tests.js:3268` cover accepted and rejected proxy URL cases.

Evidence before fix:

- `resolveProxyPolicy()` accepted any `new URL(baseUrl)` result, joined it with the original provider endpoint path, and marked the proxy as applied.
- Provider chat execution used `proxyPolicy.effectiveUrl` directly for Responses WebSocket and HTTP/SSE provider traffic, so a user-configured custom proxy destination could reach credentialed upstream request code without an app-level HTTP(S) restriction.

Impact:

- A malformed, imported, or user-entered custom proxy setting such as `file:` or an app-specific scheme could be treated as an active upstream destination for provider requests that carry authorization headers or API keys. The app should fail closed before any provider credential leaves the normal web transport boundary.

Fix:

- Added `src/utils/networkUrlSafety.ts` and routed custom proxy URL validation through it.
- `resolveProxyPolicy()` now rejects non-HTTP(S) custom proxy base URLs and reports `invalid_custom_base_url`.
- `buildRuntimeDiagnosticsSummary()` now uses the same validation path, so diagnostics no longer report invalid proxy values as applied.
- Existing HTTPS proxy rewriting behavior remains unchanged for valid custom proxy targets.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - An HTTPS proxy base URL still preserves endpoint path and query.
  - `file:///tmp/proxy` is rejected before credentialed proxy fetch.
  - `islemind://proxy` is rejected before credentialed proxy fetch.
  - Runtime diagnostics report invalid custom proxy URLs as `applied=false` with `reason=invalid_custom_base_url`.

Residual risk:

- This patch intentionally does not restrict proxy hosts beyond requiring HTTP(S). Custom proxies remain an advanced user-controlled networking feature, so host ownership, TLS posture, and trust boundaries still require operator judgment or a future allowlist product decision.

### S-004: Custom Provider Base URLs Reached Credentialed Provider Surfaces Without A Shared HTTP(S) Guard

Severity: Medium

Location:

- `src/types/index.ts:1004` now rejects explicit non-web custom provider Base URLs through `getProviderConfigIssue()`.
- `src/services/ai/base.ts:1338`, `src/services/ai/base.ts:1397`, `src/services/ai/base.ts:1472`, and `src/services/ai/base.ts:1520` now stop provider model tests, remote model sync, provider transcription, and provider speech when the current custom Base URL is invalid.
- `src/services/ai/providerModelDiscovery.ts:152` now rejects invalid custom provider Base URLs before `/models` discovery fetch.
- `src/services/ai/providerRegistry.ts:195` now rejects invalid custom provider Base URLs before provider preset probing sends `/models` requests with credentials.
- `scripts/provider-intelligence-tests.js` now covers helper, probe, and model-discovery refusal behavior for invalid provider Base URLs.

Evidence before fix:

- `getProviderConfigIssue()` only enforced Xiaomi-specific credential-mode and wire-protocol mismatch rules, so non-Xiaomi custom provider Base URLs such as `file:` or app-specific schemes were not rejected at the shared provider-config boundary.
- Provider runtime assembly in `src/services/ai/providerRouteAssembly.ts` and `src/services/ai/base.ts` used `getProviderEffectiveBaseUrl()` and `defaultOpenAICompatibleBaseUrl()` directly when building chat, model-discovery, embedding, transcription, and speech endpoints.
- `probeProviderPreset()` in `src/services/ai/providerRegistry.ts` normalized arbitrary input into `/models` probe endpoints and could attach bearer or API-key credentials before any provider-specific HTTP(S) policy check.

Impact:

- A malformed, imported, or user-entered custom provider Base URL could reach credentialed provider request code outside the proxy and search boundaries already fixed by S-002 and S-003. Platform fetch/WebSocket behavior might reject some of these URLs later, but the app should fail closed before it assembles outbound provider destinations or sends provider credentials.

Fix:

- Extended `getProviderConfigIssue()` in `src/types/index.ts` with shared helpers that distinguish explicit custom provider Base URLs from official defaults and require explicit custom provider Base URLs to parse as `http:` or `https:`.
- Preserved current behavior for official default provider Base URLs and valid HTTP(S) custom Base URLs.
- Routed provider model tests, remote model sync, provider model discovery, provider preset probe, provider embeddings, provider audio transcription, and provider speech through the shared `bad_base_url` refusal path.
- Kept public APIs stable: callers still use the same entry points, but now receive a deterministic provider-configuration failure instead of proceeding to late transport errors for non-web custom Base URLs.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - explicit HTTPS custom provider Base URLs remain accepted,
  - blank custom Base URLs remain treated as “no custom override,”
  - `file:` and app-scheme custom provider Base URLs are rejected by shared provider-config validation,
  - provider preset probing refuses invalid custom Base URLs before any probe fetch runs,
  - provider model discovery refuses invalid custom Base URLs before any `/models` fetch runs.
- Validation commands run in the current worktree:
  - `node --check scripts/provider-intelligence-tests.js`
  - `bun run test:provider-intelligence`
  - `bun run test:architecture-boundary`

Residual risk:

- This patch intentionally does not add a provider host allowlist or silently rewrite invalid custom Base URLs to official defaults. Trust in user-specified provider hosts remains an operator decision, while invalid non-web destinations now fail closed. A future host policy or preset-only mode would be a separate product behavior change.

### S-005: Persisted Or Imported MCP Server URLs Could Bypass The Form-Level HTTP(S) Check

Severity: Medium

Location:

- `src/services/mcpUrlPolicy.ts:1` centralizes MCP server URL validation and builtin-server exceptions.
- `src/services/mcp.ts:30` now filters persisted MCP servers through shared normalization during `listMcpServers()`.
- `src/services/mcp.ts:47` now rejects invalid MCP URLs before manifest refresh attempts.
- `src/services/mcp.ts:91` now rejects invalid MCP URLs before tool execution attempts.
- `src/services/mcp.ts:304` now drops invalid non-web persisted MCP server URLs during runtime normalization.
- `src/services/storage.ts:135` and `src/services/storage.ts:257` now drop invalid imported MCP server URLs before persistence.
- `scripts/provider-intelligence-tests.js:7943`, `scripts/provider-intelligence-tests.js:7987`, and `scripts/provider-intelligence-tests.js:8015` cover persisted, imported, and runtime-invalid MCP URL cases.

Evidence before fix:

- `src/components/settings/McpSettingsContent.tsx` already refused new MCP entries unless the URL matched `http:` or `https:`.
- But `src/services/mcp.ts` loaded persisted MCP servers through `normalizeServer()` without validating the stored URL scheme before `refreshMcpManifest()` and `callMcpTool()` could reach `fetch(server.url, ...)`.
- `src/services/storage.ts` normalized imported `mcpServers` payloads only by shape, so backup/restore or hand-edited portable data could persist non-web MCP URLs into AsyncStorage.

Impact:

- A malformed, stale, hand-edited, or imported MCP server record could bypass the UI form constraint and still reach MCP network code. The app should fail closed before a non-web MCP URL reaches fetch, even if that bad value came from storage or import rather than current user input.

Fix:

- Added `src/services/mcpUrlPolicy.ts` as a shared MCP URL guard.
- Persisted MCP servers are now normalized through the shared guard before being listed back into runtime state.
- Portable import now drops invalid MCP server URLs before writing `MCP_SERVERS`.
- `refreshMcpManifest()` and `callMcpTool()` now refuse invalid MCP server URLs before any fetch attempt, so legacy/bad runtime objects also fail closed.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - persisted `file:` MCP server URLs are filtered out before `listMcpServers()` returns runtime state,
  - portable imports drop invalid `islemind:` MCP server URLs before persistence,
  - runtime MCP tool calls with invalid non-web server URLs fail closed before `fetch`,
  - manifest refresh with an invalid non-web MCP URL fails closed before `fetch`.
- Validation commands run in the current worktree:
  - `node --check scripts/provider-intelligence-tests.js`
  - `bun run test:provider-intelligence`
  - `bun run test:architecture-boundary`
  - `git diff --check`

Residual risk:

- This patch intentionally does not add an MCP host allowlist or enable non-HTTP transports. Builtin MCP remains the only non-HTTP exception, while external MCP endpoints continue to require explicit user-controlled HTTP(S) addresses.

### S-006: Local Model Mirror Base URLs Accepted Non-Web Schemes Before Fallback Downloads

Severity: Medium

Location:

- `src/components/settings/ContextPanel.tsx:627` forwards `settings.localModelDownloadMirrorBaseUrl` into local-model download options.
- `src/services/localEmbeddingModels.ts:195` reads `mirrorBaseUrl` before fallback download assembly.
- `src/services/localEmbeddingModels.ts:428` now validates mirror Base URLs through shared HTTP(S) URL safety logic.
- `scripts/provider-intelligence-tests.js:7877` through `scripts/provider-intelligence-tests.js:7890` cover valid mirror fallback and invalid non-web mirror URL refusal behavior.

Evidence before fix:

- The local model settings UI exposed `localModelDownloadMirrorBaseUrl` as a free-form string setting.
- `downloadLocalEmbeddingModel()` trimmed the configured mirror URL through `normalizeMirrorBaseUrl()` and, when official downloads failed, passed the result directly into `mirrorModelFileUrl()` and `FileSystem.createDownloadResumable()`.
- The old `normalizeMirrorBaseUrl()` only trimmed and stripped a trailing slash, so `file:` or app/custom-scheme mirror values were not rejected at the service boundary before fallback download URL assembly.

Impact:

- A malformed, imported, or user-entered mirror setting could be treated as a fallback download destination for local embedding model files. The app should fail closed before it assembles download URLs from a user-controlled non-web mirror value, even though checksum verification still protects model integrity after download.

Fix:

- Reused the shared `safeHttpUrl()` helper from `src/utils/networkUrlSafety.ts`.
- `normalizeMirrorBaseUrl()` in `src/services/localEmbeddingModels.ts` now accepts only `http:` or `https:` mirror URLs.
- Valid HTTPS mirrors still work as before; invalid mirror URLs are ignored, so official-source failure remains the surfaced outcome instead of attempting a non-web mirror download.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - valid HTTPS mirror URLs still drive fallback mirror downloads after an official-source failure,
  - invalid non-web mirror URLs are ignored,
  - invalid mirror URLs do not cause any mirror download attempt to be recorded.
- Validation commands run in the current worktree:
  - `node --check scripts/provider-intelligence-tests.js`
  - `bun run test:provider-intelligence`
  - `bun run test:architecture-boundary`
  - `git diff --check`

Residual risk:

- This patch intentionally does not restrict mirror hosts beyond requiring HTTP(S), because mirror hosting remains an advanced user-controlled setting. Integrity still depends on the existing size and SHA-256 verification path, while non-web mirror destinations now fail closed.

### S-007: APK Update Feed URLs Accepted Non-Web Schemes Before Download Parsing And Install Flow

Severity: Medium

Location:

- `src/services/appUpdates.ts:156` now validates `release.apkUrl` before `FileSystem.downloadAsync(...)`.
- `src/services/appUpdates.ts:292` now requires manifest `releaseUrl` to be an explicit HTTP(S) URL.
- `src/services/appUpdates.ts:309` now requires manifest asset `url` to be an explicit HTTP(S) URL.
- `src/services/appUpdates.ts:316` now filters GitHub `browser_download_url` values through the shared HTTP(S) guard.
- `scripts/provider-intelligence-tests.js:7661` through `scripts/provider-intelligence-tests.js:7674` cover invalid manifest `releaseUrl` and asset `url` cases.
- `scripts/provider-intelligence-tests.js:7743` through `scripts/provider-intelligence-tests.js:7779` cover invalid GitHub asset URLs and invalid installer `apkUrl` refusal behavior.

Evidence before fix:

- `parseApkUpdateManifest()` and `parseManifestAsset()` only required `releaseUrl` and asset `url` to be non-empty strings.
- `normalizeGithubAsset()` only checked file extension and string presence for `browser_download_url`.
- `downloadAndOpenApkInstaller()` used `release.apkUrl` directly when calling `FileSystem.downloadAsync(...)`.

Impact:

- A malformed or compromised update feed entry could supply a non-web APK or release URL that crossed from update metadata into installer/download logic without the app enforcing its own web-only transport boundary. Even if downstream platform APIs rejected some schemes, the app should fail closed before treating those values as installable update targets.

Fix:

- Reused the shared `safeHttpUrl()` helper from `src/utils/networkUrlSafety.ts`.
- Added `readRequiredWebUrl()` in `src/services/appUpdates.ts` for manifest parsing.
- Manifest `releaseUrl`, manifest asset `url`, GitHub asset download URLs, and runtime installer `apkUrl` now require explicit HTTP(S) URLs.
- Invalid update URLs now surface as manifest-invalid or no-installable-update outcomes instead of reaching download code.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - manifest parsing rejects non-web `releaseUrl`,
  - manifest parsing rejects non-web APK asset URLs,
  - GitHub fallback ignores non-web asset download URLs,
  - installer flow rejects non-web `apkUrl` before any download attempt.
- Validation commands run in the current worktree:
  - `node --check scripts/provider-intelligence-tests.js`
  - `bun run test:provider-intelligence`
  - `bun run test:architecture-boundary`
  - `git diff --check`

Residual risk:

- This patch intentionally does not pin update hosts to a narrower allowlist. The current change enforces web transport and preserves the existing checksum/size verification path, while tighter host ownership policy would be a separate product decision.

### S-008: Import File Readers Lacked A Shared Size Boundary Before Full In-Memory Reads

Severity: Medium

Location:

- `src/services/fileImportGuards.ts:1` centralizes import-file size limits, declared-size checks, filesystem metadata fallback, and UTF-8 import reads.
- `src/services/attachment.ts:13` now reuses the shared 20 MB import-file guard for attachment selection.
- `src/components/providers/ProviderSettingsContent.tsx:30` and `src/components/providers/ProviderSettingsContent.tsx:1533` now route provider text/CSV/JSON file imports through the shared guard.
- `src/components/settings/SkillSettingsContent.tsx:16` and `src/components/settings/SkillSettingsContent.tsx:154` now route `.isleskill`/JSON/text imports through the shared guard.
- `src/services/context.ts:251` now rejects oversized knowledge text/PDF imports before text or base64 reads.
- `src/services/portableData.ts:5` and `src/services/portableData.ts:33` now route portable JSON backups through the shared guard with a larger 64 MB backup limit.
- `src/services/storage.ts:47` adds a backward-compatible `file_too_large` import failure reason for portable-data UI feedback.
- `src/components/main/SettingsScreenContent.tsx:19` and `src/components/main/SettingsScreenContent.tsx:1212` surface oversized portable backup failures with the configured size limit.
- `scripts/provider-intelligence-tests.js` covers accepted imports, declared-size rejection, metadata-size rejection, portable JSON rejection, and knowledge-file rejection before reads.

Evidence before fix:

- `src/components/providers/ProviderSettingsContent.tsx` read selected provider import files with `FileSystem.readAsStringAsync(asset.uri)` after only extension/MIME checks.
- `src/components/settings/SkillSettingsContent.tsx` read selected skill files with `FileSystem.readAsStringAsync(asset.uri, UTF8)` after only extension/MIME checks.
- `src/services/portableData.ts` read selected portable JSON backups fully into memory before parsing and import normalization.
- `src/services/context.ts` read knowledge text files as UTF-8 and PDF files as base64 before any import-size boundary specific to that selected file path.
- Attachment selection already had a 20 MB check, but that limit was local to `attachment.ts` and was not reused by the other import surfaces.

Impact:

- A large local or provider-backed document selected through import UI could force the app to read tens or hundreds of MB into JavaScript memory before validation or parsing. On mobile, that is a realistic denial-of-service and stability boundary even when the file comes from an explicit user selection.

Fix:

- Added `src/services/fileImportGuards.ts` with shared limits and `readUtf8ImportFile()`.
- The guard checks `asset.size` when available and falls back to `FileSystem.getInfoAsync(uri).size` when the picker did not provide a size.
- Provider, skill, knowledge text, knowledge PDF, portable JSON, and attachment flows now use one import-size policy before in-memory reads.
- Portable backups get a separate 64 MB limit to preserve normal whole-app backup restores, while interactive text/config/knowledge imports keep the existing 20 MB boundary.
- File-too-large UI feedback uses existing localized error strings where available and preserves existing success behavior for valid imports.

Validation:

- `scripts/provider-intelligence-tests.js` now asserts that:
  - ordinary bounded provider import text is still read successfully,
  - declared oversized import files throw `error.fileTooLarge` before `readAsStringAsync()`,
  - missing picker size falls back to filesystem metadata and still blocks oversized files before reads,
  - oversized portable JSON imports return `{ ok: false, kind: 'invalid', reason: 'file_too_large' }` before reads,
  - oversized knowledge imports return the existing 20 MB message before text or PDF reads.
- Validation commands run in the current worktree:
  - `node --check scripts/provider-intelligence-tests.js`
  - `bun run test:provider-intelligence`
  - `bun run type-check -- --pretty false`
  - `bun run test:architecture-boundary`

Residual risk:

- Very large pasted text can still enter memory because it is already resident in the UI text field before import processing. A paste-size and manual text-area budget should be a separate UX-sensitive task.
- The 64 MB portable backup limit is intentionally larger than interactive import limits. If real backup sizes exceed it, the next migration should stream or chunk portable-data import instead of raising the in-memory ceiling indefinitely.

### S-009: Android APK Installer Handoff Accepted Arbitrary Content URIs

Severity: Medium

Location:

- `src/services/androidUriPolicy.ts:1` centralizes Android APK URI validation and normalization.
- `src/services/androidDeviceTools.ts:1157` now routes runtime APK handoff recognition through the shared policy helper.
- `src/services/agent/agentPlanner.ts:334` now sanitizes inferred APK URIs through the shared policy helper.
- `src/services/agent/agentIntentClassifier.ts:337` now separates APK URI inference from generic Android URI inference.
- `src/services/agent/agentAndroidWorkflows.ts:456` now sanitizes APK workflow URI inputs through the shared helper.
- `scripts/provider-intelligence-tests.js:7789` through `scripts/provider-intelligence-tests.js:7793` cover accepted and rejected APK URI shapes.
- `scripts/provider-intelligence-tests.js:7978` through `scripts/provider-intelligence-tests.js:7987` verify runtime installer refusal for non-APK content URIs and acceptance for APK content URIs.

Evidence before fix:

- `src/services/androidDeviceTools.ts` treated any `content://` URI as APK-like in `looksLikeApkUri()`, so runtime installer handoff accepted generic SAF/document content URIs without proving they actually identified an APK.
- `src/services/agent/agentPlanner.ts` inferred APK URIs from message text and accepted any `content://` URI as installable, while `src/services/agent/agentIntentClassifier.ts` reused generic Android URI inference for APK installer tasks.
- Runtime installer handoff grants `FLAG_GRANT_READ_URI_PERMISSION` and launches `android.intent.action.INSTALL_PACKAGE`, so the boundary should be explicit about “APK URI only” rather than “any readable content URI.”

Impact:

- A malformed, ambiguous, or non-APK `content://` URI could be treated as an APK installer input and forwarded to the Android package installer flow with read permission grants. Platform installer behavior may reject the URI later, but the app should fail closed before handing non-APK content into the install boundary.

Fix:

- Added `src/services/androidUriPolicy.ts` with `isAllowedAndroidApkUri()` and `sanitizeAndroidApkUri()`.
- The shared rule allows:
  - `file://...apk`
  - `content://...` URIs whose visible path/document portion identifies an `.apk`
- The shared rule rejects:
  - remote HTTP(S) URLs
  - SAF tree grants such as `content://.../tree/Download`
  - non-APK content documents such as `content://downloads/document/report.pdf`
- Agent planner inference, agent intent classification for APK installer tasks, agent Android workflow sanitization, and runtime Android installer handoff now share the same APK-only boundary.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `node --check scripts/android-device-tool-policy-tests.js`
- `bun run test:provider-intelligence`
- `bun run test:android-device-tools`
- `bun run test:architecture-boundary`
- `bun run type-check -- --pretty false`

Residual risk:

- `content://` URIs can still be opaque, and this fix intentionally uses a conservative visible `.apk` path check rather than MIME-type or package-signature validation. If future native validation is required, that should be a separate behavior-changing hardening task.

### S-010: Attachment And Local Audio Base64 Reads Missed The Shared Pre-Read Size Boundary

Severity: Medium

Location:

- `src/services/fileImportGuards.ts:12` adds `assertImportFileSizeByUri()` as the shared size-and-metadata helper for pre-read boundaries.
- `src/services/attachment.ts:13` now resolves attachment file size through the shared helper, including metadata fallback when picker size is missing.
- `src/services/attachment.ts:30`, `src/services/attachment.ts:58`, and `src/services/attachment.ts:85` now enforce the shared pre-read boundary before base64 conversion for picked images, camera photos, and document attachments.
- `src/services/speech.ts:40` now enforces the same shared pre-read boundary before local audio transcription reads the recording as base64.
- `src/components/chat/Composer.tsx:240` now maps the shared `error.fileTooLarge` failure to the existing 20 MB user-facing message for local voice transcription.
- `scripts/provider-intelligence-tests.js:8187` through `scripts/provider-intelligence-tests.js:8199` verify attachment and local-audio refusal behavior when size metadata is missing or the file exceeds the 20 MB boundary.

Evidence before fix:

- `src/services/attachment.ts` only checked `asset.size` or `asset.fileSize` when the picker provided it, then called `FileSystem.readAsStringAsync(uri, { encoding: Base64 })` directly. If the picker omitted size metadata, document attachments could bypass the shared size guard and be fully loaded into memory.
- `src/services/speech.ts` read the full local recording into base64 with `FileSystem.readAsStringAsync(uri, { encoding: Base64 })` before any import-size boundary at all.
- `src/services/fileImportGuards.ts` already had a metadata fallback path for text/JSON/PDF imports, so attachment and local-audio base64 flows had drifted from the repo's newer shared pre-read boundary.

Impact:

- A large local attachment or recording selected through chat tools could still force the app to read the entire file into JavaScript memory before validation when picker metadata was absent or when local audio transcription bypassed the shared boundary. On mobile, this is a realistic denial-of-service and stability issue even when the input comes from explicit user selection.

Fix:

- Added `assertImportFileSizeByUri()` to `src/services/fileImportGuards.ts` so callers can reuse the existing “declared size or filesystem metadata” boundary without duplicating read logic.
- Routed attachment document reads, image/camera attachment reads, and local audio transcription through the shared helper before base64 conversion.

### S-011: Knowledge Import Could Bypass The Shared Pre-Read Size Boundary

Severity: Medium

Location:

- `src/services/context.ts:244` through `src/services/context.ts:292` now resolve knowledge-import file size through `assertImportFileSizeByUri()` before any text or PDF read runs.
- `src/services/fileImportGuards.ts:12` remains the shared “declared size or filesystem metadata” boundary used by provider, skill, portable-data, attachment, local-audio, and now knowledge-import reads.
- `scripts/provider-intelligence-tests.js:8176` through `scripts/provider-intelligence-tests.js:8193` now cover oversized size-less PDF knowledge imports.
- `scripts/architecture-boundary-audit.js:38` through `scripts/architecture-boundary-audit.js:57` now track the extracted knowledge retrieval runtime module as part of the context boundary contract.

Evidence before fix:

- `src/services/context.ts` normalized `asset.size` to `0` before branching by MIME type.
- The text path then passed that `0` into `readUtf8ImportFile()`, which prevented the shared metadata fallback from checking filesystem size when `DocumentPicker` omitted `size`.
- The PDF path skipped the shared helper completely and called `FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })` directly, so an oversized size-less PDF could still be fully loaded into JavaScript memory before refusal.

Impact:

- A large text or PDF knowledge document selected from the device could still force full-file reads when picker metadata was missing. On mobile, this is a practical memory-pressure and denial-of-service risk on the same import surface that the repo had already tried to harden for other file classes.

Fix:

- `importKnowledgeFile()` now resolves size through `assertImportFileSizeByUri()` before any knowledge text or PDF read path runs.
- The resolved size is passed forward to text import and PDF attachment generation so current successful imports keep the same downstream metadata.
- Oversized knowledge imports now reuse the existing `chat.fileTooLarge20` message instead of depending on divergent text/PDF behavior.
- Updated the architecture-boundary audit contract to treat `src/services/knowledgeRetrievalRuntime.ts` as part of the current retrieval boundary after the helper extraction, keeping the audit aligned with the live structure instead of the older in-file marker location.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:architecture-boundary`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/context.ts scripts/provider-intelligence-tests.js scripts/architecture-boundary-audit.js`

Residual risk:

- Accepted knowledge files are still read fully into memory before provider upload or local indexing once they pass the 20 MB boundary. Chunked or streamed PDF extraction/import would be a separate behavior-changing resource-hardening task.
- Local ONNX embedding session startup no longer base64-reads the full `model_quantized.onnx` file in `rag.ts`, but checksum verification still reads downloaded model files in bounded 1 MB chunks before activation. That verification path is acceptable for integrity enforcement and should stay separate from runtime session loading.
- Preserved existing attachment behavior for normal-sized files and preserved the existing 20 MB user-facing error copy by mapping `error.fileTooLarge` in `Composer.tsx`.
- Kept the original image-selection size check behavior and added a second post-compression size verification so compressed output still respects the same boundary before base64 conversion.

### S-012: Provider TTS Left Generated Audio Files In Cache

Severity: Medium

Location:

- `src/services/speech.ts:13` now tracks the active provider TTS temp-file URI.
- `src/services/speech.ts:85` through `src/services/speech.ts:91` now delete the active cached TTS file during `stopSpeaking()`.
- `src/services/speech.ts:94` through `src/services/speech.ts:100` still write the generated MP3 into cache for playback, but now clear the previous file before replacement and mark the new URI as active.
- `scripts/provider-intelligence-tests.js:8258` through `scripts/provider-intelligence-tests.js:8286` now verify cached provider TTS files are deleted when a new clip replaces them and when playback is stopped.

Evidence before fix:

- `playProviderSpeechBase64()` wrote each provider-generated MP3 to `${FileSystem.cacheDirectory}islemind-tts-${Date.now()}.mp3`.
- `stopSpeaking()` only paused and removed the audio player object, but did not delete the file that had just been written.
- A second remote speech playback wrote a different cache file and stopped the previous player, but still left the earlier MP3 on disk.

Impact:

- Provider-backed spoken responses could leave plaintext-derived audio content in the app cache after playback completed or another clip replaced it. Even though cache storage is not a public export surface, this is still unnecessary local retention of user or assistant content and expands the forensic/privacy footprint of remote TTS.

Fix:

- Added active temp-file tracking in `speech.ts`.
- `stopSpeaking()` now clears the active provider TTS file after stopping/removing the current player.
- Starting a new provider TTS clip now clears the previous cached file before marking the new one active.
- Local `expo-speech` fallback behavior remains unchanged.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/speech.ts scripts/provider-intelligence-tests.js`

Residual risk:

- If the process crashes after writing a provider TTS file but before `stopSpeaking()` or replacement cleanup runs, the cache file can still remain until OS cache eviction or a later cleanup pass. A broader startup cache sweep would be a separate behavior change.

### S-013: Skill Export Left Portable Share Files In Cache

Severity: Medium

Location:

- `src/components/settings/SkillSettingsContent.tsx:198` through `src/components/settings/SkillSettingsContent.tsx:214` now delete the temporary `.isleskill` file after the share attempt completes.
- `scripts/provider-intelligence-tests.js:3893` through `scripts/provider-intelligence-tests.js:3901` now pin the source-level contract that skill export clears the temporary share file.

Evidence before fix:

- `exportSkillFile()` wrote the portable skill payload to `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safeName}.isleskill`.
- The file was then handed to `Sharing.shareAsync(uri, ...)`, but the function returned without deleting the cache artifact.
- Unlike the portable backup export, this path did not present itself as a persistent saved artifact to the user; it was only an implementation detail of the share flow.

Impact:

- Portable skill exports could leave share-ready prompt bundles in the app cache after sharing. Even though provider/model bindings are stripped from portable skill exports, the file still contains user-authored prompt content, tool selections, knowledge-source references, and workflow metadata that should not linger longer than needed for a one-shot share action.

Fix:

- Wrapped the share path in a `try/finally` block.
- Skill export now deletes the temporary `.isleskill` file after the share attempt, regardless of whether the share sheet succeeds, is unavailable, or is dismissed.
- Clipboard export behavior and existing success toast copy remain unchanged.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/components/settings/SkillSettingsContent.tsx scripts/provider-intelligence-tests.js`

Residual risk:

- This fix only covers the temp file created for share-sheet export. Users can still paste or otherwise persist the clipboard copy elsewhere by design.

### S-013B: Portable Backup Export Left Full IsleMind Backup Files In Persistent Documents Storage During Share Flow

Severity: Medium

Location:

- `src/services/portableData.ts:10` through `src/services/portableData.ts:29` now stage portable backup exports in cache when the native share sheet is available and clear the temporary JSON after share completion.
- `src/components/main/SettingsScreenContent.tsx:179` through `src/components/main/SettingsScreenContent.tsx:181` still present the existing export completion notice using the returned URI.
- `src/i18n/resources/en.json:910`, `src/i18n/resources/zh-CN.json:910`, and `src/i18n/resources/ja.json:910` now describe the export as “ready” instead of claiming it was always saved into the app documents directory.
- `scripts/provider-intelligence-tests.js:9476` through `scripts/provider-intelligence-tests.js:9489` now cover cache-backed share export plus post-share cleanup.

Evidence before fix:

- `exportToJsonFile()` wrote the full portable backup JSON to `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}${filename}` before invoking `Sharing.shareAsync(...)`.
- Unlike `exportSkillFile()`, the portable backup export path had no `finally` cleanup for the share-staging file.
- The exported JSON contains conversations, settings, provider metadata, MCP state, context snapshots, and memory export data, so the share-staging artifact itself is a full backup, not just a derived preview.

Impact:

- A one-shot share action for a portable backup could leave a complete IsleMind backup JSON in persistent app documents storage even after the share sheet was dismissed or completed.
- This retained more sensitive data than necessary for the share workflow and made the lifecycle less strict than nearby export surfaces that already treat share files as temporary artifacts.

Fix:

- `portableData.ts` now checks `Sharing.isAvailableAsync()` before choosing the staging directory.
- When sharing is available, the backup JSON is staged in `cacheDirectory`, passed to `Sharing.shareAsync(...)`, and deleted in a `finally` block after the share flow completes.
- When sharing is unavailable, the function preserves the existing fallback of writing to `documentDirectory` when possible so offline/manual retrieval behavior is not regressed.
- The export result still returns the generated URI and the settings screen still shows the same completion notice shape; only the underlying staging location/lifecycle changes when share is available.

Validation:

- `node --check src/services/portableData.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js`
- `git diff --check -- src/services/portableData.ts scripts/provider-intelligence-tests.js src/i18n/resources/en.json src/i18n/resources/zh-CN.json src/i18n/resources/ja.json`
- Focused assertions now prove:
  - portable export uses a cache-backed JSON file when sharing is available,
  - the native share sheet receives that generated JSON file,
  - the shared JSON file is deleted after the share flow completes,
  - no cache-backed full-backup JSON is left behind after cleanup.

Residual risk:

- This slice intentionally keeps the current no-share fallback, which can still leave the backup JSON in `documentDirectory` when the platform has no share sheet available. Tightening that fallback further would be a separate product decision because it changes how users retrieve exports on such devices.
- Once the user explicitly shares or copies the exported backup outside the app, downstream persistence is outside IsleMind’s control by design.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `bun run test:architecture-boundary`
- `git diff --check`

Residual risk:

- These paths still rely on whole-file base64 conversion for accepted attachments and local recordings. A future modernization slice should evaluate streaming or chunked upload/transcription paths instead of raising the in-memory ceiling for larger media workflows.

### S-014: Runtime Diagnostics Logging Could Persist Credential-Bearing Endpoint Query Parameters

Severity: Medium

Location:

- `src/services/ai/providerRuntimeDiagnostics.ts:107` through `src/services/ai/providerRuntimeDiagnostics.ts:115` write `route.decision` runtime-log payloads that include the provider route decision object.
- `src/services/ai/providerRouter.ts:48` exposes `endpoint?: string` on `ProviderRouteDecision`.
- `src/services/ai/providerRouteAssembly.ts:72` builds Google provider endpoints with `?key=${encodeURIComponent(provider.apiKey)}`.
- `src/services/runtimeLog.ts:183` through `src/services/runtimeLog.ts:196` now redact sensitive query-string and plain-text credential assignments before JSONL persistence.
- `scripts/provider-intelligence-tests.js:1647` through `scripts/provider-intelligence-tests.js:1661` now verify runtime-log redaction of query-string API keys and token parameters.
- `scripts/provider-intelligence-tests.js:3624` through `scripts/provider-intelligence-tests.js:3633` now verify direct helper redaction for `endpoint` and plain `refresh_token=...` strings.

Evidence before fix:

- `buildProviderRouteDecisionLogData()` returned the full route decision object for runtime logging.
- `ProviderRouteDecision` includes the selected `endpoint`, and Google provider endpoints intentionally encode API keys in the query string.
- `appendRuntimeLog()` redacted explicit sensitive keys such as `authorization` or `apiKey`, but generic strings were only matched against bearer/OpenAI/GitHub/Google-token literals and did not normalize `?key=...`, `?token=...`, or `refresh_token=...` assignments before log-file writes.

Impact:

- When runtime logging was enabled, route-decision or adjacent diagnostic records could persist full provider endpoint strings that still contained credential-bearing query parameters. For Google provider routes, that meant a valid API key could be written into the app's runtime JSONL log file even though header-based secrets were already redacted.

Fix:

- Extended `redactString()` in `src/services/runtimeLog.ts` with deterministic normalization for sensitive query-string parameters and plain-text credential assignments before the existing token-pattern redaction runs.
- Kept the runtime log schema, event names, and route-decision payload structure stable; only the persisted string values are sanitized more aggressively.
- Preserved host/path visibility so diagnostics can still show which upstream surface was selected without leaking credential values.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check`
- Focused assertions now prove that:
  - `https://.../streamGenerateContent?...&key=<secret>` is persisted as `...&key=[redacted]`,
  - `https://proxy.example/chat?token=<secret>` is persisted as `?token=[redacted]`,
  - plain `refresh_token=<secret>` strings are redacted before persistence,
  - raw query-string key values do not appear in the runtime log fixture.

Residual risk:

- This patch intentionally targets credential-bearing query/assignment patterns without changing runtime-log event coverage or removing route-decision diagnostics entirely. If future providers introduce additional query-style secret names, extend the shared runtime-log redaction helper and keep the fixture coverage in `test:provider-intelligence`.

### S-015: Import Flows Left DocumentPicker Cache Copies Behind

Severity: Medium

Location:

- `src/services/fileImportGuards.ts:39` through `src/services/fileImportGuards.ts:58` now centralize temporary import-copy cleanup through `deleteTemporaryImportCopy()`.
- `src/services/portableData.ts:30` through `src/services/portableData.ts:50` record the picked import URI and clear the temporary picker copy in a `finally` block after restore success or rejection.
- `src/components/settings/SkillSettingsContent.tsx:155` through `src/components/settings/SkillSettingsContent.tsx:182` now clear the temporary picker copy after skill import attempts finish.
- `src/components/providers/ProviderSettingsContent.tsx:1346` through `src/components/providers/ProviderSettingsContent.tsx:1375` now clear the temporary picker copy after provider import file reads finish.
- `scripts/provider-intelligence-tests.js:3925` through `scripts/provider-intelligence-tests.js:3926` pin the skill/provider import source contracts, and `scripts/provider-intelligence-tests.js:8174` through `scripts/provider-intelligence-tests.js:8231` cover helper cleanup plus portable import cleanup on both rejection and success.

Evidence before fix:

- `importFromJsonFileDetailed()` in `src/services/portableData.ts` used `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, ... })`, read the copied file, and returned without deleting the cache copy.
- `SkillSettingsContent.importFromFile()` used `copyToCacheDirectory: true`, read the copied file, and returned without deleting the temporary import copy.
- `ProviderSettingsContent.importFromFile()` used `copyToCacheDirectory: true`, read the copied file into the provider import modal, and returned without deleting the temporary import copy.
- These paths can ingest provider connection text or full backup payloads that may contain API keys or other sensitive operator configuration, so cache retention is a privacy/safety issue even though the import UI itself is trusted.

Impact:

- Imported configuration text and full backup payloads could remain under the app cache after the one-shot import flow completed, failed, or was rejected by pre-read guards. This increases local exposure for sensitive provider credentials and expands the local retention surface beyond the import action itself.

Fix:

- Added `deleteTemporaryImportCopy()` to `src/services/fileImportGuards.ts` so import cleanup uses one shared helper instead of ad hoc file deletion.
- The helper remains conservative by default and only auto-deletes obvious cache copies; reviewed `DocumentPicker` callers that explicitly request `copyToCacheDirectory: true` pass `{ assumeTemporaryCopy: true }`.
- Portable backup import, skill import, and provider import now call the shared helper in `finally` blocks so cleanup runs after both successful reads and early file-size rejection paths.
- Knowledge import is intentionally not included in this slice because the current knowledge document metadata persists `sourceUri: asset.uri`, and deleting that picker copy immediately would leave stale provenance in the knowledge UI. That remains a separate follow-up candidate.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/fileImportGuards.ts src/services/portableData.ts src/components/settings/SkillSettingsContent.tsx src/components/providers/ProviderSettingsContent.tsx scripts/provider-intelligence-tests.js`
- Focused assertions now prove that:
  - the shared helper deletes an explicitly marked cache import copy,
  - the shared helper does not delete a non-cache document URI by default,
  - portable import deletes the picker copy after an oversized-file rejection,
  - portable import deletes the picker copy after a successful restore,
  - provider and skill import source paths both invoke the shared cleanup helper after file import.

Residual risk:

- `src/services/context.ts:251` still uses `copyToCacheDirectory: true` for knowledge import and then persists `sourceUri: asset.uri` into knowledge metadata. Cleaning that path safely requires a provenance-safe normalization pass before the picker copy can be deleted.

### S-016: Knowledge Import Persisted Temporary Picker Provenance And Left Retrieval Provenance Inconsistent

Severity: Medium

Location:

- `src/services/context.ts:252` through `src/services/context.ts:307` now retain the picked URI only for the import read, persist `asset.name` as the knowledge provenance label, and clear the temporary picker copy in a `finally` block.
- `src/services/contextStore.ts:238` through `src/services/contextStore.ts:247` now normalize stored knowledge-document provenance to a display-safe label instead of persisting picker cache URIs.
- `src/services/contextStore.ts:348` through `src/services/contextStore.ts:373` now carry document provenance through the legacy FTS retrieval path.
- `src/services/contextStore.ts:322` through `src/services/contextStore.ts:325` and `src/services/contextStore.ts:387` through `src/services/contextStore.ts:392` now normalize nullable knowledge-document fields before list/export boundaries.
- `src/services/localDataStore.ts:636` through `src/services/localDataStore.ts:657` now backfill retrieval `sourceUri` from `document_sources` for hybrid, vector, RAPTOR, GraphRAG, and ColBERT retrieval paths.
- `scripts/provider-intelligence-tests.js:8345` through `scripts/provider-intelligence-tests.js:8354` verify stable knowledge-import provenance, absence of stale `rawPath`, retrieval provenance continuity, and temporary picker-copy cleanup.

Evidence before fix:

- `importKnowledgeFile()` used `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, ... })`, read from `asset.uri`, and persisted `sourceUri: asset.uri` into imported knowledge metadata.
- The temporary picker copy was not safe to delete because the UI and citation surfaces used `document.sourceUri` as the visible provenance label.
- `searchKnowledge()` built FTS retrieval results directly from `knowledge_chunks` and did not join document-level provenance, so retrieval-source citations could drop `sourceUri` even when document metadata had it.

Impact:

- Knowledge imports could leave a temporary picker cache copy on disk after success, because deleting it immediately would have broken visible provenance by leaving stale `file:///tmp/...` metadata behind.
- The knowledge UI and retrieval/citation surfaces could expose ephemeral cache URIs as provenance instead of a stable source label.
- Retrieval provenance behavior diverged by path: document/list/export could carry one value while FTS retrieval sources returned none.

Fix:

- `importKnowledgeFile()` now persists `asset.name` as the reviewed provenance label for picker-backed imports and deletes the temporary picker copy in a `finally` block after success or rejection.
- `contextStore` now normalizes nullable knowledge-document fields at list/export boundaries so the public `KnowledgeDocument` shape stays aligned with optional-field semantics.
- The legacy `searchKnowledge()` FTS path now joins document provenance and emits stable `sourceUri` values, matching the already-reviewed document-source backfill in `localDataStore`.
- Public behavior remains the same for successful imports: text/PDF imports still succeed, chunk/index creation is unchanged, and provenance remains visible, but it is now stable and cache-safe.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/context.ts src/services/contextStore.ts src/services/localDataStore.ts scripts/provider-intelligence-tests.js`
- Focused assertions now prove that:
  - successful knowledge import persists `sourceUri === 'knowledge-import.txt'`,
  - exported knowledge documents do not persist the temporary picker cache URI as `rawPath`,
  - FTS retrieval results inherit the same stable provenance label,
  - the picker cache copy is deleted after successful import and after oversized-file rejection.

Residual risk:

- Picker-backed provenance is now normalized to a stable filename label, not a durable filesystem path or remote URL. If future product requirements need stronger provenance identity, that should be a separate metadata model change rather than reusing temporary picker URIs.
- Accepted knowledge files are still read fully into memory once they pass the shared 20 MB boundary; streaming or incremental document parsing remains a separate resource-hardening task.

### S-017: Document Attachment Import Left Picker Cache Copies On Disk

Severity: Medium

Location:

- `src/services/attachment.ts:85` through `src/services/attachment.ts:114` now keep the picked document URI only for bounded base64 conversion and clear the temporary picker copy in a `finally` block.
- `src/services/attachment.ts:9` through `src/services/attachment.ts:11` now route attachment size checks through the shared import-file guard, including metadata fallback when `DocumentPicker` omits `size`.
- `scripts/provider-intelligence-tests.js:8394` through `scripts/provider-intelligence-tests.js:8431` now verify cleanup after oversized rejection and after successful document attachment import.

Evidence before fix:

- `pickDocument()` used `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, ... })`, read the picked file into base64, and returned the attachment without deleting the temporary picker cache copy.
- When `DocumentPicker` omitted `size`, the oversized-file path failed late enough that the temporary picker copy still remained on disk after rejection.

Impact:

- Picked document attachments could leave user-selected text, PDF, or other attachment content in the app cache after the attachment payload had already been copied into memory for provider requests.
- Oversized attachment rejections also retained the temporary picker copy, so a failed import could still leave sensitive document content behind on disk.

Fix:

- `pickDocument()` now resolves file size through the shared import guard before any base64 read, preserving the existing 20 MB rejection behavior even when picker metadata is missing.
- The document attachment path now tracks the temporary picker URI and clears it in a `finally` block after success or rejection.
- The returned attachment shape remains unchanged, so chat composition and provider request assembly still receive the same `type`, `name`, `mimeType`, `size`, and `base64` fields.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/attachment.ts scripts/provider-intelligence-tests.js docs/architecture/security-scan-2026-06-17.md docs/architecture/modernization-and-ai-enhancement-plan.md`
- Focused assertions now prove that:
  - oversized size-less document attachments are rejected before any base64 read,
  - oversized attachment rejection deletes the temporary picker cache copy,
  - successful document attachment import still returns the expected text attachment payload,
  - successful attachment import deletes the temporary picker cache copy after in-memory conversion.

Residual risk:

- The current attachment persistence contract still strips `base64` before conversation storage while leaving metadata such as `uri`, `name`, and `mimeType`. Retry/replay semantics for persisted attachments are therefore a separate runtime-contract audit from this privacy cleanup slice.
- Accepted document attachments are still converted fully to base64 in memory once they pass the shared 20 MB boundary; chunked upload remains a separate behavior-changing task.

### S-018: Persisted Attachment Metadata Kept Stale Local URIs And Runtime Drift

Severity: Medium

Location:

- `src/services/attachmentContract.ts:1` through `src/services/attachmentContract.ts:29` now centralize attachment payload detection, runtime send filtering, and persistence-safe metadata normalization.
- `src/store/chatStore.ts:438` through `src/store/chatStore.ts:471` now sanitize loaded and persisted conversation attachments through the shared attachment contract helper.
- `src/services/storage.ts:205` through `src/services/storage.ts:229` now normalize imported/exported conversation attachments through the same persistence-safe attachment contract.
- `src/services/chatRunner.ts:531` through `src/services/chatRunner.ts:533` and `src/services/chatRunner.ts:701` through `src/services/chatRunner.ts:702` now derive runtime attachment behavior only from payload-bearing attachments.
- `src/services/tokenUsage.ts:15` through `src/services/tokenUsage.ts:18`, `src/services/ai/providerConformance.ts:639` through `src/services/ai/providerConformance.ts:645`, and `src/services/ai/providerRuntimeFallback.ts:28` through `src/services/ai/providerRuntimeFallback.ts:35` now ignore metadata-only historical attachments when estimating cost or required provider capabilities.
- `scripts/provider-intelligence-tests.js:5068` through `scripts/provider-intelligence-tests.js:5094` and `scripts/provider-intelligence-tests.js:5249` through `scripts/provider-intelligence-tests.js:5319` now verify sanitized attachment persistence, export behavior, token estimation, and runtime capability filtering.

Evidence before fix:

- `chatStore` persisted conversations by clearing `attachment.base64` but kept `attachment.uri`, so local `file:///tmp/...` attachment paths could remain in AsyncStorage, SQLite conversation snapshots, and portable exports.
- After reload/import, those attachments no longer had inline payloads, but `chatRunner` still treated `attachments.length > 0` as a live-attachment signal, disabling native provider search for the reply path.
- Provider fallback capability derivation, provider conformance modality checks, and estimated token usage all still counted metadata-only historical attachments even though request builders only embed attachments that still have `base64`.

Impact:

- Portable exports and local conversation persistence could retain stale local attachment paths that were no longer usable as file handles but still revealed prior filesystem/cache locations.
- Reloaded conversations with metadata-only attachments could drift at runtime by disabling native search, inflating estimated token usage, or demanding image/file fallback capability even when no sendable attachment payload remained.

Fix:

- Added `attachmentContract.ts` to distinguish payload-bearing attachments from historical display metadata.
- Persisted and imported/exported conversation attachments now clear inline payloads and scrub non-web local URIs while preserving user-visible metadata such as `name`, `type`, `mimeType`, and `size`.
- `chatRunner`, token estimation, provider conformance, and runtime fallback capability checks now use only payload-bearing attachments for runtime decisions.
- Public message and attachment shapes stay stable; the change only normalizes stale persisted metadata and removes runtime drift caused by metadata-only historical attachments.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/attachmentContract.ts src/store/chatStore.ts src/services/storage.ts src/services/chatRunner.ts src/services/tokenUsage.ts src/services/ai/providerConformance.ts src/services/ai/providerRuntimeFallback.ts scripts/provider-intelligence-tests.js docs/architecture/security-scan-2026-06-17.md docs/architecture/modernization-and-ai-enhancement-plan.md`
- Focused assertions now prove that:
  - portable conversation import strips `base64` and stale local attachment URIs before AsyncStorage and SQLite persistence,
  - portable export does not reintroduce stripped inline payloads or stale local attachment paths,
  - runtime fallback capability derivation ignores metadata-only historical attachments,
  - token estimation ignores persisted attachment metadata without payload but still counts live inline attachment payloads,
  - chat runtime derives sendable attachments from payload-bearing attachments only.

Residual risk:

- Historical attachments still remain visible as names/counts rather than reopenable local files after reload, which matches the current product contract but does not implement durable attachment replay.
- Restoring full persisted attachment resend support would require a separate product/API migration to store durable files or remote object handles instead of transient picker/cache paths.

### S-018B: Provider Base URLs Could Re-Enter Persisted State Through Portable Import Or Export Normalization

Severity: Low

Location:

- `src/services/storage.ts:317` through `src/services/storage.ts:342` now normalize provider `baseUrl` through `sanitizeProviderBaseUrl()` during portable import/export persistence.
- `scripts/provider-intelligence-tests.js:5454` through `scripts/provider-intelligence-tests.js:5472` now verify portable import persistence and later export behavior for embedded-credential provider base URLs.

Evidence before fix:

- Shared provider URL guards already rejected embedded `https://user:pass@host` inputs at the settings/runtime boundary.
- But `src/services/storage.ts` still normalized provider records with `provider.baseUrl?.trim() || undefined`, so hand-edited or restored portable payloads could write an embedded-credential provider base URL back into AsyncStorage.

Impact:

- A backup/restore path could reintroduce embedded-credential provider endpoints into persisted state even after the direct UI/runtime path had been hardened against them.

Fix:

- `src/services/storage.ts` now reuses `sanitizeProviderBaseUrl()` inside provider normalization.
- Portable provider imports still accept valid HTTP(S) endpoints, but embedded credentials are now dropped before the provider record is written.
- Later exports continue to reflect the normalized provider state and do not reintroduce the stripped embedded-credential URL.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check`
- Focused assertions now prove that:
  - `importAllDataDetailed()` strips embedded-credential provider base URLs before persistence,
  - `loadData('PROVIDERS')` returns the normalized provider state without the embedded-credential base URL,
  - `exportAllData()` does not reintroduce the embedded-credential provider base URL after persistence normalization.

### S-026: URL-Bearing Settings Could Re-Enter Persisted State Through Settings Writes Or Portable Backup Round-Trips

Severity: Medium

Location:

- `src/services/settingsUrlPolicy.ts:1` through `src/services/settingsUrlPolicy.ts:26` now centralize persistence-safe normalization for URL-bearing settings fields.
- `src/store/settingsStore.ts:176` through `src/store/settingsStore.ts:205` now sanitize loaded settings before in-memory use and write back migrated values when persisted settings contained unsafe URLs.
- `src/store/settingsStore.ts:221` through `src/store/settingsStore.ts:229` now sanitize settings updates before AsyncStorage persistence.
- `src/services/storage.ts:88` through `src/services/storage.ts:118` now sanitize exported settings snapshots before backup JSON is emitted.
- `src/services/storage.ts:128` through `src/services/storage.ts:137` now sanitize imported settings before backup restore writes `SETTINGS`.
- `scripts/provider-intelligence-tests.js:2838` through `scripts/provider-intelligence-tests.js:2861` and `scripts/provider-intelligence-tests.js:5518` through `scripts/provider-intelligence-tests.js:5548` now cover settings-store migration plus portable import/export normalization for unsafe settings URLs.

Evidence before fix:

- Runtime consumers already failed closed on unsafe values:
  - `src/services/searchPolicy.ts` rejects invalid or credential-bearing `customSearchEndpoint` values before fetch.
  - `src/services/ai/policy/proxyPolicy.ts` rejects invalid or non-web `proxyBaseUrl` values before proxy rewrite.
  - `src/services/localEmbeddingModels.ts` ignores invalid or non-web `localModelDownloadMirrorBaseUrl` values before mirror fallback.
- But `src/store/settingsStore.ts` still persisted `updateSettings()` payloads directly, and `src/services/storage.ts` still imported/exported raw `settings` payloads unchanged.

Impact:

- AsyncStorage and portable backups could retain embedded-credential or non-web settings URLs that no longer passed the runtime guard, leaving secrets or invalid destinations in persisted state.
- A restored backup could repeatedly reintroduce unsafe settings values, forcing every runtime consumer to reject them again instead of clearing them at the persistence boundary.

Fix:

- Added `src/services/settingsUrlPolicy.ts` as the shared persistence-layer sanitizer for `customSearchEndpoint`, `localModelDownloadMirrorBaseUrl`, and `proxyBaseUrl`.
- `settingsStore.load()` now migrates persisted settings through the shared sanitizer before in-memory use and writes the normalized values back to `SETTINGS` when legacy persisted values were unsafe.
- `settingsStore.updateSettings()` now sanitizes URL-bearing settings fields before saving to AsyncStorage, preserving valid HTTP(S) values and normalizing invalid values to the current empty-string UI convention.
- Portable import/export now runs settings through the same shared sanitizer, so backups no longer round-trip unsafe values back into persisted state.

Validation:

- `node --check src/services/settingsUrlPolicy.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence` now passes in the current worktree after the focused settings-url persistence slice and the existing app-update logging assertions run together under the same harness.
- Source/readback evidence confirms the shared sanitizer is wired into:
  - settings load migration,
  - settings update persistence,
  - portable import,
  - portable export.

Residual risk:

- This slice intentionally keeps the current UI/storage convention of normalizing invalid URL-bearing settings fields to `''` rather than changing those fields to `undefined` or introducing a new validation-error persistence shape.
- Other future settings fields that may become network destinations should be added to `settingsUrlPolicy.ts` instead of duplicating inline sanitizers.

### S-019: Image Attachment Compression Left Temporary Payload Copies On Disk And Mixed Original-Cleanup Semantics

Severity: Medium

Location:

- `src/services/attachment.ts:30` through `src/services/attachment.ts:62` now track `originalUri` and `compressedUri` for `pickImage()`.
- `src/services/attachment.ts:66` through `src/services/attachment.ts:97` now track the same lifecycle for `takePhoto()`.
- `src/services/attachment.ts:142` through `src/services/attachment.ts:153` now centralize conservative image attachment cleanup in `cleanupImageAttachmentCopies()`.
- `scripts/provider-intelligence-tests.js:8589` through `scripts/provider-intelligence-tests.js:8659` now verify successful picker cleanup, oversized picker rejection cleanup, and conservative camera-path cleanup.

Evidence before fix:

- `pickImage()` and `takePhoto()` compressed the original image into a new temporary file, converted that compressed copy into base64, and returned the compressed URI in the attachment payload.
- The compressed output URI was not centrally cleaned after payload extraction, so the app could leave a redundant image copy on disk even though runtime behavior only needed the in-memory `base64` payload plus user-visible metadata.
- Original-image cleanup behavior was not clearly centralized, increasing the chance that future picker and camera paths would drift or become overly aggressive about deleting non-temporary originals.

Impact:

- Picked or captured images could leave compressed temporary copies on disk after the app had already extracted the attachment payload into memory for provider requests.
- Cleanup semantics for the original image path were easy to misread or duplicate, which raised the risk of either retaining more temp copies than intended or accidentally deleting a non-temporary original URI in a future edit.

Fix:

- Added `cleanupImageAttachmentCopies()` in `src/services/attachment.ts` and routed both `pickImage()` and `takePhoto()` through it in `finally` blocks.
- The cleanup helper always deletes the compressed output via `deleteTemporaryImportCopy(..., { assumeTemporaryCopy: true })`, because the compressed file is app-created temp output.
- The original image URI still goes through the conservative default `deleteTemporaryImportCopy(originalUri)` path, so only cache-backed or temp-looking originals are removed while non-cache originals remain untouched.
- Attachment return shape and current runtime behavior stay stable: the user still gets the same image attachment fields, and current chat/runtime paths still depend on `base64` plus metadata rather than reopening the returned `uri`.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/attachment.ts scripts/provider-intelligence-tests.js docs/architecture/security-scan-2026-06-17.md docs/architecture/modernization-and-ai-enhancement-plan.md`
- Focused assertions now prove that:
  - successful image picking deletes the compressed temp output after payload extraction,
  - oversized image rejection clears the cache-backed original picker copy before any base64 read,
  - successful camera capture deletes the compressed temp output,
  - successful camera capture does not delete a non-cache original image URI while still cleaning the compressed temp file.

Residual risk:

- Returned image attachments still carry the compressed temp `uri`, even though the current runtime path depends on `base64` and name rather than reopening that file. Durable attachment replay remains a separate attachment-contract migration.
- Accepted images are still fully converted to base64 in memory once they pass the existing size boundary. Chunked image upload or durable attachment storage would be separate behavior-changing tasks.

### S-020: MCP Tool Identity Matching Could Resolve Ambiguous Bare Names To The Wrong Server

Severity: Medium

Location:

- `src/services/chatMcpToolIdentityUtils.ts:8` through `src/services/chatMcpToolIdentityUtils.ts:40` now centralize enabled-tool selection and request identity resolution.
- `src/services/chatMcpContextUtils.ts:17` through `src/services/chatMcpContextUtils.ts:24` now route MCP context selection through the shared identity helper.
- `src/services/chatToolResultUtils.ts:28` through `src/services/chatToolResultUtils.ts:31` now route tool lookup through the same helper.
- `scripts/provider-intelligence-tests.js:3189` through `scripts/provider-intelligence-tests.js:3262` now verify explicit, unique-bare, and ambiguous-bare MCP tool identity behavior.

Evidence before fix:

- `collectResolvedMcpTools()` accepted bare tool names and included every enabled tool whose `tool.name` matched the string.
- `findMcpTool()` fell back to the first bare-name match when `serverId` was absent, even if multiple servers exposed the same `tool.name`.
- MCP tool selection therefore depended on manifest ordering rather than an explicit identity boundary whenever a tool request did not carry a server qualifier.

Impact:

- A bare MCP tool request like `search` could resolve nondeterministically when more than one server exposed the same tool name.
- That ambiguity could route a tool call to the wrong server or make a later manifest reorder change runtime behavior without any user-visible identity change.

Fix:

- Added `chatMcpToolIdentityUtils.ts` to centralize tool identity matching.
- Explicit `serverId:toolName` and `serverId/toolName` references still resolve exactly as before.
- Bare tool names now resolve only when they are unique across enabled tools; ambiguous bare names are refused instead of picking the first match.
- Existing single-server or unique-name behavior remains stable, so ordinary tool selection still works without requiring a broader UI or protocol change.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- src/services/chatMcpToolIdentityUtils.ts src/services/chatMcpContextUtils.ts src/services/chatToolResultUtils.ts scripts/provider-intelligence-tests.js docs/architecture/security-scan-2026-06-17.md docs/architecture/modernization-and-ai-enhancement-plan.md`
- Focused assertions now prove that:
  - explicit `serverId:toolName` selection still works,
  - a bare name still resolves when it is unique,
  - a bare name is rejected when multiple servers expose the same tool.

Residual risk:

- Bare MCP tool names still remain a supported convenience path for unique tool names. A stricter future policy could require server-qualified references everywhere, but that would be a separate behavior change.
- The identity helper does not change MCP tool permission handling or manifest refresh; it only closes the ambiguous lookup path.

### S-021: Agent Workflow Tool Identity Matching Could Bind Ambiguous Bare Names To The Wrong Tool

Severity: Medium

Location:

- `src/services/agent/agentToolIdentityUtils.ts:3` through `src/services/agent/agentToolIdentityUtils.ts:17` now centralize unique agent tool lookup.
- `src/services/agent/agentToolRegistry.ts:253` through `src/services/agent/agentToolRegistry.ts:254` now route runtime tool resolution through the shared helper.
- `src/services/agent/agentWorkflowDefinitions.ts:68` through `src/services/agent/agentWorkflowDefinitions.ts:79` now validate workflow steps through the shared helper.
- `src/services/agent/agentWorkflowSkills.ts:1042` through `src/services/agent/agentWorkflowSkills.ts:1048` now route workflow-skill permission-ceiling inference through the same helper.
- `scripts/provider-intelligence-tests.js:3263` through `scripts/provider-intelligence-tests.js:3450` now verify unique, ambiguous, source-scoped, server-scoped, tool-id, and workflow-skill suggestion identity cases.

Evidence before fix:

- Agent tool lookup already preferred `toolId`, but bare-name lookup still accepted the first matching manifest when no server/source qualifier was present.
- Workflow validation delegated to the same lookup path, so a workflow step with a bare tool name could pass against one manifest order and fail or bind differently after a manifest reorder.
- Workflow skill suggestion generation also reused first-match lookup when deriving a workflow permission ceiling from completed run steps, so a saved workflow could inherit the wrong ceiling if a same-name tool with higher permission appeared first.

Impact:

- A workflow definition using only `name: "search"` could become order-dependent if multiple enabled tools shared that name.
- The validation boundary would not reliably fail closed on ambiguous references, which weakens workflow review and can make exported workflow definitions drift from their intended tool target.
- Permission-ceiling inference for generated workflow skills could drift upward or downward based on manifest order instead of the actual uniquely reviewed tool target.

Fix:

- Added `agentToolIdentityUtils.ts` to centralize tool resolution across runtime and validation paths.
- Routed workflow-skill permission-ceiling inference through the same shared helper so generated workflow suggestions inherit the same unique-match rule.
- Explicit `toolId` references still win.
- Explicit `source` and/or `serverId` filtering still works as before.
- Bare tool names now resolve only when exactly one manifest matches; ambiguous bare names return `null` and fail validation.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check -- scripts/provider-intelligence-tests.js src/services/agent/agentWorkflowSkills.ts src/services/agent/agentToolIdentityUtils.ts src/services/agent/agentToolRegistry.ts src/services/agent/agentWorkflowDefinitions.ts docs/architecture/security-scan-2026-06-17.md docs/architecture/modernization-and-ai-enhancement-plan.md`
- Focused assertions now prove:
  - unique bare agent tool names still resolve,
  - ambiguous bare agent tool names are refused,
  - explicit source/server scoping still resolves correctly,
  - explicit `toolId` still takes precedence,
  - workflow validation fails closed for ambiguous bare tool references,
  - workflow-skill suggestion permission ceilings no longer drift from ambiguous bare tool names.

Residual risk:

- Bare-name agent tool references remain supported for unique matches. A stricter future policy could require explicit ids in every workflow, but that would be a separate compatibility task.
- This slice does not alter agent permission handling or runtime execution semantics beyond the identity boundary.

### S-022: APK Installer Download And Launch Failures Left Cached APK Files Behind

Severity: Medium

Location:

- `src/services/appUpdates.ts:143` through `src/services/appUpdates.ts:205` now validate installer URLs with `safeHttpUrl()`, track the staged APK URI, and delete the cache file on HTTP failure or installer-launch failure.
- `src/services/appUpdates.ts:389` through `src/services/appUpdates.ts:431` still verify size and checksum, and keep deleting the staged APK when validation fails.
- `scripts/provider-intelligence-tests.js:8533` through `scripts/provider-intelligence-tests.js:8628` cover checksum mismatch, HTTP download failure, invalid URL refusal, and installer-launch failure cleanup.

Evidence before fix:

- `downloadAndOpenApkInstaller()` deleted the staged APK only on checksum/size verification failure.
- If `FileSystem.downloadAsync()` returned a non-2xx response or `IntentLauncher.startActivityAsync()` threw after a successful download, the cached file could remain on disk.
- The installer flow also accepted any non-empty `apkUrl` or manifest asset URL string before parse-time validation, which made non-web installer destinations less explicit than the rest of the repo's outbound URL boundaries.

Impact:

- Failed APK update attempts could leave staged binaries in the app cache longer than intended.
- The leftover file risk was small but real because APKs are large, sensitive artifacts that should be removed when installation does not complete.

Fix:

- Added shared HTTP(S) validation to the APK installer path through `safeHttpUrl()`.
- The downloader now deletes the staged file after HTTP failure and after installer-launch failure, while leaving the successful handoff path unchanged.
- Manifest `releaseUrl`, manifest asset `url`, and GitHub asset `browser_download_url` now use the same explicit web-URL guard as the installer `apkUrl`.

Validation:

- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- `git diff --check`
- Focused assertions now prove:
  - checksum mismatches delete the cached APK,
  - HTTP download failures delete the cached APK,
- invalid non-web APK URLs fail before download,
- installer-launch failures delete the cached APK.

### S-023: Remote Speech Playback Left Cached TTS Files Behind After Natural Completion

Severity: Low

Location:

- `src/services/speech.ts:12` now tracks the active provider-audio playback subscription alongside the player and temp-file URI.
- `src/services/speech.ts:80` through `src/services/speech.ts:87` now clear the playback-status subscription during `stopSpeaking()`.
- `src/services/speech.ts:95` through `src/services/speech.ts:110` now listen for `playbackStatusUpdate` and delete the cached MP3 when `didJustFinish` is emitted.
- `scripts/provider-intelligence-tests.js:9004` through `scripts/provider-intelligence-tests.js:9028` cover replacement cleanup, explicit stop cleanup, and natural-finish cleanup.

Evidence before fix:

- `playProviderSpeechBase64()` wrote a provider-generated MP3 into `cacheDirectory` and tracked the active URI.
- Cleanup only happened through `stopSpeaking()`, which was reached on manual stop or when a later playback replaced the current player.
- If provider speech simply finished on its own, the temp file could remain on disk until another playback event or manual stop happened later.

Impact:

- Provider TTS output is transient app-created media, so retaining the temp file after successful playback was an avoidable privacy and cache-hygiene gap.

Fix:

- `speech.ts` now subscribes to the Expo Audio player's `playbackStatusUpdate` event.
- When `didJustFinish` becomes true, the service removes the event subscription, releases the player object, and deletes the cached MP3 immediately.
- `stopSpeaking()` now also clears the active status subscription before pausing/removing the player, keeping explicit-stop behavior aligned with natural completion.

Validation:

- `node --check src/services/speech.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `bun run test:provider-intelligence`
- Focused assertions now prove:
  - starting a new provider speech playback deletes the previous cached TTS file,
  - explicit `stopSpeaking()` deletes the active cached TTS file,
  - a `playbackStatusUpdate` with `didJustFinish: true` deletes the cached TTS file and leaves no temp clip behind.

### S-024: Local Model Download Lifecycle Could Leave Orphaned Temporary Or Backup Directories In Persistent Storage

Severity: Low

Location:

- `src/services/localEmbeddingModels.ts:188` now clears stale same-model temp/backup directories before a new download session starts.
- `src/services/localEmbeddingModels.ts:284` now clears stale same-model temp/backup directories during explicit downloaded-model deletion.
- `src/services/localEmbeddingModels.ts:477` through `src/services/localEmbeddingModels.ts:492` now centralize stale local-model directory cleanup in `cleanupStaleModelDirectories()`.
- `scripts/provider-intelligence-tests.js:9838` through `scripts/provider-intelligence-tests.js:9908` now cover stale-directory cleanup during successful download and explicit model deletion.

Evidence before fix:

- `downloadLocalEmbeddingModel()` already wrote new model files into a timestamped `${modelId}.tmp-*` directory and atomically swapped the verified directory into `${modelId}/`.
- `replaceDownloadedModelDirectory()` only knew about the current call's `tempDirectory` and one transient `backupDirectory`.
- `deleteDownloadedLocalEmbeddingModel()` only deleted the active `${modelId}/` directory and removed the state record.
- If an earlier download or replace flow was interrupted after creating `${modelId}.tmp-*` or `${modelId}.bak-*`, no later maintenance path revisited those orphaned directories.

Impact:

- Local embedding models live under app document storage rather than cache storage, so stale `.tmp-*` and `.bak-*` directories could persist longer than intended after interrupted download or replacement flows.
- The leftover files did not change active model selection, but they could retain redundant model artifacts on disk and complicate future storage reviews.

Fix:

- Added `cleanupStaleModelDirectories()` in `src/services/localEmbeddingModels.ts`.
- Before starting a new download, the service now enumerates the model root and removes stale same-model `${modelId}.tmp-*` and `${modelId}.bak-*` directories from earlier interrupted runs.
- Explicit downloaded-model deletion now reuses the same cleanup helper so removing a model also clears orphaned temp/backup siblings for that model id.
- The download contract, final directory name, checksum verification path, and selected-model behavior remain unchanged.

Validation:

- `node --check src/services/localEmbeddingModels.ts`
- `node --check scripts/provider-intelligence-tests.js`
- `node scripts/provider-intelligence-tests.js`
- `git diff --check -- src/services/localEmbeddingModels.ts scripts/provider-intelligence-tests.js`
- Focused assertions now prove:
  - successful model download clears stale `${modelId}.tmp-*` directories from earlier interrupted downloads,
  - successful model download clears stale `${modelId}.bak-*` directories from earlier interrupted replacements,
  - successful download still publishes the verified files into the stable `${modelId}/` directory,
  - explicit downloaded-model deletion removes the active model directory and same-model orphan temp/backup siblings.

Residual risk:

- This slice intentionally does not add age-based sweeping for unrelated model ids or a global document-directory janitor; it only clears same-model orphan directories at the points where the user already downloads or deletes that model.
- If future product requirements need background storage reclamation across all model ids, that should be a separate maintenance task with explicit UX and scheduling rules.

## Validated Existing Hardening

### H-001: Provider And Search Keys Use Secure Storage

Evidence:

- `src/store/settingsStore.ts:144` and `src/store/settingsStore.ts:157` define secure key helpers for provider/search credentials.
- `src/store/settingsStore.ts:362` through `src/store/settingsStore.ts:426` route provider and search API key writes/reads through secure storage.
- `src/services/ai/secureKey.ts:11` through `src/services/ai/secureKey.ts:61` provides provider and credential-group secure-key helpers.
- `src/services/secureStorage.ts:22` and `src/services/secureStorage.ts:34` are the secure item write/delete boundaries.

Assessment:

- Reviewed provider credential paths do not store raw API keys in normal AsyncStorage provider metadata when following current store APIs. Backup/import paths should continue to preserve that invariant.

### H-002: Trace, Storage, And MCP Output Redaction Exists

Evidence:

- `src/utils/traceSafety.ts:22` redacts sensitive text, and `src/utils/traceSafety.ts:55` sanitizes process traces at boundaries.
- `src/store/chatStore.ts:495` sanitizes traces before store insertion.
- `src/services/storage.ts:282` through `src/services/storage.ts:288` redact trace title/content/metadata during export normalization.
- `src/services/mcp.ts:152` through `src/services/mcp.ts:157` truncates and redacts MCP text blocks.
- `src/services/mcp.ts:333` through `src/services/mcp.ts:347` sanitizes MCP call results.

Assessment:

- The reviewed paths have explicit redaction layers before UI/persistence/export boundaries. Continue adding tests when introducing new trace metadata fields.

## Follow-Up Findings And Review Items

### R-001: Outbound Fetch Surfaces Should Keep Destination Ownership Clear

Severity: Low to Medium, context-dependent.

Evidence:

- Provider networking is centralized through `src/services/ai/providerHttp.ts:10`.
- S-003 now gates custom proxy URL schemes before provider traffic reuses them as effective upstream destinations.
- MCP server calls are centralized through `src/services/mcp.ts:211`.
- Search adapters call Tavily, Google, Bing-compatible, or custom endpoints in `src/services/searchAdapters.ts:39`, `src/services/searchAdapters.ts:63`, `src/services/searchAdapters.ts:80`, and `src/services/searchAdapters.ts:97`.
- S-002 now gates user-configured custom/Bing-compatible search endpoints to HTTP(S) before those search paths attach service credentials.
- App update checks call fixed release endpoints in `src/services/appUpdates.ts:206` and `src/services/appUpdates.ts:226`.

Recommendation:

- Keep provider/MCP/search/update/download clients as separate destination-owned boundaries. S-002 adds the search endpoint scheme guard, S-003 adds the proxy scheme guard, S-005 adds MCP stored/imported endpoint scheme enforcement, S-006 adds mirror-download endpoint scheme enforcement, and S-007 adds update-feed/install URL scheme enforcement; future work should add per-boundary destination-ownership tests before expanding user-provided base URLs, proxy presets, MCP transports, mirror hosts, update hosts, or search host presets.

### R-002: WebView Source Viewer Should Stay Isolated From Authenticated Contexts

Severity: Low after S-001 fix.

Evidence:

- The only reviewed WebView usage is the source viewer in `app/source.tsx`.
- S-001 now gates initial source URLs and navigations to web schemes only.

Recommendation:

- Do not add cookies, Authorization headers, injected JavaScript, file access, or local HTML rendering to this WebView without a new threat model and tests.

### R-003: Continue Dead-Code And Oversized-Module Refactors In Small Passes

Security relevance:

- Oversized orchestration files make sink review harder and increase accidental policy bypass risk.

Current modernization candidates:

- `src/services/ai/base.ts`: provider runtime orchestration remains the largest security-sensitive surface.
- `src/services/chatRunner.ts`: chat/RAG/MCP/tool-loop orchestration remains coupled.
- `src/components/chat/ChatWorkspace.tsx`: UI actions still bridge into provider/model tests and agent follow-ups.
- Import file readers now share a size guard, but pasted/imported text budgets still need broader UX review before expanding large-document workflows.

Next safe refactor slice:

- Extract more pure policy helpers with focused tests while keeping public APIs stable, following the pattern used for `src/utils/sourceUrlSafety.ts` and the provider base-url guard now living beside `getProviderConfigIssue()`.

## Verification Plan

Run in this order when resources permit:

1. `bun run test:provider-intelligence`
2. `bun run test:architecture-boundary`
3. `bun run type-check -- --pretty false`
4. `git diff --check`

If full type-check remains noisy because of unrelated current worktree changes, treat the focused provider-intelligence assertions and source/search/proxy/provider-base-url readbacks as the primary evidence for S-001, S-002, S-003, and S-004.
