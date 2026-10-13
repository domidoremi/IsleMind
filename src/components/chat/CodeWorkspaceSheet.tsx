import { useEffect, useRef, useState } from 'react'
import { Modal, ScrollView, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { builtInWritableWorkspaceFilePort } from '@/bootstrap/builtInWorkspaceFileRuntime'
import type { BuiltInWorkspaceFilePage } from '@/modules/integrations'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/** This sheet only lists local app-owned paths. Selection neither reads file content nor grants tools. */
export function CodeWorkspaceSheet({ onClose, onInsertPath }: { onClose: () => void; onInsertPath: (path: string) => void }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [page, setPage] = useState<BuiltInWorkspaceFilePage>({ files: [] })
  const [busy, setBusy] = useState(Boolean(builtInWritableWorkspaceFilePort))
  const [failed, setFailed] = useState(false)
  const request = useRef<AbortController | null>(null)

  async function load(afterPath?: string) {
    if (!builtInWritableWorkspaceFilePort || request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setFailed(false)
    try {
      const next = await builtInWritableWorkspaceFilePort.queryFiles({ directory: 'workspace', limit: 20, afterPath }, { signal: controller.signal })
      if (!controller.signal.aborted) setPage(next)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false) }
    }
  }
  useEffect(() => {
    void load()
    return () => { request.current?.abort(); request.current = null }
  }, [])

  const body = { color: colors.textSecondary, fontSize: 14, lineHeight: 22 } as const
  return <Modal visible transparent animationType={motion === 'full' ? 'fade' : 'none'} onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.backdrop }}>
      <View accessibilityViewIsModal style={{ maxHeight: height - insets.top - 24, padding: 18,
        paddingBottom: Math.max(18, insets.bottom), gap: 12, backgroundColor: colors.ui.semantic.surface.base }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{t('chat.codeWorkspace')}</Text>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>
          <Text style={body}>{t('chat.unifiedToolsHint')}</Text>
          <Text style={body}>{t('chat.workspacePrivacyHint')}</Text>
          {!builtInWritableWorkspaceFilePort ? <Text style={body}>{t('chat.workspaceUnavailable')}</Text>
            : failed ? <Text accessibilityRole="alert" style={body}>{t('chat.workspaceReadFailed')}</Text>
              : busy ? <Text style={body}>{t('common.loading')}</Text>
                : !page.files.length ? <Text style={body}>{t('chat.workspaceEmpty')}</Text>
                  : page.files.map(file => <IsleButton key={file.relativePath} label={file.relativePath}
                    onPress={() => onInsertPath(file.relativePath)} />)}
        </ScrollView>
        {builtInWritableWorkspaceFilePort ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton label={t('common.refresh')} disabled={busy} onPress={() => void load()} />
          {page.nextAfterPath ? <IsleButton label={t('agentTasks.nextPage')} disabled={busy}
            onPress={() => void load(page.nextAfterPath)} /> : null}
        </View> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton label={t('chat.toolPermissions')} onPress={() => { onClose(); router.push('/settings/category/tools') }} />
          <IsleButton label={t('common.close')} onPress={onClose} />
        </View>
      </View>
    </View>
  </Modal>
}
