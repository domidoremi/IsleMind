import { act, fireEvent, render } from '@testing-library/react-native'
import { AppState, Linking, type AppStateStatus } from 'react-native'
import { IsleButton } from '@/components/ui/isle'
import { ContentReportScreen } from './ContentReportScreen'
import { ContentReportError, prepareContentReport, type ContentReporting } from '@/modules/conversations'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: { text: '#fff', textSecondary: '#aaa', textTertiary: '#888' } }) }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/modules/conversations', () => jest.requireActual('@/modules/conversations/application/contentReport'))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput } = require('react-native')
  const React = require('react')
  return {
    IslePressable: Pressable,
    IsleInput: TextInput,
    IsleButton: jest.fn(({ label, ...props }: { label: string }) => React.createElement(Pressable, { accessibilityRole: 'button', ...props }, React.createElement(Text, null, label))),
  }
})

const configuration = { endpoint: 'https://reports.islemind.org/v1/reports', operator: 'Synthetic operator', privacyPolicyUrl: 'https://reports.islemind.org/privacy' }
function fixture() {
  let count = 0
  const reporting: ContentReporting = {
    configuration,
    prepare: jest.fn(draft => prepareContentReport(draft, `12345678-1234-4567-89ab-${String(++count).padStart(12, '0')}`, '1.1.2')),
    submit: jest.fn(async () => undefined),
  }
  return { reporting, close: jest.fn() }
}
beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() })
})
afterEach(() => jest.restoreAllMocks())

it('cannot send before explicit preview and confirmation, and sends only the edited selection', async () => {
  const { reporting, close } = fixture()
  const screen = await render(<ContentReportScreen source="Answer sk-syntheticsecret123" reporting={reporting} onClose={close} />)
  expect(screen.getByLabelText('contentReport.excerpt').props.value).toBe('Answer [redacted]')
  expect(screen.queryByRole('button', { name: 'contentReport.send' })).toBeNull()
  expect(reporting.submit).not.toHaveBeenCalled()
  await fireEvent.changeText(screen.getByLabelText('contentReport.excerpt'), 'Selected synthetic excerpt')
  await fireEvent.press(screen.getByRole('radio', { name: 'contentReport.reasons.privacy' }))
  await fireEvent.changeText(screen.getByLabelText('contentReport.note'), 'Synthetic note')
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.review' }))
  expect(reporting.submit).not.toHaveBeenCalled()
  expect(screen.getByText('Selected synthetic excerpt')).toBeTruthy()
  expect(screen.queryByLabelText('contentReport.excerpt')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.send' }))
  expect(reporting.submit).toHaveBeenCalledWith({ schemaVersion: 1, reportId: '12345678-1234-4567-89ab-000000000001',
    appVersion: '1.1.2', excerpt: 'Selected synthetic excerpt', reason: 'privacy', note: 'Synthetic note' }, expect.any(AbortSignal))
  expect(screen.getByText('contentReport.received')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'contentReport.send' })).toBeNull()
})

it('retains exact payload and id on manual retry, but requires a fresh preview after editing', async () => {
  const { reporting, close } = fixture()
  jest.mocked(reporting.submit).mockRejectedValue(new ContentReportError('failed'))
  const screen = await render(<ContentReportScreen source="Answer" reporting={reporting} onClose={close} />)
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.review' }))
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.send' }))
  expect(reporting.submit).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.retry' }))
  const calls = jest.mocked(reporting.submit).mock.calls
  expect(calls[0][0]).toBe(calls[1][0])
  await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
  await fireEvent.changeText(screen.getByLabelText('contentReport.note'), 'Changed note')
  expect(screen.queryByRole('button', { name: 'contentReport.send' })).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.review' }))
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.send' }))
  expect(calls[2][0].reportId).not.toBe(calls[1][0].reportId)
})

it('blocks immediate duplicate confirmation and cancels on background and unmount', async () => {
  const { reporting, close } = fixture()
  jest.mocked(reporting.submit).mockImplementation((_report, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new ContentReportError('cancelled')), { once: true })
  }))
  let change!: (state: AppStateStatus) => void
  const remove = jest.fn()
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => { change = listener; return { remove } })
  const screen = await render(<ContentReportScreen source="Answer" reporting={reporting} onClose={close} />)
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.review' }))
  const send = jest.mocked(IsleButton).mock.calls.findLast(([props]) => props.label === 'contentReport.send')![0].onPress!
  await act(() => { send({} as never); send({} as never) })
  expect(reporting.submit).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'contentReport.send' })).toBeDisabled()
  await act(() => change('background'))
  expect(jest.mocked(reporting.submit).mock.calls[0][1].aborted).toBe(true)
  expect(screen.getByText('contentReport.errors.cancelled')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.retry' }))
  await screen.unmount()
  expect(jest.mocked(reporting.submit).mock.calls[1][1].aborted).toBe(true)
  expect(remove).toHaveBeenCalled()
  subscription.mockRestore()
})

it('does not expose sending when configuration/source is absent and does not open privacy automatically', async () => {
  const { reporting, close } = fixture()
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  const screen = await render(<ContentReportScreen source="Answer" reporting={{ ...reporting, configuration: null }} onClose={close} />)
  expect(screen.getByText('contentReport.unavailable')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'contentReport.review' })).toBeNull()
  await screen.rerender(<ContentReportScreen source={null} reporting={reporting} onClose={close} />)
  expect(screen.queryByRole('button', { name: 'contentReport.review' })).toBeNull()
  expect(open).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.privacyPolicy' }))
  expect(open).toHaveBeenCalledWith(configuration.privacyPolicyUrl)
  expect(reporting.submit).not.toHaveBeenCalled()
  open.mockRestore()
})

it('shows only a fixed error for unknown exceptions and preserves edits across source rerenders', async () => {
  const { reporting, close } = fixture()
  jest.mocked(reporting.submit).mockRejectedValue(Error('private server diagnostic'))
  const screen = await render(<ContentReportScreen source="Answer" reporting={reporting} onClose={close} />)
  await fireEvent.changeText(screen.getByLabelText('contentReport.excerpt'), 'My excerpt')
  await screen.rerender(<ContentReportScreen source="New answer must not overwrite the draft" reporting={reporting} onClose={close} />)
  expect(screen.getByLabelText('contentReport.excerpt').props.value).toBe('My excerpt')
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.review' }))
  await fireEvent.press(screen.getByRole('button', { name: 'contentReport.send' }))
  expect(screen.getByText('contentReport.errors.failed')).toBeTruthy()
  expect(screen.queryByText('private server diagnostic')).toBeNull()
})
