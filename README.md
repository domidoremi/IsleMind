<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="IsleMind icon">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  A local-first, provider-controlled AI workspace for Android
</p>

<p align="center">
  English · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a>
</p>

## What IsleMind is

IsleMind is a React Native + Expo Android app that puts model providers, conversations, knowledge, memory, and agentic tooling into a single, offline-capable workspace. It treats your data as yours: conversations, settings, and provider credentials stay on the device unless you explicitly wire up a network call.

## Capabilities at a glance

- **Model provider management** – API keys, base URLs, protocols, and capability switches; discovery, bulk import, availability checks, usage queries, and runtime diagnostics.
- **Protocol compatibility** – OpenAI, Anthropic, Gemini, xAI, DeepSeek, Qwen, GLM, and OpenAI/Anthropic-compatible relays.
- **Conversation workbench** – Multi-session chat, streaming replies, reasoning state, source citations, attachments, drafts, message actions, and generation lifecycle.
- **Knowledge and context** – Import documents, manage personal memory and conversation context, run retrieval-augmented generation with local embedding models.
- **Agents and tasks** – Step state, cancel/resume, tool authorization, execution evidence; structured artifacts include quality gates, copyable handoffs, and continuation prompts.
- **Tools and integrations** – MCP, Skills, built-in workspace tools, web retrieval, speech, and Android device capabilities. Network features are user-configured or explicitly enabled.
- **Themes and languages** – Minimal, Monet, Material 3, and Liquid Glass themes with light, dark, system, and custom-accent modes. The UI ships in English, Simplified Chinese, and Japanese.
- **Android experience** – Safe-area and keyboard handling, background notifications, in-app update checks, runtime diagnostics, and recovery entry points.

## Data and network boundaries

Everything except explicit network calls is local by default:

- conversations, settings, knowledge indexes, personal context, provider configuration
- provider credentials (stored in system secure storage; portable JSON exports never include API keys)

Network access is limited to:

- AI inference, model discovery, embeddings, transcription, and speech
- local-model resource downloads
- GitHub version checks
- user-enabled networking, MCP servers, and third-party integrations

## Current release

| Item | Value |
|---|---|
| Version | `v1.0.24` |
| Android `versionCode` | `124` |
| Latest installable APK | `v1.0.21` (`v1.0.22`–`v1.0.24` are source-only) |

