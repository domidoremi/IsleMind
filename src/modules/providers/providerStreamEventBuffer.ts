import type { StreamEvent } from '@/core'

export class StreamEventBufferLimitError extends Error {
  constructor() {
    super('The provider stream exceeded the bounded event buffer.')
    this.name = 'StreamEventBufferLimitError'
  }
}

export function streamEventCount(event: StreamEvent): number {
  const count = event.type === 'text-delta' ? event.sourceEventCount ?? 1 : 1
  if (!Number.isSafeInteger(count) || count < 1) throw new StreamEventBufferLimitError()
  return count
}

/**
 * Callback transports cannot be paused uniformly (notably WebSocket). Bound
 * retained events and serialized characters, coalescing only adjacent text.
 * Overflow is explicit; never drop a tool/usage/citation boundary to make room.
 * Receipts let multiple checkpoint callers share one durable batch promise.
 */
export class ProviderStreamEventBuffer<Receipt = undefined> {
  private readonly entries: Array<{ event: StreamEvent; receipt: Receipt; characters: number }> = []
  private characters = 0

  constructor(private readonly limits = { events: 256, characters: 1_048_576 }) {}

  get length(): number { return this.entries.length }

  push(event: StreamEvent, receipt: () => Receipt): Receipt {
    const count = streamEventCount(event)
    const characters = event.type === 'text-delta' ? event.text.length : JSON.stringify(event).length
    const last = this.entries.at(-1)
    const merge = last?.event.type === 'text-delta' && event.type === 'text-delta'
    if (characters > this.limits.characters - this.characters
      || (!merge && this.entries.length >= this.limits.events)) throw new StreamEventBufferLimitError()
    if (last && last.event.type === 'text-delta' && event.type === 'text-delta') {
      const sourceEventCount = streamEventCount(last.event) + count
      if (!Number.isSafeInteger(sourceEventCount)) throw new StreamEventBufferLimitError()
      last.event = { type: 'text-delta', text: last.event.text + event.text, sourceEventCount }
      last.characters += characters
      this.characters += characters
      return last.receipt
    }
    // Capture metadata now: callback owners may reuse/mutate their input after
    // returning. JSON also rejects unserializable provider payloads here.
    const captured: StreamEvent = event.type === 'text-delta'
      ? { ...event }
      : JSON.parse(JSON.stringify(event)) as StreamEvent
    const value = receipt()
    this.entries.push({ event: captured, receipt: value, characters })
    this.characters += characters
    return value
  }

  shift(): { event: StreamEvent; receipt: Receipt } | undefined {
    const value = this.entries.shift()
    if (value) this.characters -= value.characters
    return value
  }
}
