# Official provider API review

Started: 2026-10-31. Continued and reviewed: 2026-11-01, Asia/Taipei.
Owner: project-maintainer. Next manual review: 2026-11-07.
This is a local engineering goal and evidence record, not release approval.

## Goal and acceptance

Use current primary documentation to compare IsleMind's existing provider
contracts with documented endpoints, request parameters, streaming outcomes,
tool/reasoning replay, structured outputs, usage, model lifecycle and pricing.
Change behavior only for a reproduced discrepancy. Unknown, account-dependent
and model-dependent capabilities remain conservative.

| Phase | Acceptance | Current state |
| --- | --- | --- |
| G1 Inventory | Classify every existing identity; preserve the starting worktree | Complete: 45 identities and a SHA-256 baseline |
| G2 Primary evidence | Record public source URLs, retrieval dates, content hashes, reviewed facets and limitations | Complete with explicit limitations: 73 source records; the original 70 records are retained and three selected LocalAI primary excerpts are added |
| G3 Disposition | Separate confirmed defects, already-correct behavior, unavailable evidence and unsupported app routing | Complete: every identity has a scoped decision and follow-up limitations |
| G4 Compatible changes | Add permanent offline counterexamples before fixing confirmed defects; preserve saved settings and public contracts | Local fixes recorded for 13 counterexample groups; defaults, saved identifiers and historical costs preserved |
| G5 Latest-tree acceptance | Run targeted and broad offline regressions, type/dependency/transport gates, and worktree preservation checks | Complete for the exact follow-up source bound below: stable scoped offline acceptance on 2026-11-01; original acceptance 9 and qualification limits are retained |

## Scope

The catalog has 45 identities, not 45 official model vendors:

- 31 official supplier services, including model vendors and inference hosts.
- Three official hosted interfaces: Azure OpenAI, AWS Bedrock and Vertex AI.
- One official aggregator: OpenRouter.
- Five local runtime references: Ollama, LM Studio, LocalAI, vLLM and SGLang.
- Two community gateways: NewAPI and Sub2API.
- Three generic/custom protocol identities; protocol documentation does not
  establish the capabilities of an arbitrary endpoint.

Review the existing catalog rather than automatically adding vendors or
changing the default model. Documentation examples, model-name recognition and
an OpenAI-compatible label are not parameter or pricing evidence. A documented
vendor capability is not an implemented app capability until admission,
planning, the wire body and a matching offline regression agree.

## Evidence rules

- Read actual public primary pages, not search snippets alone.
- Retain retrieval failures, redirects, challenge pages and partial extraction
  as limitations; never mark them as verified API evidence.
- Separate the documented API surface from the particular facets compared
  against source. A single overview is not a full vendor qualification.
- Preserve opaque reasoning/signature payloads rather than displaying them,
  modifying them or inferring them from text.
- Do not treat estimated/display token counters as authoritative billable usage.
- Do not introduce automatic continuation, retry or tool replay after a
  non-successful outcome; these may create further billed requests.
- Do not update defaults, prices or model shutdown dates from examples or
  reseller documentation. Missing exact evidence remains unavailable.

## Execution boundaries

Public documentation GETs and offline tests only. No user credentials, real
inference, paid smoke tests, local-server qualification, Android qualification,
publication, commit or push. Previous maintenance receipts and unrelated
UI/settings changes are preserved.

The prior local remediation remains recorded in
[`provider-maintenance-2026-10-31.md`](provider-maintenance-2026-10-31.md).
This review does not waive prior security exception deadlines or rewrite
historical architecture-document-set findings. Current gate results are
recorded independently in the latest acceptance.

Raw evidence root:
`C:\Users\barna\.codex\visualizations\2026\10\31\01a19103-0e59-7d30-8ded-a301a9cef67a\official-api-review`.
The baseline and statically extracted catalog inventory are retained there.
The continuation has its own `continuation-2026-11-01/baseline.json`; neither
starting snapshot nor failed/interrupted/superseded evidence is overwritten.

