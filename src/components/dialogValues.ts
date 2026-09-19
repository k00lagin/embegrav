export type FieldValues = Record<string, string | boolean>

/** Dialog results are decoded at operation boundaries instead of coerced. */
export function textValue(values: FieldValues, name: string): string {
  const value = values[name]
  if (typeof value !== 'string') throw new Error(`Expected text field: ${name}`)
  return value
}

export function checkedValue(values: FieldValues, name: string): boolean {
  const value = values[name]
  if (value === undefined) return false // conditional checkbox omitted from the dialog
  if (typeof value !== 'boolean') throw new Error(`Expected checkbox field: ${name}`)
  return value
}

export function optionalTextValue(values: FieldValues, name: string): string | undefined {
  return values[name] === undefined ? undefined : textValue(values, name)
}

export function choiceValue<const T extends string>(
  values: FieldValues,
  name: string,
  choices: readonly T[],
): T {
  const value = textValue(values, name)
  const choice = choices.find((item) => item === value)
  if (choice === undefined) throw new Error(`Invalid choice: ${name}`)
  return choice
}
