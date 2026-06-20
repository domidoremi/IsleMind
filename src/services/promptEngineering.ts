import type { AIModel, Language, RetrievalSource } from '@/types'

interface PromptBuildInput {
  baseSystemPrompt?: string
  expectedReplyFormat?: string
  language: Language
  modelConfig: AIModel
  hasMemory: boolean
  hasKnowledge: boolean
  hasWeb: boolean
  retrievalSources: RetrievalSource[]
}

export function buildSystemPrompt(input: PromptBuildInput): string {
  const parts = [
    input.baseSystemPrompt?.trim(),
    languageRule(input.language),
    capabilityRule(input.modelConfig),
    input.hasMemory ? '记忆规则：可使用长期记忆辅助个性化回答，但不要暴露“我读取了记忆”；记忆与当前问题冲突时，以用户当前消息为准。' : '',
    input.hasKnowledge ? '知识库规则：使用本机知识库内容时，优先引用来源编号；知识库不足时明确说明，不要补造不存在的资料。' : '',
    input.hasWeb ? '联网搜索规则：联网来源只用于补充当前事实；涉及新闻、价格、法规、版本或时间敏感内容时，回答中保留来源指向。' : '',
    input.hasWeb ? webAnswerStyleRule(input.language) : '',
    input.retrievalSources.length ? citationRule(input.retrievalSources.length) : '',
    input.expectedReplyFormat?.trim() ? `回复格式要求：\n${input.expectedReplyFormat.trim()}` : '',
  ]
  return parts.filter(Boolean).join('\n\n')
}

function languageRule(language: Language): string {
  switch (language) {
    case 'en':
      return 'Language preference: respond in English unless the user clearly asks for another language.'
    case 'ja':
      return '言語設定：ユーザーが別の言語を明示しない限り、日本語で簡潔に回答してください。'
    case 'zh-CN':
      return '语言偏好：默认使用简体中文回答；如果用户使用其他语言或明确指定语言，则跟随用户。'
  }
}

function capabilityRule(model: AIModel): string {
  const capabilities = [
    `当前模型：${model.id}`,
    `上下文窗口约 ${model.contextWindow} tokens`,
    `建议输出上限 ${model.defaultMaxTokens} tokens`,
    model.supportsVision ? '可处理图像输入' : '不假定可处理图像输入',
    model.supportsFiles ? '可处理文件输入' : '不假定可直接解析文件输入',
  ]
  return `模型能力提示：${capabilities.join('；')}。请在能力边界内回答。`
}

function citationRule(count: number): string {
  return `引用规则：本轮提供了 ${count} 条上下文来源。若答案使用来源内容，请用“来源 1/2/3”或自然语言点明出处；不要伪造未给出的来源。`
}

function webAnswerStyleRule(language: Language): string {
  switch (language) {
    case 'en':
      return 'Web answer style: synthesize sources in a natural user-facing voice. For news or time-sensitive lists, start with a short context sentence, group or rank concise items, keep source hints readable, and avoid exposing tool-output wording.'
    case 'ja':
      return 'Web回答スタイル：検索結果はユーザー向けの自然な文章に統合してください。ニュースや時事的な一覧では短い前置き、読みやすい項目整理、自然な出典表示を使い、ツール出力のような表現は避けてください。'
    case 'zh-CN':
      return '联网回答风格：把来源综合成面向用户的自然回答，不要像工具日志或搜索结果转写。新闻、近况、价格、版本等时效性列表先给一句简短背景，再用紧凑条目分组或排序；保留可读的来源指向，但不要反复说“工具输出”“搜索结果显示”。'
  }
}
