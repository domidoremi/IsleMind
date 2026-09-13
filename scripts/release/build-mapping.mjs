// Build scripts/release/history-mapping.tsv (English-first subject+body)
// Source: C:/Users/barna/AppData/Local/Temp/commits.json (114 entries, real SHAs)
// Output: SHA<TAB>English subject (preserve [skip ci] / [skip actions] markers)<TAB>English body
// Policy: Conventional Commits type+scope, concise subject; body compressed to <=6 short bullets.
import fs from 'node:fs';

const JSON_IN = 'C:/Users/barna/AppData/Local/Temp/commits.json';
const OUT = 'scripts/release/history-mapping.tsv';

const data = JSON.parse(fs.readFileSync(JSON_IN, 'utf8'));

// Per-commit overrides keyed by full SHA (from commits.json).
const M = {};
function set(sha, subject, body) {
  M[sha] = { subject, body: body || '' };
}

// ===== 000-011: head + merges =====
set('87f4438df9f0705357860cd615c1eecac5b37d73',
  'chore(release): publish 1.0.23',
  '- bump version 1.0.22 -> 1.0.23, versionCode 122 -> 123\n- sync version and changelog across English, Chinese and Japanese READMEs');

set('4035dafd7dc3ba997ab9a6c841670fccc707b84e',
  'chore(docs,config): sync docs, dependencies and model catalog',
  '- sync READMEs and architecture docs\n- update model catalog, mise.toml and package.json\n- adjust public/index.html preloading');

set('e523df138dceee58b14cbde805f0e7badc0b616b',
  'test(scripts): expand architecture and compatibility validation scripts',
  '- add unified-chat-context-orchestration and knowledge-retrieval-runtime-eval\n- add native-interruption evidence collector\n- refresh GitHub Actions workflows');

set('647be64a8ee1ef092aa61fe50a4502bd320f93e7',
  'feat(ui): refactor chat and settings theme experience',
  '- update chat panel, composer and MessageBubble interaction components\n- align provider and settings theme surfaces\n- sync three-language i18n resources');

set('070c67426ff74a9e2d44043f5c0e37978f546cf9',
  'feat(modules): unify assistant runtime and knowledge retrieval strategy',
  '- introduce unifiedConversationCapabilityPolicy\n- add contextArtifact, toolOutput and contextCompactionGuard strategies\n- extend knowledge module with sqlite scope, retrieval and rerank\n- add remote compression lifecycle and stream event buffer in providers');

set('affe2ff3d483e445cc536137c1ad44b15b254605',
  'feat(context): complete context orchestration and compression guardrails',
  '- add contextArtifactRuntime with tokenEstimation and contextCompactionGuard\n- update bootstrap and provider runtime contracts with tokenUsage accounting\n- extend settingsStore and types to expose new context capabilities');

set('eb9f059bf0c38fe8270ebfc32c502ee295ce14ce',
  'refactor(theme): compact theme tokens and add background environment system',
  '- shrink colors.ts from 1637 lines into a compact token table\n- add backgroundEnvironment module and tests\n- adjust themeExpression, themeMotion and themeTokens\n- sync global.css and .gitignore\n- add contentDigest, contextCompactionGuard and tokenEstimation core modules');

set('0ccb6d5e5b4bc48758126c2d685f7a72b60ccdb8',
  'feat(context): complete model compression lock and RAG fallback reporting', '');

set('3a544e4f43fea7fe509e8212eaf8d60ba2c702bb', 'merge: integrate chat flow and MCP output fixes', '');
set('1f860445164712581f1b5e9bacadc1f750ede9c7', 'merge: integrate Expo dependency assertion fix', '');
set('c0a7d3f80abd145699f242a8f3a5b6deae3c19e3', 'merge: integrate context capacity card', '');
set('4bc00e42fd2a6760d6cb67f141bf28a634a924d4', 'merge: integrate model context compression and parameter fix', '');

// ===== 012-030: context/test/ui work =====
set('750ac08267ddf262fc87be5c53f929d06b03a3b3',
  'test(assistant-runtime): cover SQL path for per-conversation context receipt reads',
  '- prepared-request holds a real receipt and asserts runId, capturedAt and deep equality\n- frozen request without capture verifies contextReceiptJson IS NOT NULL filter\n- unknown conversation returns undefined');

