import { useEffect, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { contentReporting } from '@/bootstrap/contentReporting'
import { conversationPersistence } from '@/bootstrap/conversationPersistence'
import { ContentReportScreen } from '@/presentation/features/conversations/ContentReportScreen'
import { sanitizeInternalChatOutputText } from '@/services/chatInternalOutputGuard'
import { useChatStore } from '@/store/chatStore'

export default function ReportRoute() {
  const { conversationId, messageId } = useLocalSearchParams<{ conversationId?: string; messageId?: string }>()
  return <ReportSource key={JSON.stringify([conversationId, messageId])} conversationId={conversationId} messageId={messageId} />
}

function ReportSource({ conversationId, messageId }: { conversationId?: string; messageId?: string }) {
  const [source, setSource] = useState<string | null>()
  useEffect(() => {
    let active = true
    void (async () => {
      if (typeof conversationId !== 'string' || typeof messageId !== 'string') { if (active) setSource(null); return }
      const cached = useChatStore.getState().conversations.find(item => item.id === conversationId)
      const conversation = cached ?? await conversationPersistence.loadRecord(conversationId)
      const message = conversation?.messages.find(item => item.id === messageId)
      if (!active) return
      const visible = message?.role === 'assistant' && !['sending', 'streaming'].includes(message.status)
        ? sanitizeInternalChatOutputText(message.responseText ?? message.content) : ''
      setSource(visible.trim() ? visible : null)
    })().catch(() => { if (active) setSource(null) })
    return () => { active = false }
  }, [conversationId, messageId])
  return <ContentReportScreen source={source} reporting={contentReporting}
    onClose={() => router.canGoBack() ? router.back() : router.replace('/')} />
}
