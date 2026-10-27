import type { Conversation, Message } from '@/types/chatContracts'
import {
  createConversationActionConfirmationController,
  type ConversationActionPendingAction,
  type ConversationActionToolRequest,
} from './conversationActionConfirmationController'

type Pending = ConversationActionPendingAction<ConversationActionToolRequest>
type PendingMessage = Message & { pendingAction?: Pending }

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function makeConversation(): Conversation {
  return {
    id: 'conversation', title: 'Review', providerId: 'provider', model: 'model',
    systemPrompt: '', temperature: 0, maxTokens: 128, createdAt: 1, updatedAt: 1,
    messages: [
      { id: 'user', role: 'user', content: 'Review this exact request.', status: 'done', timestamp: 1 },
      {
        id: 'response', role: 'assistant', content: 'Permission required.', status: 'done', timestamp: 2,
        pendingAction: {
          id: 'pending', confirmable: true, toolId: 'fixture.read', toolName: 'read',
          permission: 'read', source: 'builtin', serverId: 'fixture',
          resumeToolRequest: {
            toolId: 'fixture.read', name: 'read', source: 'builtin', serverId: 'fixture',
            arguments: { path: 'reviewed.txt', nested: { enabled: true } },
          },
        },
      } as PendingMessage,
      { id: 'cancelled-tail', role: 'assistant', content: '', status: 'cancelled', timestamp: 3 },
    ],
  }
}

function fixture() {
  let conversation: Conversation | undefined = makeConversation()
  const discover = jest.fn(async () => [{ id: 'fixture.read' }])
  const stop = jest.fn(async (): Promise<void> => undefined)
  const start = jest.fn(async (): Promise<void> => undefined)
  const remove = jest.fn((_conversationId: string, messageId: string) => {
    conversation = conversation && { ...conversation, messages: conversation.messages.filter(item => item.id !== messageId) }
  })
  const controller = createConversationActionConfirmationController({
    getConversation: () => conversation,
    getPendingAction: (message) => (message as PendingMessage).pendingAction,
    listToolManifests: discover,
    resolveConfirmedTool: ({ manifests }) => manifests[0],
    getRunLimits: () => ({ maxSteps: 7 }),
    stopConversation: stop,
    removeMessage: remove,
    startWorkflowReply: start,
  })
  return {
    controller, discover, stop, start, remove,
    read: () => conversation!,
    replace: (next: Conversation | undefined) => { conversation = next },
  }
}

function pending(conversation: Conversation): Pending {
  return (conversation.messages[1] as PendingMessage).pendingAction!
}

const mutations: [string, (conversation: Conversation) => void][] = [
  ['pending identity', conversation => { pending(conversation).id = 'replacement' }],
  ['tool permission', conversation => { pending(conversation).permission = 'write' }],
  ['reviewed summary', conversation => { (pending(conversation) as Pending & { summary?: string }).summary = 'Changed review.' }],
  ['request identity', conversation => { pending(conversation).resumeToolRequest!.name = 'other' }],
  ['nested arguments', conversation => {
    const args = pending(conversation).resumeToolRequest!.arguments!
    ;(args.nested as { enabled: boolean }).enabled = false
  }],
  ['previous user content', conversation => { conversation.messages[0].content = 'A newer request.' }],
  ['previous user identity', conversation => { conversation.messages[0].id = 'replacement-user' }],
  ['execution configuration', conversation => { conversation.providerId = 'replacement-provider' }],
]

it.each(mutations)('rejects in-place %s drift while discovering the catalog', async (_label, mutate) => {
  const test = fixture()
  const wait = deferred<{ id: string }[]>()
  test.discover.mockReturnValueOnce(wait.promise)
  const confirmation = test.controller.confirm('conversation', 'response')
  mutate(test.read())
  wait.resolve([{ id: 'fixture.read' }])
  await expect(confirmation).resolves.toBe(false)
  expect(test.stop).not.toHaveBeenCalled()
  expect(test.remove).not.toHaveBeenCalled()
  expect(test.start).not.toHaveBeenCalled()
})

it.each(mutations)('rejects in-place %s drift while Stop is pending', async (_label, mutate) => {
  const test = fixture()
  const wait = deferred<void>()
  test.stop.mockReturnValueOnce(wait.promise)
  const confirmation = test.controller.confirm('conversation', 'response')
  await Promise.resolve()
  await Promise.resolve()
  expect(test.stop).toHaveBeenCalledTimes(1)
  mutate(test.read())
  wait.resolve()
  await expect(confirmation).resolves.toBe(false)
  expect(test.remove).not.toHaveBeenCalled()
  expect(test.start).not.toHaveBeenCalled()
})

