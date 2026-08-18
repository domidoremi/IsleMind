import type {
  ChatMultimodalEntry,
  ChatMultimodalEntryPolicy,
  ChatMultimodalPolicy,
  ChatMultimodalSource,
} from '@/presentation/features/chat/chatMultimodalPolicy'

import { shouldRenderChatSetupBoundaryStatus } from '../chatSetupBoundaryVisibility'

const ENTRIES: readonly ChatMultimodalEntry[] = ['image', 'camera', 'file', 'voice']

function policyWithSource(
  source: ChatMultimodalSource,
): Pick<ChatMultimodalPolicy, 'entries'> {
  return {
    entries: Object.fromEntries(
      ENTRIES.map((entry) => [
        entry,
        {
          entry,
          available: source !== 'provider-missing',
          requirement: entry === 'file'
            ? 'file-input'
            : entry === 'voice'
              ? 'audio-transcription'
              : 'image-input',
          source,
        } satisfies ChatMultimodalEntryPolicy,
      ]),
    ) as ChatMultimodalPolicy['entries'],
  }
}

describe('shouldRenderChatSetupBoundaryStatus', () => {
  it('hides duplicated readiness details while setup has no usable provider context', () => {
    expect(
      shouldRenderChatSetupBoundaryStatus(policyWithSource('provider-missing')),
    ).toBe(false)
  })

  it('keeps the capability entry once setup has a provider-backed policy', () => {
    expect(
      shouldRenderChatSetupBoundaryStatus(
        policyWithSource('provider-capability-manifest'),
      ),
    ).toBe(true)
  })
})
