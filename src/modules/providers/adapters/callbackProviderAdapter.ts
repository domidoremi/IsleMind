import type { ChatRequest, StreamEvent } from '@/core'
import type { ProviderAdapter, ProviderCapability, ProviderGatewayOptions } from '../contracts'

export interface CallbackProviderStreamCallbacks {
  onEvent(event: StreamEvent): void
  onComplete(): void
  onError(error: unknown): void
}

export interface CallbackProviderStreamTransport {
  start(
    request: ChatRequest,
    callbacks: CallbackProviderStreamCallbacks,
    options: ProviderGatewayOptions,
  ): Promise<void>
}

export interface CallbackProviderAdapterOptions {
  providerId: string
  capabilities?: readonly ProviderCapability[]
  transport: CallbackProviderStreamTransport
}

export function createCallbackProviderAdapter(options: CallbackProviderAdapterOptions): ProviderAdapter {
  return {
    providerId: options.providerId,
    ...(options.capabilities ? { capabilities: [...options.capabilities] } : {}),
    stream(request, gatewayOptions) {
      return streamFromCallbacks(options.transport, request, gatewayOptions)
    },
  }
}

async function* streamFromCallbacks(
  transport: CallbackProviderStreamTransport,
  request: ChatRequest,
  options: ProviderGatewayOptions,
): AsyncIterable<StreamEvent> {
  if (options.signal.aborted) return
  const queue = new AsyncEventQueue<StreamEvent>()
  const abort = () => queue.complete()
  options.signal.addEventListener('abort', abort, { once: true })

  if (options.signal.aborted) {
    options.signal.removeEventListener('abort', abort)
    return
  }

  void transport.start(request, {
    onEvent: (event) => queue.push(event),
    onComplete: () => queue.complete(),
    onError: (error) => queue.fail(error),
  }, options).then(
    () => queue.complete(),
    (error) => queue.fail(error),
  )

  try {
    for await (const event of queue) {
      if (options.signal.aborted) return
      yield event
    }
  } finally {
    options.signal.removeEventListener('abort', abort)
  }
}

class AsyncEventQueue<Value> implements AsyncIterable<Value> {
  private readonly values: Value[] = []
  private completion: { error?: unknown } | undefined
  private wake?: () => void

  push(value: Value): void {
    if (this.completion) return
    this.values.push(value)
    this.wake?.()
    this.wake = undefined
  }

  complete(): void {
    if (this.completion) return
    this.completion = {}
    this.wake?.()
    this.wake = undefined
  }

  fail(error: unknown): void {
    if (this.completion) return
    this.completion = { error }
    this.wake?.()
    this.wake = undefined
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Value> {
    while (true) {
      const value = this.values.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      if (this.completion) {
        if (this.completion.error) throw this.completion.error
        return
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}