it.each(['removed', 'newer turn', 'cancelled response'] as const)('does not remove a %s after asynchronous Stop', async change => {
  const test = fixture()
  const wait = deferred<void>()
  test.stop.mockReturnValueOnce(wait.promise)
  const confirmation = test.controller.confirm('conversation', 'response')
  await Promise.resolve()
  await Promise.resolve()
  const current = test.read()
  if (change === 'removed') test.replace(undefined)
  else if (change === 'newer turn') current.messages.push({ id: 'new-user', role: 'user', content: 'New turn', timestamp: 4, status: 'done' })
  else current.messages[1].status = 'cancelled'
  wait.resolve()
  await expect(confirmation).resolves.toBe(false)
  expect(test.remove).not.toHaveBeenCalled()
  expect(test.start).not.toHaveBeenCalled()
})

it('does not restart newer history introduced by the exact-removal callback', async () => {
  const test = fixture()
  test.remove.mockImplementationOnce((_id, messageId) => {
    const current = test.read()
    test.replace({ ...current, messages: [
      ...current.messages.filter(item => item.id !== messageId),
      { id: 'new-user', role: 'user', content: 'New turn', timestamp: 4, status: 'done' },
    ] })
  })
  await expect(test.controller.confirm('conversation', 'response')).resolves.toBe(false)
  expect(test.start).not.toHaveBeenCalled()
})

it('starts only with detached reviewed arguments even if removed source objects are mutated', async () => {
  const test = fixture()
  const oldPending = pending(test.read())
  test.remove.mockImplementationOnce((_id, messageId) => {
    const current = test.read()
    test.replace({ ...current, messages: current.messages.filter(item => item.id !== messageId) })
    oldPending.resumeToolRequest!.arguments!.path = 'unreviewed.txt'
  })
  await expect(test.controller.confirm('conversation', 'response')).resolves.toBe(true)
  expect(test.start).toHaveBeenCalledWith(expect.anything(), 'Review this exact request.', {
    explicitToolRequest: expect.objectContaining({ arguments: { path: 'reviewed.txt', nested: { enabled: true } } }),
    limits: { maxSteps: 7 }, userConfirmed: true,
  })
})

it('admits only one confirmation until the durable restart settles', async () => {
  const test = fixture()
  const catalog = deferred<{ id: string }[]>()
  const restart = deferred<void>()
  test.discover.mockReturnValue(catalog.promise)
  test.start.mockReturnValue(restart.promise)
  const confirmation = test.controller.confirm('conversation', 'response')
  const duplicate = test.controller.confirm('conversation', 'response')
  const discoveryCount = test.discover.mock.calls.length
  catalog.resolve([{ id: 'fixture.read' }])
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  restart.resolve()
  await expect(confirmation).resolves.toBe(true)
  await expect(duplicate).resolves.toBe(false)
  expect(discoveryCount).toBe(1)
  expect(test.start).toHaveBeenCalledTimes(1)
  expect(test.remove).toHaveBeenCalledTimes(1)
})

it('releases single-flight ownership after catalog rejection', async () => {
  const test = fixture()
  const failure = new Error('catalog unavailable')
  test.discover.mockRejectedValueOnce(failure)
  await expect(test.controller.confirm('conversation', 'response')).rejects.toBe(failure)
  await expect(test.controller.confirm('conversation', 'response')).resolves.toBe(true)
})

it.each(['entry', 'discovery', 'stop'] as const)('honors lifetime cancellation at %s without removal or restart', async boundary => {
  const test = fixture()
  const lifetime = new AbortController()
  const catalog = deferred<{ id: string }[]>()
  const stopped = deferred<void>()
  if (boundary === 'entry') lifetime.abort()
  else if (boundary === 'discovery') test.discover.mockReturnValueOnce(catalog.promise)
  else test.stop.mockReturnValueOnce(stopped.promise)
  const confirmation = test.controller.confirm('conversation', 'response', lifetime.signal)
  await Promise.resolve()
  await Promise.resolve()
  lifetime.abort()
  catalog.resolve([{ id: 'fixture.read' }])
  stopped.resolve()
  await expect(confirmation).resolves.toBe(false)
  expect(test.remove).not.toHaveBeenCalled()
  expect(test.start).not.toHaveBeenCalled()
})
