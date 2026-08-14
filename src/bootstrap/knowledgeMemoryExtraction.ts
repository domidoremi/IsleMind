import { generateProviderText } from '@/bootstrap/providerRuntime'
import { knowledgeRepository } from '@/bootstrap/knowledgeRepository'
import {
  createMemoryCandidatePersistenceUseCase,
  createMemoryExtractionUseCase,
} from '@/modules/knowledge'
import { st } from '@/i18n/service'
import { useSettingsStore } from '@/store/settingsStore'
import { logContextOperation } from '@/services/runtimeHealthLog'
import type { Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

const memoryExtraction = createMemoryExtractionUseCase(
  createMemoryCandidatePersistenceUseCase(knowledgeRepository),
)

export async function extractConversationMemories(
  conversationId: string,
  messages: readonly Message[],
  provider?: AIProvider,
  model?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const settings = useSettingsStore.getState().settings
  return memoryExtraction.extract({
    conversationId,
    messages,
    memoryEnabled: settings.memoryEnabled === true,
    ...(provider?.apiKey && model
      ? {
          modelExtraction: {
            generate: (recentTranscript: string, requestSignal?: AbortSignal) => generateProviderText({
              provider,
              model,
              systemPrompt: [
                '你只抽取长期有用、可复用、非敏感的用户偏好或事实。',
                '必须只返回 JSON 字符串数组，例如 ["用户偏好：使用中文回答"]。',
                '不要返回解释、Markdown、编号列表或额外文字；没有可用记忆就返回 []。',
                '不要抽取临时问题、一次性任务、验证码、API Key、Token、密码或隐私敏感内容。',
                '每项不超过 80 字。',
              ].join('\n'),
              messages: [{ role: 'user', content: recentTranscript }],
              temperature: 0.1,
              maxTokens: 512,
              generationParameterSources: { temperature: 'internal-policy', maxTokens: 'internal-policy' },
              usageContext: { source: 'memory', correlationId: conversationId },
              ...(requestSignal ? { signal: requestSignal } : {}),
            }),
            onFailure: (error: unknown) => logContextOperation({
              phase: 'memory_extract',
              status: 'error',
              detail: 'model_extraction_failed',
              sourceType: 'memory_model',
              providerId: provider.id,
              model,
              error,
            }),
          },
        }
      : {}),
    sourceDetails: {
      deterministic: st('contextMemory.source.deterministic'),
      model: st('contextMemory.source.model'),
    },
    ...(signal ? { signal } : {}),
  })
}