- [Read the v1.0.24 notes](https://github.com/domidoremi/IsleMind/releases/tag/v1.0.24)
- [Download the v1.0.21 APK and checksums](https://github.com/domidoremi/IsleMind/releases/tag/v1.0.21)
- [All releases and localized changelog](https://github.com/domidoremi/IsleMind/releases)

### v1.0.24 highlights

- Established the root English README as the canonical engineering reference.
- Added root-level Simplified Chinese and Japanese translations with direct language navigation.
- Consolidated release guidance around local-first operation, network boundaries, development setup, and validation.
- Published this version as source-only, with no APK or generated build assets.

### APK variants

- `no-model` – Smallest build; no bundled local embedding model.
- `with-model-small` – Includes a small local RAG embedding model.
- `universal-64` – Use when you are unsure of the device ABI; verify integrity with the shipped `.sha256` files.

## Development environment

- [Bun 1.4.2](https://bun.sh/) for dependencies and scripts
- Node.js **24.21.0** for selected project scripts
- Eclipse Temurin **25.0.4.1+1** (mise version `temurin-25.0.4+101.0.LTS`)
- Android SDK and Platform Tools (ADB)
- Android emulator or a USB-debuggable device

`bun.lock` is the authoritative lockfile. Do not mix package managers.

Install the pinned tools with `mise install` and run commands through `mise exec --`
when the shell has not activated mise. `node scripts/android-build-toolchain.js`
verifies Node/Bun and records the exact Android JDK without reading application
credentials. Android builders prefer the project-managed JDK and reject an
unqualified `ISLEMIND_ANDROID_JAVA_HOME` override; a Java 25 major alone is not
sufficient. Run raw Gradle commands through mise as well, rather than inheriting
an unrelated `JAVA_HOME`. The build-only Expo plugin pins the Gradle 9.3.1
distribution checksum again after native regeneration.

## Get the source

```bash
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

## Run on Android

Start Metro:

```bash
bun run start --localhost
```

Connect a device and launch:

```bash
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <device-name> --no-bundler
```

## Repository structure

```text
app/               Expo Router routes and entry points
src/core/          Shared pure types, protocols, and base contracts
src/modules/       Business modules and public APIs
src/platform/      Storage, network, and native platform adapters
src/bootstrap/     Dependency wiring and runtime composition root
src/presentation/  Presentation controllers and use-case bridges
src/components/    React Native UI components
scripts/           Tests, audits, diagnostics, and local release scripts
plugins/           In-repo Expo and Android native plugins
docs/              Architecture, migration status, and localized docs
```

Architecture boundaries are enforced by:
- [IsleMind architecture](docs/architecture/architecture.md)
- [Module public API](docs/architecture/module-public-api.md)

[Technology radar and assimilation](docs/technology-radar.md) tracks evidence-based technology choices, new product opportunities, and sunset conditions.

## Validation commands

```bash
bun run test --runInBand
bun run type-check
bun run test:architecture-boundary
bun run test:architecture-contract
bun run test:walking-skeleton
bun run test:task-runtime
bun run test:provider-intelligence
bun run test:product-mobile-layout
bun run test:release-readiness-compatibility
```

`bun run test` runs the native SQLite repository suites under Bun, then the
React Native/unit suites under Jest. `bun run test:sqlite` runs just the real
SQLite boundary. Direct `jest` and `test:watch` cover only the Jest partition;
use the combined command for the complete unit suite. No SQLite assertions are
replaced with mocks or skipped in the combined run.

### Isolated availability qualification

Model-availability history uses Android-calibrated 7-day/500-record retention,
50-row pages (100 maximum), 8-row write/cleanup batches and an 8 KiB normalized
observation budget. Current lifecycle evidence and discovery catalog coverage are
not capped by history retention. Both current/history rows are virtualized.

For authorized M2007J3SC qualification, use
`scripts/build-native-availability-apk.js --stage <new-outside-repository-directory>`.
It regenerates native files without copying the working Android project or production
signing material, then builds the debug-signed `qualification` variant with optimized
bundled Hermes and no developer-server dependency. Production `release` is unchanged.
Only the qualification build pins CMake to `RelWithDebInfo`, matching the release
React Native dependencies while keeping the test app inspectable with `run-as`.

The default package is `com.islemind.stage9`, without INTERNET permission. `--network`
builds `com.islemind.stage9.network` with INTERNET for explicitly authorized networking
qualification; pass the same flag to the collector. Neither profile grants permission
to send provider credentials, make paid requests or mutate the production app.

On an installed non-debuggable production app, use
`scripts/collect-native-availability-evidence.js --mode qualification --serial SERIAL --adb <resolved-adb> --apk <qualification-apk> --out <evidence-root> --isolated-install-authorized`.
Add `--update-test-package` only to authorize replacement of an existing test package.
This mode writes and reads a fresh fixture database, hashes the actual private test
file, restarts only the test app and verifies the same SQLite rows and integrity.
`scripts/validate-native-availability-evidence.js <evidence-root> --qualification`
validates that probe. Its scoped verdict explicitly leaves production private-file
preservation and full C4 **not certified**; public package/APK identity is still checked.

The strict offline C4 path retains `inspect`, `install`, and the `calibration`, `bounds`,
`startup`, `recovery`, `final` (with `--profile`) and `retention` suites. Its verifier
without `--qualification` still requires complete native, preservation and host
receipts. A release package that denies `run-as` remains blocked for private-file
preservation; qualification never changes its debuggability. See the
[architecture qualification contract](docs/architecture/architecture.md#isolated-availability-qualification).
Generated receipts belong under `test-evidence/qa/provider-model-availability-android/`.
They do not certify another device or a production-signed release.

### Current APK device targeting

`test:current-apk-smoke` force-stops and launches the installed app; it is not a host-only
test. Use it only on an explicitly authorized target. `QA_DEVICE_SERIAL` must name exactly
one connected device in the ready `device` state. Only an **unset** value defaults to
`emulator-5554`; blank, whitespace/control-containing, missing, unready or duplicate targets
fail without device commands. Inventory order never selects a replacement, and subsequent
ADB operations remain pinned with `-s` if the target disconnects.

Target selection does not prove APK freshness or device authorization. Existing installed
APK/provenance, launch and 16 KB checks still apply. The release-readiness compatibility
suite exercises targeting with fake ADB and in-memory receipts, without touching devices.

`release:install-current-apk` shares the exact ready-target rule. It accepts one
`--device SERIAL` or `--device=SERIAL`, which takes precedence over `QA_DEVICE_SERIAL`,
and optional `--keep-data`. Empty, malformed, repeated or unsupported arguments fail
before ADB; an invalid CLI target never falls back to the environment or default.
Without CLI/environment selection, only `emulator-5554` is eligible, never the first device.

**The installer uninstalls the existing app by default, deleting its app-local data.**
Use this clean path only with explicit data-deletion authorization on the selected target.
`--keep-data` skips uninstall and uses `adb install -r`; it does not prove a clean install.
Neither targeting nor artifact preflight authorizes deletion.

Both installer modes require a readable, nonempty regular APK, a matching single-digest
`.sha256` sidecar, consistent app/package version configuration, and a readable
`.source-snapshot.json` whose APK digest/byte count and source inputs match the admitted
artifact and current tree. Missing, unreadable or stale evidence fails before uninstall/install;
a recent APK timestamp alone is insufficient. Smoke and QA provenance enforce the same binding.

Source snapshots use `islemind.release-source-snapshot.v1`. Local builds also emit a
`build` record with schema `islemind.release-build-source-capture.v1`: `build.inputs` are the
literal prepared-variant inputs, while top-level `inputs` are the exact final workspace used
for freshness comparison. Only the catalog/format-validated model-bundle generation and
restoration may differ between those sets. Generated source, including its timestamp, is
checked in both; it is not exempt from freshness. Release builds restore `no-model`, while
debug builds retain their selected bundle as before.

Content/path checks surround Gradle attempts (including failures/retries), output copying,
validation and publication. Copied APK identity is captured before restoration and rechecked
before publication. Source changes cannot become a fresh retry baseline. Restoration still
runs after build failures, and combined failures preserve both causes. Signing validation
precedes sidecar publication; failed qualification cannot reach optional installation.

Legacy/unversioned snapshots and cached receipts without a matching binary binding cannot
qualify as current; rebuild from the intended sources and recollect evidence. The standalone
snapshot writer, including the current CI invocation, remains compatible but supplies only
post-build observations, not this local build-window record. Do not regenerate a snapshot
over an old/unqualified APK merely to pass a gate. Snapshot publication uses an exclusive
temporary file and same-directory rename; failures do not replace a preceding snapshot with
partial evidence.

Installation consumes an independently staged temporary copy, not the mutable build path.
Hashing uses a bounded 1 MiB buffer; receipts retain the admitted digest and original
artifact identity/time. Cleanup runs on success and failure, with cleanup errors surfaced.
This is checksum/source-input preflight, not APK manifest/signature/16 KB validation,
trusted source-to-binary build attestation, or transactional Android installation. The binding
identifies observed bytes, not a trusted/reproducible build. Local build checks observe the
enumerated inputs at boundaries; they do not isolate compilation from transient edit/revert
races or cover every generated native file/model binary. A later package-manager failure can
still follow authorized clean deletion; abrupt host termination can leave a temporary copy.
It does not protect against same-user tampering with that copy.
Do not assume other collectors share these targeting or argument-validation policies.

Focused host-only provenance checks (no ADB or QA evidence writes):

```bash
node scripts/release-readiness-compatibility-tests.js
node scripts/qa-coverage-audit.js --self-test=release-provenance
node scripts/provider-intelligence-tests.js --focus=release-contracts
```

## Assets and attribution

- Isle UI is a React Native adaptation of [animal-island-ui](https://github.com/guokaigdg/animal-island-ui); upstream license is CC BY-NC 4.0.
- Local model catalog: [assets/models/catalog.json](assets/models/catalog.json)
- Model sources and attribution: [assets/models/NOTICE.md](assets/models/NOTICE.md)
- Brand sources: `assets/brand/source/`
- Runtime brand assets: `assets/brand/generated/`
