import AsyncStorage from '@react-native-async-storage/async-storage'
import { createProviderHealthRepository } from '@/modules/providers'

export const providerHealthRepository = createProviderHealthRepository(AsyncStorage)

export const loadProviderHealthSnapshot = providerHealthRepository.load
export const saveProviderHealthRecords = providerHealthRepository.save
export const mergeProviderHealthRecords = providerHealthRepository.merge
export const clearProviderHealthSnapshot = providerHealthRepository.clear
export const removeProviderHealthRecordsByProviderId = providerHealthRepository.removeByProviderId
