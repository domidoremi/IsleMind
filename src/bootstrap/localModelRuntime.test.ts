import {
  clearLocalEmbeddingModelState,
  deleteDownloadedLocalEmbeddingModel,
  downloadLocalEmbeddingModel,
  reviewLocalEmbeddingModelStateRecovery,
} from './localModelRuntime'
import type { LocalEmbeddingModel } from '@/modules/knowledge'

const mockRequireModel = jest.fn()
const mockInstall = jest.fn()
const mockDeleteArtifacts = jest.fn()
const mockRecord = jest.fn()
const mockRemove = jest.fn()
const mockFailure = jest.fn()
const mockRelease = jest.fn()
const mockLoad = jest.fn()
const mockClear = jest.fn()
const mockReview = jest.fn()

jest.mock('./localModelArtifactInstaller', () => ({
  installLocalModelArtifacts: (...args: unknown[]) => mockInstall(...args),
  deleteInstalledLocalModelArtifacts: (...args: unknown[]) => mockDeleteArtifacts(...args),
}))
jest.mock('./localModelCatalog', () => ({
  localEmbeddingModelCatalogPolicy: { requireModel: (...args: unknown[]) => mockRequireModel(...args) },
  localEmbeddingModels: [],
  localRagModelCapabilities: [],
}))
jest.mock('./localModelStateRepository', () => ({
  localModelStateRepository: {
    loadState: (...args: unknown[]) => mockLoad(...args),
    recordInstalledModel: (...args: unknown[]) => mockRecord(...args),
    removeModel: (...args: unknown[]) => mockRemove(...args),
    markModelFailure: (...args: unknown[]) => mockFailure(...args),
    clear: (...args: unknown[]) => mockClear(...args),
    reviewInvalidState: (...args: unknown[]) => mockReview(...args),
  },
}))
jest.mock('./knowledgeEmbeddingProvider', () => ({
  releaseOnnxEmbeddingResources: (...args: unknown[]) => mockRelease(...args),
}))

const model: LocalEmbeddingModel = {
  id: 'owned-runtime-model', version: '1', name: 'Owned runtime model',
  language: 'en', useCase: 'Isolated abort boundary', dimension: 8, tokenizer: 'wordpiece',
  maxTokens: 16, sizeBytes: 100, downloadBaseUrl: 'https://runtime-fixture.invalid',
  bundledIn: [], files: [{ path: 'model.onnx', bytes: 100, sha256: '0'.repeat(64) }],
}
const installed = { bytes: 100, sha256: { 'model.onnx': '0'.repeat(64) } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function settleAdmission() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireModel.mockReset().mockReturnValue(model)
  mockInstall.mockReset().mockResolvedValue(installed)
  mockDeleteArtifacts.mockReset().mockResolvedValue(undefined)
  mockRecord.mockReset().mockResolvedValue(undefined)
  mockRemove.mockReset().mockResolvedValue(undefined)
  mockFailure.mockReset().mockResolvedValue(undefined)
  mockRelease.mockReset().mockResolvedValue(undefined)
  mockLoad.mockReset().mockResolvedValue({ records: {}, failed: {} })
  mockClear.mockReset().mockResolvedValue(undefined)
  mockReview.mockReset().mockResolvedValue(null)
})

function expectNoRecoveryFileOrOrdinaryMutation() {
  expect(mockRequireModel).not.toHaveBeenCalled()
  expect(mockLoad).not.toHaveBeenCalled()
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  expect(mockRelease).not.toHaveBeenCalled()
  expect(mockRecord).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
  expect(mockFailure).not.toHaveBeenCalled()
  expect(mockClear).not.toHaveBeenCalled()
}

it('forwards the exact recovery lifetime and opaque review without ordinary clear, file or resource work', async () => {
  const controller = new AbortController()
  const reset = jest.fn()
  const review = Object.freeze({ reset })
  mockReview.mockResolvedValueOnce(review)
  await expect(reviewLocalEmbeddingModelStateRecovery(controller.signal)).resolves.toBe(review)
  expect(mockReview).toHaveBeenCalledWith({ signal: controller.signal })
  expect(reset).not.toHaveBeenCalled()
  expectNoRecoveryFileOrOrdinaryMutation()
})

