import type { AIModel, ProviderType } from './index'

export const DEFAULT_MODELS: AIModel[] = [
  model('gpt-5.5', 'GPT-5.5', 'openai', 1050000, 128000, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.5', verifiedAt: '2026-06-10' }),
  model('gpt-5.5-pro', 'GPT-5.5 Pro', 'openai', 1050000, 128000, 8192, true, true, false, { supportsTools: true, supportsStreaming: false, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.5-pro', verifiedAt: '2026-06-10' }),
  model('gpt-5.4', 'GPT-5.4', 'openai', 1050000, 128000, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4', verifiedAt: '2026-06-10' }),
  model('gpt-5.4-pro', 'GPT-5.4 Pro', 'openai', 1050000, 128000, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4-pro', verifiedAt: '2026-06-10' }),
  model('gpt-5.4-mini', 'GPT-5.4 Mini', 'openai', 400000, 128000, 4096, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini', verifiedAt: '2026-06-10' }),
  model('gpt-5.4-nano', 'GPT-5.4 Nano', 'openai', 400000, 128000, 2048, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4-nano', verifiedAt: '2026-06-10' }),
  model('gpt-5.2', 'GPT-5.2', 'openai', 400000, 128000, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.2', verifiedAt: '2026-05-25' }),
  model('gpt-5.2-chat-latest', 'GPT-5.2 Chat', 'openai', 128000, 16384, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.2-chat-latest', verifiedAt: '2026-05-25' }),
  model('gpt-5.2-pro', 'GPT-5.2 Pro', 'openai', 400000, 128000, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['medium', 'high', 'xhigh'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.2-pro', verifiedAt: '2026-05-25' }),
  model('gpt-5', 'GPT-5', 'openai', 400000, 128000, 8192, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5', verifiedAt: '2026-05-25' }),
  model('gpt-5-mini', 'GPT-5 Mini', 'openai', 400000, 128000, 4096, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5-mini', verifiedAt: '2026-05-25' }),
  model('gpt-5-nano', 'GPT-5 Nano', 'openai', 400000, 128000, 2048, true, true, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'openai-effort', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5-nano', verifiedAt: '2026-05-25' }),
  model('gpt-4.1', 'GPT-4.1', 'openai', 1047576, 32768, 4096, true, false, false, { supportsTools: true }),
  model('gpt-4.1-mini', 'GPT-4.1 Mini', 'openai', 1047576, 32768, 4096, true, false, false, { supportsTools: true }),
  model('gpt-4.1-nano', 'GPT-4.1 Nano', 'openai', 1047576, 32768, 2048, true, false, false, { supportsTools: true }),
  model('gpt-4o', 'GPT-4o', 'openai', 128000, 16384, 4096, true, false, false, { supportsTools: true }),
  model('gpt-4o-mini', 'GPT-4o Mini', 'openai', 128000, 16384, 4096, true, false, false, { supportsTools: true }),
  model('claude-fable-5', 'Claude Fable 5', 'anthropic', 1000000, 128000, 8192, true, true, false, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview', verifiedAt: '2026-06-11' }),
  model('claude-mythos-5', 'Claude Mythos 5', 'anthropic', 1000000, 128000, 8192, true, true, false, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview', verifiedAt: '2026-06-11' }),
  model('claude-fable-5-20260602', 'Claude Fable 5 (compat)', 'anthropic', 1000000, 128000, 8192, true, true, true, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], sourceUrl: 'https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts', verifiedAt: '2026-06-11', deprecatedReason: 'Compatibility entry for earlier draft naming; use claude-fable-5.' }),
  model('claude-opus-4-8', 'Claude Opus 4.8', 'anthropic', 1000000, 128000, 8192, true, true, false, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview', verifiedAt: '2026-06-11' }),
  model('claude-opus-4-7', 'Claude Opus 4.7', 'anthropic', 1000000, 128000, 8192, true, true, false, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview', verifiedAt: '2026-06-11' }),
  model('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic', 1000000, 64000, 8192, true, true, false, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview', verifiedAt: '2026-06-11' }),
  model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 'anthropic', 200000, 64000, 8192, true, true, false, { supportsTools: true }),
  model('claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic', 200000, 64000, 8192, true, true, false, { supportsTools: true, reasoningMode: 'anthropic-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview', verifiedAt: '2026-05-25' }),
  model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 'anthropic', 200000, 64000, 8192, true, true, false, { supportsTools: true }),
  model('claude-opus-4-1-20250805', 'Claude Opus 4.1', 'anthropic', 200000, 32000, 4096, true, true, false, { supportsTools: true }),
  model('claude-opus-4-20250514', 'Claude Opus 4', 'anthropic', 200000, 32000, 4096, true, true, false, { supportsTools: true }),
  model('claude-sonnet-4-20250514', 'Claude Sonnet 4', 'anthropic', 200000, 64000, 8192, true, true, false, { supportsTools: true }),
  model('claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet', 'anthropic', 200000, 64000, 8192, true, true, true, { supportsTools: true }),
  model('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 'anthropic', 200000, 8192, 4096, true, true, false, { supportsTools: true }),
  model('claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', 'anthropic', 200000, 8192, 4096, true, true, false, { supportsTools: true }),
  model('claude-3-haiku-20240307', 'Claude 3 Haiku', 'anthropic', 200000, 4096, 2048, true, true, true, { supportsTools: true }),
  model('gemini-3.5-flash', 'Gemini 3.5 Flash', 'google', 1048576, 65536, 8192, true, true, false, { supportsTools: true, reasoningMode: 'gemini-thinking-level', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], sourceUrl: 'https://ai.google.dev/gemini-api/docs/thinking', verifiedAt: '2026-06-10' }),
  model('gemini-3-pro-preview', 'Gemini 3 Pro Preview', 'google', 1048576, 65536, 8192, true, true, true, { supportsTools: true, reasoningMode: 'gemini-thinking-level', reasoningEfforts: ['low', 'medium', 'high'], sourceUrl: 'https://ai.google.dev/gemini-api/docs/thinking', verifiedAt: '2026-05-25', deprecatedReason: 'Preview model is not recommended as a default.' }),
  model('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 'google', 1048576, 65536, 8192, true, true, false, { supportsTools: true, reasoningMode: 'gemini-thinking-level', reasoningEfforts: ['minimal', 'low', 'medium', 'high'], sourceUrl: 'https://ai.google.dev/gemini-api/docs/thinking', verifiedAt: '2026-05-25' }),
  model('gemini-2.5-pro', 'Gemini 2.5 Pro', 'google', 1048576, 65536, 8192, true, true, false, { supportsTools: true, reasoningMode: 'gemini-thinking-budget', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://ai.google.dev/gemini-api/docs/thinking', verifiedAt: '2026-05-25' }),
  model('gemini-2.5-flash', 'Gemini 2.5 Flash', 'google', 1048576, 65536, 8192, true, true, false, { supportsTools: true, reasoningMode: 'gemini-thinking-budget', reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://ai.google.dev/gemini-api/docs/thinking', verifiedAt: '2026-05-25' }),
  model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'google', 1048576, 65536, 4096, true, true, false, { supportsTools: true, reasoningMode: 'gemini-thinking-budget', reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://ai.google.dev/gemini-api/docs/thinking', verifiedAt: '2026-05-25' }),
  model('deepseek-v4-pro', 'DeepSeek V4 Pro', 'openai-compatible', 1000000, 384000, 8192, false, false, false, { supportsTools: true, reasoningMode: 'deepseek-thinking', reasoningEfforts: ['none', 'high', 'xhigh'], sourceUrl: 'https://api-docs.deepseek.com/api/create-chat-completion', verifiedAt: '2026-06-11' }),
  model('deepseek-v4-flash', 'DeepSeek V4 Flash', 'openai-compatible', 1000000, 384000, 8192, false, false, false, { supportsTools: true, reasoningMode: 'deepseek-thinking', reasoningEfforts: ['none', 'high', 'xhigh'], sourceUrl: 'https://api-docs.deepseek.com/api/create-chat-completion', verifiedAt: '2026-06-11' }),
  model('deepseek-chat', 'DeepSeek Chat', 'openai-compatible', 1000000, 384000, 8192, false, false, true, { supportsTools: true, sourceUrl: 'https://api-docs.deepseek.com/guides/thinking_mode', verifiedAt: '2026-06-11', deprecatedReason: 'Compatibility alias for DeepSeek V4 Flash non-thinking mode; retires on 2026-07-24 15:59 UTC.' }),
  model('deepseek-reasoner', 'DeepSeek Reasoner', 'openai-compatible', 1000000, 384000, 8192, false, false, true, { supportsTools: true, reasoningMode: 'deepseek-thinking', reasoningEfforts: ['high', 'xhigh'], sourceUrl: 'https://api-docs.deepseek.com/guides/thinking_mode', verifiedAt: '2026-06-11', deprecatedReason: 'Compatibility alias for DeepSeek V4 Flash thinking mode; retires on 2026-07-24 15:59 UTC.' }),
  model('qwen3.7-max', 'Qwen3.7 Max', 'openai-compatible', 1000000, 65536, 8192, true, false, false, { supportsTools: true, reasoningMode: 'dashscope-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://help.aliyun.com/zh/model-studio/text-generation-model', verifiedAt: '2026-06-12' }),
  model('qwen3.7-plus', 'Qwen3.7 Plus', 'openai-compatible', 1000000, 65536, 8192, true, false, false, { supportsTools: true, reasoningMode: 'dashscope-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://help.aliyun.com/zh/model-studio/text-generation-model', verifiedAt: '2026-06-12' }),
  model('qwen3.6-flash', 'Qwen3.6 Flash', 'openai-compatible', 1000000, 65536, 8192, true, false, false, { supportsTools: true, reasoningMode: 'dashscope-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://help.aliyun.com/zh/model-studio/text-generation-model', verifiedAt: '2026-06-12' }),
  model('qwen3.6-plus', 'Qwen3.6 Plus', 'openai-compatible', 1000000, 65536, 8192, false, false, false, { supportsTools: true, reasoningMode: 'dashscope-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://help.aliyun.com/zh/model-studio/text-generation-model', verifiedAt: '2026-06-12' }),
  model('qwen3.5-plus', 'Qwen3.5 Plus', 'openai-compatible', 1000000, 65536, 8192, false, false, false, { supportsTools: true, reasoningMode: 'dashscope-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://help.aliyun.com/zh/model-studio/text-generation-model', verifiedAt: '2026-06-12' }),
  model('qwen3.5-flash', 'Qwen3.5 Flash', 'openai-compatible', 1000000, 65536, 8192, false, false, false, { supportsTools: true, reasoningMode: 'dashscope-thinking', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://help.aliyun.com/zh/model-studio/text-generation-model', verifiedAt: '2026-06-12' }),
  model('kimi-k2.6', 'Kimi K2.6', 'openai-compatible', 262144, 32768, 32768, true, false, false, { supportsTools: true, reasoningMode: 'kimi-thinking', reasoningEfforts: ['none', 'high'], sourceUrl: 'https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model', verifiedAt: '2026-06-12' }),
  model('kimi-k2.5', 'Kimi K2.5', 'openai-compatible', 262144, 32768, 32768, true, false, false, { supportsTools: true, reasoningMode: 'kimi-thinking', reasoningEfforts: ['none', 'high'], sourceUrl: 'https://platform.kimi.ai/docs/models', verifiedAt: '2026-06-12' }),
  model('kimi-k2-turbo-preview', 'Kimi K2 Turbo Preview', 'openai-compatible', 262144, 32768, 32768, false, false, true, { supportsTools: true, reasoningMode: 'kimi-thinking', reasoningEfforts: ['none', 'high'], sourceUrl: 'https://platform.kimi.ai/docs/models', verifiedAt: '2026-06-12', deprecatedReason: 'Officially discontinued on 2026-05-25 and no longer maintained or supported; use kimi-k2.6.' }),
  model('moonshot-v1-8k', 'Moonshot V1 8K', 'openai-compatible', 8192, 8192, 2048, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.kimi.ai/docs/models', verifiedAt: '2026-06-06' }),
  model('moonshot-v1-32k', 'Moonshot V1 32K', 'openai-compatible', 32768, 32768, 4096, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.kimi.ai/docs/models', verifiedAt: '2026-06-06' }),
  model('moonshot-v1-128k', 'Moonshot V1 128K', 'openai-compatible', 131072, 65536, 8192, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.kimi.ai/docs/models', verifiedAt: '2026-06-06' }),
  model('glm-5.1', 'GLM-5.1', 'openai-compatible', 200000, 128000, 8192, false, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('glm-5', 'GLM-5', 'openai-compatible', 200000, 128000, 8192, false, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('glm-5-turbo', 'GLM-5 Turbo', 'openai-compatible', 200000, 128000, 8192, false, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('glm-5v-turbo', 'GLM-5V Turbo', 'openai-compatible', 200000, 128000, 8192, true, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('glm-4.7', 'GLM-4.7', 'openai-compatible', 200000, 128000, 8192, false, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('glm-4.7-flashx', 'GLM-4.7 FlashX', 'openai-compatible', 200000, 128000, 8192, false, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('glm-4.7-flash', 'GLM-4.7 Flash', 'openai-compatible', 200000, 128000, 8192, false, false, false, { sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview', verifiedAt: '2026-06-06' }),
  model('MiniMax-M3', 'MiniMax M3', 'openai-compatible', 1000000, 524288, 131072, true, false, false, { supportsTools: true, reasoningMode: 'minimax-thinking', reasoningEfforts: ['none', 'high'], sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2.7', 'MiniMax M2.7', 'openai-compatible', 1000000, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2.7-highspeed', 'MiniMax M2.7 Highspeed', 'openai-compatible', 1000000, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2.5', 'MiniMax M2.5', 'openai-compatible', 204800, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2.5-highspeed', 'MiniMax M2.5 Highspeed', 'openai-compatible', 204800, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2', 'MiniMax M2', 'openai-compatible', 204800, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2.1', 'MiniMax M2.1', 'openai-compatible', 204800, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('MiniMax-M2.1-highspeed', 'MiniMax M2.1 Highspeed', 'openai-compatible', 204800, 204800, 65536, false, false, false, { supportsTools: true, sourceUrl: 'https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json', verifiedAt: '2026-06-11' }),
  model('grok-4.3', 'Grok 4.3', 'openai-compatible', 1000000, 1000000, 8192, true, false, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'xai-reasoning-effort', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://docs.x.ai/developers/models/grok-4.3', verifiedAt: '2026-06-12' }),
  model('grok-4.20', 'Grok 4.20', 'openai-compatible', 1000000, 1000000, 8192, true, false, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'xai-reasoning-effort', reasoningEfforts: ['none', 'low', 'medium', 'high'], sourceUrl: 'https://docs.x.ai/developers/models/grok-4.20-beta-0309-reasoning', verifiedAt: '2026-06-12' }),
  model('grok-4.20-multi-agent', 'Grok 4.20 Multi-Agent', 'openai-compatible', 1000000, 1000000, 8192, true, false, false, { supportsTools: true, preferredEndpoint: 'responses', reasoningMode: 'xai-reasoning-effort', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], sourceUrl: 'https://docs.x.ai/developers/model-capabilities/text/multi-agent', verifiedAt: '2026-06-12' }),
  model('grok-4.20-non-reasoning', 'Grok 4.20 Non-Reasoning', 'openai-compatible', 1000000, 1000000, 8192, true, false, false, { supportsTools: true, preferredEndpoint: 'responses', sourceUrl: 'https://docs.x.ai/developers/models/grok-4.20-0309-non-reasoning', verifiedAt: '2026-06-12' }),
  model('grok-build-0.1', 'Grok Build 0.1', 'openai-compatible', 256000, 256000, 8192, false, false, false, { supportsTools: true, sourceUrl: 'https://docs.x.ai/developers/models', verifiedAt: '2026-06-11' }),
  model('grok-4.1', 'Grok 4.1', 'openai-compatible', 1000000, 1000000, 8192, true, false, true, { supportsTools: true, sourceUrl: 'https://docs.x.ai/developers/migration/may-15-retirement', verifiedAt: '2026-06-11', deprecatedReason: 'Not listed as a current public xAI API model; use grok-4.3. Retired Grok 4.1 fast slugs redirect to Grok 4.3 after 2026-05-15.' }),
  model('grok-4', 'Grok 4', 'openai-compatible', 1000000, 1000000, 8192, true, false, true, { supportsTools: true, sourceUrl: 'https://docs.x.ai/developers/migration/may-15-retirement', verifiedAt: '2026-06-11', deprecatedReason: 'Earlier Grok 4 API slugs are retired or redirected to Grok 4.3 after 2026-05-15; use grok-4.3 for current conversations.' }),
  model('mimo-v2.5-pro', 'MiMo V2.5 Pro', 'xiaomi-mimo', 1048576, 131072, 131072, false, false, false, { supportsTools: true, defaultTemperature: 1, maxTemperature: 1.5, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-05-22' }),
  model('mimo-v2.5', 'MiMo V2.5', 'xiaomi-mimo', 1048576, 131072, 32768, true, false, false, { supportsTools: true, defaultTemperature: 1, maxTemperature: 1.5, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-05-22' }),
  model('mimo-v2-pro', 'MiMo V2 Pro', 'xiaomi-mimo', 1048576, 131072, 131072, false, false, true, { supportsTools: true, defaultTemperature: 1, maxTemperature: 1.5, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-06-10', deprecatedReason: 'MiMo V2 Pro enters the official retirement window on 2026-06-01 and auto-routes to MiMo V2.5 Pro before full retirement.' }),
  model('mimo-v2-omni', 'MiMo V2 Omni', 'xiaomi-mimo', 262144, 131072, 32768, true, false, true, { supportsTools: true, defaultTemperature: 1, maxTemperature: 1.5, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-06-10', deprecatedReason: 'MiMo V2 Omni enters the official retirement window on 2026-06-01 and auto-routes to MiMo V2.5 before full retirement.' }),
  model('mimo-v2-flash', 'MiMo V2 Flash', 'xiaomi-mimo', 262144, 65536, 65536, false, false, false, { supportsTools: true, defaultTemperature: 0.3, maxTemperature: 1.5, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-05-22' }),
  model('mimo-v2.5-tts', 'MiMo V2.5 TTS', 'xiaomi-mimo', 8192, 8192, 2048, false, false, false, { chatCompatible: false, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-06-02' }),
  model('mimo-v2.5-tts-voiceclone', 'MiMo V2.5 TTS VoiceClone', 'xiaomi-mimo', 8192, 8192, 2048, false, false, false, { chatCompatible: false, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-06-02' }),
  model('mimo-v2.5-tts-voicedesign', 'MiMo V2.5 TTS VoiceDesign', 'xiaomi-mimo', 8192, 8192, 2048, false, false, false, { chatCompatible: false, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-06-02' }),
  model('mimo-v2.5-asr', 'MiMo V2.5 ASR', 'xiaomi-mimo', 8192, 2048, 2048, false, false, false, { chatCompatible: false, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-06-02' }),
  model('mimo-v2-tts', 'MiMo V2 TTS', 'xiaomi-mimo', 8192, 8192, 2048, false, false, false, { chatCompatible: false, sourceUrl: 'https://platform.xiaomimimo.com/docs/en-US/quick-start/model', verifiedAt: '2026-05-22' }),
]

export function getModelName(modelId: string): string {
  return getModelConfig(modelId).name
}

export function getProviderModels(providerType: ProviderType): AIModel[] {
  return DEFAULT_MODELS.filter((model) => model.provider === providerType)
}

export function getDefaultProviderModelIds(_providerType: ProviderType): string[] {
  return []
}

export function getModelConfig(modelId: string, providerType?: ProviderType, modelConfigs: AIModel[] = []): AIModel {
  const remoteExact = modelConfigs.find((item) => item.id === modelId)
  if (remoteExact) return mergeKnownModelDefaults(modelId, providerType, remoteExact)

  const exact = DEFAULT_MODELS.find((item) => item.id === modelId)
  if (exact) return { ...exact, id: modelId, provider: providerType ?? exact.provider }

  const normalized = normalizeModelId(modelId)
  const known = DEFAULT_MODELS.find((item) => item.id === normalized)
  if (known) {
    const prefix = modelId.includes('/') ? `${titleCase(modelId.split('/')[0])} / ` : ''
    return { ...known, id: modelId, name: `${prefix}${known.name}`, provider: providerType ?? known.provider }
  }

  return inferModelConfig(modelId, providerType ?? 'openai-compatible')
}

export function mergeModelConfig(modelId: string, providerType: ProviderType, remote?: Partial<AIModel>): AIModel {
  const base = getModelConfig(modelId, providerType)
  const contextWindow = remote?.contextWindow ?? base.contextWindow
  const maxOutputTokens = Math.min(remote?.maxOutputTokens ?? base.maxOutputTokens, contextWindow)
  const defaultMaxTokens = Math.min(remote?.defaultMaxTokens ?? base.defaultMaxTokens, maxOutputTokens)
  return {
    ...base,
    ...remote,
    id: modelId,
    name: remote?.name || base.name,
    provider: providerType,
    contextWindow,
    maxTokens: contextWindow,
    maxOutputTokens,
    defaultMaxTokens,
    defaultTemperature: remote?.defaultTemperature ?? base.defaultTemperature,
    maxTemperature: remote?.maxTemperature ?? base.maxTemperature,
    supportsVision: remote?.supportsVision ?? base.supportsVision,
    supportsFiles: remote?.supportsFiles ?? base.supportsFiles,
    supportsTools: remote?.supportsTools ?? base.supportsTools,
    supportsStreaming: remote?.supportsStreaming ?? base.supportsStreaming,
    preferredEndpoint: remote?.preferredEndpoint ?? base.preferredEndpoint,
    chatCompatible: remote?.chatCompatible ?? base.chatCompatible,
    source: remote?.source ?? 'remote',
  }
}

export function sortModelConfigs(models: AIModel[], providerType: ProviderType): AIModel[] {
  const knownOrder = getProviderModels(providerType).map((item) => item.id)
  return [...models].sort((a, b) => {
    const aIndex = knownOrder.indexOf(normalizeModelId(a.id))
    const bIndex = knownOrder.indexOf(normalizeModelId(b.id))
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
    if (aIndex >= 0) return -1
    if (bIndex >= 0) return 1
    return a.name.localeCompare(b.name)
  })
}

function mergeKnownModelDefaults(modelId: string, providerType: ProviderType | undefined, remote: AIModel): AIModel {
  const normalized = normalizeModelId(modelId)
  const known = DEFAULT_MODELS.find((item) => item.id === modelId || item.id === normalized)
  if (!known) return { ...remote, id: modelId, provider: providerType ?? remote.provider }

  return {
    ...known,
    ...remote,
    id: modelId,
    provider: providerType ?? remote.provider,
    preferredEndpoint: remote.preferredEndpoint ?? known.preferredEndpoint,
    reasoningMode: remote.reasoningMode ?? known.reasoningMode,
    reasoningEfforts: remote.reasoningEfforts ?? known.reasoningEfforts,
    sourceUrl: remote.sourceUrl ?? known.sourceUrl,
    verifiedAt: remote.verifiedAt ?? known.verifiedAt,
    deprecatedReason: remote.deprecatedReason ?? known.deprecatedReason,
    supportsTools: remote.supportsTools ?? known.supportsTools,
    supportsStreaming: remote.supportsStreaming ?? known.supportsStreaming,
    chatCompatible: remote.chatCompatible ?? known.chatCompatible,
  }
}

function model(
  id: string,
  name: string,
  provider: ProviderType,
  contextWindow: number,
  maxOutputTokens: number,
  defaultMaxTokens: number,
  supportsVision: boolean,
  supportsFiles: boolean,
  deprecated = false,
  options: Partial<AIModel> = {}
): AIModel {
  return {
    id,
    name,
    provider,
    contextWindow,
    maxTokens: contextWindow,
    maxOutputTokens,
    defaultMaxTokens,
    supportsVision,
    supportsFiles,
    source: 'built-in',
    deprecated,
    ...options,
  }
}

function normalizeModelId(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/').at(-1) ?? modelId : modelId
}

function inferModelConfig(modelId: string, providerType: ProviderType): AIModel {
  const defaults = providerDefaults(providerType)
  return {
    id: modelId,
    name: titleCase(normalizeModelId(modelId).replace(/[-_]/g, ' ')),
    provider: providerType,
    contextWindow: defaults.contextWindow,
    maxTokens: defaults.contextWindow,
    maxOutputTokens: defaults.maxOutputTokens,
    defaultMaxTokens: defaults.defaultMaxTokens,
    supportsVision: defaults.supportsVision,
    supportsFiles: defaults.supportsFiles,
    preferredEndpoint: providerType === 'openai' ? 'chat-completions' : undefined,
    source: 'inferred',
  }
}

function providerDefaults(providerType: ProviderType): Pick<AIModel, 'contextWindow' | 'maxOutputTokens' | 'defaultMaxTokens' | 'supportsVision' | 'supportsFiles'> {
  switch (providerType) {
    case 'openai':
      return { contextWindow: 128000, maxOutputTokens: 16384, defaultMaxTokens: 4096, supportsVision: true, supportsFiles: false }
    case 'anthropic':
      return { contextWindow: 200000, maxOutputTokens: 8192, defaultMaxTokens: 4096, supportsVision: true, supportsFiles: true }
    case 'google':
      return { contextWindow: 1048576, maxOutputTokens: 65536, defaultMaxTokens: 8192, supportsVision: true, supportsFiles: true }
    case 'xiaomi-mimo':
      return { contextWindow: 32768, maxOutputTokens: 4096, defaultMaxTokens: 2048, supportsVision: false, supportsFiles: false }
    case 'openai-compatible':
      return { contextWindow: 32768, maxOutputTokens: 4096, defaultMaxTokens: 2048, supportsVision: false, supportsFiles: false }
  }
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}