The permanent, machine-readable source/disposition record is
[`provider-official-docs-review.json`](../../scripts/fixtures/provider-official-docs-review.json).
It records the actual catalog hash, all 45 identities, 73 selected source or
unavailable-locator records, exact excerpt/body hashes, retrieval dates,
compared facets, decisions, owners and review dates. Whole-page hashes and
tool-excerpt hashes remain different evidence levels. A selected source
record is not a statement that every facet on its page was qualified.

## Review outcomes

| Group | Local behavior and scope | Permanent regression |
| --- | --- | --- |
| API-01 | Reuse completed Responses reasoning items, not unfinished ciphertext from output_item.added | providerOfficialApiRegression.test.ts |
| API-02 | Preserve every Gemini signed part in order, including empty-text signatures, independently of display or route changes | providerOfficialApiRegression.test.ts; providerRuntimeReplay.test.ts |
| API-03 | Keep Gemini CONTINUATION incomplete locally and retain last cumulative usage; do not start a billed continuation hop | providerOfficialApiRegression.test.ts |
| API-04 | Do not promote counters outside the documented Anthropic usage envelope to authoritative tokens; estimated_tokens is a synthetic forward-compatibility counterexample, not a live capture | providerOfficialApiRegression.test.ts |
| API-05 | Validate Cohere transcription model/language, supported MIME, JSON format and final file field before dispatch | providerOfficialApiRegression.test.ts |
| API-06 | Block the retired GitHub Models service before probing/key use, capability admission and fallback; preserve saved configurations | providerOfficialApiRegression.test.ts; providerOfficialRequestRegression.test.ts |
| API-07 | Use the working /v1/sonar sync/stream route without reviving retired async or automatically migrating to Agent API | providerRouteAssembly.test.ts; providerOfficialApiRegression.test.ts |
| API-08 | Reserve field-level provider/catalog output limits for uncapped bodies, not inferred/clamped display defaults | providerContextCapacity.test.ts |
| API-09 | Scope DashScope combined caps to documented models, include the ten-token tolerance, and separately bound legacy thinking output or reject an unavailable estimate | providerDashScopePolicy.test.ts; providerContextCapacity.test.ts; provider-parameter-matrix-tests.js |
| API-10 | Preserve every assistant reasoning_content for default-preserving DashScope models, separately from visible content | providerOfficialRequestRegression.test.ts |
| API-11 | Map DeepSeek minimal to low thinking and keep low admission, sampling and wire diagnostics consistent | providerOfficialRequestRegression.test.ts |
| API-12 | Use the exact DeepSeek 384K = 393216 bound for four current/served Flash/Pro identifiers; keep defaults and saved aliases | providerContextCapacity.test.ts; modelCatalog.current.test.ts |
| API-13 | Replay original LocalAI assistant reasoning beside tool_calls and the following tool result on explicitly configured Chat routes; parse reasoning and reasoning_content aliases without enabling unknown model controls | providerOfficialRequestRegression.test.ts |

The ledger contains full repository paths for each group; shorthand filenames
in this table are labels, not a separate test inventory.

The prior GPT-5 mini/nano standard-price corrections and Deprecated labels
were rechecked against current primary model pages. No historical cost is
repriced, no model is silently replaced, and no shutdown date is invented.
Standard token rows are not tool, cache-duration, service-tier, time-band,
holiday or reseller invoices. A current standalone Gemini 2.5 Flash text-price
row was not established by the localized alternate pricing page, so that
retrieval does not update its price or infer retirement.

## Evidence limitations

- Current Baichuan and ModelScope articles returned client shells. Their
  historically mapped basic behavior is preserved, not called current schema
  or live endpoint verification. Model API URLs are not documentation sources.