it('does not offer metadata recovery when the authoritative repository returns supported state', async () => {
  await expect(reviewLocalEmbeddingModelStateRecovery()).resolves.toBeNull()
  expect(mockReview).toHaveBeenCalledWith({ signal: undefined })
  expectNoRecoveryFileOrOrdinaryMutation()
})

it.each(['LocalModelStateDataError', 'LocalModelStatePersistenceError'])('preserves a recovery review %s refusal without file or resource admission', async name => {
  const refusal = Object.assign(new Error('Owned recovery refusal'), { name })
  mockReview.mockRejectedValueOnce(refusal)
  await expect(reviewLocalEmbeddingModelStateRecovery()).rejects.toBe(refusal)
  expectNoRecoveryFileOrOrdinaryMutation()
})

it('refuses an already-aborted recovery lifetime before repository or file admission', async () => {
  const controller = new AbortController()
  const reason = new Error('Retired before recovery bridge')
  controller.abort(reason)
  await expect(reviewLocalEmbeddingModelStateRecovery(controller.signal)).rejects.toBe(reason)
  expect(mockReview).not.toHaveBeenCalled()
  expectNoRecoveryFileOrOrdinaryMutation()
})

it.each(['resolved', 'rejected'] as const)('retires a %s recovery review after its awaited repository admission', async outcome => {
  const controller = new AbortController()
  const read = deferred<{ reset: () => Promise<void> }>()
  mockReview.mockReturnValueOnce(read.promise)
  const operation = reviewLocalEmbeddingModelStateRecovery(controller.signal)
  const reason = new Error('Retired during recovery bridge')
  const refused = expect(operation).rejects.toBe(reason)
  await settleAdmission()
  expect(mockReview).toHaveBeenCalledWith({ signal: controller.signal })
  controller.abort(reason)
  if (outcome === 'resolved') read.resolve(Object.freeze({ reset: async () => undefined }))
  else read.reject(new Error('Late owned repository refusal'))
  await refused
  expectNoRecoveryFileOrOrdinaryMutation()
})

it('refuses an already-aborted download before catalog lookup or artifact work', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Retired before download'))
  await expect(downloadLocalEmbeddingModel(model.id, { signal: controller.signal })).rejects.toThrow('Retired before download')
  expect(mockRequireModel).not.toHaveBeenCalled()
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockRecord).not.toHaveBeenCalled()
  expect(mockFailure).not.toHaveBeenCalled()
})

it('passes the exact download signal, mirror and progress port and records the installed result once', async () => {
  const controller = new AbortController()
  const onProgress = jest.fn()
  const result = await downloadLocalEmbeddingModel(model.id, {
    signal: controller.signal, mirrorBaseUrl: 'https://mirror-fixture.invalid', onProgress,
  })
  expect(mockInstall).toHaveBeenCalledWith(model, {
    signal: controller.signal, mirrorBaseUrl: 'https://mirror-fixture.invalid', onProgress,
  })
  expect(result).toEqual(expect.objectContaining({ modelId: model.id, source: 'downloaded', ...installed }))
  expect(mockRecord).toHaveBeenCalledWith(result, { signal: controller.signal })
  expect(mockFailure).not.toHaveBeenCalled()
})

it('does not dispatch a state write after an installer acknowledges an aborted download', async () => {
  const effect = deferred<typeof installed>()
  const controller = new AbortController()
  mockInstall.mockReturnValueOnce(effect.promise)
  const operation = downloadLocalEmbeddingModel(model.id, { signal: controller.signal })
  const refused = expect(operation).rejects.toThrow('Retired during install')
  await settleAdmission()
  expect(mockInstall).toHaveBeenCalledTimes(1)
  controller.abort(new Error('Retired during install'))
  effect.resolve(installed)
  await refused
  expect(mockRecord).not.toHaveBeenCalled()
  expect(mockFailure).not.toHaveBeenCalled()
})

it('does not write a model failure marker when an aborted installer rejects', async () => {
  const controller = new AbortController()
  mockInstall.mockImplementationOnce(async () => {
    controller.abort(new Error('Retired installer'))
    throw new Error('Late installer failure')
  })
  await expect(downloadLocalEmbeddingModel(model.id, { signal: controller.signal })).rejects.toThrow('Retired installer')
  expect(mockRecord).not.toHaveBeenCalled()
  expect(mockFailure).not.toHaveBeenCalled()
})

