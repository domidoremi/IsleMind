export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonRecord = Readonly<Record<string, JsonValue>>
