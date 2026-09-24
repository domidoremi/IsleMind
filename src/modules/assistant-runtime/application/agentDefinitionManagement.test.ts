import { createAgentDefinition, encodeAgentDefinition } from '../agentDefinition'
import { createAgentDefinitionManagement } from './agentDefinitionManagement'

const definition = createAgentDefinition({ id: 'original', name: 'Research', providerId: 'provider', modelId: 'model' })
function fixture(json = encodeAgentDefinition(definition)) {
  const repository = { list: jest.fn(), get: jest.fn().mockResolvedValue(definition), save: jest.fn(), remove: jest.fn(), clear: jest.fn() }
  const files = { selectJsonFile: jest.fn().mockResolvedValue({ ok: true, json }), exportJsonFile: jest.fn().mockResolvedValue({ uri: 'local-file' }) }
  return { repository, files, management: createAgentDefinitionManagement({ repository, files, newId: () => 'local-copy' }) }
}

test('import is an unsaved preview with a fresh identity and never overwrites or grants anything', async () => {
  const { repository, management } = fixture()
  const imported = await management.importDraft()
  expect(imported).toEqual({ ...definition, id: 'local-copy' })
  expect(repository.save).not.toHaveBeenCalled()
  expect(repository.remove).not.toHaveBeenCalled()
})

test('rejects unknown authority fields before any save and handles cancellation without mutation', async () => {
  const { repository, files, management } = fixture(JSON.stringify({ ...definition, credentials: { secret: 'untrusted' } }))
  await expect(management.importDraft()).rejects.toThrow()
  expect(repository.save).not.toHaveBeenCalled()
  files.selectJsonFile.mockResolvedValue({ ok: false, reason: 'selection_cancelled' })
  expect(await management.importDraft()).toBeUndefined()
  files.selectJsonFile.mockResolvedValue({ ok: true, json: encodeAgentDefinition(definition) })
  const controller = new AbortController(); controller.abort()
  expect(await management.importDraft(controller.signal)).toBeUndefined()
})

test('export rereads the saved definition and emits only the validated document', async () => {
  const { repository, files, management } = fixture()
  await management.exportSaved('original')
  expect(repository.get).toHaveBeenCalledWith('original')
  expect(JSON.parse(files.exportJsonFile.mock.calls[0][0])).toEqual(definition)
  expect(repository.save).not.toHaveBeenCalled()
})
