import {
  buildSystemStatusNotificationMutationKey,
  createSystemStatusNotificationDispatcher,
} from '../systemStatusNotificationDispatch'

const generatingPayload = {
  state: 'generating' as const,
  title: 'Generating',
  message: 'Chat A · Thinking',
  shortText: 'Thinking',
  conversationId: 'conversation-a',
  deepLink: 'islemind://chat/conversation-a',
  indeterminate: true,
  ongoing: true,
  requestPromotedOngoing: true,
}

describe('system status notification dispatcher', () => {
  it('deduplicates identical streaming frames before they cross the native bridge', async () => {
    const calls: string[] = []
    let releaseUpdate = () => {}
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    const dispatcher = createSystemStatusNotificationDispatcher({
      async update(payload) {
        calls.push(`update:${payload.shortText}`)
        await updateGate
      },
      async clear() {
        calls.push('clear')
      },
    })

    const first = dispatcher.update(generatingPayload)
    const duplicate = dispatcher.update({ ...generatingPayload })
    await Promise.resolve()

    expect(await duplicate).toBe(false)
    expect(calls).toEqual(['update:Thinking'])
    releaseUpdate()
    expect(await first).toBe(true)
  })

  it('serializes semantic changes so the latest notification wins', async () => {
    const calls: string[] = []
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const dispatcher = createSystemStatusNotificationDispatcher({
      async update(payload) {
        calls.push(`start:${payload.shortText}`)
        if (payload.shortText === 'Thinking') await firstGate
        calls.push(`end:${payload.shortText}`)
      },
      async clear() {
        calls.push('clear')
      },
    })

    const thinking = dispatcher.update(generatingPayload)
    const toolUse = dispatcher.update({ ...generatingPayload, shortText: 'Using tools' })
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['start:Thinking'])

    releaseFirst()
    await Promise.all([thinking, toolUse])
    expect(calls).toEqual([
      'start:Thinking',
      'end:Thinking',
      'start:Using tools',
      'end:Using tools',
    ])
  })

  it('coalesces repeated clears and recovers after a failed mutation', async () => {
    const calls: string[] = []
    let failNextUpdate = true
    const dispatcher = createSystemStatusNotificationDispatcher({
      async update() {
        calls.push('update')
        if (failNextUpdate) {
          failNextUpdate = false
          throw new Error('native failure')
        }
      },
      async clear() {
        calls.push('clear')
      },
    })

    await expect(dispatcher.update(generatingPayload)).rejects.toThrow('native failure')
    await expect(dispatcher.update(generatingPayload)).resolves.toBe(true)
    await expect(dispatcher.clear()).resolves.toBe(true)
    await expect(dispatcher.clear()).resolves.toBe(false)
    expect(calls).toEqual(['update', 'update', 'clear'])
  })

  it('keys every user-visible or lifecycle payload field', () => {
    const key = buildSystemStatusNotificationMutationKey(generatingPayload)
    expect(buildSystemStatusNotificationMutationKey({ ...generatingPayload })).toBe(key)
    expect(buildSystemStatusNotificationMutationKey({ ...generatingPayload, message: 'Chat B · Thinking' })).not.toBe(key)
    expect(buildSystemStatusNotificationMutationKey({ ...generatingPayload, ongoing: false })).not.toBe(key)
  })
})
