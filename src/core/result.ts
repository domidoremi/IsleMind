import type { JsonRecord } from './json'

export interface ResultFailure<Code extends string> {
  code: Code
  message: string
  retryable: boolean
  details?: JsonRecord
}

export type Result<Value, Code extends string> =
  | { ok: true; value: Value }
  | { ok: false; error: ResultFailure<Code> }

export function ok<Value>(value: Value): Result<Value, never> {
  return { ok: true, value }
}

export function err<Code extends string>(
  code: Code,
  message: string,
  options: Pick<ResultFailure<Code>, 'retryable' | 'details'> = { retryable: false },
): Result<never, Code> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: options.retryable,
      ...(options.details ? { details: options.details } : {}),
    },
  }
}

export function isOk<Value, Code extends string>(result: Result<Value, Code>): result is { ok: true; value: Value } {
  return result.ok
}
