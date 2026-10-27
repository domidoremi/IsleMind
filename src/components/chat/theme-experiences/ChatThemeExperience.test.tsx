import { render } from '@testing-library/react-native'
import { View } from 'react-native'

import { getColors } from '@/theme/colors'

import { ChatActiveThemeExperience } from './ChatActiveThemeExperience'
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