set('7c1543116266c495089e860f178b8da48de20b71',
  'feat(settings): add model compression toggle in context page with regression',
  '- ContextPanel gains a "compress context with current model" switch with extra-billing notice\n- context-compression-v2 adds: off state keeps local-structured-v2; on state uses application-model-summary with reason application_model_summary\n- in-flight compression trace stays running after sanitizeTrace with no completedAt');

set('4318878303035b5afaa40f202ddb45a692a2bb99',
  'feat(context): show compression progress as in-flight state',
  '- recordCompleted wraps any trace in completeTrace; sanitizeTrace rewrites a running trace with completedAt into done, so the step appears 0ms done before the summary request\n- new recordRunning writes a running trace without completedAt; the summary path overwrites the same trace id with the terminal state via upsertTrace, removing the duplicated -done / -fallback step');

set('74653e37c7be998de3439e5caf1a8a972cb11628',
  'feat(context): support compressing context with the currently selected model',
  '- providerApplicationContextSummary and application-model-summary branch were wired but unreachable: decideRemoteCompact never emitted that strategy and resolveProviderContextManagement always returned local-structured-v2 when native compression was unavailable\n- add modelContextCompressionEnabled (off by default); on, with native compression unavailable and privacy gate passed, decideRemoteCompact yields application-model-summary using the active model');

set('468d81ee9eec98995cd29318912762119e416e1f',
  'feat(chat): add context capacity card on home screen',
  '- project the persisted but never-rendered AssistantContextPlanReceipt into a readable capacity view, opened from the layer button in the conversation header\n- assistant-runtime adds getLatestContextReceipt port per conversation; SQLite and in-memory implementations land together\n- new projectContextCapacity projection: denominator is requestBudgetTokens + fixedTokens');

set('fd7ab6af612107630d55813f40cad7ee065f8a43',
  'docs(readme): bump version info to 1.0.22',
  '- three READMEs still said v1.0.21 / versionCode 121 while app.json and package.json are at 1.0.22 / 122\n- v1.0.22 release ships no APK asset, so the download link still points to 1.0.21 with an explicit note\n- drop unused getDefaultProviderModelIds (returned [] unconditionally); AIModel.maxTokens remains an intentionally retained legacy field declared by provider-intelligence');

set('fcd4a91ba445d1084287398c22aaaba93808033b',
  'fix(test): repair four source assertions broken by renames',
  '- product-experience: AnimatedProcessStatusText param thinkingStartedAt renamed to stageStartedAt\n- tavern-core: portableDataPayload serialization variable payload renamed to serialized, still serialized once\n- streaming-cleanup: chatStore test double missing transitionMessageLifecycle; finalize switched from await to return');

set('4b8e185be8778d36f7f93f77c5920a30767c94ab',
  'test(providers): cover all reasoning modes and output budget precedence',
  '- reasoning-runtime-compatibility only covered 3 of 12 reasoningMode shapes; 9 had no assertion so dropped request fields would be silent\n- provider-parameter-matrix adds real body assertions: each reasoningMode lands in the correct wire field, user output budget overrides catalog default and clamps to model maxOutputTokens');

set('ddbbe9f5414a28a0c5c3dc6c845568137b4b0fbc',
  'fix(chat): user-configured output budget and temperature flow into the request',
  '- new conversation and home settings shell initialised generationParameterOverrides to {} so resolveGenerationParameterSources treated the user default as provider-default and dropped the field; the active value became the provider default\n- configured global defaults are now marked explicit: chatStore seeds the new conversation with defaultTemperature / defaultMaxTokens and explicit override flags');

set('26ea81c533bca03e60e9a6d103a17a6877233ab7',
  'fix(test): align expo-blur assertion with actual consumer',
  '- web-style-runtime-boundary-tests.js pins expo-blur alongside nativewind and @expo/vector-icons as "must not regress as unused production dep"\n- src/components/chat/glass/GlassSurface.tsx now consumes BlurView and BlurTargetView via ChatThemeSurfaces -> GlassSurface -> expo-blur, so the premise is invalid and the suite has been red on main for a long time');

