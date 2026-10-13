import { createContextSnapshotAssembler } from './contextSnapshotAssembler'

function fixture() {
  const repository = { save: jest.fn(async () => {}), get: jest.fn(async () => undefined) }
  const assembler = createContextSnapshotAssembler({ repository, clock: { now: () => 1 }, ids: { next: () => 'snapshot' } })
  return { repository, assembler }
}

it('persists a fresh Agent task snapshot without inventing conversation history', async () => {
  const { assembler, repository } = fixture()
  const result = await assembler.assemble({ conversationId: 'chat', conversationMessageIds: [], requestText: 'Do this new task' })
  expect(result.ok).toBe(true)
  expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'chat',
    snapshot: expect.objectContaining({ conversationMessageIds: [] }), providerContext: '', sources: [], citations: [] }))
})

it.each([
  { conversationId: 'chat', conversationMessageIds: [], requestText: '  ' },
  { conversationId: '  ', conversationMessageIds: [], requestText: 'Do this new task' },
])('rejects an empty task or missing conversation without saving', async (input) => {
  const { assembler, repository } = fixture()
  const result = await assembler.assemble(input)
  expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(repository.save).not.toHaveBeenCalled()
})
