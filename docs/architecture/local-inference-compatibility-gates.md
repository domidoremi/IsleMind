# Local Inference Compatibility Gates

## Scope

Local and LAN inference is a priority direction for IsleMind, but desktop/server runtimes must stay optional. This gate evaluates local inference servers as explicit service targets before IsleMind expands runtime routing, model discovery, or local-network setup flows.

Local gate:

- Schema: `islemind.local-inference-compatibility-eval.v1`
- Service: `src/services/localInferenceCompatibilityEvaluation.ts`
- Script: `scripts/local-inference-compatibility-tests.js`
- Package entry: `bun run test:local-inference-compatibility`

Runtime families:

- Ollama
- llama.cpp server
- LM Studio
- LocalAI
- vLLM
- SGLang

These are optional desktop, server, or LAN targets. They are not React Native runtime dependencies.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `ollama-openai-compatible` | Ollama OpenAI-compatible LAN server | Records docs, base URL, chat/model/embedding endpoints, model metadata, structured output, reasoning, streaming, opt-in, timeout, and server-runtime boundary. |
| `llama-cpp-server` | llama.cpp OpenAI-compatible server | Records GGUF-style local server model metadata, chat/model/embedding endpoints, and LAN opt-in. |
| `lm-studio-openai-compatible` | LM Studio local server | Records OpenAI-compatible chat, models, embeddings, Responses route, tools, structured output, and reasoning capabilities. |
| `localai-audio-and-grammar` | LocalAI server | Records text, tools, embeddings, audio transcription, speech, and grammar-backed structured output while requiring a grammar adapter before app request controls expand. |
| `vllm-gpu-server` | vLLM OpenAI-compatible GPU server | Records GPU/server requirements, chat, models, embeddings, tools, structured output, reasoning, and Responses route. |
| `sglang-reasoning-server` | SGLang OpenAI-compatible server | Records tools, structured output, embeddings, vision, and separate reasoning-output support. |
| `mobile-loopback-warning` | Mobile app configured with localhost | Blocks mobile `localhost` assumptions because loopback points at the phone, not the user's desktop server. |
| `model-list-fallback` | Local server with failed model listing | Requires explicit manual model fallback instead of silently assuming a model. |
| `memory-pressure-boundary` | Oversized local server candidate | Blocks when RAM/VRAM requirements exceed available resources. |

## Diagnostic Contract

Each diagnostic records:

- runtime family and source,
- protocol and base URL,
- official docs,
- endpoint shape,
- client platform and host kind,
- mobile reachability,
- explicit LAN opt-in,
- readiness,
- timeout,
- RAM/VRAM requirements,
- model-list status and model metadata,
- manual-model fallback policy,
- declared and blocked capabilities,
- risk codes.

## Adoption Rule

Before adding local-network inference setup, automatic local-runtime detection, new local provider presets, or runtime-specific request controls, this gate must pass and be extended for the new behavior. Mobile loopback and resource-pressure failures should stay blocked with visible diagnostics. LAN or remote local-runtime access must remain explicit user opt-in.
