/** The id of a `FormField`'s label, for a control that names itself by `aria-labelledby`. */
export function fieldLabelId(id: string): string {
  return `${id}-label`
}
