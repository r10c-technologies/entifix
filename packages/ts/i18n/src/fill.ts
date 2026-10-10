/**
 * A catalog string with its `{{name}}` placeholders filled in, for copy a
 * component receives already translated: `fill('{{n}} active', { n: 2 })`.
 * A placeholder with no value stays as written.
 *
 * Pure, and free of i18next: a client component can fill a string the server
 * translated without installing a catalog.
 */
export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}
