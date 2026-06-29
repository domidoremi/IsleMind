# AI Technology Landscape

## Scope

- Snapshot date: 2026-06-14.
- Coverage: current hot AI repositories, mature production libraries, and technology families relevant to IsleMind.
- This document is a technology radar, not a dependency manifest.
- A listed project does not imply runtime adoption. Adoption requires license review, platform fit, security review, measurable quality improvement, and fallback behavior.

## IsleMind Position

IsleMind must remain a local-first, controlled, explainable, and cancellable mobile AI workspace.

Current repository evidence:

- `src/services/context.ts` calls `runAgenticRag()` and routes retrieval through local data store search functions.
- `src/services/localDataStore.ts` exposes `searchHybrid()` and `searchAgenticIndexes()`.
- `src/services/ragEvaluation.ts` defines the local `islemind.rag-retrieval-eval.v1` benchmark for baseline, hybrid, and agentic retrieval, citation coverage, context precision, fallback reasons, empty-index behavior, missing/corrupted embedding models, provider embedding fallback, and local embedding fallback.
- `src/services/contextPlanner.ts` defines versioned context fragments and assembly manifests for token budgets, source hashes, compact decisions, cache diagnostics, and raw-text-free runtime events.
- `src/services/contextRuntime.ts` wraps retrieval, web, and MCP context into authority-tagged envelopes before planner injection.
- `src/services/contextEngineeringCompatibilityEvaluation.ts` defines the local `islemind.context-engineering-compatibility-eval.v1` gate for long-context assembly, retrieval provenance, memory review, permissioned tool outputs, remote compact fallback, cache reuse, manifest observability, unbounded context blocking, raw context blocking, and authority-leak blocking.
- `src/services/agentWorkflowCompatibilityEvaluation.ts` defines the local `islemind.agent-workflow-compatibility-eval.v1` gate for runtime state machines, direct chat bypass, pending confirmations, step-limit pause/resume, cancellation recovery, RAG evidence repair, work-artifact quality audit, handoff/diagnostic output, runtime trace observability, and blocked autonomous-loop, hidden-tool, background-continuation, and unsafe-resume paths.
- `src/services/agent/agentSecurityEvaluation.ts` defines the local `islemind.agent-security-eval.v1` gate and `islemind.agent-security-runtime-summary.v1` summary for prompt injection, tool misuse, malformed arguments, MCP schema drift, provider-native tool replay, saved-workflow tampering, RAG citation drift, and provider fallback behavior.
- `src/services/mcp.ts` refreshes `tools/list`, `resources/list`, and `prompts/list`.
- `src/services/pluginManifest.ts` defines `islemind.plugin.v1` and `islemind.plugin-catalog.v1` manifests for imported workflow skills, MCP server references, explicit hook points, permission review, bounded catalog snapshots, and raw-prompt-free runtime events.
- `src/services/ai/providerRuntimeGateway.ts` emits the `islemind.provider-runtime-gateway-outcome.v1` gateway outcome for ready and blocked provider runtime paths, route snapshot links, structured-output decisions, sanitized error traces, and `provider.gateway.outcome` runtime events.
- `src/services/ai/providerRuntimeHealth.ts` exposes `islemind.provider-runtime-health-view.v1` health views for provider route success, rate-limit cooldown, circuit opening, recovery, credential-group scoping, and bounded provider-health snapshots.
- `src/services/ai/providerFailover.ts` resolves `islemind.provider-failover-decision.v1` decisions for retryable trigger classification, policy blocks, candidate rejection, cross-provider confirmation, region/cost preservation, and secret-free selected routes.
- `src/services/ai/providerFallbackCandidates.ts` builds `islemind.provider-fallback-candidate-build.v1` candidate sets from provider models, credential groups, compatibility contracts, aliases, health records, and bounded per-provider model expansion.
- `src/services/ai/providerOperationResult.ts` exposes the `islemind.provider-operation-result.v1` compatibility marker for stable provider operation result shape, HTTP/status classification, request-id extraction, and redacted provider error summaries.
- `src/services/toolCallingGateway.ts` emits the `islemind.tool-calling-gateway-outcome.v1` gateway outcome for MCP, provider-native tools, and structured output.
- `src/services/toolCallingCompatibilityEvaluation.ts` defines the local `islemind.tool-calling-compatibility-eval.v1` gate for MCP contracts, provider-native function calls, structured-output separation, Android confirmations, RAG tool outputs, output budgets, replay reconciliation, ambiguous names, malformed arguments, destructive confirmation, and raw-command blocking.
- `src/services/mcpCompatibilityEvaluation.ts` defines the local `islemind.mcp-compatibility-eval.v1` gate for MCP server archetypes, malformed manifests, transport failures, and destructive tool refusal.
- `src/services/memoryGovernanceEvaluation.ts` defines the local `islemind.memory-governance-eval.v1` gate for memory source attribution, review, retention, conflict, retrieval-boundary, and deletion behavior.
- `src/services/localInferenceCompatibilityEvaluation.ts` defines the local `islemind.local-inference-compatibility-eval.v1` gate for Ollama, llama.cpp, LM Studio, LocalAI, vLLM, and SGLang service targets.
- `src/services/executionLayerCompatibilityEvaluation.ts` defines the local `islemind.execution-layer-compatibility-eval.v1` gate for MCP/plugin control surfaces, Android native APIs, ONNX workers, external CLI workers, remote job runners, and blocked raw shell paths.
- `src/services/reasoningRuntimeCompatibilityEvaluation.ts` defines the local `islemind.reasoning-runtime-compatibility-eval.v1` gate for provider-native reasoning controls, response-side reasoning traces, bounded verifier loops, tool self-checks, and blocked prompt-only or unbounded reasoning paths.
- `src/services/runtimeBudgetGovernanceCompatibilityEvaluation.ts` defines the local `islemind.runtime-budget-governance-compatibility-eval.v1` gate for token, cost, latency, timeout, retry/circuit-breaker, stream-idle, cancellation, fallback, local resource, tool-loop, observability budget ledger, and blocked unbounded retry, missing timeout, fallback escalation, no-cancellation, unmetered tool-loop, and unbounded local-resource paths.
- `src/services/multimodalWorkflowCompatibilityEvaluation.ts` defines the local `islemind.multimodal-workflow-compatibility-eval.v1` gate for image chat, document ingestion, audio transcription, speech output, realtime voice, video frame workers, screen understanding, provider modality overclaims, raw media retention, and unbounded media payloads.
- `src/services/realtimeInteractionCompatibilityEvaluation.ts` defines the local `islemind.realtime-interaction-compatibility-eval.v1` gate for push-to-talk transcription, provider realtime duplex transport, barge-in, turn taking, streaming transcript boundaries, speech cancellation/cleanup, offline voice-note fallback, visible text fallback, and blocked missing-permission, unbounded-audio, non-interruptible, raw-retention, and cross-session audio-state paths.
- `src/services/modelRoutingCompatibilityEvaluation.ts` defines the local `islemind.model-routing-compatibility-eval.v1` gate for cheap/local/strong/vision/tool routing, structured-output model gating, visible fallback, privacy blocks, budget blocks, and provider-state replay blocks.
- `src/services/providerProtocolCompatibilityEvaluation.ts` defines the local `islemind.provider-protocol-compatibility-eval.v1` gate for official, relay, hosted, local-runtime, Responses, Chat Completions, Anthropic Messages, Gemini generateContent, HTTP/SSE, Responses WebSocket, signed hosted requests, model-list policy, same-provider state, and blocked generic-overclaim, missing-hosted-scope, cross-provider replay, and unsupported WebSocket paths.
- `src/services/providerRequestShapingCompatibilityEvaluation.ts` defines the local `islemind.provider-request-shaping-compatibility-eval.v1` gate for provider-native reasoning/tools/schema/search/multimodal fields, token normalization, cache/compact state, relay declarations, privacy blocks, visible downgrade, and generic-compatible overclaim blocking.
- `src/services/providerModelLifecycleCompatibilityEvaluation.ts` defines the local `islemind.provider-model-lifecycle-compatibility-eval.v1` gate for provider model-list sync, suppression, manual fallback, alias resolution, deprecation replacement, hosted deployment identity, local runtime models, capability admission, custom endpoint declarations, and blocked universal `/models`, stale alias, deprecated model, capability-flattening, and cross-provider alias-state paths.
- `src/services/credentialGovernanceCompatibilityEvaluation.ts` defines the local `islemind.credential-governance-compatibility-eval.v1` gate for provider-key storage, credential-group scope, model-scoped selection, credential health routing, imported secret restore, hosted auth scope, observability sink consent, proxy URL sanitization, runtime diagnostics redaction, portable export secret elision, reset cleanup, and blocked plaintext, URL credential, diagnostics leak, cross-provider replay, and no-consent observability paths.
- `src/services/providerStateIsolationCompatibilityEvaluation.ts` defines the local `islemind.provider-state-isolation-compatibility-eval.v1` gate for session-affinity keys, credential-group binding TTL, Responses previous-response scope, compact-state provider/model scope, provider-tool replay, session leases, fallback state policy, diagnostics, and blocked cross-provider response replay, cross-model cache continuation, stale affinity binding, replay-id mismatch, raw state export, and unbounded session state.
- `src/services/runtimePrivacyRetentionCompatibilityEvaluation.ts` defines the local `islemind.runtime-privacy-retention-compatibility-eval.v1` gate for runtime-log opt-in, byte retention, clear/delete behavior, runtime-event bounds, high-frequency token suppression, payload and URL redaction, portable export sanitization, reset/restore cleanup, observability sink consent, and blocked raw diagnostics, raw media retention, unbounded logs, high-frequency persistence, export leaks, and reset artifact retention.
- `src/services/structuredOutputCompatibilityEvaluation.ts` defines the local `islemind.structured-output-compatibility-eval.v1` gate for provider-native schemas, typed tools, blocked/fallback paths, and parser validation.
- `src/services/observabilityCompatibilityEvaluation.ts` defines the local `islemind.observability-compatibility-eval.v1` gate, `islemind.runtime-event.v1` bridge, `islemind.observability-sink-export.v1` sink export contract, and `islemind.observability-sink-policy.v1` opt-in policy for trace spans, source event provenance, eval outcomes, metrics, high-frequency suppression, repair replay, target-specific hints, attribute budgets, and privacy redaction.
- `src/services/productExperienceCompatibilityEvaluation.ts` defines the local `islemind.product-experience-compatibility-eval.v1` gate for first-run setup, provider activation progress, model unavailable recovery, capability-driven controls, chat error deduplication, long-running task feedback, data reset confirmation, offline local fallback, and blocked silent failure, repeated toast, and destructive reset paths.
- `src/services/releaseReadinessCompatibilityEvaluation.ts` defines the local `islemind.release-readiness-compatibility-eval.v1` gate for source stability, APK freshness, release manifests, URL safety, artifact integrity, staged APK cleanup, installer handoff, current APK smoke, Android 16 KB validation, QA evidence retention, and blocked stale/unverified/no-smoke release paths.
- `src/services/modernizationCompletionCompatibilityEvaluation.ts` defines the local `islemind.modernization-completion-compatibility-eval.v1` cross-layer completion gate for architecture, provider, context, agent, security, product, observability, release, and quality readiness, plus blocked ungated capability expansion, silent/raw UX failure, and delivery-without-evidence paths.
- `src/services/chatRunner.ts` resolves MCP context through `resolveMcpContext()` and parses explicit tool calls through `parseMcpToolRequest()`.
- `src/types/index.ts` contains model metadata fields such as `supportsTools`, `reasoningMode`, and `verifiedAt`.