- Zero-One yielded a retained primary example, not a complete current schema.
  SiliconFlow and LocalAI retain explicitly scoped primary excerpts where full
  article retrieval failed. The LocalAI follow-up adds three current primary
  excerpts, not original HTML bodies or full-page retrieval. Local backend,
  model and reasoning-parser requirements remain unqualified; new documented
  Anthropic/Responses routes and grammar controls are not enabled by this review.
- Ark documents model-dependent combined/answer-only caps. Opaque endpoint
  model IDs, optional reasoning controls and new parameter support are not
  qualified from names alone; no universal new field is sent.
- SambaNova's same OpenAPI describes response.completed and data: [DONE].
  This disagreement remains visible. It does not justify weakening completion
  gates or claiming a supplier-qualified terminal marker.
- Azure, Bedrock and Vertex public pages do not establish tenant/deployment/
  model access. Bedrock's newer Runtime Chat path and model-specific Mantle
  prefixes do not silently migrate saved settings.
- Local runtime references and community gateway READMEs are not official
  model suppliers or supplier-independent capability/billing guarantees.
  Interactions, Agent API, TokenHub, additional hosted routes and newer model
  examples do not trigger automatic app or default-model migrations.

## Coverage ledger

This table is a locator/selected-facet audit, not a live supplier certification.
The JSON record contains additional sources, exact facets and per-identity
decisions. `Unverified` means retrieval was unavailable or shell-only, not that
the service has shut down.

