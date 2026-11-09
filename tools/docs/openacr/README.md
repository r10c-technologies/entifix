# Vendored OpenACR files

- `openacr-0.1.0.json` — GSA's OpenACR report schema, from
  [GSA/openacr](https://github.com/GSA/openacr/tree/main/schema).
- `2.5-edition-wcag-2.2-en.yaml` — the VPAT 2.5 WCAG 2.2 edition catalog, from
  [GSA/openacr](https://github.com/GSA/openacr/tree/main/catalog). It carries
  W3C data, released under the
  [W3C Software and Document Notice and License](https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document).

Vendored so the report's check runs offline in CI. `src/openacr` builds
`docs/accessibility/openacr.yaml` from them and from `assessment.ts`.