it('retains a non-cancelled install failure and writes its marker through the same signal', async () => {
  const controller = new AbortController()
  const error = new Error('Owned checksum failure')
  mockInstall.mockRejectedValueOnce(error)
  await expect(downloadLocalEmbeddingModel(model.id, { signal: controller.signal })).rejects.toBe(error)
  expect(mockFailure).toHaveBeenCalledWith(model.id, error.message, { signal: controller.signal })
  expect(mockRecord).not.toHaveBeenCalled()
})

it('refuses an already-aborted deletion before releasing resources or touching files or state', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Retired before delete'))
  await expect(deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)).rejects.toThrow('Retired before delete')
  expect(mockRelease).not.toHaveBeenCalled()
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
})

it('keeps deletion awaiting resource release and refuses new file work after cancellation', async () => {
  const released = deferred<void>()
  const controller = new AbortController()
  mockRelease.mockReturnValueOnce(released.promise)
  const operation = deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)
  const refused = expect(operation).rejects.toThrow('Retired while releasing')
  await settleAdmission()
  expect(mockRelease).toHaveBeenCalledTimes(1)
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  controller.abort(new Error('Retired while releasing'))
  released.resolve()
  await refused
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
})

it('does not dispatch removal after an artifact deletion acknowledges an aborted operation', async () => {
  const deleted = deferred<void>()
  const controller = new AbortController()
  mockDeleteArtifacts.mockReturnValueOnce(deleted.promise)
  const operation = deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)
  const refused = expect(operation).rejects.toThrow('Retired while deleting files')
  await settleAdmission()
  expect(mockDeleteArtifacts).toHaveBeenCalledWith(model.id, controller.signal)
  controller.abort(new Error('Retired while deleting files'))
  deleted.resolve()
  await refused
  expect(mockRemove).not.toHaveBeenCalled()
})

it('passes the exact deletion signal to files and state after resource release settles', async () => {
  const controller = new AbortController()
  await deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)
  expect(mockRelease).toHaveBeenCalledTimes(1)
  expect(mockDeleteArtifacts).toHaveBeenCalledWith(model.id, controller.signal)
  expect(mockRemove).toHaveBeenCalledWith(model.id, { signal: controller.signal })
  expect(mockRelease.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteArtifacts.mock.invocationCallOrder[0])
  expect(mockDeleteArtifacts.mock.invocationCallOrder[0]).toBeLessThan(mockRemove.mock.invocationCallOrder[0])
})

it('does not remove state when artifact deletion fails', async () => {
  const error = new Error('Owned file removal failure')
  mockDeleteArtifacts.mockRejectedValueOnce(error)
  await expect(deleteDownloadedLocalEmbeddingModel(model.id)).rejects.toBe(error)
  expect(mockRemove).not.toHaveBeenCalled()
})

it('does not claim an already-admitted installed-state write was rolled back after cancellation', async () => {
  const controller = new AbortController()
  mockRecord.mockImplementationOnce(async () => { controller.abort(new Error('Retired after state write')) })
  await expect(downloadLocalEmbeddingModel(model.id, { signal: controller.signal })).resolves.toEqual(
    expect.objectContaining({ modelId: model.id, source: 'downloaded' }))
  expect(mockRecord).toHaveBeenCalledTimes(1)
  expect(mockFailure).not.toHaveBeenCalled()
})

it('does not claim an already-admitted state removal was rolled back after cancellation', async () => {
  const controller = new AbortController()
  mockRemove.mockImplementationOnce(async () => { controller.abort(new Error('Retired after state removal')) })
  await expect(deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)).resolves.toBeUndefined()
  expect(mockDeleteArtifacts).toHaveBeenCalledTimes(1)
  expect(mockRemove).toHaveBeenCalledTimes(1)
})

it('does not touch files or state if resource release fails', async () => {
  const error = new Error('Owned resource release failed')
  mockRelease.mockRejectedValueOnce(error)
  await expect(deleteDownloadedLocalEmbeddingModel(model.id)).rejects.toBe(error)
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
})