| Identity | Classification | Dated result | Selected source |
| --- | --- | --- | --- |
| `custom-endpoint` | Protocol identity | Protocol only | [Primary page](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| `openai` | Official service | Selected facets | [Primary page](https://developers.openai.com/api/reference/resources/responses/streaming-events) |
| `anthropic` | Official service | Selected facets | [Primary page](https://platform.claude.com/docs/en/api/http/messages/create) |
| `google` | Official service | Selected facets | [Primary page](https://ai.google.dev/gemini-api/docs/generate-content/long-decode) |
| `deepseek` | Official service | Selected facets | [Primary page](https://api-docs.deepseek.com/api/create-chat-completion) |
| `dashscope` | Official service | Selected facets | [Primary page](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |
| `moonshot` | Official service | Selected facets | [Primary page](https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart) |
| `bigmodel` | Official service | Selected facets | [Primary page](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8) |
| `minimax` | Official service | Selected facets | [Primary page](https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json) |
| `xai` | Official service | Selected facets | [Primary page](https://docs.x.ai/docs/api-reference) |
| `xiaomi-mimo` | Official service | Selected facets | [Primary page](https://mimo.mi.com/docs/en-US/api/chat/openai-api) |
| `mistral` | Official service | Selected facets | [Primary page](https://docs.mistral.ai/api/endpoint/chat) |
| `groq` | Official service | Selected facets | [Primary page](https://console.groq.com/docs/api-reference) |
| `together` | Official service | Selected facets | [Primary page](https://docs.together.ai/reference/chat-completions) |
| `fireworks` | Official service | Selected facets | [Primary page](https://docs.fireworks.ai/api-reference/post-chatcompletions) |
| `perplexity` | Official service | Selected facets | [Primary page](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md) |
| `cohere` | Official service | Selected facets | [Primary page](https://docs.cohere.com/v2/docs/compatibility-api.md) |
| `cerebras` | Official service | Selected facets | [Primary page](https://inference-docs.cerebras.ai/api-reference/chat-completions.md) |
| `sambanova` | Official service | Conflicting terminal docs | [Primary page](https://sambanova-systems.mintlify.dev/docs/api-reference/chat-completions/create-chat-based-completion.md) |
| `nvidia-nim` | Official service | Selected facets | [Primary page](https://docs.api.nvidia.com/nim/reference/llm-apis) |
| `huggingface` | Official service | Selected facets | [Primary page](https://huggingface.co/docs/inference-providers/tasks/chat-completion.md) |
| `github-models` | Official service | Retired service blocked | [Primary page](https://docs.github.com/api/article/body?pathname=/en/github-models) |
| `deepinfra` | Official service | Selected facets | [Primary page](https://docs.deepinfra.com/chat/overview.md) |
| `novita` | Official service | Selected facets | [Primary page](https://docs.novita.ai/api-reference/model-apis-llm-create-chat-completion) |
| `siliconflow` | Official service | Partial primary excerpt | [Primary excerpt](https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions) |
| `modelscope` | Official service | Unverified / preserved | [Unverified locator](https://www.modelscope.cn/docs/model-service/API-Inference/API%20Reference/chat-completion) |
| `volcengine-ark` | Official service | Model-dependent caps | [Primary page](https://docs.volcengine.com/docs/82379/1494384) |
| `baidu-qianfan` | Official service | Selected facets | [Primary page](https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb) |
| `tencent-hunyuan` | Official service | Selected facets | [Primary page](https://cloud.tencent.com/document/product/1729/111007) |
| `baichuan` | Official service | Unverified / preserved | [Unverified locator](https://platform.baichuan-ai.com/docs-v2/api) |
| `stepfun` | Official service | Selected facets | [Primary page](https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create) |
| `zero-one` | Official service | Example only | [Primary example](https://platform.lingyiwanwu.com/docs/api-reference) |
| `azure-openai` | Hosted interface | Selected facets | [Primary page](https://learn.microsoft.com/azure/ai-foundry/openai/reference) |
| `aws-bedrock` | Hosted interface | Selected facets | [Primary page](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html) |
| `vertex-ai` | Hosted interface | Selected facets | [Primary page](https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai) |
| `ollama` | Local reference | Reference / not qualified | [Primary page](https://docs.ollama.com/api/openai-compatibility.md) |
| `lm-studio` | Local reference | Reference / not qualified | [Primary page](https://lmstudio.ai/docs/developer/openai-compat.md) |
| `localai` | Local reference | Reference / not qualified | [Primary excerpt](https://localai.io/features/text-generation/) |
| `vllm` | Local reference | Reference / not qualified | [Primary page](https://docs.vllm.ai/en/latest/serving/online_serving/) |
| `sglang` | Local reference | Reference / not qualified | [Primary page](https://docs.sglang.io/docs/basic_usage/openai_api_completions.md) |
| `openrouter` | Aggregator | Selected facets | [Primary page](https://openrouter.ai/docs/api_reference/overview) |
| `newapi` | Community gateway | Community reference | [Primary page](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createchatcompletion) |
| `sub2api` | Community gateway | Community reference | [Primary page](https://raw.githubusercontent.com/Wei-Shaw/sub2api/main/README.md) |
| `openai-compatible` | Protocol identity | Protocol only | [Primary page](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| `anthropic-compatible` | Protocol identity | Protocol only | [Primary page](https://platform.claude.com/docs/en/api/http/messages/create) |

## Offline acceptance

`test:provider-official-docs-review` runs six permanent review/API/capacity/
model-bound test files, including source-ledger integrity, under the offline guard.
`test:provider-compatibility` retains all 62 independent focuses, including the
original 58, with allowlisted environment, individual process logs and stable
source fingerprints. Neither command qualifies a real supplier or device.

The original accepted source is recorded in
`regression.lastOfficialApiVerification`; follow-up acceptances append to
`regression.officialApiRevalidations` in
[`provider-maintenance-ledger.json`](../../scripts/fixtures/provider-maintenance-ledger.json).
That existing verification ledger is excluded from the regression source hash
to avoid self-referential receipts. The new source review fixture is included.

Prior security deadlines and remote CI/device gaps remain unqualified; their
records are not rewritten. The original accepted module gate reported zero
issues; the follow-up reruns the same rules without waiving historical evidence.

## Historical accepted source: acceptance 9

Verified locally on 2026-11-01, Asia/Taipei. This is source-contract acceptance,
not release, supplier-account, browser-export or device qualification.

| Check | Result |
| --- | --- |
| Official API review | 6 files, 218 tests passed |
| Full Jest | 359 files, 4679 tests passed; zero failures/pending |
| Independent provider focuses | 62/62 passed; four bounded process shards using the unchanged offline runner |
| SQLite package targets | Exactly 12 files, 94 tests passed with Bun 1.4.2; dotenv-free equal-source snapshot |
| Related checks | 23/23 passed; collectors only in self-test mode |
| Type and architecture | Type check, include-type graph, transport boundary, both self-tests and module gate passed; zero cycles/current module issues |
| New UI behavior preserved | 137 focused tests and 75 feedback/persistence tests passed |

Historical accepted regression input SHA-256:

```text
1869dad43ad41032f0a83b49b93faa7a3a0ba4136a7aa147d461c3039d7d85e8
```

The source fixture is included in this digest; the appended verification ledger
is excluded to avoid self-referential receipts. Final ledger contracts, security
policy revalidation and full frozen-worktree preservation are bound in
`C:\Users\barna\.codex\visualizations\2026\10\31\01a19103-0e59-7d30-8ded-a301a9cef67a\official-api-review\continuation-2026-11-01\final-acceptance-9\final-local-verification.json`.

Continuation policy authorized on 2026-11-01: preserve pre-existing and newly
arriving changes by default, never revert them, retain failed/superseded evidence,
and repair/reverify the latest source. Quiet-window waiting does not lock files.
The new fixed status-slot UI is preserved; old Save/Copy selectors now check
accessible receipts, stable labels, busy/disabled state and absent extra success
rows while retaining strict-write, failure, recovery and retry assertions.
The extracted provider connection row is also retained. Its updated parent
contract checks delegated identity/state/callbacks, and the child regressions
retain full accessible labels plus independent selection, opening and editing.
The performance script now checks the rendered row rather than removed inline
JSX, retaining shrinkable width, flexible minimum height and bounded labels
without changing catalog, diagnostic or coalesced-write performance limits.

Four original security advisory exceptions remain, covering five locked-version
matches; the earliest expiry is 2026-11-07 00:00 Asia/Taipei. The security check
reuses retained public-registry evidence offline; it is not a new registry scan
or a clean-lock claim. Earlier document-set findings remain in historical records;
the current unmodified module gate reports zero issues. No user credentials,
real inference, paid smoke, device qualification, commit, push or publish was used.

## Follow-up review: LocalAI and current UI contracts

Continued on 2026-11-01, Asia/Taipei. Preserve acceptance 9 and every earlier
receipt; none certifies the latest tree after new changes.

The actual primary LocalAI pages establish selected Chat facets:

- [Interleaved thinking](https://localai.io/docs/features/interleaved-thinking/)
  returns `reasoning` beside `tool_calls`; the client returns that original
  assistant state followed by the tool result. Inbound `reasoning_content`
  is accepted as an alias; the application's canonical outgoing field is
  `reasoning`.
- [Text generation](https://localai.io/docs/features/text-generation/) and
  [OpenAI functions](https://localai.io/docs/features/openai-functions/) document
  reasoning output and backend/parser-dependent streaming aliases. This review
  does not qualify an installed server, any particular model or parser version.

The three excerpts and their exact selected-text hashes are retained in
`continuation-2026-11-01/followup-1/official-tool-excerpts.json`. Direct host
HTTPS retrieval failed for all four attempted documentation pages; those
failure receipts remain in `followup-1/official-docs-fetch-1/fetch-results.json`.
The successful evidence is tool-extracted primary text, not original HTML,
complete page retrieval, a search-only snippet or a live capture.

Before changing production behavior, the new LocalAI block reproduced seven
failures among 76 request regressions with stable source. Sixteen new cases
cover the canonical replay, both response aliases, streaming fragments, exact
whitespace and tool results, and negative admission boundaries. Only explicit
`presetId: 'localai'` with the OpenAI-compatible Chat wire and returned assistant
tool-turn reasoning qualifies replay. Model/display names or localhost alone
do not. Unknown local-model reasoning controls, text-only replay, invented
state, Anthropic wire and request-local Responses adapters remain excluded.
The original 70 source records, 12 findings, other provider decisions,
verified values, defaults, saved identifiers and pricing boundaries are retained.

New document editor and usage UI changes are preserved. The installed React
Native 0.86.3 no longer exposes `StyleSheet.absoluteFillObject`; the
[official removal note](https://github.com/react/react-native-website/blob/main/website/blog/2026-04-07-react-native-0.85.mdx)
and [current StyleSheet API](https://reactnative.dev/docs/stylesheet) support
`StyleSheet.absoluteFill`. The fixed, fluid save-status slot and inaccessible
measurement text remain intact, with four focused regressions. This is a
source/API correction, not device or full SDK migration qualification.
Shared redacted usage-detail types move to a neutral contract file, retaining
the parent's type re-exports and UI behavior while removing the parent/child
include-type dependency cycle; the redaction boundary is not weakened.

Latest targeted diagnostics pass on stable source: six official API suites
(235 tests), fifteen UI suites (179 tests), the original LocalAI independent
focus, type checking and the include-type graph (zero cycles). The earlier
failed/drifted diagnostics remain retained. These are intermediate diagnostic counts, not the final receipt. Complete
follow-up acceptance and its append-only history are recorded for the exact
source below, with final ledger/security and full-worktree preservation binding.

## Latest accepted source: final-acceptance-11

Verified locally on 2026-11-01, Asia/Taipei. This accepts the exact frozen
source and full git-visible worktree, not a release, supplier/local-backend
account, remote CI, browser export or device. Later changes require fresh acceptance.

| Check | Result |
| --- | --- |
| Source review | 45 identities, 73 source records, 13 counterexample groups; original evidence retained |
| Official API review | 6 files, 236 tests passed |
| Full Jest | 362 files, 4711 tests passed; zero failures/pending |
| LocalAI replay | 16 permanent cases passed; seven pre-fix failures retained |
| Independent provider focuses | 62/62 passed using the original offline runner in four bounded shards |
| SQLite package targets | Exactly 12 files, 94 tests passed with Bun 1.4.2; dotenv-free equal-source snapshot |
| Related checks | 23/23 passed; collector and smoke planner only in self-test mode |
| Type and architecture | Type check, include-type graph, transport boundary, both self-tests and module gate passed; zero cycles/current issues, no waiver |
| UI behavior preserved | 15 suites, 179 tests; 75 feedback/persistence tests passed |
| Post-ledger contracts | 67 tests passed after the immutable history append |

Accepted regression input SHA-256:

```text
1d0c8ec1c03ee1a60810226895d96d33c98b1e4f242d96e86cd23b310bdcb216
```

The source review fixture is included. The maintenance verification ledger
is excluded as before to avoid self-reference; its final hash, the review
document hash and the complete frozen-worktree preservation are bound in
`C:\Users\barna\.codex\visualizations\2026\10\31\01a19103-0e59-7d30-8ded-a301a9cef67a\official-api-review\continuation-2026-11-01\final-acceptance-11\final-local-verification.json`.

`regression.lastOfficialApiVerification` remains unchanged. This continuation
appends one record to `regression.officialApiRevalidations`, retaining every
old ledger section and receipt. Only the ledger history and this review document
change after the full-tree freeze; no source exclusions or gate rules are widened.

Four original security exceptions still cover five locked-version matches.
Earliest expiry remains 2026-11-07 00:00 Asia/Taipei. The final policy check
reuses retained registry evidence offline, not a new scan or a clean-lock claim.
Selected primary LocalAI excerpts are not full HTML or backend/model qualification;
new Anthropic/Responses/grammar routes remain unenabled. No credentials, real
inference, paid smoke, local-server/device qualification, commit, push or publication.