set('f55c5868fe9494e5e69cf9f2e72ee153e401070b',
  'fix(test): restrict jest discovery to src and scripts',
  '- jest picked up nested worktrees under .claude/worktrees/. On main checkout this surfaced 118 test files, 52 of them from .claude/worktrees/preview-55f5f2d, polluting the host result\n- jest config gains roots limited to <rootDir>/src and <rootDir>/scripts, covering all 66 existing test files (65 in src, 1 in scripts)');

set('11c16563d68d09bca717eb6c170bd4e79bfe1d6b',
  'fix(test): transform moti to restore theme surface suite',
  '- moti 0.30.0 main points to build/index.js (ESM); jest transformIgnorePatterns keeps the jest-expo default whitelist and does not include moti, so `import { MotiView } from "moti"` in src/components/ui/isle/ThemeExpressionSurface.tsx fails to resolve and the suite reports "Jest failed to parse a file" without ever running');

set('5992f86b424d632bc6d787845019c14e918a5f7b',
  'fix(repo): normalize working-tree line endings to LF',
  '- contract tests read source via fs.readFileSync and match multi-line literals containing \\n. With core.autocrlf=true a fresh Windows checkout writes CRLF and the matches fail: the same commit passes on the long-lived main checkout and fails on a new worktree\n- add repo-level `* text=auto eol=lf`; index was already LF, so `git add --renormalize .` only surfaces .gitattributes itself, no content rewrite');

set('d399c68d6741987ba68820fc5b122fd8628a1f58',
  'test(mcp): tool fallback contract no longer echoes raw output',
  '- assistantMcpToolTurnRuntime already returns chatRunner.error.providerToolSynthesisFailed from both fallbacks; the raw observation output is only used as synthesis input\n- mcp-compatibility-tests.js still encoded the old contract (empty formatted block echoes observation.output; synthesis failure echoes MCP result + toolOutput); updated to match\n- new assertions: synthesis-failure return text does not contain the raw tool output; empty formatted block keeps observation.output as revisionMessages toolOutput');

set('0ba7891c2004e271224e5c136f229fd1b7a83914',
  'wip(chat): stash MessageBubble lifecycle panel trim',
  '- unfinished work snapshot, only landed to fast-forward local main to a0e3878; not a mergeable state\n- MessageBubble.tsx drops safeTraceWorkSummary, trims lifecycle label and thinking preview\n- also includes in-flight changes to Dialog, plainChatProjection, assistantMcpToolTurnRuntime, tracePresentation, conversationAssistantDurableExecutionRuntime and appFeedbackState tests');

set('ce12d219f75e23cd0a52ed7a027c55a939871a2c',
  'fix(assets): model fixtures opt out of EOL conversion',
  '- assets/models/catalog.json pins every fixture by bytes and sha256\n- with core.autocrlf=true and no .gitattributes, a new checkout materialised config.json, special_tokens_map.json, tokenizer_config.json and tokenizer.json as CRLF, changing bytes and hashes\n- this made verifyConfiguredLocalEmbeddingModel fail on Windows; provider-intelligence-tests.js:30465 failed for that reason; the committed blob is LF and matches the pinned bytes');

set('c98ef1d09b0fcdd028303cbaf91b5d5475f9f1f6',
  'fix(test): rich-card full-width assertion matches current implementation',
  '- 9feadd0 rewrote MessageContent.tsx rich card from IslePanel to plain View, so contentStyle={{ padding: contentPadding, width: "100%" }} disappeared; provider-intelligence-tests.js full-width assertion has been red on main since\n- the assertion was pinning an IslePanel detail; the described full-width behaviour is still satisfied by the current View: alignSelf / width / maxWidth / minWidth and padding live on the same style block\n- switch to matching that whole style block, which is strictly tighter than the four file-wide includes');

set('a0e38788f9ec402a7c034895a26cd4ec2429ce1f',
  'fix(architecture): repair two boundary-gate blockers',
  '- move responseLifecycle and its test from src/services/ into modules/conversations/application/; portableDataPayload now imports from @/modules/conversations to clear the compat-layer import violation\n- chatStore, chatStreamingStore and MessageBubble route through the conversations barrel\n- MessageBubble timeline summary falls back via formatProcessTraceForDisplay(trace, 720).content, sharing the same sanitization and truncation path; reasoning without displaySummary still renders empty\n- the two flags have been failing on main since 9feadd0 and are unrelated to this branch canvas changes');

