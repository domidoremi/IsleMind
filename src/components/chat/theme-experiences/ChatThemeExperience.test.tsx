import { render } from '@testing-library/react-native'
import { StyleSheet, View } from 'react-native'

import { getColors } from '@/theme/colors'

import { ChatActiveThemeExperience } from './ChatActiveThemeExperience'
import { ChatEmptyStateExperience } from './ChatEmptyStateExperience'
import { ChatSetupThemeExperience } from './ChatSetupThemeExperience'

it.each(['setup', 'active'] as const)(
  'keeps the Material %s header out of zero-height wrappers',
  async phase => {
    const props = {
      themeId: 'material' as const,
      colors: getColors('light', 'material'),
      compactViewport: true,
      chrome: <View testID="floating-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 58 }} />,
      status: null,
      controls: null,
      composer: null,
    }
    const screen = await render(phase === 'setup'
      ? <ChatSetupThemeExperience {...props} content={<View style={{ flex: 1 }} />} />
      : <ChatActiveThemeExperience {...props} documentMetadata="" documentTitle="" messageList={<View style={{ flex: 1 }} />} />,
    )

    // Android clips descendant hit/accessibility bounds to the native parent.
    // An in-flow wrapper around this absolute header would collapse to zero.
    expect(screen.getByTestId('floating-header').parent)
      .toBe(screen.getByTestId(`chat-${phase}-experience-material`))
  },
)

it.each(['setup', 'active'] as const)(
  'gives Liquid Glass %s floating controls viewport-sized, pass-through parents',
  async phase => {
    const props = {
      themeId: 'liquid-glass' as const,
      colors: getColors('light', 'liquid-glass'),
      compactViewport: true,
      chrome: <View testID="glass-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 58 }} />,
      status: null,
      controls: null,
      composer: <View testID="glass-composer" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 88 }} />,
    }
    const screen = await render(phase === 'setup'
      ? <ChatSetupThemeExperience {...props} content={<View style={{ flex: 1 }} />} />
      : <ChatActiveThemeExperience {...props} documentMetadata="" documentTitle="" messageList={<View style={{ flex: 1 }} />} />,
    )
    const root = screen.getByTestId(`chat-${phase}-experience-liquid-glass`)

    for (const id of ['glass-header', 'glass-composer']) {
      const layer = screen.getByTestId(id).parent
      expect(layer?.parent).toBe(root)
      expect(StyleSheet.flatten(layer?.props.style)).toEqual(expect.objectContaining(StyleSheet.absoluteFill))
      expect(layer?.props.pointerEvents).toBe('box-none')
      expect(layer?.props.importantForAccessibility).not.toBe('no-hide-descendants')
    }
  },
)

it('keeps Material setup content horizontally centered inside every canvas wrapper', async () => {
  const screen = await render(
    <ChatSetupThemeExperience
      themeId="material"
      colors={getColors('light', 'material')}
      compactViewport
      chrome={null}
      status={null}
      content={<View testID="setup-content" style={{ flex: 1 }} />}
      controls={null}
      composer={null}
    />,
  )
  const root = screen.getByTestId('chat-setup-experience-material')
  let ancestor = screen.getByTestId('setup-content').parent
  let horizontalPadding = 0

  while (ancestor && ancestor !== root) {
    const style = StyleSheet.flatten(ancestor.props.style) ?? {}
    const leftPadding = style.paddingLeft ?? style.paddingHorizontal ?? style.padding ?? 0
    const rightPadding = style.paddingRight ?? style.paddingHorizontal ?? style.padding ?? 0
    expect(leftPadding).toBe(rightPadding)
    horizontalPadding += leftPadding + rightPadding
    expect(style.marginLeft ?? style.marginHorizontal ?? style.margin ?? 0)
      .toBe(style.marginRight ?? style.marginHorizontal ?? style.margin ?? 0)
    ancestor = ancestor.parent
  }

  expect(ancestor).toBe(root)
  expect(horizontalPadding).toBe(28)
})

it('centers the Material setup connection action beneath its introduction', async () => {
  const screen = await render(
    <ChatEmptyStateExperience
      themeId="material"
      colors={getColors('light', 'material')}
      title="No provider connected"
      context="setup"
      intro={<View testID="provider-introduction" />}
      boundary={null}
      starter={null}
      action={<View testID="provider-connection-action" />}
    />,
  )
  const actionRow = screen.getByTestId('provider-connection-action').parent

  expect(StyleSheet.flatten(actionRow?.props.style)?.alignItems).toBe('center')
})
