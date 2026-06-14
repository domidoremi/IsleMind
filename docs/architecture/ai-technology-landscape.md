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
- `src/services/mcp.ts` refreshes `tools/list`, `resources/list`, and `prompts/list`.
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
| Local inference and serving | [llama.cpp](https://github.com/ggml-org/llama.cpp), [Ollama](https://github.com/ollama/ollama), [vLLM](https://github.com/vllm-project/vllm), [SGLang](https://github.com/sgl-project/sglang), BentoML, Ray Serve | TensorRT-LLM, llamafile, LocalAI | Use as desktop, server, or local-network inference references. Mobile runtime must keep model download, verification, fallback, and memory-pressure controls. |
| Agent orchestration | [LangGraph](https://github.com/langchain-ai/langgraph), [OpenAI Agents SDK](https://github.com/openai/openai-agents-python), [Pydantic AI](https://github.com/pydantic/pydantic-ai), [Semantic Kernel](https://github.com/microsoft/semantic-kernel) | CrewAI, Agno, Letta, AutoGen variants | Borrow durable-state, typed-tool, and explicit-loop patterns. Runtime adoption must keep user approval gates and visible traces. |
| MCP and tool protocol | [modelcontextprotocol](https://github.com/modelcontextprotocol), [github-mcp-server](https://github.com/github/github-mcp-server), [playwright-mcp](https://github.com/microsoft/playwright-mcp), [context7](https://github.com/upstash/context7) | MCP registries, tool marketplaces, agent tool routers | High relevance. Extend server diagnostics, compatibility display, and tool/resource/prompt visibility before widening chat-runtime execution. |
| Coding agents | [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Cline](https://github.com/cline/cline), [Continue](https://github.com/continuedev/continue), [Aider](https://github.com/paul-gauthier/aider), [Goose](https://github.com/block/goose) | opencode, code graph agents, memory-first coding agents | Track workflow and UX patterns. Do not couple IsleMind runtime to a coding-agent implementation unless it supports bounded mobile workflows. |
| RAG and knowledge workflow | [LlamaIndex](https://github.com/run-llama/llama_index), LangChain, Haystack, [Dify](https://github.com/langgenius/dify), [RAGFlow](https://github.com/infiniflow/ragflow), [Open WebUI](https://github.com/open-webui/open-webui) | Flowise, Langflow, AnythingLLM, agentic RAG pipelines | Use as reference for import, indexing, hybrid retrieval, citation, and evaluation. Avoid replacing existing local retrieval without measured gains. |
| Document parsing and ingestion | [MarkItDown](https://github.com/microsoft/markitdown), [Docling](https://github.com/docling-project/docling), [Unstructured](https://github.com/Unstructured-IO/unstructured), [MinerU](https://github.com/opendatalab/MinerU) | Layout-aware PDF parsing, formula/table extraction, multimodal document understanding | Strong candidate area. Prefer optional import pipeline or service boundary over heavy mobile runtime coupling. |
| Vector search and retrieval storage | [pgvector](https://github.com/pgvector/pgvector), [Qdrant](https://github.com/qdrant/qdrant), [Milvus](https://github.com/milvus-io/milvus), [FAISS](https://github.com/facebookresearch/faiss), Chroma, Weaviate | hybrid vector + keyword search, graph retrieval, long-context retrieval compression | Use external vector stores for server or sync scenarios. Mobile default must remain resource-aware and offline-capable. |
| Agent memory and context | [mem0](https://github.com/mem0ai/mem0), [Zep Graphiti](https://github.com/getzep/graphiti), [Letta](https://github.com/letta-ai/letta) | hierarchical memory, graph memory, session compression, coding-agent memory | Research only until quality metrics are defined. Memory writes must expose source, scope, retention, deletion, and conflict behavior. |
| Observability, eval, and security | [Langfuse](https://github.com/langfuse/langfuse), [Phoenix](https://github.com/Arize-ai/phoenix), [promptfoo](https://github.com/promptfoo/promptfoo), [DeepEval](https://github.com/confident-ai/deepeval), [garak](https://github.com/NVIDIA/garak), [PyRIT](https://github.com/microsoft/PyRIT), OpenAI Evals | agent red-teaming, prompt-injection scanning, tool-call eval, RAG citation eval | Production-critical. Prefer CI/dev tooling first, then in-app diagnostics only where it helps users understand failure behavior. |
| Multimodal, speech, and media | [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [Whisper](https://github.com/openai/whisper), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), whisper.cpp, FFmpeg, [supervision](https://github.com/roboflow/supervision) | [NVIDIA Cosmos](https://github.com/NVIDIA/cosmos), vision-language agents, local TTS, video generation workflows | Track for import and artifact workflows. Add mobile features only when model size, latency, permissions, and offline fallback are explicit. |
| API abstraction and structured output | [LiteLLM](https://github.com/BerriAI/litellm), Instructor, Outlines, Guidance, JSON schema constrained decoding | provider routers, tool-call adapters, typed agent interfaces | Relevant to provider abstraction. Must align with existing provider conformance, model allow/block policy, and failure reporting. |

## Recommended Tracks

### Track 1: MCP Compatibility And Visibility

Default behavior:

- Preserve the current MCP context and explicit tool-call boundary.
- Expand diagnostics around server capabilities, transport failures, schema mismatches, and per-server tool/resource/prompt counts.
- Treat GitHub MCP, Playwright MCP, and context7 as compatibility targets for local testing, not mandatory runtime dependencies.

Acceptance evidence:

- UI or diagnostic output records the server source, refresh result, capability counts, and failure code.
- Chat runtime refuses unauthorized or malformed tool calls.
- Existing MCP context behavior remains compatible with saved conversations.

### Track 2: Document Ingestion Quality

Default behavior:

- Evaluate MarkItDown, Docling, Unstructured, and MinerU against representative PDFs, office documents, tables, and mixed-language content.
- Prefer an optional import step that converts source files into stable Markdown or structured chunks before indexing.
- Do not add large native parsing dependencies to the React Native runtime without proving package size, memory, and Android compatibility.

Acceptance evidence:

- Test corpus records extraction quality, table preservation, source page mapping, failure codes, and fallback output.
- RAG citations continue to point to source metadata after conversion.

### Track 3: Retrieval Evaluation

Default behavior:

- Keep current local hybrid and agentic retrieval as the baseline.
- Compare external vector databases only for server-side or sync scenarios.
- Add evaluation around hit quality, citation correctness, latency, memory pressure, and offline behavior.

Acceptance evidence:

- Evaluation logs compare baseline search, hybrid search, and agentic search on the same query set.
- Regression tests cover empty index, missing model, corrupted model file, and provider/local embedding fallback.

### Track 4: Agent Memory

Default behavior:

- Treat mem0, Zep Graphiti, and Letta as reference designs.
- Do not enable autonomous long-term memory writes by default.
- Require user-visible memory scope, source, retention, edit, delete, and conflict behavior.

Acceptance evidence:

- Memory write traces record source message, extracted claim, confidence, retention class, and deletion path.
- Retrieval distinguishes remembered user preference, imported knowledge, provider response, and generated summary.

### Track 5: Eval, Red-Team, And Observability

Default behavior:

- Introduce eval and security tooling as development gates before adding runtime dependencies.
- Use promptfoo, DeepEval, garak, PyRIT, Langfuse, or Phoenix where they produce reproducible evidence for prompt-injection, tool-call misuse, RAG citation drift, and provider fallback behavior.

Acceptance evidence:

- CI or local scripts can run a small deterministic suite without network secrets.
- Failures report the prompt, tool request, expected policy, actual behavior, and blocking condition.

## Current Priority

| Priority | Work item | Target outcome |
| --- | --- | --- |
| P0 | Maintain model and provider metadata accuracy | Provider selection and reasoning controls remain current without hard-coding stale assumptions. |
| P0 | Keep MCP behavior bounded | Tools, resources, and prompts are visible and diagnosable while execution remains explicit and permissioned. |
| P1 | Build a document-ingestion benchmark | External parsers are evaluated before integration, using real files and citation quality evidence. |
| P1 | Add retrieval quality gates | RAG changes must improve measurable recall, citation correctness, or latency without breaking offline behavior. |
| P1 | Add agent/security eval gates | Tool-call and prompt-injection behavior becomes testable before broadening agent autonomy. |
| P2 | Research long-term memory | Memory is introduced only with source attribution, retention control, and deletion behavior. |
| P2 | Research local-network inference | Ollama, llama.cpp, vLLM, and SGLang remain service targets for advanced users, not required mobile dependencies. |

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
