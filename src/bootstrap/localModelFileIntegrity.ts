import { createLocalModelFileIntegrityPolicy } from '@/modules/knowledge'
import { createExpoLocalModelFileIntegrityPort } from '@/platform/localModels'

const localModelFileIntegrityPort = createExpoLocalModelFileIntegrityPort()
const localModelFileIntegrityPolicy = createLocalModelFileIntegrityPolicy(localModelFileIntegrityPort)

export const sha256LocalModelFile = localModelFileIntegrityPort.sha256File
export const verifyLocalModelFile = localModelFileIntegrityPolicy.verifyFile
export const verifyLocalModelFiles = localModelFileIntegrityPolicy.verifyFiles
