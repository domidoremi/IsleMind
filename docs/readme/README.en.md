<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind app icon">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  A local-first, provider-controlled Android AI workspace
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · English · <a href="README.ja.md">日本語</a>
</p>

## What is IsleMind?

IsleMind brings model providers, conversations, knowledge and memory, agent tasks, and tool integrations into one mobile workspace. Android is the primary platform. The product emphasizes local data ownership, explicit network boundaries, and recoverable AI execution.

## Core capabilities

- **Model provider management**: Configure API keys, base URLs, protocols, models, and capability switches, with model discovery, bulk import, availability checks, usage queries, and runtime diagnostics.
- **Broad protocol compatibility**: Use OpenAI, Anthropic, Gemini, xAI, DeepSeek, Qwen, GLM, and OpenAI-compatible or Anthropic-compatible relay endpoints.
- **Conversation workspace**: Manage multiple conversations, streaming replies, reasoning state, source citations, attachments, drafts, message actions, and generation status.
- **Knowledge and personal context**: Import knowledge documents, maintain personal memory and conversation context, and use local indexes and embedding models for retrieval augmentation.
- **Agents and task execution**: Track step state, cancellation and recovery, tool authorization, and execution evidence; structured work artifacts include Quality gates, copyable handoffs, and continuation prompts.
- **Tools and integrations**: Connect MCP servers, Skills, built-in workspace tools, web retrieval, speech, and Android device capabilities. Network features are configured or explicitly enabled by the user.
- **Themes and languages**: Choose Minimal, Monet, Material 3, or Liquid Glass themes with light, dark, system, and custom-accent modes. The interface supports Simplified Chinese, English, and Japanese.
- **Android experience**: Includes safe-area and keyboard handling, background status notifications, in-app update checks, runtime diagnostics, and recovery entry points.

## Data and network boundaries

Conversations, settings, knowledge indexes, personal context, and provider configuration are stored locally by default. Provider credentials use system secure storage, and portable JSON exports do not include API keys.

The following operations access the network:

- AI inference, model discovery, embeddings, transcription, and speech services;
- local-model resource downloads;
- GitHub version checks;
- user-enabled network tools, MCP servers, and third-party integrations.

## Current release

- Stable release: `v1.0.21`
- Android: `versionCode 121`
- [Download v1.0.21 APKs and checksums](https://github.com/domidoremi/IsleMind/releases/tag/v1.0.21)
- [View all Releases and localized version history](https://github.com/domidoremi/IsleMind/releases)

### v1.0.21 highlights

- Unified in-app notification delivery to prevent duplicate provider-import and status messages.
- Improved message bubbles, model generation status, thinking-summary interaction, provider icons, and mobile layout.
- Improved bulk provider import with endpoint-based provider naming while preserving each credential's original label.
- Published `no-model` and `with-model-small` APK variants for `universal-64`, `arm64-v8a`, `armeabi-v7a-legacy`, and `x86_64`.

### APK selection

- `no-model`: smaller package without a bundled local embedding model.
- `with-model-small`: includes the small local RAG embedding model.
- When unsure about the device architecture, choose the matching `universal-64` variant; use the `.sha256` files to verify downloads.

## Development environment

- [Bun 1.3.14](https://bun.sh/) for dependency installation and scripts
- Node.js for selected project scripts
- JDK 25
- Android SDK
- Android Platform Tools / ADB
- Android emulator or a USB-debuggable device

`bun.lock` is the authoritative dependency lockfile. Do not use another package manager to update dependencies.

## Get the source

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

## Run on Android

Start Metro:

```powershell
bun run start --localhost
```

Connect an Android device and start the app:

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <device-name> --no-bundler
```

## Repository structure

```text
app/              Expo Router pages and route entry points
src/core/         Shared pure types, protocols, and base contracts
src/modules/      Business modules and their public APIs
src/platform/     Storage, network, and native platform adapters
src/bootstrap/    Dependency wiring and runtime composition root
src/presentation/ Presentation controllers and use-case bridges
src/components/   React Native interface components
scripts/          Tests, audits, diagnostics, and local release scripts
plugins/          In-repository Expo and Android native plugins
docs/             Architecture, migration status, and localized docs
```

The [IsleMind architecture](../architecture/architecture.md) and [module public API](../architecture/module-public-api.md) define the architecture boundaries.

## Common validation

```powershell
bun run type-check
bun run test:architecture-boundary
bun run test:architecture-contract
bun run test:walking-skeleton
bun run test:task-runtime
bun run test:provider-intelligence
bun run test:product-mobile-layout
```

## Assets and attribution

- Isle UI is a React Native adaptation of [animal-island-ui](https://github.com/guokaigdg/animal-island-ui); the upstream license is CC BY-NC 4.0.
- Local model catalog: [assets/models/catalog.json](../../assets/models/catalog.json)
- Model sources and attribution: [assets/models/NOTICE.md](../../assets/models/NOTICE.md)
- Brand sources: `assets/brand/source/`
- Runtime brand assets: `assets/brand/generated/`
