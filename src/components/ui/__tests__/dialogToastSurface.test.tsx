import { act, fireEvent, render } from '@testing-library/react-native'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useState } from 'react'

import { getColors } from '@/theme/colors'
import { IsleDialogProvider, useIsleDialog } from '../isle/Dialog'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'
import { useSettingsLifetime } from '@/components/settings/SettingsEditBoundary'

let mockMotion = 'none'
let mockTheme = 'minimal'

jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors('light', mockTheme)
    return { colors, design: colors.design, canonicalThemeId: mockTheme, isLiquidGlass: mockTheme === 'liquid-glass' }
  },
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

beforeEach(() => { mockMotion = 'none'; mockTheme = 'minimal' })

function Trigger() {
  const dialog = useIsleDialog()
  return <Pressable accessibilityRole="button" accessibilityLabel="Report export failure" onPress={() => dialog.toast({ title: 'Export failed', message: 'Clipboard unavailable', tone: 'amber' })}><Text>Report</Text></Pressable>
}

it('keeps the minimal toast’s actual panel surface opaque over underlying Chat content', async () => {
  const view = await render(<IsleDialogProvider><Trigger /></IsleDialogProvider>)
  await fireEvent.press(view.getByRole('button', { name: 'Report export failure' }))
  const panel = view.getByTestId('theme-toast-minimal').parent
  expect(StyleSheet.flatten(panel?.props.style).backgroundColor).toBe(getColors('light', 'minimal').ui.semantic.surface.base)
  await view.unmount()
})

it('dismisses only the cancelled pending confirmation and settles it false', async () => {
  const controller = new AbortController()
  let outcome: Promise<boolean> | undefined
  function ConfirmTrigger() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityRole="button" accessibilityLabel="Ask fallback" onPress={() => {
      outcome = dialog.confirm({ title: 'Use another provider?', signal: controller.signal })
    }}><Text>Ask</Text></Pressable>
  }
  const view = await render(<IsleDialogProvider><ConfirmTrigger /></IsleDialogProvider>)
  await fireEvent.press(view.getByRole('button', { name: 'Ask fallback' }))
  expect(view.getByText('Use another provider?')).toBeTruthy()
  await act(async () => controller.abort())
  expect(await outcome).toBe(false)
  expect(view.queryByText('Use another provider?')).toBeNull()
  await view.unmount()
})

it('keeps the Animal Island dialog title in the app theme font and cancellation usable', async () => {
  mockTheme = 'animal-island-ui'
  let outcome: Promise<boolean> | undefined
  function ConfirmTrigger() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Ask" onPress={() => {
      outcome = dialog.confirm({ title: 'Island confirmation' })
    }} />
  }
  const screen = await render(<IsleThemeProvider><IsleDialogProvider><ConfirmTrigger /></IsleDialogProvider></IsleThemeProvider>)
  await fireEvent.press(screen.getByLabelText('Ask'))
  expect(screen.getByText('Island confirmation')).toHaveStyle({ fontFamily: 'LXGWWenKai' })
  await fireEvent.press(screen.getByText('common.cancel'))
  expect(await outcome).toBe(false)
  expect(screen.queryByText('Island confirmation')).toBeNull()
})

it.each([false, true])('constrains the Animal Island action row for narrow-screen wrapping and settles %s', async confirmed => {
  mockTheme = 'animal-island-ui'
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 360, height: 640, scale: 1, fontScale: 1.6 })
  let outcome: Promise<boolean> | undefined
  function ConfirmTrigger() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Ask narrow" onPress={() => {
      outcome = dialog.confirm({
        title: 'Discard unsaved changes?',
        message: 'Leaving clears the input in this editing session.',
        cancelLabel: 'Keep editing',
        confirmLabel: 'Discard changes',
      })
    }} />
  }
  try {
    const screen = await render(<IsleThemeProvider><IsleDialogProvider><ConfirmTrigger /></IsleDialogProvider></IsleThemeProvider>)
    await fireEvent.press(screen.getByLabelText('Ask narrow'))
    expect(screen.getByTestId('animal-island-dialog-panel')).toHaveStyle({ width: 332 })
    const actionRow = screen.getByTestId('animal-island-dialog-footer').props.children
    expect(StyleSheet.flatten(actionRow.props.style)).toMatchObject({
      width: '100%',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
    })
    await fireEvent.press(screen.getByText(confirmed ? 'Discard changes' : 'Keep editing'))
    expect(await outcome).toBe(confirmed)
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
    await screen.unmount()
  } finally {
    dimensions.mockRestore()
  }
})

