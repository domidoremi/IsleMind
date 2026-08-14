import { useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'

import { renderCompressionMessage, type CompressionSummary } from './compressionSummary'

type ChatCompressionToastDialog = {
  toast: (options: { title: string; message: string; tone: 'mint' | 'amber' }) => void
}

export function useChatCompressionToast({
  active,
  compression,
  dialog,
  t,
}: {
  active: boolean
  compression: CompressionSummary | null
  dialog: ChatCompressionToastDialog
  t: TFunction
}) {
  const lastCompressionToastSignature = useRef('')

  useEffect(() => {
    if (!active) return
    if (!compression?.metadata) return
    const signature = `${compression.mode}:${compression.metadata.strategy}:${compression.metadata.sourceMessageCount}:${compression.metadata.keptMessageCount}:${compression.savedTokens}`
    if (lastCompressionToastSignature.current === signature) return
    lastCompressionToastSignature.current = signature
    dialog.toast({
      title: t(compression.titleKey),
      message: renderCompressionMessage(compression, t),
      tone: compression.mode === 'remote' ? 'mint' : 'amber',
    })
  }, [active, compression, dialog, t])
}