set('d600a00e1f69685153e205c2f104bcbca256f833',
  'refactor(chat): share the reading column between canvas and composer',
  '- on wide viewports the conversation canvas and the input dock each filled the viewport: assistant body on the left, user bubble on the right, reading like two columns instead of one\n- productMobileLayout gains readingColumnMaxWidth (880) emitted by the message list layout; canvas contentContainerStyle centres around that value; message bubbles measure against the canvas box rather than the raw viewport, so both roles share one column width');

// ===== 031-040: 1.0.22 + i18n + 1.0.19 =====
set('9feadd0bf3069dbf91a4cd089a630d0713e8c5c2',
  'feat(release): publish 1.0.22',
  '- refine conversation UI, theme expression and mobile interaction\n- strengthen provider runtime, data management, diagnostics and native Android capabilities\n- update Expo dependencies, build pipeline and Android versionCode to 122');

set('bcf09850cb026ec8c008bfab62c684c6e3ec5f17',
  'chore(website): add site static assets',
  '- index.html, main.js, styles.css and site-meta.json power the 1.0.21 landing page\n- bundled brand icon, favicon, Android forensic screenshot and four UI screenshots');

set('a6c289c9e013eade4d66cb127f6d243fa5eb845d',
  'fix(i18n): error messages render in the selected language',
  '- add core/userFacingError: resolve localized copy by error code, with original text as parenthetical detail\n- chat bubbles and the session-health banner rebuild copy from the persisted error code at render time, no longer replaying the write-time sentence\n- providerOperationResult exposes PROVIDER_HTTP_COPY_ONLY_CODE_KEYS so pure-copy error codes no longer carry the old language sentence in parentheses\n- 14 toast / notification sites route through a shared helper; fill missing error keys in en, zh-CN and ja\n- provider-intelligence gains three-language regression assertions and a copy-only mapping drift guard');

set('9dc9cb80df763cb708d70c161c719b3f3af2d91b', 'fix(ui): rebuild chat layout and themed feedback', '');
set('14c88ce8458b39ba70df31013f77fdf111d6cbed', 'docs(release): tighten 1.0.21 changelog wording', '');
set('871c25d97b15e16597a5f9deed775a4f5f0702df', 'docs(repo): update 1.0.21 docs and authorship rollup', '');
set('756ce66d8e3fa48b05b56b931ba65b97c6381e4d', 'fix(release): publish 1.0.21 conversation experience fix', '');
set('53f96a363e6abf649b639ad20b3a33a0fb3f985f', 'chore(release): polish build asset cleanup', '');
set('377e3e849c036c52e51a1d4bf38a1fcf0aead9f0', 'chore(release): publish 1.0.20 experience and model update', '');

set('d3db1d15a3ac81821c81a1ec39cd24ebecf7fb1c',
  'fix(release): publish 1.0.19 stability update',
  '- complete vNext contract convergence, resume and cancel semantics\n- consolidate Plain / Rich message identity and chat experience\n- sync Expo SDK 57 patch dependencies and add Android QA evidence');

// ===== 041-051 =====
set('8d112ad1bdd5997a6c738a10d373c3c588a1934a', 'docs(chat): define long-draft composer design', '');

set('1147a09899adc922dac0450bf05da5be129d1158',
  'docs(architecture): update vNext migration and recovery boundaries',
  '- document the conversation, knowledge and memory modernization migration\n- update persistence snapshot, event recovery and deletion conditions\n- sync English and Chinese READMEs verification entry points');

set('ea9efd3eee27ab4e75d4644455391acacbf1a49e',
  'chore(release): publish 1.0.18 and tidy verification entry points',
  '- bump app version and Android versionCode\n- extend architecture, runtime and product regression script coverage\n- remove the deprecated theme-structure test entry point');

set('2617c7888ba937168a019c14990b119219003477',
  'feat(theme): polish chat and settings theme expression',
  '- unify chat, settings and provider theme experience components\n- add theme expression controls, search field and tooltip components\n- refine message, navigation, empty-state and interaction feedback layout');

