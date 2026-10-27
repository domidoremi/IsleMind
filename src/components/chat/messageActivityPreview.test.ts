import { createInstance } from 'i18next'
import en from '@/i18n/resources/en.json'
import type { Message } from '@/types/chatContracts'
import { getMessageActivityLabel, previewSystemStatusMessage } from './messageActivityPreview'

const i18n = createInstance()
beforeAll(async () => { await i18n.init({ lng: 'en', resources: { en: { translation: en } } }) })

it('reports paused rather than thinking or generating from retained unfinished status', () => {
  const message: Message = {
    id: 'owned-pause', role: 'assistant', status: 'streaming', content: '', timestamp: 100,
    responseLifecycle: {
      stage: 'paused', startedAt: 100, stageStartedAt: 200,
      history: [{ stage: 'paused', startedAt: 200 }],
    },
    reasoning: [{ id: 'old-progress', type: 'reasoning', title: 'Old progress', status: 'running' }],
  }
  expect(getMessageActivityLabel(message, i18n.t, 'Assistant')).toBe(i18n.t('agentTasks.status.paused'))
  expect(previewSystemStatusMessage(message, i18n.t)).toBe(i18n.t('agentTasks.status.paused'))
})
