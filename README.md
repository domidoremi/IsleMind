# IsleMind

English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

IsleMind is a local-first mobile AI workspace for focused conversations, private provider setup, reusable personal context, and knowledge-assisted chat.

## Highlights

- Chat with configurable AI providers and models.
- Keep conversations, settings, and local context on your device.
- Import knowledge with Agentic RAG: hybrid search, semantic chunking, local rerank, citations, and graceful fallback.
- Download optional local embedding models in the app, or use the hash embedding fallback with no model files.
- Trace source, retrieval, and process details when reviewing model output.
- Update Android builds through GitHub Release APKs.

## Download

Download the latest Android APK from [GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest), then install it on your device. Release notes include direct download links for each APK variant.

Current app version: `1.0.3`.

Release APKs are split by local model bundle:

- `no-model`: default build, no local model files bundled.
- `with-model-small`: bundles `all-MiniLM-L6-v2` for local embedding.

Release APKs are also split by Android architecture:

- `arm64-v8a`: 64-bit ARM devices.
- `x86_64`: 64-bit x86 devices.
- `armeabi-v7a`: 32-bit ARM devices.
- `universal`: widest compatibility, larger file.

The app can also download and verify local RAG models from the local model page.

## Android 16 KB Page Size

Release builds run `npm run apk:validate-16kb`, which checks APK ZIP page alignment with `zipalign -P 16` and inspects native library ELF `LOAD` segment alignment with `llvm-readelf`. ZIP alignment is controlled by the Android build; ELF alignment depends on the native libraries shipped by Expo, React Native, ONNX Runtime, and other dependencies. If the validator reports a third-party `.so` with 4 KB `LOAD` alignment, update or rebuild that dependency before marking the APK fully compatible with Android 16 KB page-size devices.

## Local RAG Models

IsleMind's default APK does not include model weights. Optional local models are listed in `assets/models/catalog.json`; detailed source and attribution notes are in `assets/models/NOTICE.md`.

Current catalog entries are ONNX distributions published by Xenova on Hugging Face, with upstream model families from `sentence-transformers` and BAAI. Model files are not authored by IsleMind contributors. Review the upstream model cards and licenses before redistribution.

## Privacy

IsleMind is local-first. Conversations, settings, context index data, Agentic RAG indexes, and provider configuration stay on the device unless you export/import JSON, download a local model, or send content to a configured AI provider. Secure provider keys are not included in JSON exports.

## Updates

IsleMind currently uses APK cold updates only. The in-app updater checks the latest GitHub Release APK, downloads it on Android, and opens the system installer so you can confirm installation.