set('9c5c20fc2740526afc3b9c3308e3f0044dd9055c',
  'feat(runtime): harden conversation runtime persistence and recovery',
  '- solidify request snapshot, context plan receipt and recovery boundary\n- complete persistence contracts for session, knowledge base and stream events\n- add focused tests for conversation runtime and knowledge retrieval');

set('f9e6d1492ab9d7359c21b09a037a6c9859d7e19f', 'feat(theme): ship 1.0.17 four-theme experience', '');
set('1afed1590fb8613a85f92aab4a988f1335825c03', 'chore(release): publish 1.0.16', '');

set('1b4b758e64ec35abefa0955c2ae17606247060cc', 'docs(repo): drop local proxy config and simplify README [skip actions]', '');
set('88fe040cc880f509cc4ae471415fe45aa9813414', 'docs(readme): rewrite project description and clean repo layout [skip actions]', '');
set('897532d464e79721ab4e270cec4805cb93a53b15', 'chore(release): publish 1.0.15 [skip actions]', '');
set('588278950849adea156ccf9742148e967d2ed944', 'refactor(vnext): complete 1.0.14 architecture and experience upgrade [skip actions]', '');

// ===== 052-065 =====
set('f6b2c2ccd49859af40c12a58821dde172542b6fa',
  'fix(providers): fix batch-enable state merging',
  '- merge batch-enable provider patches with credential group health updates\n- reduce provider list and model strategy compute load\n- add performance guardrails and batch failure grouping');

set('07081d05b2177ecd11ca0a7ee719180b97788f9b', 'perf(providers): reduce load after batch enable', '');

set('1255fb46b36fe6d62e9601c10d50d1279b91f4ee',
  'feat(modernization): complete cross-layer modernization',
  '- close provider, context, agent, security, product and release compatibility gates\n- add release-readiness and modernization-completion final checks\n- preserve existing runtime behavior and update architecture plus QA evidence');

set('d63167fb223875f1af056ea03ccb4a8db617fe26',
  'feat(provider): build relay compatibility capability layer',
  '- route by provider.type / wireProtocol; model family is only used for UI, diagnostics and default inference\n- add provider+model capability matrix, request trimming, minimal chat fallback and runtime logging\n- extend relay, model sync, activation diagnostics and chat-runtime contract tests');

set('0bae038fefd55c18e0dac49c52b1f9f337a2800d',
  'fix(release): publish 1.0.13 and fix MiMo import',
  '- bump Android versionCode and update manifest to 1.0.13\n- fix MiMo multi-protocol paste import and sampling-parameter gate');

set('0fe750e40a048ffbaf900683c9018d3d6da9daca', 'fix(chat): refine top-bar motion and icon semantics', '');
set('7be615b32ac289e6e0fd9beadb9e9efee8277679', 'fix(chat): correct thinking expansion content', '');
set('e764ff42d9f7b5d650ef25419c8d17a466af28fa', 'fix(chat): refine model response status presentation', '');

set('768eba8bba309572fa8e25a5174c5b0714618779',
  'fix(provider): generalize capability detection from display name',
  '- use generic alias keys to match provider console model names\n- support filling catalog capabilities for opaque model IDs via display_name\n- cover Qwen, Claude, Gemini, MiniMax and Grok regression samples');

set('ab803218127acbae5879f45434ae44d02c64caf5',
  'fix(provider): recognize Grok console model capabilities',
  '- normalize Grok 4.20 console model names into the built-in xAI catalog\n- preserve capability differences between non-reasoning, multi-agent and reasoning models\n- add provider-model-discovery focused regression tests');

set('fe67adc707d549da3b497760f621e02b4800e391',
  'fix(provider): fix provider import and runtime error diagnostics',
  '- correct import sheet bottom inset under Android keyboard\n- normalize custom OpenAI-compatible prefix paths to /v1\n- classify relay 503 model_not_found as model unavailable');

set('12c7a191bdfcbfacff1d78500fa1b6bf1671071b',
  'fix(mimo): repair parameter error fallback handling',
  '- avoid misclassifying MiMo HTTP 400 parameter errors as a provider address problem\n- perform a single safe fallback retry on MiMo thinking and web_search parameter errors\n- complete provider-intelligence regression tests and runtime error code propagation');

