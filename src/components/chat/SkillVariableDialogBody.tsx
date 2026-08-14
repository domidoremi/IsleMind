import { useState } from 'react'
import { View } from 'react-native'

import { IsleField } from '@/components/ui/isle'

export function SkillVariableDialogBody({
  variableNames,
  initialValues,
  onChange,
}: {
  variableNames: string[]
  initialValues: Record<string, string>
  onChange: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState(initialValues)

  function updateValue(name: string, value: string) {
    setValues((current) => {
      const next = { ...current, [name]: value }
      onChange(next)
      return next
    })
  }

  return (
    <View style={{ gap: 10 }}>
      {variableNames.map((name) => (
        <IsleField
          key={name}
          label={name}
          inputProps={{
            value: values[name] ?? '',
            onChangeText: (value) => updateValue(name, value),
            autoCapitalize: 'none',
            autoCorrect: false,
            placeholder: name,
          }}
        />
      ))}
    </View>
  )
}
