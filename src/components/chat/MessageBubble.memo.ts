/**
 * MessageBubble 性能优化方案
 *
 * 当前问题：MessageBubble 未使用 React.memo，导致列表中所有消息在任何更新时都重新渲染
 * 优化目标：仅在消息自身变化时重新渲染，减少不必要的渲染次数
 *
 * 实施步骤：
 * 1. 将当前 MessageBubble 函数重命名为 MessageBubbleComponent
 * 2. 创建 areMessagesEqual 比较函数
 * 3. 使用 memo 包装并导出
 */

import { memo } from 'react'
import type { MessageBubbleProps } from './MessageBubble'
import { collectVisibleProcessTraces } from './tracePresentation'

/**
 * 消息属性比较函数
 *
 * 返回 true = 属性相同，跳过重新渲染
 * 返回 false = 属性变化，需要重新渲染
 */
const areMessagesEqual = (
  prevProps: MessageBubbleProps,
  nextProps: MessageBubbleProps
): boolean => {
  const prevMsg = prevProps.message
  const nextMsg = nextProps.message

  // 1. 基础字段比较
  if (prevMsg.id !== nextMsg.id) return false
  if (prevMsg.role !== nextMsg.role) return false
  if (prevMsg.content !== nextMsg.content) return false
  if (prevMsg.status !== nextMsg.status) return false

  // 2. 附件比较（仅比较长度）
  if (prevMsg.attachments?.length !== nextMsg.attachments?.length) return false

  // 3. Traces 比较（仅比较长度，避免深比较）
  if (collectVisibleProcessTraces(prevMsg).length !== collectVisibleProcessTraces(nextMsg).length) return false

  // 4. 其他关键 props 比较
  if (prevProps.index !== nextProps.index) return false
  if (prevProps.isLastAssistant !== nextProps.isLastAssistant) return false
  if (prevProps.showThinkingStatus !== nextProps.showThinkingStatus) return false
  if (prevProps.activeActionMessageId !== nextProps.activeActionMessageId) return false

  // 所有关键属性相同，跳过重新渲染
  return true
}

/**
 * 使用说明：
 *
 * 在 MessageBubble.tsx 中：
 *
 * 1. 将第 67 行的函数声明改为：
 *    function MessageBubbleComponent({ ... }: MessageBubbleProps) {
 *
 * 2. 在文件末尾（第 1225 行之后）添加：
 *    export const MessageBubble = memo(MessageBubbleComponent, areMessagesEqual)
 *
 * 3. 删除原来的 export 关键字（第 67 行）
 *
 * 预期效果：
 * - 100 条消息的列表中，新消息流式更新时，其他 99 条消息不会重新渲染
 * - 滚动性能提升约 2 倍
 * - 内存占用减少
 */

/**
 * 性能测试方法：
 *
 * 1. 开发模式下添加渲染计数：
 *
 * function MessageBubbleComponent(props: MessageBubbleProps) {
 *   const renderCount = useRef(0)
 *   useEffect(() => {
 *     renderCount.current += 1
 *     console.log(`[MessageBubble-${props.message.id}] Render #${renderCount.current}`)
 *   })
 *   // ...
 * }
 *
 * 2. 使用 React DevTools Profiler 记录优化前后的渲染次数
 *
 * 3. 在长对话（100+消息）中测试滚动性能
 */

export { areMessagesEqual }
