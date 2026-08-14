<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind app icon">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  A local-first, provider-controlled Android AI workspace.
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · English · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>Current version: 1.0.15 (Android versionCode 115)</strong><br>
  <a href="https://github.com/domidoremi/IsleMind/releases">Versions and release notes</a>
</p>

> [!IMPORTANT]
> Current GitHub Releases do not publish APKs, checksum files, or other build artifacts. Releases mark source versions and record their corresponding changes. Build the app locally from source if you need to run it.

## What IsleMind Is

IsleMind is for people who want direct control over model providers, conversation data, and working context. It does not provide a hosted AI account. Instead, it brings provider configuration, chat, knowledge retrieval, task execution, and structured work artifacts into one mobile workspace.

**Android** is the primary development and validation platform. The repository retains Expo iOS configuration, but does not claim a published or device-regression-tested iOS release.

## Core Capabilities

- **Providers and models**: Configure API keys, base URLs, protocols, models, and capability switches. Presets cover OpenAI, Anthropic, Gemini, xAI, DeepSeek, Qwen, GLM, and OpenAI/Anthropic-compatible endpoints.
- **Conversation workspace**: Manage multiple conversations, streaming replies, reasoning state, citations, attachments, and copyable content with explicit in-progress, success, and failure feedback.
- **Knowledge and context**: Manage knowledge documents, personal memory, conversation context, and retrieval indexes on-device, with a diagnosable fallback when local models are unavailable.
- **Tasks and workflows**: Break longer work into trackable steps while preserving cancellation, recovery, tool authorization, and execution-evidence boundaries.
- **Structured work artifacts**: Turn model replies into deliverable results with Quality gates, executable actions, copyable handoffs, and continuation prompts.
- **System feedback**: Surface important operation state through in-app Toast/Banner UI, status layers, and Android notifications instead of silent success or failure.

## Privacy and Network Boundaries

Conversations, settings, knowledge indexes, personal context, and provider configuration are stored locally by default. The following user-triggered actions can create external requests:

- Sending inference, model discovery, embedding, transcription, or speech requests to the provider selected by the user.
- Downloading a local-model resource explicitly selected by the user.
- Checking remote versions on GitHub.
- Running a network tool or integration explicitly enabled by the user.

Provider credentials are kept in secure storage and are not written to portable JSON exports. Remove API keys, tokens, private base URLs, and personal content before posting issues, logs, or screenshots.

## Run Android From Source

### Requirements

- [Bun 1.3.14](https://bun.sh/) (`bun.lock` is the only dependency lockfile)
- Node.js (required by project scripts and the Expo CLI entry point)
- JDK 17
- Android SDK, Platform Tools, and ADB
- An Android emulator or a USB-debuggable physical device

### Install and start

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

With an Android device connected:

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <device-name> --no-bundler
```

Start Metro in another terminal:

```powershell
bun run start --localhost
```

If USB reverse port forwarding is not used, configure a development-server address that the device can reach over the current network.

## Validation

Run at least the checks that match the scope of your change:

```powershell
bun run type-check
bun run test:provider-intelligence
bun run test:architecture-boundary
bun run test:vnext-architecture-contract
```

Changes to Android UI, native plugins, notifications, file-system behavior, or packaging also require focused emulator or physical-device validation. Source checks are not a substitute for device evidence.

## Architecture

IsleMind is migrating incrementally toward its vNext boundaries:

```text
app/               Expo Router routes and page entry points
src/modules/       Business-owner domain and application modules
src/core/          Shared pure contracts
src/platform/      Reusable platform infrastructure
src/bootstrap/     Composition root and concrete adapter binding
src/presentation/  Presentation controllers and view models
src/components/    React Native components
plugins/           Expo and Android native configuration plugins
assets/            Runtime assets, brand sources, and model catalog
scripts/           Validation, audit, build, and evidence scripts
```

Read these documents before changing architecture:

- [vNext architecture refactor plan](../architecture/islemind-vnext-architecture-refactor-plan.md)
- [vNext module public API](../architecture/vnext-module-public-api.md)
- [Current vNext migration status](../architecture/vnext-migration-status.md)

New business behavior belongs in the owning `src/modules/<owner>/`. Cross-module imports must use the owner's public entry point. Concrete adapters are bound in `src/bootstrap/`; `src/services/` is only a legacy compatibility boundary with an explicit deletion condition.

## Versioning and Releases

- The project uses one [Semantic Versioning](https://semver.org/) version.
- `package.json`, `app.json`, and the Git tag must agree. Tags use `vX.Y.Z`.
- `0.x.x` identifies progressive early pre-releases; `1.x.x` and later identify formal releases.
- Every GitHub Release must contain release notes that match the actual changes in that version.
- Current GitHub Releases publish source-version markers only; no APK, checksum file, or other build artifact is attached.
- A version update does not intentionally erase local conversations, knowledge, memory, or provider configuration. Any persistence migration must be documented separately.

## Repository Hygiene

- Keep product code, documentation, and runtime assets in `src/`, `docs/`, and `assets/`. Do not place temporary screenshots or exports in the repository root.
- Keep local logs, test reports, Playwright output, screenshots, APKs, AABs, and temporary evidence in ignored locations.
- Never commit API keys, signing keys, tokens, private configuration, sensitive device logs, or download caches.
- Before deleting an asset, verify that runtime code, build scripts, and documentation do not reference it. Design sources that must remain belong in a clearly named `assets/brand/source/` path.
- Use Bun for dependency installation and do not generate or commit another package-manager lockfile.

## Assets and Attribution

- Isle UI is a React Native adaptation of [animal-island-ui](https://github.com/guokaigdg/animal-island-ui), published by `guokaigdg` under CC BY-NC 4.0. IsleMind does not directly bundle its React DOM package, CSS, fonts, or image assets.
- Optional local models are recorded in [assets/models/catalog.json](../../assets/models/catalog.json); source and attribution notes are in [assets/models/NOTICE.md](../../assets/models/NOTICE.md).
- Current brand sources live in `assets/brand/source/`; runtime-generated assets live in `assets/brand/generated/` and the Expo icon paths.

## Contributing

Before opening a report, search existing [Issues](https://github.com/domidoremi/IsleMind/issues). Include reproducible steps, platform/device details, the app version, and sanitized logs. Architecture or persistence changes should also describe compatibility, migration, and rollback boundaries.