set('bc678834ba80bdbf836b907534ed32f6e11791a7',
  'fix(provider): strengthen provider compatibility and debug runtime path [skip ci]',
  '- complete model provider compatibility contracts, runtime diagnostics and structured output handling\n- tighten native search, tool calling, fallback routing and chat tracing\n- split agent barrel import to remove the Require cycle warning in Debug Build startup');

set('14a3da7467081db5a3d5c4835e691c83120965c9',
  'fix(provider): fix multi-protocol provider import and endpoint selection',
  '- multi-protocol endpoints on the same host no longer expand into multiple providers\n- when the Anthropic endpoint comes first, baseUrl selection is corrected so model discovery succeeds\n- expandProviderImportChunk now collapses same-host multi-protocol endpoints into a single provider');

// ===== 066-075 =====
set('2cec3a45719f6c43ce308ac05c478119233d2f97',
  'fix(ui): fix keyboard occlusion and model selector scrolling',
  '- provider import sheet: drop KeyboardAvoidingView paddingBottom: keyboardInset\n- drop ScrollView dynamic bottom padding\n- only scroll to bottom when content exceeds 5 rows\n- rely on automaticallyAdjustKeyboardInsets for keyboard avoidance');

set('9593d0d838469e9ad105cd6db3ff9b00c87797f3',
  'fix(provider): fix import sheet input occlusion by keyboard',
  '- in the provider import sheet the input was occluded at the top when the keyboard opened\n- add automaticallyAdjustKeyboardInsets to the ScrollView and a top inset to give the title room');

set('b770903871585f215a2adb008e6d35e8a781cf09',
  'fix(provider): fix duplicate multi-protocol provider import',
  '- pasting a config with multiple protocol endpoints (OpenAI and Anthropic) for the same provider was being treated as two separate providers\n- expandProviderImportChunk: collapse same-domain multi-protocol endpoints into a single provider\n- extractLooseKeys: filter out protocol labels to avoid mistaking them for keys');

set('5089d3252f89df000264ee5528fd26687585510c',
  'feat(release): publish 1.0.12 chat experience update',
  '- add conversation navigation, top-bar stay and generation status display\n- adjust thinking-strength default level and single-click toggle\n- tighten provider parameters and web answer finalization stability');

set('b7db5963800425a5ac319d9bdfcaedbd79f3098f',
  'fix(chat): fix tool calling and update interaction issues',
  '- fix text tool call fallback execution and message render leak\n- complete APK update progress display and 1.0.11 update manifest\n- adjust chat top-bar spacing and auto-collapse interaction');

set('3a6fcc57120f38612581f2cc2e37c24cb0381b91',
  'fix(updates): fix APK update manifest lag',
  '- sync Android update manifest to 1.0.10 / 110\n- keep confirming GitHub Latest when the old manifest is behind\n- add regression test: 1.0.9 detects 1.0.10');

set('3a4ed2a493e4a7877308ec00f7eb39d533b6c9bd',
  'fix(android): fix chat surface and search tool experience',
  '- fix Android top safe area, bottom input bar iconography and message overlap refresh\n- improve provider import, runtime deep link and background generation notification state\n- add visible no-result and native-mode error output to built-in web search');

set('c1139fe3aa8cb7316c71cf120e61dce41c60b1a1',
  'fix(release): publish 1.0.9 and fix release gate',
  '- update package.json and app.json to 1.0.9 / versionCode 109\n- add expo-font so @expo/vector-icons passes the Expo Doctor peer dependency check\n- add .mailmap to roll up historical Claude co-author attribution to the primary maintainer');

set('c97006bb0ffb966c3b09e9b1330d09ba48045c7f',
  'feat(runtime): harden provider, theme and Android audit',
  '- split provider / chat / context runtime modules; complete model, tool calling, playback and diagnostic paths\n- strengthen theme system, contrast self-check, Android capability boundary and status notification audit\n- update architecture docs and release gates; remove stale production QA matrix entry');

set('ebe7abb51388e2dbe4975e099a847d4245bb4dd4',
  'fix(release): publish 1.0.8 and add release gates',
  '- bump app version and Android versionCode\n- complete RAG, agent, QA audit and raw-evidence contracts\n- fix pre-release type, provider-intelligence and doctor gates');

