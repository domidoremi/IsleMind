import { waitFor } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import * as Clipboard from 'expo-clipboard'
import type { Message } from '@/types/chatContracts'
import { summarizeWorkArtifact } from '@/utils/workArtifact'
import { formatProcessTraceForCopy } from './tracePresentation'
import { copyChatMessageProcessTrace, copyChatMessageText, copyChatMessageWorkArtifact } from './chatMessageBubbleActions'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('@/presentation/features/conversations/conversationMessageActionCommand', () => {
  const { createConversationMessageActionController } = jest.requireActual('@/presentation/features/conversations/conversationMessageActionController')
  const controller = createConversationMessageActionController({ writeText: (text: string) => require('expo-clipboard').setStringAsync(text) })
  return { copyConversationMessageFinalText: controller.copyFinalText }
})

const t = ((key: string) => key) as TFunction
const dialog = { toast: jest.fn(), confirm: jest.fn() }
const message: Message = {
  id: 'clipboard-message', role: 'assistant', timestamp: 1, status: 'done',
  content: '## Summary\n- Ready for review.\n## Action items\n- Owner: Alex; Next: Review the draft.',
  responseText: '## Summary\n- Final review copy.\n## Action items\n- Owner: Alex; Next: Review the final draft.',
  retrievalTrace: [{ id: 'source', type: 'retrieval', title: 'Sources', content: 'One saved source.', status: 'done', startedAt: 1 }],
}

beforeEach(() => jest.resetAllMocks())

describe.each([
  ['final text', copyChatMessageText, () => message.responseText!],
  ['process trace', copyChatMessageProcessTrace, () => formatProcessTraceForCopy(message.retrievalTrace![0])],
  ['work artifact', copyChatMessageWorkArtifact, () => summarizeWorkArtifact(message.responseText!).handoffText],
] as const)('%s copy', (_label, copy, expectedText) => {
  it.each(['success', 'false', 'rejection'] as const)('reports only the actual clipboard outcome: %s', async (outcome) => {
    if (outcome === 'rejection') jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Unavailable'))
    else jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(outcome === 'success')
    copy({ dialog, message, t })
    await waitFor(() => expect(dialog.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: outcome === 'success' ? 'common.copied' : 'common.copyFailed',
      tone: outcome === 'success' ? 'mint' : 'danger',
    })))
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expectedText())
    expect(dialog.toast).toHaveBeenCalledTimes(1)
  })
})

it('does not touch the clipboard for absent process traces or work artifacts', () => {
  const empty: Message = { ...message, content: 'Plain answer', responseText: undefined, retrievalTrace: [] }
  copyChatMessageProcessTrace({ dialog, message: empty, t })
  copyChatMessageWorkArtifact({ dialog, message: empty, t })
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
  expect(dialog.toast.mock.calls.map(([feedback]) => feedback.tone)).toEqual(['amber', 'amber'])
})
