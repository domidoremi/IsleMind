import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleButton, IsleMotionFrame, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useWorkspaceLayout } from '@/presentation/layout/useWorkspaceLayout'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import { CHAT_PRESENTATION_CATALOG, type ChatStarterDefinition } from '@/presentation/features/chat/chatPresentationCatalog'
import type { ComposerDraftPresence } from './composerDraftState'
import { useChatEntryTasks } from './useChatEntryTasks'

export function ChatEntryTasks({ title, modelTitle, providerName, ready, hasProvider, draftPresence, composing = false, onStarter, onConfigure, onHistory, onDocuments }: {
  title: string
  modelTitle: string
  providerName?: string
  ready: boolean
  hasProvider: boolean
  draftPresence: ComposerDraftPresence
  composing?: boolean
  onStarter: (starter: ChatStarterDefinition) => void
  onConfigure: () => void
  onHistory: () => void
  onDocuments: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const layout = useWorkspaceLayout()
  const task = useChatEntryTasks(draftPresence, onStarter)
  const [startingPointsOpen, setStartingPointsOpen] = useState(false)
  const draftWorkspace = composing || draftPresence === 'draft'
  const tasksVisible = !draftWorkspace || startingPointsOpen
  return <View testID="chat-entry-workspace" style={[styles.workspace, { maxWidth: layout.wide ? 1080 : 680 }]}>
    <View style={[styles.layout, { flexDirection: layout.wide ? 'row' : 'column', gap: layout.gap }]}>
      <IsleMotionFrame role="section" style={[{ minWidth: 0, gap: draftWorkspace ? 12 : 18 }, layout.wide && { flex: 1 }]}>
        <View style={{ minWidth: 0, gap: 6 }}>
          <Text testID="chat-entry-title" accessibilityRole="header"
            style={[draftWorkspace ? typography.headline : typography.display, { color: colors.text }]}>
            {draftWorkspace ? t('taskWorkspace.home.draftTitle') : title}
          </Text>
          {draftWorkspace ? <Text testID="chat-entry-writing-hint" style={[typography.caption, { color: colors.textSecondary }]}>
            {t('taskWorkspace.home.draftHint')}
          </Text> : null}
        </View>
        <IslePressable testID="chat-entry-connection" accessibilityRole="button"
          accessibilityLabel={ready ? `${providerName ?? ''}, ${modelTitle}` : t(hasProvider ? 'chat.syncModelsBeforeChat' : 'chat.noProviderConnected')}
          accessibilityHint={t('chat.configureProvidersAccessibilityHint')} haptic onPress={onConfigure} style={styles.connection}>
          <View pointerEvents="none" style={[styles.connectionMark, { borderRadius: colors.design!.semantic.radius.medium, backgroundColor: colors.ui.icon.accentBackground }]}>
            <AppIcon name={ready ? 'model' : 'add'} size={20} color={colors.ui.icon.accentForeground} />
          </View>
          <View style={{ minWidth: 0, flex: 1, gap: 4 }}>
            <Text style={[typography.label, { color: colors.text }]}>{ready ? modelTitle : t(hasProvider ? 'chat.noAvailableModels' : 'chat.connectProvider')}</Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>{ready ? providerName : t('taskWorkspace.home.prepareBeforeConnect')}</Text>
          </View>
          <AppIcon name="arrow-right" size={18} color={colors.textTertiary} />
        </IslePressable>
        <View testID="chat-entry-continuation" style={styles.continuation}>
          {!draftWorkspace ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{t('taskWorkspace.home.continue')}</Text> : null}
          <IslePressable testID="chat-entry-history" accessibilityRole="button" accessibilityLabel={t('conversation.title')}
            haptic onPress={onHistory} style={styles.continueAction}>
            <AppIcon name="conversation" size={18} color={colors.textSecondary} />
            <Text style={[typography.label, { color: colors.text }]}>{t('conversation.title')}</Text>
          </IslePressable>
          <IslePressable testID="chat-entry-documents" accessibilityRole="button" accessibilityLabel={t('documents.title')}
            haptic onPress={onDocuments} style={styles.continueAction}>
            <AppIcon name="source" size={18} color={colors.textSecondary} />
            <Text style={[typography.label, { color: colors.text }]}>{t('documents.title')}</Text>
          </IslePressable>
        </View>
        {draftWorkspace ? <IslePressable testID="chat-entry-starting-points-toggle" accessibilityRole="button"
          accessibilityLabel={t(startingPointsOpen ? 'taskWorkspace.home.hideStartingPoints' : 'taskWorkspace.home.showStartingPoints')}
          accessibilityState={{ expanded: startingPointsOpen }} haptic onPress={() => setStartingPointsOpen(value => !value)}
          style={[styles.continueAction, { alignSelf: 'flex-start' }]}>
          <AppIcon name={startingPointsOpen ? 'collapse' : 'add'} size={16} color={colors.textTertiary} />
          <Text style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>
            {t(startingPointsOpen ? 'taskWorkspace.home.hideStartingPoints' : 'taskWorkspace.home.showStartingPoints')}
          </Text>
        </IslePressable> : null}
      </IsleMotionFrame>
      <View testID="chat-entry-task-panel" accessibilityElementsHidden={!tasksVisible}
        importantForAccessibility={tasksVisible ? 'auto' : 'no-hide-descendants'}
        style={[layout.wide ? { flex: 1.15, minWidth: 0 } : undefined, !tasksVisible && styles.hidden]}>
        <WorkspaceSurface role="support" style={{ gap: 14 }}>
          <View testID="chat-entry-task-choices" accessibilityRole="radiogroup" accessibilityLabel={t('taskWorkspace.home.chooseTask')} style={styles.choices}>
            {CHAT_PRESENTATION_CATALOG.starters.map(starter => <IslePressable key={starter.id} testID={`chat-entry-task-${starter.id}`}
              accessibilityRole="radio" accessibilityLabel={t(starter.titleKey)} accessibilityState={{ checked: task.selected.id === starter.id }}
              haptic onPress={() => task.select(starter.id)}
              style={[styles.choice, { borderRadius: colors.design!.semantic.radius.medium, backgroundColor: task.selected.id === starter.id ? colors.ui.icon.accentBackground : 'transparent' }]}>
              <AppIcon name={starter.glyph} size={18} color={task.selected.id === starter.id ? colors.ui.icon.accentForeground : colors.textSecondary} />
              <Text style={[typography.label, { color: task.selected.id === starter.id ? colors.text : colors.textSecondary }]}>{t(`taskWorkspace.home.tasks.${starter.id}`)}</Text>
            </IslePressable>)}
          </View>
          <Text testID="chat-entry-task-description" style={[typography.body, { color: colors.textSecondary }]}>{t(task.selected.descriptionKey)}</Text>
          <View style={styles.prepare}>
            <IsleButton testID="chat-entry-prepare" compact label={t('taskWorkspace.home.prepare')} tone="soft"
              disabled={task.action !== 'prepare'} onPress={task.prepare} />
            <Text testID="chat-entry-draft-status" accessibilityLiveRegion="polite"
              style={[typography.caption, { color: colors.textSecondary, flex: 1, minWidth: 140 }]}>
              {t(task.action === 'preserve' ? 'taskWorkspace.home.keepDraft' : task.action === 'wait' ? 'taskWorkspace.home.restoringDraft' : 'taskWorkspace.home.noAutoSend')}
            </Text>
          </View>
        </WorkspaceSurface>
      </View>
    </View>
  </View>
}

const styles = StyleSheet.create({
  workspace: { minWidth: 0, width: '100%', alignSelf: 'center', gap: 20 },
  layout: { minWidth: 0 },
  connection: { flexDirection: 'row', minWidth: 0, alignItems: 'center', gap: 12, minHeight: 60 },
  connectionMark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  choices: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 10, flexGrow: 1 },
  prepare: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  continuation: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  continueAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10 },
  hidden: { display: 'none' },
})