// ===== 076-090 =====
set('08be5d8e5784ac50379bdbb7ccb3c9d3d427aef5',
  'fix(ui): status bar follows content background',
  '- main screen status bar uses the canvas background color (beige)\n- dialog status bar uses the backdrop mask color (gray)\n- align status bar color with the top content');

set('e0f41d4ed558d01cea273fee348e7f10529fda6b',
  'fix(ui): dialog status bar uses light icons',
  '- add StatusBar component to the Dialog modal\n- while the dialog is shown, status bar icons switch to light\n- improve readability over the dark mask');

set('a4b789a9431c5b629cc750f06e22b6389a0f07ba',
  'fix(ui): fix status bar immersion experience',
  '- add translucent and transparent background to StatusBar\n- reduce the dialog-mask and status-bar contrast clash\n- improve global interface immersion');

set('1d7883f6c9832677e4f55559cc2df1ac89bb2fc0',
  'feat: cumulative feature updates and optimizations',
  '- add performance monitoring and optimization tools\n- add image compression and lazy-load service\n- refine UI components and theme system\n- enhance AI service and provider management\n- improve type definitions and i18n resources\n- add test and validation scripts');

set('b1880f7806b2f21dbe68219fee3bb833f286ad69',
  'refactor(store): split streaming handling into a dedicated store',
  '- new chatStreamingStore dedicated to streaming message state\n- decouple streaming from chatStore to raise module cohesion\n- chatRunner now uses the new streamingStore\n- cohesion projected from 64% to 70%+');

set('eef5a8d176f74add5d376dff417136450075b4fb',
  'feat(android): integrate Android 16KB APK auto-verification',
  '- automatically run --strict validation after every apk:local:release command\n- add apk:validate-16kb:strict as a standalone command\n- ensure release builds comply with Android 16 16KB page requirement');

set('eae6e97733478a8d35910f5fd97ba2dece600a82',
  'chore: clean temp files and add new feature modules',
  '- remove temp output dirs (dist-apk, test-evidence, output, local-docs)\n- remove dev caches (.codex, .gitnexus, .expo)\n- remove temp docs and reports\n- remove Android log files\n- add Jest config file\n- add Android native plugins (device tools, status notifications)');

set('b8c34ed1f06dfd5a8fd9775c2b317b3a91b89616', 'docs(readme): remove public documentation directory index', '');
set('a09a86182061c2cf0901850541d030a2fd70c73d', 'docs(readme): trim public documentation entry points', '');
set('f42e432b4903161a27d8e5ef2d87e03efa0bf618', 'chore(release): publish 1.0.7', '');
set('79f8190f66ec09ac80c072d19a27360ffacfbb3d', 'fix(app): improve chat interaction and update-check reliability', '');
set('0349c3bd1d78d9aa634b66d015f3b3a29cc1ad97', 'test(qa): extend Android smoke evidence collection', '');
set('d0a7d29cecc6623241373c58dbfc872c7379d6df', 'feat(settings): add workspace ready state and page transition', '');
set('7adce2c8bc2fc4f51761776d1783aa1ab20b6cff', 'feat(chat): redesign minimal message bubble', '');
set('7f7e46e846edd6b2a6c180e1fbac56fbd6e1ccf2', 'docs(readme): tidy documentation entry and brand assets', '');
set('6da44d257aa91ec59c7579c15c99c17a2695db46', 'fix(i18n): fix first-launch language source', '');

// ===== 091-105 =====
set('4603f34ba4ace3a9746249e67d70e11c5ebd0673',
  'fix(release): add Android launcher background resource',
  '- generate ic_launcher_background drawable in the release config script\n- fix local prebuild release asset link failure');

set('0f81efc3e6a526f5eac7eca2c7d9fbec9d5bea41',
  'feat(app): complete app interaction and migrate to Bun',
  '- wire in-app command routing, action policy and tool registration\n- update chat, settings, provider import, screen state transitions and Isle UI experience\n- migrate package manager to Bun; refresh dependencies, validation scripts and dev docs');

set('b438bf7bdda13bc7c18294c1d990b11017d0e19e', 'chore(gitignore): tighten local temp file rules', '');

