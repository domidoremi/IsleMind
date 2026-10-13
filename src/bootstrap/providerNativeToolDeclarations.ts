import { createProviderNativeToolDeclarationAdapter } from '@/modules/providers'
import { redactSensitiveText } from '@/core'

// A schema is not trace data: `properties.apiKey` is a field definition,
// not a credential. Keep its validation contract; omit sample/default data.
function sanitizeSchemaValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(sanitizeSchemaValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'default' && key !== 'examples')
    .map(([key, child]) => [key, ['properties', 'patternProperties', '$defs', 'definitions'].includes(key) && child && typeof child === 'object'
      ? Object.fromEntries(Object.entries(child).map(([field, definition]) => [field, sanitizeSchemaValue(definition)]))
      : sanitizeSchemaValue(child)]))
}

export const providerNativeToolDeclarationAdapter = createProviderNativeToolDeclarationAdapter({
  redactSensitiveText,
  sanitizeSchemaValue,
})

export const {
  resolveTarget: resolveProviderNativeToolDeclarationTarget,
  build: buildProviderNativeToolDeclarations,
} = providerNativeToolDeclarationAdapter
