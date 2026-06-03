# IsleMind

English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

IsleMind is a local-first mobile AI workspace for focused conversations, private provider configuration, reusable personal context, knowledge-assisted chat, and structured work artifacts.

## Capability Boundary

- Provides chat sessions with user-configured AI providers and models.
- Stores conversations, settings, local context, knowledge indexes, and provider metadata on the device by default.
- Sends content upstream only when a configured AI provider is selected for inference, embedding, transcription, speech, or model discovery.
- Imports knowledge through Agentic RAG with semantic chunking, hybrid search, local rerank, citations, and fallback behavior.
- Supports optional local embedding models; the hash embedding fallback keeps retrieval available when model files are absent or unavailable.
- Records source, retrieval, token usage, provider trace, and process details for review where supported by the provider runtime.
- Converts model replies into structured work artifacts with quality gates, executable actions, copyable handoffs, and continuation prompts.
- Updates Android builds through GitHub Release APKs.

## Release Download

Download the Android APK from [GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest), then install the variant that matches the target device architecture and local model requirement. Release notes include direct download links for each APK variant.

Current app version: `1.0.6`.

## APK Variants

Release APKs are split by local model bundle:

- `no-model`: default build, no local model files bundled.
- `with-model-small`: bundles `all-MiniLM-L6-v2` for local embedding.

Release APKs are also split by Android architecture:

- `arm64-v8a`: 64-bit ARM devices.
- `x86_64`: 64-bit x86 devices.
- `universal-64`: includes both 64-bit ARM and 64-bit x86 native libraries.
- `armeabi-v7a-legacy`: legacy 32-bit ARM devices only.

The app can also download and verify local RAG models from the local model page when model files are not bundled in the installed APK.

## Android 16 KB Page Size

Release builds run `bun run apk:validate-16kb`. The validator checks APK ZIP page alignment with `zipalign -P 16` and inspects native library ELF `LOAD` segment alignment with `llvm-readelf`. ZIP alignment is controlled by the Android build. ELF alignment depends on the native libraries shipped by Expo, React Native, ONNX Runtime, and other dependencies. If the validator reports a third-party `.so` with 4 KB `LOAD` alignment, that dependency must be updated or rebuilt before the APK is marked compatible with Android 16 KB page-size devices.

Current release packaging builds `universal-64` from only `arm64-v8a` and `x86_64`. The main universal APK does not include 32-bit native libraries. The separate `armeabi-v7a-legacy` APK is kept only for legacy 32-bit devices and is not part of Android 16 64-bit page-size validation.

## UI Attribution

IsleMind includes Isle UI, a React Native adaptation of the `animal-island-ui` component language. The upstream project is authored by `guokaigdg`, published under MIT, and documented at <https://github.com/guokaigdg/animal-island-ui>. IsleMind does not vendor the upstream React DOM package, CSS modules, fonts, or image assets. The local implementation is adapted for Expo/React Native, mobile safe areas, reduced motion, and IsleMind theme tokens. See `src/components/ui/isle/README.md`.

## Local RAG Models

IsleMind's default APK does not include model weights. Optional local models are listed in `assets/models/catalog.json`; detailed source and attribution notes are in `assets/models/NOTICE.md`.

Current catalog entries include ONNX distributions published by Xenova on Hugging Face, with upstream model families from `sentence-transformers` and BAAI. Model files are not authored by IsleMind contributors. Redistribution requires review of the upstream model cards and licenses.

## Privacy Boundary

IsleMind is local-first. Conversations, settings, context index data, Agentic RAG indexes, and provider configuration stay on the device unless you export/import JSON, download a local model, or send content to a configured AI provider. Secure provider keys are not included in JSON exports.

## Update Policy

IsleMind currently uses APK cold updates only. The in-app updater checks the latest GitHub Release APK, downloads it on Android, and opens the system installer so you can confirm installation.

## Development Commands

This repository uses `bun.lock`; local scripts default to Bun commands.

- `bun install`: installs dependencies from `bun.lock` and runs the ONNX Runtime Android 16 KB patch during `postinstall`.
- `bun run type-check`: validates TypeScript with `tsc --noEmit`.
- `bun run doctor`: runs `expo-doctor`.
- `bun run test:provider-intelligence`: runs provider routing, model, policy, and release contract checks.
- `bun run test:qa-audit:self`: runs the QA audit self-test path.
- `bun run apk:local`: builds a local Android debug APK without bundled model files.
- `bun run apk:local:release`: builds a local Android release APK without bundled model files.
- `bun run apk:local:release:all`: builds all local Android release APK variants.
- `bun run apk:validate-16kb`: validates APK ZIP and native library alignment for Android 16 KB page-size compatibility.

## Technology Stack

- Application runtime: Expo SDK `~54.0.35`, React Native `0.81.5`, React `19.1.0`, Expo Router `~6.0.24`, and TypeScript `~5.9.2` in strict mode.
- Mobile targets: Android APK release builds with EAS profiles; iOS configuration exists in Expo app metadata.
- UI and motion: NativeWind `^4.2.4`, Tailwind CSS `^3.4.19`, Isle UI, `lucide-react-native`, `moti`, React Native Reanimated, Gesture Handler, Safe Area Context, Screens, SVG, and Expo Blur.
- Local storage and device APIs: AsyncStorage, Expo SecureStore, Expo SQLite, Expo FileSystem, Expo Document Picker, Expo Image Picker, Expo Clipboard, Expo Sharing, Expo Application, Expo Constants, Expo Haptics, Expo Audio, and Expo Speech.
- AI provider runtime: OpenAI, Anthropic, Google Gemini, Xiaomi MiMo, OpenAI-compatible providers, and custom compatible endpoints. Presets include DeepSeek, DashScope/Qwen, Zhipu/GLM, xAI, OpenRouter, NewAPI/OneAPI, and Sub2API.
- Retrieval and local models: Agentic RAG services, ONNX Runtime React Native, local embedding model catalog, bundled/downloaded model verification, Xenova and BAAI model sources, and hash embedding fallback.
- Localization: i18next, React i18next, Expo Localization, and `en`, `zh-CN`, `ja` resource files.
- Release and validation tooling: Node.js scripts, Expo/EAS APK packaging, Android ABI split configuration, `zipalign -P 16`, `llvm-readelf`, QA coverage audit, release artifact contract, release freshness contract, and provider runtime smoke scripts.