it.each(['download', 'delete'] as const)('refuses a %s before file or resource work when the existing directory cannot be read', async kind => {
  const error = new Error('Owned model directory read refused')
  mockLoad.mockRejectedValueOnce(error)
  const controller = new AbortController()
  const operation = kind === 'download'
    ? downloadLocalEmbeddingModel(model.id, { signal: controller.signal })
    : deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)
  await expect(operation).rejects.toBe(error)
  expect(mockLoad).toHaveBeenCalledWith({ signal: controller.signal })
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockRelease).not.toHaveBeenCalled()
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  expect(mockRecord).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
  expect(mockFailure).not.toHaveBeenCalled()
})

it.each(['download', 'delete'] as const)('keeps a %s closed through pending state admission and rejects cancellation before new file work', async kind => {
  const read = deferred<{ records: {}; failed: {} }>()
  mockLoad.mockReturnValueOnce(read.promise)
  const controller = new AbortController()
  const operation = kind === 'download'
    ? downloadLocalEmbeddingModel(model.id, { signal: controller.signal })
    : deleteDownloadedLocalEmbeddingModel(model.id, controller.signal)
  const refused = expect(operation).rejects.toThrow('Retired during model state admission')
  try {
    await Promise.resolve()
    expect(mockInstall).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
  } finally {
    controller.abort(new Error('Retired during model state admission'))
    read.resolve({ records: {}, failed: {} })
    await refused
  }
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockDeleteArtifacts).not.toHaveBeenCalled()
  expect(mockRecord).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
})

it('binds reviewed model files and download ports before an awaited storage admission', async () => {
  const read = deferred<{ records: {}; failed: {} }>()
  const reviewed = { ...model, files: model.files.map(file => ({ ...file })), bundledIn: [...model.bundledIn] }
  mockRequireModel.mockReturnValueOnce(reviewed)
  mockLoad.mockReturnValueOnce(read.promise)
  const controller = new AbortController()
  const onProgress = jest.fn()
  const options = { signal: controller.signal, mirrorBaseUrl: 'https://reviewed-mirror.invalid', onProgress }
  const operation = downloadLocalEmbeddingModel(model.id, options)
  reviewed.files[0].sha256 = 'f'.repeat(64)
  options.mirrorBaseUrl = 'https://later-mirror.invalid'
  options.onProgress = jest.fn()
  read.resolve({ records: {}, failed: {} })
  await operation
  expect(mockInstall).toHaveBeenCalledWith(expect.objectContaining({
    files: [{ ...model.files[0], sha256: '0'.repeat(64) }],
  }), { signal: controller.signal, mirrorBaseUrl: 'https://reviewed-mirror.invalid', onProgress })
})

it('preserves the primary install failure when its secondary failure marker also cannot be saved', async () => {
  const primary = new Error('Owned primary install failure')
  mockInstall.mockRejectedValueOnce(primary)
  mockFailure.mockRejectedValueOnce(new Error('Owned secondary marker save failure'))
  await expect(downloadLocalEmbeddingModel(model.id)).rejects.toBe(primary)
})

it('refuses an already-aborted explicit clear before releasing resources or removing state', async () => {
  const controller = new AbortController()
  const reason = new Error('Retired before model clear')
  controller.abort(reason)
  await expect(clearLocalEmbeddingModelState(controller.signal)).rejects.toBe(reason)
  expect(mockRelease).not.toHaveBeenCalled()
  expect(mockClear).not.toHaveBeenCalled()
})

it('does not dispatch state clearing after cancellation during resource release', async () => {
  const released = deferred<void>()
  const controller = new AbortController()
  mockRelease.mockReturnValueOnce(released.promise)
  const operation = clearLocalEmbeddingModelState(controller.signal)
  const refused = expect(operation).rejects.toThrow('Retired while releasing for clear')
  await Promise.resolve()
  await Promise.resolve()
  controller.abort(new Error('Retired while releasing for clear'))
  released.resolve()
  await refused
  expect(mockClear).not.toHaveBeenCalled()
})

it('allows an explicit clear to acknowledge already-admitted removal after cancellation', async () => {
  const controller = new AbortController()
  mockClear.mockImplementationOnce(async () => { controller.abort(new Error('Retired after model clear admission')) })
  await expect(clearLocalEmbeddingModelState(controller.signal)).resolves.toBeUndefined()
  expect(mockClear).toHaveBeenCalledWith({ signal: controller.signal })
})