set('729617c1d18decb0fad02dda0f67d83e73f87dd4', 'feat(provider): complete runtime routing governance', '');

set('b8601f234cf203534c450774f4fd82847f2aa5aa',
  'feat(app): complete workspace governance and runtime diagnostics',
  '- add upstream governance, runtime log, remote compact, transport and policy controls\n- complete provider model tests, alias, capability declaration and batch activation checks\n- add workspace ready, memory audit, work product and release validation scripts');

set('750a641c56b0905c004efc9c0b3eeb08eb9ccb8a', 'fix(release): publish 1.0.5 experience fix [skip ci]', '');
set('247f0de4a3c00119b56240e9425a2ba8a0d01cea', 'fix(android): fix model panel and local model download [skip ci]', '');
set('6cf685f8bc1ca89ab802959a5d04a98ea8ec70db', 'feat(ui): complete Isle UI and interaction regression fixes [skip ci]', '');

set('62f9ae1a60cd541a2475183347ed04fb9c3c4d69',
  'fix(release): publish 1.0.4 compatibility fix',
  '- fix Android 16KB page-size compatibility dialog\n- refine provider enable, default model cleanup and composer shortcut entry\n- add local build 16KB alignment patch and validation coverage');

set('762c0158dfc6303391111e3445a23facebf246f6', 'docs(release): clarify APK architecture description', '');
set('1df827d94686ed771f1de294434735b7a1db51d2', 'fix(release): improve mobile APK download naming', '');
set('9b8f466ebb89b24fc306efbd71d5b2f95c4272b4', 'fix(release): add local APK per-architecture split build', '');

set('e4c6d1b991558b0e98d0d0c4b8d792959a53816a',
  'fix(release): publish 1.0.3 minor fix',
  '- fix home provider entry, composer command and citation panel empty state\n- fix Android SQLite missing exp causing RAG self-check to fail\n- add 16KB APK validation and model bundle release notes');

set('d6c5a09ec6a7497941d4c59e22aac21dc1d1d0a4', 'fix(release): fix multi-variant APK build cleanup flow', '');

// ===== 106-113: last 8 (English already) =====
set('8e6868fab4b9c92d5c1061e7662723dcb4f85e86', 'feat(rag): complete agentic RAG and release packaging', '');
set('f01b8a2cd58ce234c2d18c810243569f4f82baeb', 'chore(release): switch to manual release workflow', '');
set('05df33cc5123a5b22f4576a42f1843ac7cc94ab4', 'fix(app): improve provider import and launcher icon', '');

set('8d564482b63babaa2565e7ba830ba90658ea2f1c',
  'feat(app): refine navigation and provider configuration',
  '- add three-page pager and provider management entry\n- simplify provider configuration, batch import and model selection interaction\n- improve cold update check and publish 1.0.1 minor version');

set('9ad826c1825beed1d9d61867849bb2e2ae00150a',
  'feat(providers): simplify provider management and sync home state',
  '- redo provider page sorting, filtering, drag and batch enable entry\n- token groups move to per-group management; model list defaults to read-only\n- home top bar switches to provider status; fix model popover outside-click close');

set('ed03106d8512c0ff98e17f853258f2e9a3e28eb5',
  'feat(ai): complete multi-provider intelligent configuration',
  '- add provider preset, token group, model sync and search strategy capabilities\n- add context packaging, voice capability and provider-intelligence regression tests\n- update IsleMind brand icon and Android build dependencies');

set('5a1b44ce7617d6a5c8d3a6010b40f459fa81753f', 'chore: refresh CI actions', '');
set('0a100a9bd90cf4781deaa6ac53c7569837dba3fa', 'chore: initialize IsleMind 1.0.0', '');

const lines = [];
let missing = 0;
for (const c of data) {
  const entry = M[c.sha];
  if (!entry) { console.error('MISSING', c.sha); missing++; continue; }
  const subj = entry.subject.replace(/[\t\r\n]+/g, ' ').trim();
  const body = (entry.body || '').replace(/\r/g, '').trim();
  lines.push([c.sha, subj, body].join('\t'));
}
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log('wrote', OUT, 'lines:', lines.length, 'missing:', missing);
