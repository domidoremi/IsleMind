import { describe, expect, it } from '@jest/globals'
import type { Conversation } from '@/types/chatContracts'
import type { KnowledgeLocalSource } from '@/modules/knowledge'
import { documentDraftFromMessage } from './document'
import { createDocumentRevisionService, DOCUMENT_REVISION_INPUT_LIMIT, type DocumentRevisionTarget } from './documentRevision'

function fixture() {
  const conversation: Conversation = {
    id: 'chat', title: 'Decision', providerId: 'p', model: 'm', systemPrompt: '', temperature: 0.2, maxTokens: 512,
    createdAt: 1, updatedAt: 15, knowledgeSources: ['source'],
    messages: [{ id: 'answer', role: 'assistant', status: 'done', timestamp: 15, content: 'Approval is pending.',
      providerId: 'p', model: 'm', citations: [{ id: 'citation', type: 'knowledge', title: 'Decision source', documentId: 'source', chunkId: 'part', excerpt: 'Captured excerpt' }] }],
  }
  const draft = documentDraftFromMessage(conversation, conversation.messages[0])
  const target: DocumentRevisionTarget = { providerId: 'p', providerName: 'Provider', model: 'm', upstreamModel: 'm', destination: 'http://127.0.0.1:18085/v1' }
  let current: Conversation | undefined = conversation
  let targets = [target]
  let source: KnowledgeLocalSource | undefined = {
    type: 'knowledge',
    document: { schema: 'islemind.knowledge-document-record.v1', id: 'source', title: 'Decision source', updatedAt: 20, createdAt: 1, status: 'ready', chunkCount: 1, mimeType: 'text/plain', size: 80 },
    chunks: [{ schema: 'islemind.knowledge-chunk-record.v1', id: 'part', documentId: 'source', ordinal: 0, title: 'Decision source', content: 'Approval is pending. A supervised on-site alternative is permitted.', createdAt: 1 }],
  }
  let waitRead: (() => Promise<void>) | undefined
  let waitGenerate: (() => Promise<string>) | undefined
  const reads: unknown[] = []
  const requests: { target: DocumentRevisionTarget; userPrompt: string; systemPrompt: string; signal: AbortSignal }[] = []
  const service = createDocumentRevisionService({
    getConversation: () => current,
    ensureConversation: async () => undefined,
    readLocalSource: async (reference) => { reads.push(reference); await waitRead?.(); return source },
    listTargets: () => targets,
    generate: async (input) => { requests.push(input); return waitGenerate ? waitGenerate() : 'Approval is pending. Use the supervised on-site option.' },
  })
  return { service, conversation, draft, target, reads, requests,
    source: () => source,
    setSource: (value: typeof source) => { source = value },
    setConversation: (value: typeof current) => { current = value },
    setTargets: (value: typeof targets) => { targets = value },
    waitRead: (value: typeof waitRead) => { waitRead = value },
    waitGenerate: (value: typeof waitGenerate) => { waitGenerate = value },
  }
}
const signal = () => new AbortController().signal
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('explicit source-backed document revisions (host)', () => {
  it('reads current scoped retained sections only, then sends only the chosen bytes and current document', async () => {
    const f = fixture()
    const source = await f.service.readSource(f.draft.origin!, 'citation', signal())
    expect(f.reads).toEqual([{ type: 'knowledge', documentId: 'source' }])
    expect(source.text).toContain('supervised on-site alternative')
    expect(source.updatedAt).toBe(20)
    const result = await f.service.propose({ draft: { ...f.draft, body: 'Edited body' }, instruction: 'Add the permitted alternative.', target: f.target, sources: [source] }, signal())
    const payload = JSON.parse(f.requests[0].userPrompt)
    expect(payload.document).toEqual({ title: f.draft.title, body: 'Edited body' })
    expect(payload.sources).toEqual([{ label: 'S1', title: source.title, type: 'knowledge', updatedAt: 20, text: source.text }])
    expect(f.requests[0].userPrompt).not.toContain('Captured excerpt')
    expect(payload).not.toHaveProperty('origin')
    expect(result).toContain('on-site')
    expect(f.draft.body).toBe('Approval is pending.')
    expect(f.conversation.messages[0].content).toBe(f.draft.body)
  })

  it('does not let imported/captured citations authorize a missing, changed or different live origin', async () => {
    for (const change of ['missing', 'body', 'timestamp', 'status', 'provider', 'citation', 'ambiguous', 'scope']) {
      const f = fixture()
      const message = f.conversation.messages[0]
      if (change === 'missing') f.setConversation(undefined)
      if (change === 'body') message.content = 'Different answer'
      if (change === 'timestamp') message.timestamp++
      if (change === 'status') message.status = 'streaming'
      if (change === 'provider') message.providerId = 'other'
      if (change === 'citation') message.citations![0] = { ...message.citations![0], documentId: 'private' }
      if (change === 'ambiguous') message.citations!.push({ ...message.citations![0] })
      if (change === 'scope') f.conversation.knowledgeSources = ['private']
      await expect(f.service.readSource(f.draft.origin!, 'citation', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
      expect(f.reads).toHaveLength(0)
      expect(f.requests).toHaveLength(0)
    }
  })

  it('does not resolve missing identities, unlinked citations or web URLs by title/excerpt', async () => {
    for (const change of ['missing-id', 'unlinked', 'web']) {
      const f = fixture()
      if (change === 'unlinked') {
        delete f.draft.origin!.citations[0].documentId
        delete f.conversation.messages[0].citations![0].documentId
      }
      if (change === 'web') {
        f.draft.origin!.citations[0].type = 'web'
        f.conversation.messages[0].citations![0].type = 'web'
      }
      await expect(f.service.readSource(f.draft.origin!, change === 'missing-id' ? 'unknown' : 'citation', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
      expect(f.reads).toHaveLength(0)
    }
  })

  it('rechecks live scope after a delayed read, including the actual saved title for title scopes', async () => {
    const f = fixture()
    const gate = deferred<void>()
    f.waitRead(() => gate.promise)
    const pending = f.service.readSource(f.draft.origin!, 'citation', signal())
    await Promise.resolve()
    f.conversation.knowledgeSources = ['private']
    gate.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'sourceUnavailable' })
    f.conversation.knowledgeSources = ['Decision']
    const source = f.source()!
    if (source.type === 'knowledge') source.document.title = 'Unrelated private title'
    await expect(f.service.readSource(f.draft.origin!, 'citation', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
  })

  it('refuses missing, incomplete or internally mismatched saved sources', async () => {
    for (const change of ['deleted', 'not-ready', 'foreign-chunk']) {
      const f = fixture()
      const source = f.source()!
      if (change === 'deleted') f.setSource(undefined)
      if (source.type === 'knowledge' && change === 'not-ready') source.document.status = 'error'
      if (source.type === 'knowledge' && change === 'foreign-chunk') source.chunks[0].documentId = 'private'
      await expect(f.service.readSource(f.draft.origin!, 'citation', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
    }
  })

  it('uses conversation-scoped active, non-sensitive memory only', async () => {
    const f = fixture()
    f.draft.origin!.citations[0] = { id: 'memory', type: 'memory', title: 'Preference' }
    f.conversation.messages[0].citations = [{ ...f.draft.origin!.citations[0] }]
    const source: KnowledgeLocalSource = { type: 'memory', memory: {
      schema: 'islemind.knowledge-memory-record.v1', id: 'memory', status: 'active', sensitivity: 'normal',
      content: 'Use concise prose.', scope: { kind: 'conversation', id: 'chat' }, sourceMessageIds: [], sourceKind: 'manual', createdAt: 1, updatedAt: 2,
    } }
    f.setSource(source)
    expect((await f.service.readSource(f.draft.origin!, 'memory', signal())).text).toBe('Use concise prose.')
    expect(f.reads[0]).toEqual({ type: 'memory', memoryId: 'memory', conversationId: 'chat' })
    source.memory.scope.id = 'different-chat'
    await expect(f.service.readSource(f.draft.origin!, 'memory', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
    source.memory.scope.id = 'chat'; source.memory.sensitivity = 'sensitive'
    await expect(f.service.readSource(f.draft.origin!, 'memory', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
    source.memory.sensitivity = 'normal'; source.memory.status = 'disabled'
    await expect(f.service.readSource(f.draft.origin!, 'memory', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
    source.memory.status = 'active'; source.memory.validUntil = 10
    await expect(f.service.readSource(f.draft.origin!, 'memory', signal())).rejects.toMatchObject({ code: 'sourceUnavailable' })
  })

  it('requires re-review after source replacement instead of silently sending newer text', async () => {
    const f = fixture()
    const selected = await f.service.readSource(f.draft.origin!, 'citation', signal())
    const source = f.source()!
    if (source.type === 'knowledge') source.chunks[0].content = 'Changed without a timestamp update'
    await expect(f.service.propose({ draft: f.draft, instruction: 'Revise', sources: [selected], target: f.target }, signal())).rejects.toMatchObject({ code: 'sourceChanged' })
    expect(f.requests).toHaveLength(0)
  })

  it('honors cancellation before dispatch and rejects late completed text after cancellation', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(f.service.propose({ draft: f.draft, instruction: 'Revise', sources: [], target: f.target }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.requests).toHaveLength(0)
    const gate = deferred<string>()
    f.waitGenerate(() => gate.promise)
    const next = new AbortController()
    const pending = f.service.propose({ draft: f.draft, instruction: 'Revise', sources: [], target: f.target }, next.signal)
    next.abort(); gate.resolve('Late output must not become a proposal')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not send unselected origin/source text and rejects changed targets without fallback', async () => {
    const f = fixture()
    await f.service.propose({ draft: f.draft, instruction: 'Make the text concise', sources: [], target: f.target }, signal())
    expect(f.reads).toHaveLength(0)
    expect(JSON.parse(f.requests[0].userPrompt).sources).toEqual([])
    f.setTargets([{ ...f.target, destination: 'http://127.0.0.1:18086/v1' }])
    await expect(f.service.propose({ draft: f.draft, instruction: 'Revise', sources: [], target: f.target }, signal())).rejects.toMatchObject({ code: 'targetChanged' })
    expect(f.requests).toHaveLength(1)
  })

  it('bounds input and distinct source count rather than silently compressing or duplicating', async () => {
    const f = fixture()
    const source = await f.service.readSource(f.draft.origin!, 'citation', signal())
    await expect(f.service.propose({ draft: f.draft, instruction: 'Revise', sources: [source, source], target: f.target }, signal())).rejects.toMatchObject({ code: 'invalidRequest' })
    await expect(f.service.propose({ draft: { ...f.draft, body: 'x'.repeat(DOCUMENT_REVISION_INPUT_LIMIT) }, instruction: 'Revise', sources: [], target: f.target }, signal())).rejects.toMatchObject({ code: 'inputTooLong' })
    expect(f.requests).toHaveLength(0)
  })

  it('snapshots user-reviewed bytes before an awaited read; no late caller mutation changes the request', async () => {
    const f = fixture()
    const source = await f.service.readSource(f.draft.origin!, 'citation', signal())
    const gate = deferred<void>()
    f.waitRead(() => gate.promise)
    const pending = f.service.propose({ draft: f.draft, instruction: 'Revise', sources: [source], target: f.target }, signal())
    f.draft.body = 'Newer unsaved draft'
    source.text = 'Late mutation'
    gate.resolve()
    await pending
    expect(JSON.parse(f.requests[0].userPrompt).document.body).toBe('Approval is pending.')
    expect(f.requests[0].userPrompt).not.toContain('Late mutation')
  })
})
