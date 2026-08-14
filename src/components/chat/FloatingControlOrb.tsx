import { AnimatePresence, MotiView } from 'moti'
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

import { ChatControlPanelThemeSurface, ChatControlTriggerThemeSurface } from './theme-surfaces/ChatThemeSurfaces'

const FLOATING_CONTROL_ORB_SIZE = 48
export const FLOATING_CONTROL_ORB_GAP = 8
const QUICK_TOOL_HIT_SLOP = { top: 8, right: 6, bottom: 8, left: 6 }
const QUICK_TOOL_PANEL_MAX_WIDTH = 248
const QUICK_TOOL_PANEL_MAX_HEIGHT = 372
const QUICK_TOOL_PANEL_TOP_CLEARANCE = 64
const QUICK_TOOL_ROW_MIN_HEIGHT = 44
const QUICK_TOOL_PANEL_VERTICAL_PADDING = 12
const QUICK_TOOL_PANEL_MIN_HEIGHT = QUICK_TOOL_ROW_MIN_HEIGHT + QUICK_TOOL_PANEL_VERTICAL_PADDING
const QUICK_TOOL_ROW_GAP = 2

export interface FloatingControlOrbAction {
  key: string
  label: string
  icon: AppIconName
  onPress: () => void
}

export function FloatingControlOrb({
  actions,
  bottomOffset,
  open,
  onOpenChange,
}: {
  actions: FloatingControlOrbAction[]
  bottomOffset: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { colors, themeId } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const fullMotion = motion === 'full'
  const activeColor = open ? colors.ui.control.primaryForeground : colors.textSecondary
  const rightOffset = Math.max(14, insets.right + 14)
  const availablePanelWidth = Math.max(1, windowWidth - rightOffset - 10)
  const panelWidth = Math.min(QUICK_TOOL_PANEL_MAX_WIDTH, availablePanelWidth)
  const availablePanelHeight = Math.max(
    QUICK_TOOL_PANEL_MIN_HEIGHT,
    windowHeight - bottomOffset - FLOATING_CONTROL_ORB_SIZE - FLOATING_CONTROL_ORB_GAP - Math.max(insets.top, 0) - QUICK_TOOL_PANEL_TOP_CLEARANCE,
  )
  const panelMaxHeight = Math.min(QUICK_TOOL_PANEL_MAX_HEIGHT, availablePanelHeight)
  const actionListMaxHeight = Math.max(QUICK_TOOL_ROW_MIN_HEIGHT, panelMaxHeight - QUICK_TOOL_PANEL_VERTICAL_PADDING)
  const actionListContentHeight = actions.length * QUICK_TOOL_ROW_MIN_HEIGHT +
    Math.max(0, actions.length - 1) * QUICK_TOOL_ROW_GAP +
    14
  const actionListHeight = Math.min(actionListMaxHeight, actionListContentHeight)
  const panelHeight = actionListHeight + QUICK_TOOL_PANEL_VERTICAL_PADDING
  const motionDuration = fullMotion ? motionTokens.duration.fast : 0

  return (
    <>
      <View
        pointerEvents="box-none"
        accessibilityViewIsModal={open}
        style={{
          position: 'absolute',
          right: rightOffset,
          bottom: bottomOffset,
          zIndex: 58,
          elevation: 4,
          alignItems: 'flex-end',
        }}
      >
        {open ? (
            <View
              key="quick-tool-panel"
              testID="chat-floating-toolbox-panel"
              style={{
                position: 'absolute',
                right: 0,
                bottom: FLOATING_CONTROL_ORB_SIZE + FLOATING_CONTROL_ORB_GAP,
                width: panelWidth,
                height: panelHeight,
                maxHeight: panelMaxHeight,
              }}
              onStartShouldSetResponderCapture={() => false}
              onMoveShouldSetResponderCapture={() => false}
            >
              <ChatControlPanelThemeSurface themeId={themeId} colors={colors}>
                <ScrollView
                testID="chat-floating-toolbox-action-scroll"
                style={{ height: actionListHeight, maxHeight: actionListMaxHeight }}
                contentInsetAdjustmentBehavior="never"
                nestedScrollEnabled
                directionalLockEnabled
                showsVerticalScrollIndicator={actions.length >= 6}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingTop: 4, paddingBottom: 10, gap: QUICK_TOOL_ROW_GAP }}
                onStartShouldSetResponderCapture={() => false}
                onMoveShouldSetResponderCapture={() => false}
              >
                {actions.map((action) => (
                  <View
                    key={action.key}
                  >
                    <IslePressable
                      haptic
                      onPress={action.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      hitSlop={QUICK_TOOL_HIT_SLOP}
                      style={{
                        minHeight: QUICK_TOOL_ROW_MIN_HEIGHT,
                        width: '100%',
                        borderRadius: colors.ui.radius.controlLarge,
                        paddingHorizontal: 10,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        backgroundColor: 'transparent',
                      }}
                    >
                      <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
                        <AppIcon name={action.icon} color={colors.textSecondary} size={17} strokeWidth={appIconStroke.strong} />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: colors.text,
                          fontSize: 13,
                          lineHeight: 17,
                          fontWeight: '700',
                          includeFontPadding: false,
                        }}
                      >
                        {action.label}
                      </Text>
                      <AppIcon name="arrow-right" color={colors.textTertiary} size={14} strokeWidth={appIconStroke.strong} />
                    </IslePressable>
                  </View>
                ))}
                </ScrollView>
              </ChatControlPanelThemeSurface>
            </View>
          ) : null}

        <IslePressable
          testID="chat-floating-toolbox-trigger"
          haptic
          onPress={() => onOpenChange(!open)}
          accessibilityRole="button"
          accessibilityLabel={open ? t('chat.collapseQuickTools') : t('chat.quickTools')}
          accessibilityHint={open ? t('chat.collapseQuickToolsAccessibilityHint') : t('chat.quickToolsAccessibilityHint')}
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          hitSlop={12}
          style={{
            width: FLOATING_CONTROL_ORB_SIZE,
            height: FLOATING_CONTROL_ORB_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChatControlTriggerThemeSurface themeId={themeId} colors={colors} open={open}>
            <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
              <AnimatePresence>
                <MotiView
                  key={open ? 'quick-tool-close' : 'quick-tool-open'}
                  from={fullMotion ? { opacity: 0, scale: 0.82 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={fullMotion ? { opacity: 0, scale: 0.82 } : false}
                  transition={{ type: 'timing', duration: motionDuration }}
                  exitTransition={{ type: 'timing', duration: motionDuration }}
                  style={StyleSheet.absoluteFill}
                >
                  <View style={styles.centeredIcon}>
                    <AppIcon name={open ? 'close' : 'tools'} color={activeColor} size={20} strokeWidth={appIconStroke.strong} />
                  </View>
                </MotiView>
              </AnimatePresence>
            </View>
          </ChatControlTriggerThemeSurface>
        </IslePressable>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  centeredIcon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
