import { useEffect, useRef, useState, type ComponentProps } from 'react'
import type { TextInputProps } from 'react-native'
import { IsleField } from '@/components/ui/isle'

type IsleFieldProps = ComponentProps<typeof IsleField>

export interface CommittedSettingsFieldProps extends Omit<IsleFieldProps, 'inputProps'> {
  value: string
  onCommit: (value: string) => void
  normalize?: (value: string) => string
  commitOnSubmit?: boolean
  inputProps?: Omit<TextInputProps, 'value' | 'onChangeText'>
}

const preserveDraft = (value: string) => value

export function CommittedSettingsField({
  value,
  onCommit,
  normalize = preserveDraft,
  commitOnSubmit = true,
  inputProps,
  ...fieldProps
}: CommittedSettingsFieldProps) {
  const [draft, setDraft] = useState(value)
  const lastCommittedValueRef = useRef(value)

  useEffect(() => {
    lastCommittedValueRef.current = value
    setDraft(value)
  }, [value])

  const commit = () => {
    const normalized = normalize(draft)
    setDraft(normalized)
    if (normalized === lastCommittedValueRef.current) return
    lastCommittedValueRef.current = normalized
    onCommit(normalized)
  }

  const {
    onBlur,
    onSubmitEditing,
    returnKeyType,
    ...restInputProps
  } = inputProps ?? {}

  return (
    <IsleField
      {...fieldProps}
      inputProps={{
        ...restInputProps,
        value: draft,
        onChangeText: setDraft,
        onBlur: (event) => {
          onBlur?.(event)
          commit()
        },
        onSubmitEditing: commitOnSubmit
          ? (event) => {
              onSubmitEditing?.(event)
              commit()
            }
          : onSubmitEditing,
        returnKeyType: returnKeyType ?? (commitOnSubmit ? 'done' : undefined),
      }}
    />
  )
}
