import * as FileSystem from 'expo-file-system/legacy'
import * as Speech from 'expo-speech'
import type { AIProvider } from '@/types'
import { synthesizeSpeechWithProvider, transcribeAudioWithProvider } from '@/services/ai/base'
import { useSettingsStore } from '@/store/settingsStore'

let AudioModule: any = null
let useAudioRecorderModule: any = null
let createAudioPlayerModule: any = null
let activeProviderAudioPlayer: any = null

try {
  const expoAudio = require('expo-audio')
  AudioModule = expoAudio.AudioModule
  useAudioRecorderModule = expoAudio.useAudioRecorder
  createAudioPlayerModule = expoAudio.createAudioPlayer
} catch {
  AudioModule = null
  useAudioRecorderModule = null
  createAudioPlayerModule = null
}

export function isAudioRecordingAvailable(): boolean {
  return !!AudioModule && !!useAudioRecorderModule
}

export function getAudioRecorderHook(): any {
  return useAudioRecorderModule
}

export async function requestMicrophonePermission(): Promise<boolean> {
  if (!AudioModule?.requestRecordingPermissionsAsync) return false
  const result = await AudioModule.requestRecordingPermissionsAsync()
  return !!result.granted
}

export async function transcribeLocalAudio(uri: string, provider?: AIProvider | null): Promise<string> {
  const sourceProvider = provider ?? await useSettingsStore.getState().getPrimaryConfiguredProvider()
  if (!sourceProvider) throw new Error('请先配置支持音频转写的服务商。')
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
  return transcribeAudioWithProvider({
    provider: sourceProvider,
    audioBase64: base64,
    mimeType: guessAudioMime(uri),
    fileName: uri.split('/').pop() || 'recording.m4a',
    model: sourceProvider.type === 'google' ? sourceProvider.models[0] : undefined,
  })
}

export async function speakText(text: string, provider?: AIProvider | null): Promise<void> {
  if (!text.trim()) return
  const sourceProvider = provider ?? await useSettingsStore.getState().getPrimaryConfiguredProvider()
  if (sourceProvider?.capabilities?.speech && createAudioPlayerModule && FileSystem.cacheDirectory) {
    try {
      const base64 = await synthesizeSpeechWithProvider({
        provider: sourceProvider,
        text,
      })
      if (base64) {
        await playProviderSpeechBase64(base64)
        return
      }
    } catch {
      // Fall back to local speech below. Remote TTS is optional and should never
      // block quick reading when a provider lacks speech support or rejects it.
    }
  }
  speakTextLocally(text)
}

export function speakTextLocally(text: string): void {
  Speech.stop()
  Speech.speak(text.slice(0, 4000), {
    language: 'zh-CN',
    rate: 0.96,
    pitch: 1,
  })
}

export function stopSpeaking(): void {
  try {
    activeProviderAudioPlayer?.pause?.()
    activeProviderAudioPlayer?.remove?.()
  } catch {}
  activeProviderAudioPlayer = null
  Speech.stop()
}

async function playProviderSpeechBase64(base64: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}islemind-tts-${Date.now()}.mp3`
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
  stopSpeaking()
  activeProviderAudioPlayer = createAudioPlayerModule({ uri })
  activeProviderAudioPlayer.play()
}

function guessAudioMime(uri: string): string {
  const lower = uri.toLowerCase()
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.webm')) return 'audio/webm'
  return 'audio/mp4'
}