External technologies must therefore be evaluated as capability extensions or reference designs. They must not be described as missing capabilities until the current source path has been checked.

## Selection Policy

Adoption candidates must satisfy these gates:

- The project must have a clear license and active maintenance signal.
- The integration must preserve local-first defaults and explicit user-triggered data movement.
- Agent or tool execution must remain permissioned, observable, and cancellable.
- Retrieval, memory, and context changes must produce acceptance evidence through trace output, evaluation logs, or deterministic tests.
- Runtime dependencies must be compatible with React Native or isolated behind a service boundary.
- Security-sensitive integrations must define prompt-injection behavior, tool-call authorization, credential handling, and failure fallback.

Reject or defer candidates when:

- The project is primarily prompt text, wrapper glue, or short-lived trend content without a durable runtime.
- The dependency requires broad native changes without a measurable user-facing gain.
- The integration duplicates an existing IsleMind capability without improving quality, reliability, observability, or maintenance cost.
- The tool path cannot be disabled, audited, or rolled back.

## Technology Radar

| Area | Mature production libraries | Hot or frontier projects | IsleMind adoption stance |
| --- | --- | --- | --- |
| Model ecosystem | [PyTorch](https://github.com/pytorch/pytorch), [Transformers](https://github.com/huggingface/transformers), [PEFT](https://github.com/huggingface/peft), [TRL](https://github.com/huggingface/trl), [Accelerate](https://github.com/huggingface/accelerate) | [Qwen](https://github.com/QwenLM/Qwen3), DeepSeek, Gemma, OLMo, Open-R1 | Track model metadata, tool support, context limits, reasoning controls, and deprecation behavior. Do not bind the app to one provider family. |
| Local inference and serving | [llama.cpp](https://github.com/ggml-org/llama.cpp), [Ollama](https://github.com/ollama/ollama), [vLLM](https://github.com/vllm-project/vllm), [SGLang](https://github.com/sgl-project/sglang), BentoML, Ray Serve | TensorRT-LLM, llamafile, LocalAI | Use as desktop, server, or local-network inference references behind `islemind.local-inference-compatibility-eval.v1`. Mobile runtime must keep model download, verification, fallback, and memory-pressure controls. |
| Agent workflow orchestration | [LangGraph](https://github.com/langchain-ai/langgraph), [OpenAI Agents SDK](https://github.com/openai/openai-agents-python), [Pydantic AI](https://github.com/pydantic/pydantic-ai), [Semantic Kernel](https://github.com/microsoft/semantic-kernel) | CrewAI, Agno, Letta, AutoGen variants | Borrow durable-state, typed-tool, and explicit-loop patterns through `islemind.agent-workflow-compatibility-eval.v1`. Runtime adoption must keep step limits, cancellation, pending actions, user approval gates, safe resume, and visible traces. |
| Reasoning and test-time compute | Provider-native reasoning controls, verifier loops, self-checking workflows, eval-guided retries | OpenAI reasoning models, Claude extended thinking, Gemini thinking, tree/search-style verifier loops | High relevance. Use `islemind.reasoning-runtime-compatibility-eval.v1` before expanding reasoning controls, retry loops, model routing, or verifier workflows. Do not store hidden chain-of-thought or use prompt-only reasoning as a control plane. |
| Runtime budget governance | Token budgeters, request timeouts, retry/circuit breakers, cancellation, fallback guards | cost-aware runtime ledgers, stream idle budgets, thermal-aware local inference gates | Use `islemind.runtime-budget-governance-compatibility-eval.v1`. Runtime expansion must prove finite token, cost, latency, timeout, retry, stream, cancellation, fallback, tool-call, memory, thermal, ledger, and audit behavior before doing more work. |
| Credential and secret governance | Secure storage, scoped tokens, secret redaction, consented telemetry keys | hosted-provider auth scope, credential health routing, portable-secret migration gates | Use `islemind.credential-governance-compatibility-eval.v1`. Provider, group, hosted-route, proxy, observability, import/restore, reset, and diagnostics paths must prove scoped storage, redaction, export elision, consent, and replay blocking before credentials can reach runtime work. |
| Runtime privacy and retention | Local log retention, redacted diagnostics, export/import sanitizers, reset cleanup | privacy-retention gates, raw media/data retention blockers, consented local preview policies | Use `islemind.runtime-privacy-retention-compatibility-eval.v1`. Runtime diagnostics, portable export, reset/restore, media workflows, and observability previews must prove opt-in, finite retention, redaction, bounded event history, cleanup, and consent before data paths widen. |
| MCP and tool protocol | [modelcontextprotocol](https://github.com/modelcontextprotocol), [github-mcp-server](https://github.com/github/github-mcp-server), [playwright-mcp](https://github.com/microsoft/playwright-mcp), [context7](https://github.com/upstash/context7) | MCP registries, tool marketplaces, agent tool routers | High relevance. Extend server diagnostics, compatibility display, and tool/resource/prompt visibility before widening chat-runtime execution. |
| Plugin and hook manifests | Versioned plugin catalogs, extension manifests, permission review, disabled-by-default hook registries | plugin marketplaces, workflow imports, runtime repair hooks, settings extensions | Use `islemind.plugin.v1` and `islemind.plugin-catalog.v1`. Plugin expansion must prove stable ids, semver, disabled reasons, permission bounds, finite hook points, forced no-op hooks, bounded catalog events, and raw-prompt elision before hooks or marketplace imports execute. |
| Tool calling and typed actions | Function calling, JSON Schema tools, app/native actions, RAG tools, tool result envelopes | provider-native tool replay, multi-tool reconciliation, typed action gateways | Core direction. Use `islemind.tool-calling-compatibility-eval.v1` before widening executable tools, replay, structured-output coexistence, or Android actions. |
| Coding agents | [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Cline](https://github.com/cline/cline), [Continue](https://github.com/continuedev/continue), [Aider](https://github.com/paul-gauthier/aider), [Goose](https://github.com/block/goose) | opencode, code graph agents, memory-first coding agents | Track workflow and UX patterns. Do not couple IsleMind runtime to a coding-agent implementation unless it supports bounded mobile workflows. |
| RAG and knowledge workflow | [LlamaIndex](https://github.com/run-llama/llama_index), LangChain, Haystack, [Dify](https://github.com/langgenius/dify), [RAGFlow](https://github.com/infiniflow/ragflow), [Open WebUI](https://github.com/open-webui/open-webui) | Flowise, Langflow, AnythingLLM, agentic RAG pipelines | Use as reference for import, indexing, hybrid retrieval, citation, and evaluation through `islemind.rag-retrieval-eval.v1`. Avoid replacing existing local retrieval without measured recall, citation, latency, and offline-fallback gains. |
| Document parsing and ingestion | [MarkItDown](https://github.com/microsoft/markitdown), [Docling](https://github.com/docling-project/docling), [Unstructured](https://github.com/Unstructured-IO/unstructured), [MinerU](https://github.com/opendatalab/MinerU) | Layout-aware PDF parsing, formula/table extraction, multimodal document understanding | Strong candidate area. Prefer optional import pipeline or service boundary over heavy mobile runtime coupling. |
| Vector search and retrieval storage | [pgvector](https://github.com/pgvector/pgvector), [Qdrant](https://github.com/qdrant/qdrant), [Milvus](https://github.com/milvus-io/milvus), [FAISS](https://github.com/facebookresearch/faiss), Chroma, Weaviate | hybrid vector + keyword search, graph retrieval, long-context retrieval compression | Use external vector stores for server or sync scenarios. Mobile default must remain resource-aware and offline-capable. |
| Agent memory and context | [mem0](https://github.com/mem0ai/mem0), [Zep Graphiti](https://github.com/getzep/graphiti), [Letta](https://github.com/letta-ai/letta) | hierarchical memory, graph memory, session compression, coding-agent memory | Research only until quality metrics are defined. Memory writes must expose source, scope, retention, deletion, and conflict behavior. |
| Context engineering | Long-context packing, retrieval ranking, memory governance, tool-output envelopes, compression, citation manifests | adaptive context routers, source-hash caches, context distillation, context firewalls | Core direction. Use `islemind.context-engineering-compatibility-eval.v1` before widening context lanes, compact reuse, memory injection, tool-output injection, or manifest export. |
| Observability, eval, and security | [Langfuse](https://github.com/langfuse/langfuse), [Phoenix](https://github.com/Arize-ai/phoenix), [promptfoo](https://github.com/promptfoo/promptfoo), [DeepEval](https://github.com/confident-ai/deepeval), [garak](https://github.com/NVIDIA/garak), [PyRIT](https://github.com/microsoft/PyRIT), OpenAI Evals | agent red-teaming, prompt-injection scanning, tool-call eval, RAG citation eval | Production-critical. Prefer CI/dev tooling first, then in-app diagnostics only where it helps users understand failure behavior. Trace/eval adoption must align with `islemind.observability-compatibility-eval.v1`. |
| Multimodal, speech, and media | [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [Whisper](https://github.com/openai/whisper), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), whisper.cpp, FFmpeg, [supervision](https://github.com/roboflow/supervision) | [NVIDIA Cosmos](https://github.com/NVIDIA/cosmos), vision-language agents, local TTS, video generation workflows | Track for import and artifact workflows through `islemind.multimodal-workflow-compatibility-eval.v1`. Add mobile features only when provider/model metadata, size/duration/frame budgets, permissions, redaction, provenance, cleanup, and offline fallback are explicit. |
| Realtime interaction and voice UX | Expo Audio, Expo Speech, provider realtime transports, push-to-talk transcription | duplex voice, barge-in, streaming transcript UI, low-latency turn taking | Use `islemind.realtime-interaction-compatibility-eval.v1`. Realtime voice must prove consent, microphone permission, speaker control, latency, interruption, cancellation, transcript boundaries, bounded buffers, cleanup, fallback, and same-session state isolation before replacing push-to-talk. |
| API abstraction and structured output | [LiteLLM](https://github.com/BerriAI/litellm), Instructor, Outlines, Guidance, JSON schema constrained decoding | provider routers, tool-call adapters, typed agent interfaces | Relevant to provider abstraction. Must align with `islemind.structured-output-compatibility-eval.v1`, provider conformance, model allow/block policy, and failure reporting. |
| Provider runtime gateway | Route snapshots, provider execution gateways, runtime event envelopes, sanitized error traces | route-level repair actions, hosted-chain diagnostics, provider-runtime control planes | Use `islemind.provider-runtime-gateway-outcome.v1`. Provider execution expansion must keep ready and blocked gateway outcomes linked to route snapshots, structured-output planning, runtime-log options, bounded traces, and redaction before adding new provider protocols or hosted chains. |
| Provider runtime health | Health snapshots, cooldowns, circuit breakers, retry-after handling, credential-group health | quota-aware routing, account/channel cooldowns, automatic route repair | Use `islemind.provider-runtime-health-view.v1`. Provider health expansion must keep provider/model/credential/region scoping, finite cooldowns, finite circuits, snapshot caps, cleanup, recovery, and secret-free telemetry explicit before broadening quota-aware routing. |
| Provider failover policy | Retry/fallback classifiers, candidate ranking, policy gates, health-aware route selection | quota-aware failover, cross-provider repair, account/channel route rotation | Use `islemind.provider-failover-decision.v1`. Failover expansion must prove finite triggers, policy-off blocking, stream-start blocking, explicit model-lock blocking, capability equivalence, region and cost controls, cross-provider confirmation, and secret-free decisions. |
| Provider fallback candidates | Provider/model inventories, credential-group scoping, model aliases, health annotations, capability-contract checks | candidate marketplaces, account pools, automatic route repair inventories | Use `islemind.provider-fallback-candidate-build.v1`. Candidate expansion must prove bounded model discovery, credential availability, deprecated-model rejection, compatibility-contract gating, health annotation, dedupe, and secret-free candidate evidence. |
| Provider operation results | Provider test result shapes, HTTP status classifiers, request-id extraction, redacted error summaries | provider-specific error mappers, relay diagnostics, automatic repair hints | Use `islemind.provider-operation-result.v1`. Operation-result expansion must preserve public result shape, stable operation codes, relay model-unavailable mapping, bounded details, request-id visibility, and secret redaction. |
| Execution layer backends | Android native APIs, ONNX Runtime, desktop companion workers, job runners | LAN paired workers, cloud job runners, CLI-backed media/document processors | Use `islemind.execution-layer-compatibility-eval.v1`. MCP/plugin/policy stay as the control layer; CLI is an external worker backend only, never direct mobile shell or model-composed raw shell. |
| Model routing and mixture of models | Provider routers, capability matrices, local/cloud model pools, fallback policies | cost-aware routers, privacy-aware routing, specialist model pools | Use `islemind.model-routing-compatibility-eval.v1`. Route by capability evidence, privacy, cost, latency, and provider-state isolation rather than one universal model or generic fallback. |
| Provider protocol and transport | Responses, Chat Completions, Anthropic Messages, Gemini generateContent, SSE, WebSocket, signed hosted requests | OpenAI-compatible relays, hosted compatibility layers, local-runtime gateways, protocol brokers | Use `islemind.provider-protocol-compatibility-eval.v1`. Provider routes must preserve endpoint, auth, region/resource, request-shape, transport, model-list, timeout, error, fallback, and provider-state semantics rather than flattening every endpoint into one generic API. |
| Provider request shaping and conformance | Provider-native body builders, capability matrices, token normalizers, modality adapters | capability-aware request routers, provider-specific cache/search/reasoning controls | Use `islemind.provider-request-shaping-compatibility-eval.v1`. Request bodies must emit only provider/model-proven fields, normalize token parameters, remove or block unsupported optional fields, and keep privacy/cache state scoped. |
| Provider model lifecycle | Model catalogs, remote model sync, aliases, deprecations, hosted deployment ids, manual model declarations | alias/deprecation lifecycle gates, model metadata freshness gates, custom endpoint import policy | Use `islemind.provider-model-lifecycle-compatibility-eval.v1`. Model ids and capabilities must come from scoped provider metadata or explicit user declaration, not from a universal `/models` assumption or stale alias. |
| Provider state isolation | Session affinity, Responses continuation, provider cache state, provider-native tool replay, compact-state rows | state isolation gates, route-scoped continuation, replay reset policies | Use `islemind.provider-state-isolation-compatibility-eval.v1`. Provider-native state must remain scoped by provider, model, conversation, session, credential group, TTL, health, and fallback policy before any continuation or replay state is reused. |

## Recommended Tracks

### Track 1: MCP Compatibility And Visibility

Default behavior:

- Preserve the current MCP context and explicit tool-call boundary.
- Expand diagnostics around server capabilities, transport failures, schema mismatches, and per-server tool/resource/prompt counts.
- Treat GitHub MCP, Playwright MCP, and context7 as compatibility targets for local testing, not mandatory runtime dependencies.
- Use the local `islemind.mcp-compatibility-eval.v1` gate as the first acceptance baseline before adding MCP transports, registries, or wider runtime execution.

Acceptance evidence:

- Evaluation output covers GitHub MCP, Playwright MCP, context7-style resources, malformed schema responses, unsupported transport, and destructive tool-call refusal.
- UI or diagnostic output records the server source, refresh result, capability counts, and failure code.
- Chat runtime refuses unauthorized or malformed tool calls.
- Existing MCP context behavior remains compatible with saved conversations.

### Track 1A: Tool Calling And Typed Actions

Default behavior:

- Keep executable tools behind typed contracts, schema validation, unique identity, permission decisions, output budgets, redaction, and audit events.
- Keep structured output separate from executable tools.
- Require visible confirmation for destructive native or app actions.
- Reconcile provider-native replay ids only within the same provider/tool state.
- Use the local `islemind.tool-calling-compatibility-eval.v1` gate before widening executable tools, provider-native tool adapters, replay, Android actions, or tool-result context admission.

Acceptance evidence:

- Evaluation output records source, request shape, tool identity, typed contract, schema validation, argument validity, permission class, confirmation, output budget, redaction, audit, replay id stability, structured-output separation, and failure codes.
- Ambiguous names, malformed arguments, destructive tools without confirmation, and model-composed raw commands fail closed.

### Track 1B: Agent Workflow Compatibility

Default behavior:

- Treat agent behavior as bounded workflows and state machines, not fully autonomous background agents.
- Require finite step/tool-call limits, visible traces, audit events, cancellation, recovery prompts, output budgets, redaction, and step attribution.
- Pause on permissions, step limits, and RAG evidence gaps through pending actions with human-readable continuation guidance.
- Use the local `islemind.agent-workflow-compatibility-eval.v1` gate before widening agent autonomy, saved workflow resume, handoff/diagnostic flows, work artifacts, tool loops, or background execution.

Acceptance evidence:

- Evaluation output records run kind, control pattern, readiness, runtime schema, state machine, max steps, max tool calls per step, trace/audit state, permissions, confirmations, pending actions, cancellation, recovery prompts, output budget, quality audit, evidence repair, resume safety, background-continuation state, human review, redaction, step attribution, raw-command status, and failure codes.
- Unbounded loops, hidden tool actions, unsafe resume payloads, background continuation, and raw command paths fail closed.

### Track 2: Document Ingestion Quality

Default behavior:

- Evaluate MarkItDown, Docling, Unstructured, and MinerU against representative PDFs, office documents, tables, and mixed-language content.
- Use the local `islemind.document-ingestion-benchmark.v1` gate as the first acceptance baseline before adding parser dependencies.
- Prefer an optional import step that converts source files into stable Markdown or structured chunks before indexing.
- Do not add large native parsing dependencies to the React Native runtime without proving package size, memory, and Android compatibility.

Acceptance evidence:

- Test corpus records extraction quality, table preservation, source page mapping, failure codes, and fallback output.
- RAG citations continue to point to source metadata after conversion.

### Track 3: Retrieval Evaluation

Default behavior:

- Keep current local hybrid and agentic retrieval as the baseline.
- Compare external vector databases only for server-side or sync scenarios.
- Use the local `islemind.rag-retrieval-eval.v1` gate as the first acceptance baseline for hit quality, citation correctness, latency, and offline fallback behavior.
- Extend evaluation before replacing retrieval storage or adding external vector services.

Acceptance evidence:

- Evaluation output compares baseline search, hybrid search, and agentic search on the same query set.
- Regression tests cover empty index, missing model, corrupted model file, and provider/local embedding fallback.

### Track 3A: Context Engineering

Default behavior:

- Treat RAG, memory, tool outputs, attachments, summaries, provider state, and recent history as context lanes with authority and budget metadata.
- Require finite token caps, source hashes, provenance, source reliability, redaction, and visible decisions for model-visible context.
- Keep context manifests and runtime events raw-text-free and non-networked.
- Use the local `islemind.context-engineering-compatibility-eval.v1` gate before widening context lanes, context caching, compact reuse, memory injection, tool-output injection, or manifest export.

Acceptance evidence:

- Evaluation output records source kind, authority, token budget, estimated tokens, source hash, provenance, citation trace, permission checks, review status, redaction, ranking, reliability, compact mode, fallback state, cache reuse, runtime events, visible decision, and failure codes.
- Unbounded context, raw context manifests, and cross-authority memory leaks fail closed.

### Track 4: Agent Memory

Default behavior:

- Treat mem0, Zep Graphiti, and Letta as reference designs.
- Do not enable autonomous long-term memory writes by default.
- Require user-visible memory scope, source, retention, edit, delete, and conflict behavior.
- Use the local `islemind.memory-governance-eval.v1` gate as the first acceptance baseline before adding graph memory, external memory sync, or autonomous memory-writing workflows.

Acceptance evidence:

- Memory write traces record source message, extracted claim, confidence, retention class, and deletion path.
- Retrieval distinguishes remembered user preference, imported knowledge, provider response, and generated summary.
- Conflicting or model-inferred memories stay pending for review instead of auto-overwriting active user memory.

### Track 5: Eval, Red-Team, And Observability

Default behavior:

- Introduce eval and security tooling as development gates before adding runtime dependencies.
- Use the local `islemind.agent-security-eval.v1` gate and `test:agent-security-eval` entry as the first acceptance baseline for agent prompt-injection, tool-call, citation-drift, and fallback behavior.
- Use the local `islemind.observability-compatibility-eval.v1` gate, `islemind.observability-sink-export.v1` export contract, and `islemind.observability-sink-policy.v1` opt-in policy before adding external trace sinks, eval dashboards, or OpenTelemetry-style export.
- Use promptfoo, DeepEval, garak, PyRIT, Langfuse, or Phoenix where they produce reproducible evidence for prompt-injection, tool-call misuse, RAG citation drift, and provider fallback behavior.

Acceptance evidence:

- CI or local scripts can run a small deterministic suite without network secrets.
- Failures report the prompt, tool request, expected policy, actual behavior, and blocking condition.
- Trace diagnostics preserve source event ids, span hierarchy, duration/status/failure code, eval outcome, metrics, high-frequency suppression, repair provenance, and redaction markers.

### Track 6: Local Inference Compatibility

Default behavior:

- Treat Ollama, llama.cpp, LM Studio, LocalAI, vLLM, and SGLang as optional desktop, server, or LAN service targets.
- Keep mobile runtime dependencies separate from desktop/server inference dependencies.
- Require explicit LAN opt-in, model metadata or manual-model fallback, timeout policy, and memory/VRAM requirements before runtime setup expands.
- Use the local `islemind.local-inference-compatibility-eval.v1` gate as the first acceptance baseline before adding local-network inference setup or runtime-specific request controls.

Acceptance evidence:

- Evaluation output records runtime family, docs, endpoint shape, mobile reachability, opt-in, model-list status, manual fallback, timeout, RAM/VRAM requirements, capabilities, and risk codes.
- Mobile `localhost` configurations are blocked or explained because loopback points to the phone, not the user's desktop server.
- Oversized local-runtime candidates are blocked when RAM or VRAM requirements exceed available resources.

### Track 7: Structured Output And Typed Tools

Default behavior:

- Prefer provider-native schema controls when the provider, protocol, and model metadata prove support.
- Keep provider tools and structured output as separate request surfaces.
- Treat Anthropic tool schemas, Gemini response schemas, OpenAI `response_format` / Responses `text.format`, relay model-gated schemas, and JSON-object fallback as distinct paths.
- Use the local `islemind.structured-output-compatibility-eval.v1` gate before widening typed workflow outputs, JSON repair, or request controls.

Acceptance evidence:

- Evaluation output records docs, request shape, strict-schema status, app request-control status, model metadata, adapter requirements, tool schema validity, parse result, required-field coverage, and failure codes.
- Unknown OpenAI-compatible providers do not receive schema controls without model metadata or explicit capability evidence.
- JSON-object fallback can be parser-validated but must not claim strict JSON schema guarantees.

### Track 8: Reasoning Runtime And Test-Time Compute

Default behavior:

- Prefer provider-native reasoning controls when provider protocol and model metadata prove support.
- Treat response-side reasoning traces as trace-only summaries unless request-side controls are documented.
- Keep verifier loops bounded by max steps, retries, timeout, token budget, cost budget, cancellation, visible summary, and eval outcome.
- Require tool evidence for tool-dependent self-checks.
- Use the local `islemind.reasoning-runtime-compatibility-eval.v1` gate before widening reasoning controls, retry policies, verifier workflows, or reasoning trace export.

Acceptance evidence:

- Evaluation output records request shape, requested/effective effort, provider docs, model metadata, app request-control status, budgets, cancellation, eval outcome, tool evidence, and failure codes.
- Unsupported providers fail closed instead of receiving generic reasoning fields.
- Hidden chain-of-thought and raw thinking payloads are neither stored nor exported.
- Fallback does not silently increase reasoning effort, retries, token budgets, or cost.

### Track 8A: Runtime Budget Governance

Default behavior:

- Normalize token, cost, latency, timeout, retry, stream-idle, tool-call, local-memory, and thermal budgets before runtime work starts.
- Keep retries bounded and connected to circuit breaker behavior.
- Propagate cancellation across provider requests, stream readers, tool loops, local inference, and pending fallback.
- Allow fallback only when it preserves or reduces budget commitments, or when escalation is visible and explicitly approved.
- Use the local `islemind.runtime-budget-governance-compatibility-eval.v1` gate before widening reasoning retries, provider fallback, long streams, realtime media, local inference, tool loops, background jobs, or external workers.

Acceptance evidence:

- Evaluation output records surface, budget kinds, input/output token budgets and estimates, cost budget and estimate, latency budget, observed latency, timeout, retry limit, circuit breaker, stream idle timeout, cancellation, fallback budget policy, fallback visibility, tool-call limit and estimate, local memory budget and estimate, thermal policy, budget ledger, audit event, and failure codes.
- Unbounded retries, missing timeouts, silent fallback budget escalation, missing cancellation, unmetered tool loops, and unbounded local resource use fail closed.

### Track 8B: Credential Governance

Default behavior:

- Store provider API keys, credential-group keys, search-provider keys, and observability sink keys through secure storage helpers.
- Keep credential selection scoped to provider id, credential group id, model availability, health state, cooldown or circuit state, hosted auth route, region, resource, and deployment identity.
- Keep portable export sanitized; import may restore secrets only by moving them into secure storage before sanitized providers are persisted.
- Require explicit observability sink opt-in and workspace consent before external export can use a stored sink key.
- Use the local `islemind.credential-governance-compatibility-eval.v1` gate before widening provider families, hosted routes, proxy handling, portable restore, runtime diagnostics, external observability, or credential-aware model routing.

Acceptance evidence:

- Evaluation output records storage backend, provider scope, credential-group scope, model-scoped selection, health routing, hosted auth scope, region/resource/deployment scope, observability secure key, opt-in and consent, proxy URL sanitization, URL/userinfo/query blocking, runtime log/event redaction, import secure restore, portable export secret elision, destructive reset cleanup, cross-provider replay blocking, and failure codes.
- Plaintext provider keys, credentials in URLs, diagnostics secret leaks, cross-provider credential replay, and observability export without consent fail closed.

### Track 9: Execution Layer Backends

Default behavior:

- Keep MCP, plugin manifests, native adapters, and policy as the control layer.
- Treat Android native APIs and ONNX Runtime as local execution backends.
- Treat CLI as a desktop, LAN, or cloud worker backend behind typed tool contracts, not as a mobile shell.
- Use the local `islemind.execution-layer-compatibility-eval.v1` gate before adding new execution surfaces, workflow actions, CLI workers, LAN pairing, or cloud jobs.

Acceptance evidence:

- Evaluation output records control plane, execution surface, platform, readiness, capabilities, guardrails, and risk codes.
- External workers require typed contracts, command allowlists, cwd/env scope, timeout, output budget, artifact manifest, audit event, confirmation where needed, and secret redaction.
- Direct mobile shell and model-composed raw shell paths remain blocked.

### Track 10: Multimodal Workflow Compatibility

Default behavior:

- Send image, audio, file, video, or screen context only when provider/model metadata and app request controls prove support.
- Route documents through ingestion, chunking, provenance, and citation traces before context injection.
- Keep audio transcription and speech output permissioned, cancellable, bounded, and temporary.
- Treat realtime voice, video understanding, and screen understanding as adapter-gated workflows until transport, frame, latency, redaction, and consent boundaries are implemented.
- Use the local `islemind.multimodal-workflow-compatibility-eval.v1` gate before widening multimodal provider routing or media workflows.

Acceptance evidence:

- Evaluation output records input/output modalities, request shape, metadata support, request-control status, consent, native permission, size/duration/frame/token budgets, temp cleanup, retention, redaction, provenance, citation trace, cancellation, interruption, transcript boundary, worker/realtime adapter status, artifact manifest, audit event, and failure codes.
- Unsupported provider modality overclaims fail closed.
- Raw media is not retained in cache, diagnostics, traces, or exports without explicit policy.
- Unbounded media payloads are blocked before request shaping.

### Track 10A: Realtime Interaction And Voice UX

Default behavior:

- Keep current voice input as push-to-talk transcription unless a dedicated realtime adapter proves low-latency duplex behavior.
- Require user consent, microphone permission, speaker control, interruption, cancellation, VAD/turn boundaries, partial/final transcript boundaries, finite audio/token/cost budgets, cleanup, redaction, audit, and same-session audio state.
- Degrade visibly to text chat or push-to-talk voice notes when realtime transport, request adapter, provider contract, or permission is missing.
- Use the local `islemind.realtime-interaction-compatibility-eval.v1` gate before adding provider-native realtime voice, streaming transcript UI, barge-in, offline voice-note persistence, or audio session state.

Acceptance evidence:

- Evaluation output records surface, mode, transport, consent, microphone permission, speaker control, provider realtime contract, request adapter, latency budget, VAD/turn/transcript boundaries, interruption, cancellation, audio/duration/token/cost budgets, temp cleanup, raw-audio retention, transcript redaction, fallback mode/visibility, same-session state, audit event, and failure codes.
- Missing microphone permission, unbounded audio buffers, realtime without interruption/cancellation, raw audio retention, and cross-session audio state fail closed.

### Track 11: Model Routing And Mixture Of Models

Default behavior:

- Route simple classification and embedding work to cheap or local models when capability evidence is sufficient.
- Upgrade complex reasoning, vision, tools, and structured-output tasks only when provider/model metadata proves support.
- Keep private local-only requests on local/on-device routes unless explicit redaction and policy allow cloud routing.
- Treat fallback as visible degradation, not silent substitution.
- Use the local `islemind.model-routing-compatibility-eval.v1` gate before widening model pools, model scoring, fallback policies, or provider-native state continuation.

Acceptance evidence:

- Evaluation output records selected provider/model, fallback provider/model, required/selected capabilities, decision reasons, metadata freshness, capability evidence, privacy mode, private-data flag, redaction status, cost/latency budgets, fallback visibility, provider-state replay scope, cache/tool replay match, audit event, and failure codes.
- Required capability downgrades fail closed.
- Private data does not silently route to cloud.
- Cross-provider response id, cache, and provider-tool replay are blocked.

### Track 12: Provider Protocol And Transport Compatibility

Default behavior:

- Treat Responses, Chat Completions, Anthropic Messages, Gemini generateContent, hosted native APIs, relays, and local runtimes as distinct protocol routes.
- Preserve provider-specific endpoint, auth, region/resource/deployment, tenant, request-shape, transport, model-list, timeout, error, and fallback semantics.
- Keep OpenAI-compatible relays degraded until endpoint/model capability evidence, remote metadata, manual declaration, or live smoke proves optional features.
- Use the local `islemind.provider-protocol-compatibility-eval.v1` gate before adding providers, hosted routes, relays, aggregators, local runtimes, WebSocket transport, Responses paths, model-list sync, or provider-native state continuation.

Acceptance evidence:

- Evaluation output records protocol family, hosting profile, endpoint family, docs mapping, provider identity, endpoint/auth mapping, region/resource scope, request conformance, capability evidence, generic-overclaim status, Responses/Chat permissions, model-list policy, manual fallback, selected transport, WebSocket contract/runtime status, fallback visibility, live-smoke plan, same-provider state, local-network opt-in, timeout, error mapping, redaction, signed request, network-call status, and failure codes.
- Generic compatible endpoints, hosted routes missing region/resource scope, cross-provider state replay, and WebSocket without contract/runtime fail closed.

### Track 12A: Provider Request Shaping Compatibility

Default behavior:

- Shape the request body from provider protocol, model metadata, declared capabilities, privacy policy, and token budget rather than from one generic OpenAI-compatible template.
- Keep reasoning, tools, structured output, multimodal input, native search, cache, compact state, and max-output fields provider-specific.
- Remove unsupported optional fields only with visible downgrade; otherwise block before a request leaves the local control plane.
- Use the local `islemind.provider-request-shaping-compatibility-eval.v1` gate before widening provider-specific body fields, relay declarations, native search, cache/compact state, token parameter variants, or multimodal request shaping.

Acceptance evidence:

- Evaluation output records request shape, hosting profile, required/supported capabilities, requested/emitted/removed/adjusted fields, max-output field, token limits, fallback shape, privacy/redaction, cache scope, same-provider state, schema validity, multimodal payload bounds, diagnostics redaction, audit event, unsupported emitted fields, missing capabilities, and failure codes.
- Unknown compatible endpoints, unsupported reasoning/tools/modalities/schema/search fields, private cloud routes, unnormalized token overruns, and cross-provider cache state fail closed.

### Track 12B: Provider Model Lifecycle Compatibility

Default behavior:

- Treat provider model lists as provider-specific evidence, not as a universal OpenAI-compatible contract.
- Keep model-list suppression, manual model fallback, alias resolution, deprecation replacement, hosted deployment identity, local runtime models, and custom endpoint imports explicit.
- Admit advanced model capabilities only from fresh, route-scoped metadata or explicit manual declaration.
- Use the local `islemind.provider-model-lifecycle-compatibility-eval.v1` gate before widening model sync, aliases, deprecation handling, hosted deployment models, relay/local runtime models, or custom endpoint model imports.

Acceptance evidence:

- Evaluation output records model-list policy, endpoint scope, remote metadata verification, metadata freshness, manual fallback/declaration, alias resolution and canonical id, deprecation mapping and replacement id, required/admitted capabilities, metadata capability scope, hosted region/deployment scope, same-provider alias state, private endpoint declaration, downgrade visibility, audit event, and failure codes.
- Universal `/models` assumptions, stale aliases, deprecated models without replacements, flattened provider-level capability metadata, cross-provider alias state, and private/custom endpoint imports without user declaration fail closed.

### Track 12C: Provider State Isolation Compatibility

Default behavior:

- Scope session affinity by provider id, requested model, conversation id, session id, credential group, TTL, and health state.
- Reuse Responses `previous_response_id`, compact state, provider cache state, and provider-native tool replay ids only when provider, model, conversation, and route scope still match.
- Keep fallback same-provider for provider-native state; otherwise visibly reset provider-native continuation state before switching route.
- Use the local `islemind.provider-state-isolation-compatibility-eval.v1` gate before widening Responses continuation, cache continuation, compact reuse, provider-native tool replay, session affinity, session leases, or fallback routing.

Acceptance evidence:

- Evaluation output records provider, model, conversation, session, credential-group, TTL, binding cap, health invalidation, previous-response, compact-state, provider-tool replay, fallback-state, redaction, and audit-event policy.
- Cross-provider response id replay, cross-model cache continuation, stale affinity bindings, tool replay id mismatch, raw state export, and unbounded session state fail closed.

### Track 12D: Runtime Privacy Retention Compatibility

Default behavior:

- Keep runtime JSONL logging default-off, byte-capped, clearable, and redacted.
- Keep runtime event history bounded by history count, list length, object field count, and depth while suppressing high-frequency token persistence and subscriber fan-out.
- Keep portable export, full reset, and import restore paths sanitized and cleanup-complete before widening diagnostics, observability, media, or agent-repair flows.
- Use the local `islemind.runtime-privacy-retention-compatibility-eval.v1` gate before widening runtime diagnostics, portable export/import, reset/restore, media retention, high-frequency telemetry, observability sinks, or data-retention settings.

Acceptance evidence:

- Evaluation output records runtime log default state, byte cap, clear/delete behavior, redaction, payload summary status, URL/query/header/assignment redaction, runtime event bounds, token suppression, export sanitization, reset/restore cleanup, observability opt-in, consent, raw data blocks, and network-call status.
- Raw runtime diagnostics, raw media/file retention, unbounded runtime logs, high-frequency telemetry persistence, portable export secret leaks, and reset artifact retention fail closed.

## Current Priority

| Priority | Work item | Target outcome |
| --- | --- | --- |
| P0 | Maintain model and provider metadata accuracy | Provider selection and reasoning controls remain current without hard-coding stale assumptions. |
| P0 | Keep MCP behavior bounded | Tools, resources, and prompts are visible and diagnosable through `islemind.mcp-compatibility-eval.v1` while execution remains explicit and permissioned. |
| P0 | Keep plugin manifests reviewable | Imported workflow skills, MCP references, hook declarations, and catalog events stay gated by `islemind.plugin.v1` and `islemind.plugin-catalog.v1` so invalid manifests fail closed and hooks remain no-op until a later execution review. |
| P0 | Keep tool calling typed and bounded | Executable tools expand only through `islemind.tool-calling-compatibility-eval.v1` so schemas, identity, permissions, output budgets, replay, and raw-command blocking stay verifiable. |
| P0 | Keep agent workflows bounded | Agent workflow autonomy expands only through `islemind.agent-workflow-compatibility-eval.v1` so state machines, step limits, pending actions, cancellation, safe resume, visible traces, and background-continuation blocks stay verifiable. |
| P1 | Extend document-ingestion benchmark | External parsers are evaluated against `islemind.document-ingestion-benchmark.v1` before integration, using real files and citation quality evidence. |
| P1 | Extend retrieval quality gates | RAG changes must improve measurable recall, citation correctness, or latency against `islemind.rag-retrieval-eval.v1` without breaking offline behavior. |
| P1 | Extend context engineering compatibility | Context lanes, compact reuse, memory/tool injection, and manifests expand only through `islemind.context-engineering-compatibility-eval.v1` so unbounded context, raw manifest leakage, and cross-authority memory leaks fail closed. |
| P1 | Extend agent/security eval gates | Tool-call and prompt-injection behavior stays testable through `islemind.agent-security-eval.v1` before broadening agent autonomy. |
| P1 | Extend reasoning runtime compatibility | Provider reasoning controls and verifier loops expand only through `islemind.reasoning-runtime-compatibility-eval.v1` so unsupported providers, prompt-only chain-of-thought, hidden reasoning export, and unbounded test-time compute fail closed. |
| P1 | Extend runtime budget governance | Reasoning retries, fallback, long streams, realtime media, local inference, tool loops, background jobs, and external workers expand only through `islemind.runtime-budget-governance-compatibility-eval.v1` so unbounded retries, missing timeouts, silent budget escalation, missing cancellation, unmetered tool loops, and unbounded local resource use fail closed. |
| P1 | Extend credential governance | Provider credentials, hosted auth, proxy URLs, observability sink keys, portable restore, runtime diagnostics, and reset cleanup expand only through `islemind.credential-governance-compatibility-eval.v1` so plaintext persistence, URL credentials, diagnostics leaks, cross-provider replay, and no-consent telemetry export fail closed. |
| P1 | Extend structured-output compatibility | Typed output and tool schemas expand only through `islemind.structured-output-compatibility-eval.v1` so unsupported providers fail closed instead of relying on prompt-only JSON. |
| P1 | Extend execution-layer compatibility | MCP/plugin/policy stay as the control layer, while Android native APIs, ONNX, external CLI workers, LAN workers, and cloud jobs are gated by `islemind.execution-layer-compatibility-eval.v1`. |
| P1 | Extend multimodal workflow compatibility | Image, document, audio, speech, realtime voice, video, and screen workflows expand only through `islemind.multimodal-workflow-compatibility-eval.v1` so provider overclaims, raw-media retention, and unbounded payloads fail closed. |
| P1 | Extend realtime interaction compatibility | Push-to-talk, speech playback, realtime duplex voice, streaming transcripts, offline voice notes, and visible text fallback expand only through `islemind.realtime-interaction-compatibility-eval.v1` so missing permission, unbounded audio, non-interruptible voice, raw-audio retention, and cross-session audio state fail closed. |
| P1 | Extend model routing compatibility | Cheap/local/strong/specialist model routing expands only through `islemind.model-routing-compatibility-eval.v1` so capability downgrades, private-data cloud routing, cost/latency overruns, and cross-provider state replay fail closed. |
| P1 | Extend provider protocol compatibility | Provider families, hosted routes, relays, local runtimes, transports, and provider-native state expand only through `islemind.provider-protocol-compatibility-eval.v1` so endpoint/auth semantics, hosted scope, request conformance, model-list policy, transport fallback, and replay isolation stay verifiable. |
| P1 | Extend provider runtime gateway compatibility | Provider execution paths expand only through `islemind.provider-runtime-gateway-outcome.v1` so ready and blocked outcomes retain route snapshot links, structured-output route decisions, sanitized errors, typed runtime events, visible traces, and secret-free diagnostics. |
| P1 | Extend provider runtime health compatibility | Provider health, quota-aware routing, cooldowns, and circuit breakers expand only through `islemind.provider-runtime-health-view.v1` so route scoping, finite cooldown/circuit state, recovery, snapshot bounds, cleanup, and secret-free telemetry stay verifiable. |
| P1 | Extend provider failover compatibility | Provider fallback and automatic repair expand only through `islemind.provider-failover-decision.v1` so retryable triggers, policy blocks, capability equivalence, route health, region/cost constraints, cross-provider confirmation, and secret-free decisions stay verifiable. |
| P1 | Extend provider fallback candidate compatibility | Provider fallback inventories expand only through `islemind.provider-fallback-candidate-build.v1` so provider/model discovery, credential scoping, aliases, capability contracts, health annotation, dedupe, and secret-free evidence stay verifiable. |
| P1 | Extend provider operation result compatibility | Provider tests, model discovery, hosted routes, and runtime errors expand only through `islemind.provider-operation-result.v1` so result shape, error classification, request-id extraction, bounded summaries, and secret redaction stay verifiable. |
| P1 | Extend provider request shaping compatibility | Provider-specific reasoning, tools, schema, multimodal, search, token, cache, compact, relay, and privacy request fields expand only through `islemind.provider-request-shaping-compatibility-eval.v1` so unsupported fields, generic-compatible overclaim, token overruns, private cloud routing, and cross-provider cache state fail closed. |
| P1 | Extend provider model lifecycle compatibility | Provider model sync, aliases, deprecations, hosted deployment ids, relay/local runtime declarations, and custom endpoint imports expand only through `islemind.provider-model-lifecycle-compatibility-eval.v1` so universal `/models` assumptions, stale aliases, deprecated models without replacements, capability flattening, and cross-provider alias state fail closed. |
| P1 | Extend observability compatibility | Trace and eval telemetry expands only through `islemind.observability-compatibility-eval.v1`, the `islemind.runtime-event.v1` bridge, `islemind.observability-sink-export.v1`, and `islemind.observability-sink-policy.v1` so external sinks receive provenance, metrics, outcomes, suppression policy, target hints, explicit opt-in, bounded attributes, and redacted payloads. |
| P1 | Extend release readiness compatibility | Release channels, APK variants, update manifests, installer flows, CI promotion, Android compatibility checks, and QA evidence expand only through `islemind.release-readiness-compatibility-eval.v1` so source stability, artifact freshness, URL safety, integrity verification, staged cleanup, install handoff, smoke evidence, 16 KB validation, and blocked stale/unverified/no-smoke paths stay verifiable. |
| P1 | Keep modernization completion auditable | Cross-layer completion is declared only through `islemind.modernization-completion-compatibility-eval.v1` so architecture, provider, context, agent, security, product, observability, release, and quality layers keep source boundaries, schemas, scripts, docs, fixtures, blocked paths, traces, redaction, recovery, release evidence, and QA evidence. |
| P1 | Extend provider state isolation | Responses continuation, compact state, provider-native tool replay, session affinity, session leases, and fallback state expand only through `islemind.provider-state-isolation-compatibility-eval.v1` so cross-provider response replay, cross-model cache continuation, stale affinity bindings, replay-id mismatch, raw state export, and unbounded session state fail closed. |
| P2 | Research long-term memory | Memory is introduced only after `islemind.memory-governance-eval.v1` proves source attribution, retention control, conflict review, retrieval boundaries, and deletion behavior. |
| P2 | Research local-network inference | Ollama, llama.cpp, LM Studio, LocalAI, vLLM, and SGLang remain optional service targets gated by `islemind.local-inference-compatibility-eval.v1`, not required mobile dependencies. |

## Maintenance

- Refresh this document monthly or before major AI runtime changes.
- Record the refresh date, projects added or removed, and the evidence source.
- Prefer current repository source inspection over prior assessments when deciding whether a capability is missing.
- Keep external trend claims time-bounded. GitHub Trending, OSSInsight, and repository star counts are volatile and must not be treated as quality proof.
- Keep implementation proposals separate from this radar when they require code changes, migrations, or new runtime dependencies.

## Reference Sources

- [GitHub Trending](https://github.com/trending)
- [GitHub Trending, weekly](https://github.com/trending?since=weekly)
- [GitHub Trending, monthly](https://github.com/trending?since=monthly)
- [OSSInsight AI Trending Repositories](https://ossinsight.io/trending/ai)
- [GitHub topic: MCP](https://github.com/topics/mcp)
- [Hugging Face Transformers](https://github.com/huggingface/transformers)
- [vLLM](https://github.com/vllm-project/vllm)
- [SGLang](https://github.com/sgl-project/sglang)
- [Dify](https://github.com/langgenius/dify)
- [RAGFlow](https://github.com/infiniflow/ragflow)
- [browser-use](https://github.com/browser-use/browser-use)
- [NVIDIA Cosmos](https://github.com/NVIDIA/cosmos)
