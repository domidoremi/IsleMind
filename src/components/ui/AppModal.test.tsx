import { render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { Modal } from './AppModal'

it('blocks only while a modal is visible and releases only its own scope', async () => {
  const screen = await render(<Modal visible={false}><Text>Editor</Text></Modal>)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  await screen.rerender(<Modal visible><Text>Editor</Text></Modal>)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  const other = appUpdateActivity.acquireBlocker('other-editor')
  await screen.rerender(<Modal visible={false}><Text>Editor</Text></Modal>)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  other()
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  await screen.rerender(<Modal><Text>Default visible</Text></Modal>)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  await screen.unmount()
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
})
