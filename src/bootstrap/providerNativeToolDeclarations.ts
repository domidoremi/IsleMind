import { createProviderNativeToolDeclarationAdapter } from '@/modules/providers'
import { redactSensitiveText, sanitizeTraceMetadataValue } from '@/core'

export const providerNativeToolDeclarationAdapter = createProviderNativeToolDeclarationAdapter({
  redactSensitiveText,
  sanitizeSchemaValue: sanitizeTraceMetadataValue,
})

export const {
  resolveTarget: resolveProviderNativeToolDeclarationTarget,
  build: buildProviderNativeToolDeclarations,
} = providerNativeToolDeclarationAdapter
