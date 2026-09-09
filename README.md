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
- Node.js for selected project scripts
- JDK 25
- Android SDK and Platform Tools (ADB)
- Android emulator or a USB-debuggable device

`bun.lock` is the authoritative lockfile. Do not mix package managers.

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

[Technology radar and assimilation](docs/architecture/technology-radar.md) tracks evidence-based technology choices, new product opportunities, and sunset conditions.

## Validation commands

```bash
bun run type-check
bun run test:architecture-boundary
bun run test:architecture-contract
bun run test:walking-skeleton
bun run test:task-runtime
bun run test:provider-intelligence
bun run test:product-mobile-layout
```

## Assets and attribution

- Isle UI is a React Native adaptation of [animal-island-ui](https://github.com/guokaigdg/animal-island-ui); upstream license is CC BY-NC 4.0.
- Local model catalog: [assets/models/catalog.json](assets/models/catalog.json)
- Model sources and attribution: [assets/models/NOTICE.md](assets/models/NOTICE.md)
- Brand sources: `assets/brand/source/`
- Runtime brand assets: `assets/brand/generated/`
