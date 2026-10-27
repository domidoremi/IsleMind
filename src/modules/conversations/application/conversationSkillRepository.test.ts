import { createConversationSkillRepository } from './conversationSkillPolicy'
import type { SkillDefinition } from '@/types/skillContracts'

const original: SkillDefinition = {
  schema: 'islemind.skill.v1', id: 'skill', name: 'Saved', systemPrompt: 'Original',
  layer: 'base', tags: ['retained'], priority: 0, createdAt: 1, updatedAt: 2,
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

function fixture() {
  let records = [copy(original)]
  const read = jest.fn(async () => copy(records))
  const write = jest.fn(async (skills: readonly SkillDefinition[]) => { records = copy([...skills]) })
  const repository = createConversationSkillRepository({
    records: { read, write },
    normalizeSkill: value => value && typeof value === 'object' && (value as SkillDefinition).schema === 'islemind.skill.v1'
      ? copy(value as SkillDefinition) : null,
  })
  return { repository, read, write, get: () => copy(records), replace: (skills: SkillDefinition[]) => { records = copy(skills) } }
}

it('rejects a same-timestamp competing edit inside the serialized mutation without overwriting it', async () => {
  const f = fixture()
  f.replace([{ ...original, systemPrompt: 'Concurrent edit' }])
  await expect(f.repository.upsertSkill(
    { ...original, systemPrompt: 'Stale draft', updatedAt: 3 }, { expectedSkill: original },
  )).rejects.toMatchObject({ name: 'ConversationSkillConflictError' })
  expect(f.write).not.toHaveBeenCalled()
  expect(f.get()[0].systemPrompt).toBe('Concurrent edit')
})

it('rejects stale deletes and deleted edit targets rather than recreating or erasing unseen work', async () => {
  const f = fixture()
  f.replace([{ ...original, tags: ['concurrent'] }])
  await expect(f.repository.deleteSkill(original.id, { expectedSkill: original }))
    .rejects.toMatchObject({ name: 'ConversationSkillConflictError' })
  f.replace([])
  await expect(f.repository.upsertSkill({ ...original, systemPrompt: 'Stale draft' }, { expectedSkill: original }))
    .rejects.toMatchObject({ name: 'ConversationSkillConflictError' })
  expect(f.write).not.toHaveBeenCalled()
})

it('supports insert-only saves and resumes its mutation queue after a conflict', async () => {
  const f = fixture()
  await expect(f.repository.upsertSkill({ ...original, systemPrompt: 'Collision' }, { expectedSkill: null }))
    .rejects.toMatchObject({ name: 'ConversationSkillConflictError' })
  await f.repository.upsertSkill({ ...original, id: 'new' }, { expectedSkill: null })
  expect(f.get().map(skill => skill.id)).toEqual(['new', 'skill'])
  expect(f.get()[1]).toEqual(original)
})

it('rechecks cancellation after a pending canonical read and before the first write', async () => {
  const f = fixture()
  let resolve!: (skills: SkillDefinition[]) => void
  f.read.mockImplementationOnce(() => new Promise<SkillDefinition[]>(settle => { resolve = settle }))
  const controller = new AbortController()
  const pending = f.repository.deleteSkill(original.id, { expectedSkill: original, signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  resolve([copy(original)])
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.write).not.toHaveBeenCalled()
})

it('detaches queued input and expected snapshots from later caller mutation', async () => {
  const f = fixture()
  let resolve!: (skills: SkillDefinition[]) => void
  f.read.mockImplementationOnce(() => new Promise<SkillDefinition[]>(settle => { resolve = settle }))
  const blocker = f.repository.upsertSkill({ ...original, id: 'other' })
  await Promise.resolve()
  const expected = copy(original)
  const draft = { ...copy(original), systemPrompt: 'Queued draft', updatedAt: 3 }
  const pending = f.repository.upsertSkill(draft, { expectedSkill: expected })
  expected.tags.push('unseen')
  draft.systemPrompt = 'Later caller mutation'
  resolve([copy(original)])
  await blocker
  await pending
  expect(f.get().find(skill => skill.id === original.id)?.systemPrompt).toBe('Queued draft')
})

it('preserves a successful durable write when cancellation arrives after the write starts', async () => {
  const f = fixture()
  const controller = new AbortController()
  f.write.mockImplementationOnce(async skills => {
    f.replace(copy([...skills]))
    controller.abort()
  })
  const saved = await f.repository.upsertSkill({ ...original, systemPrompt: 'Committed' }, {
    expectedSkill: original, signal: controller.signal,
  })
  expect(saved.systemPrompt).toBe('Committed')
  expect(f.get()[0].systemPrompt).toBe('Committed')
})
