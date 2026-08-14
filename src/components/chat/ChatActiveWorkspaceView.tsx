import { View } from 'react-native'

import { useAppTheme } from '@/hooks/useAppTheme'

import { ChatActiveMessageList } from './ChatActiveMessageList'
import { ChatActiveChromeLayer } from './ChatActiveChromeLayer'
import { ChatActiveComposerDock } from './ChatActiveComposerDock'
import { ChatActiveControlsLayer } from './ChatActiveControlsLayer'
import { ChatActiveStatusLayer } from './ChatActiveStatusLayer'
import {
  buildChatActiveWorkspaceLayerProps,
} from './chatActiveWorkspaceLayerProps'
import type { ChatActiveWorkspaceViewProps } from './chatActiveWorkspaceLayerPropTypes'
import { ChatScreenFrame } from './chatScreenFrame'
import { ChatActiveThemeExperience } from './theme-experiences/ChatActiveThemeExperience'

export function ChatActiveWorkspaceView(props: ChatActiveWorkspaceViewProps) {
  const { themeId } = useAppTheme()
  const {
    embedded,
    backgroundState,
    compactViewport,
    colors,
    conversation,
  } = props
  const {
    chromeLayerProps,
    composerDockProps,
    controlsLayerProps,
    messageListProps,
    statusLayerProps,
  } = buildChatActiveWorkspaceLayerProps(props)
  return (
    <ChatScreenFrame embedded={embedded} backgroundState={backgroundState} compactViewport={compactViewport}>
      <View style={{ flex: 1 }}>
        <ChatActiveThemeExperience
          themeId={themeId}
          colors={colors}
          compactViewport={compactViewport}
          documentTitle={conversation.title}
          documentMetadata={`${conversation.messages.length} · ${conversation.model}`}
          chrome={<ChatActiveChromeLayer {...chromeLayerProps} showFloatingControlOrb={false} />}
          status={<ChatActiveStatusLayer {...statusLayerProps} />}
          messageList={<ChatActiveMessageList {...messageListProps} />}
          controls={<ChatActiveControlsLayer {...controlsLayerProps} showFloatingControlOrb={false} />}
          composer={<ChatActiveComposerDock {...composerDockProps} />}
        />
      </View>
    </ChatScreenFrame>
  )
}
