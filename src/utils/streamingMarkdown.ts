/**
 * 流式 Markdown 内容标准化
 *
 * 在流式渲染过程中，Markdown 内容可能不完整（如未闭合的代码块、表格等），
 * 导致渲染闪烁或错误。此函数自动修复常见的不完整内容。
 *
 * @param content - 原始内容
 * @param isStreaming - 是否正在流式传输
 * @returns 标准化后的内容
 */
export function normalizeStreamingMarkdown(content: string, isStreaming: boolean): string {
  if (!isStreaming || !content) {
    return content
  }

  let normalized = content

  // 1. 修复未闭合的代码块
  const codeBlockCount = (normalized.match(/```/g) || []).length
  if (codeBlockCount % 2 === 1) {
    // 未闭合的代码块，添加临时闭合标记
    normalized += '\n```'
  }

  // 2. 修复未闭合的行内代码
  const lines = normalized.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 跳过代码块内的内容
    if (line.trim().startsWith('```')) continue

    const backtickCount = (line.match(/`/g) || []).length
    if (backtickCount % 2 === 1) {
      // 未闭合的行内代码
      lines[i] = line + '`'
    }
  }
  normalized = lines.join('\n')

  // 3. 修复不完整的列表项
  const lastLine = lines[lines.length - 1]
  if (lastLine && /^[\s]*[-*+]\s*$/.test(lastLine)) {
    // 空的列表项标记，暂时隐藏
    lines[lines.length - 1] = ''
    normalized = lines.join('\n')
  }

  // 4. 修复不完整的表格行
  if (lastLine && lastLine.includes('|') && !lastLine.trim().endsWith('|')) {
    // 表格行未闭合
    lines[lines.length - 1] = lastLine + ' |'
    normalized = lines.join('\n')
  }

  // 5. 修复未闭合的粗体/斜体
  const boldCount = (normalized.match(/\*\*/g) || []).length
  if (boldCount % 2 === 1) {
    normalized += '**'
  }

  const italicSingleCount = (normalized.match(/(?<!\*)\*(?!\*)/g) || []).length
  if (italicSingleCount % 2 === 1) {
    normalized += '*'
  }

  return normalized
}

/**
 * 检测内容是否包含未完成的结构
 * 用于决定是否需要标准化
 */
export function hasIncompleteStructures(content: string): boolean {
  if (!content) return false

  // 检查未闭合的代码块
  const codeBlockCount = (content.match(/```/g) || []).length
  if (codeBlockCount % 2 === 1) return true

  // 检查未闭合的粗体
  const boldCount = (content.match(/\*\*/g) || []).length
  if (boldCount % 2 === 1) return true

  // 检查最后一行是否是不完整的列表或表格
  const lines = content.split('\n')
  const lastLine = lines[lines.length - 1]
  if (lastLine) {
    if (/^[\s]*[-*+]\s*$/.test(lastLine)) return true
    if (lastLine.includes('|') && !lastLine.trim().endsWith('|')) return true
  }

  return false
}