it.each(['minimal', 'monet', 'material', 'liquid-glass'])('%s confirmation remains readable and settles without waiting for its animation', async (theme) => {
  mockTheme = theme
  mockMotion = 'full'
  let outcome: Promise<boolean> | undefined
  function TriggerConfirm() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Ask" onPress={() => { outcome = dialog.confirm({ title: 'Continue?' }) }} />
  }
  const screen = await render(<IsleDialogProvider><TriggerConfirm /></IsleDialogProvider>)
  // Hidden Web Modal portals otherwise precede, and sit behind, later editor sheets.
  expect(screen.container.queryAll(node => node.props.animationType === 'none' && node.props.transparent === true)).toHaveLength(0)
  await fireEvent.press(screen.getByLabelText('Ask'))
  expect(screen.getByText('Continue?')).toBeTruthy()
  const entrance = screen.container.queryAll(node => node.props.from?.opacity === 0.65 && node.props.transition?.duration > 1)
  expect(entrance.length).toBeGreaterThan(0)
  await fireEvent.press(screen.getByText('common.confirm'))
  expect(await outcome).toBe(true)
  expect(screen.queryByText('Continue?')).toBeNull()
  expect(screen.container.queryAll(node => node.props.animationType === 'none' && node.props.transparent === true)).toHaveLength(0)
})

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'])('%s removes only the editor-owned prompt on editor unmount', async theme => {
  mockTheme = theme
  let editorOutcome: Promise<boolean> | undefined
  let unrelatedOutcome: Promise<boolean> | undefined
  function Editor() {
    const lifetime = useSettingsLifetime()
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Editor prompt" onPress={() => {
      editorOutcome = dialog.confirm({ title: 'Discard editor?', signal: lifetime.current?.signal })
    }} />
  }
  function Surface() {
    const [open, setOpen] = useState(true)
    const dialog = useIsleDialog()
    return <>
      {open ? <Editor /> : null}
      <Pressable accessibilityLabel="Other prompt" onPress={() => {
        unrelatedOutcome = dialog.confirm({ title: 'Unrelated action?' })
      }} />
      <Pressable accessibilityLabel="Unmount editor" onPress={() => setOpen(false)} />
    </>
  }
  const screen = await render(<IsleThemeProvider><IsleDialogProvider><Surface /></IsleDialogProvider></IsleThemeProvider>)
  await fireEvent.press(screen.getByLabelText('Editor prompt'))
  await fireEvent.press(screen.getByLabelText('Other prompt'))
  await fireEvent.press(screen.getByLabelText('Unmount editor'))
  expect(await editorOutcome).toBe(false)
  expect(screen.queryByText('Discard editor?')).toBeNull()
  expect(screen.getByText('Unrelated action?')).toBeTruthy()
  await fireEvent.press(screen.getByText('common.cancel'))
  expect(await unrelatedOutcome).toBe(false)
  await screen.unmount()
})

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'].flatMap(theme =>
  [false, true].map(confirmed => [theme, confirmed] as const),
))('keeps full %s dialog actions at narrow large fonts and settles %s', async (theme, confirmed) => {
  mockTheme = theme
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 360, height: 640, scale: 1, fontScale: 1.6,
  })
  let outcome: Promise<boolean> | undefined
  function ConfirmTrigger() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Ask long actions" onPress={() => {
      outcome = dialog.confirm({
        title: 'Review pending memories?',
        cancelLabel: 'Keep editing this configuration',
        confirmLabel: 'Confirm 123 filtered pending memories',
        message: 'Review the complete action before confirming.',
      })
    }} />
  }
  try {
    const screen = await render(<IsleThemeProvider><IsleDialogProvider><ConfirmTrigger /></IsleDialogProvider></IsleThemeProvider>)
    await fireEvent.press(screen.getByLabelText('Ask long actions'))
    expect(screen.getByTestId('dialog-actions')).toHaveStyle({ flexWrap: 'wrap' })
    for (const label of ['Keep editing this configuration', 'Confirm 123 filtered pending memories']) {
      const text = screen.getByText(label)
      expect(text.props.numberOfLines ?? 0).toBe(0)
      expect(text).toHaveStyle({ minWidth: 0, flexShrink: 1, textAlign: 'center' })
    }
    await fireEvent.press(screen.getByText(confirmed ? 'Confirm 123 filtered pending memories' : 'Keep editing this configuration'))
    expect(await outcome).toBe(confirmed)
    expect(screen.queryByText('Review pending memories?')).toBeNull()
    await screen.unmount()
  } finally {
    dimensions.mockRestore()
  }
})

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'])('%s keeps a long notice action complete and dismissible', async theme => {
  mockTheme = theme
  function NoticeTrigger() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Explain local refusal" onPress={() => {
      dialog.notice({ title: 'Import stopped locally', actionLabel: 'Return to the knowledge import editor' })
    }} />
  }
  const screen = await render(<IsleThemeProvider><IsleDialogProvider><NoticeTrigger /></IsleDialogProvider></IsleThemeProvider>)
  await fireEvent.press(screen.getByLabelText('Explain local refusal'))
  expect(screen.getByText('Return to the knowledge import editor').props.numberOfLines ?? 0).toBe(0)
  await fireEvent.press(screen.getByText('Return to the knowledge import editor'))
  expect(screen.queryByText('Import stopped locally')).toBeNull()
  await screen.unmount()
})
