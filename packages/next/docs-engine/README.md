# @entifix/docs-engine

A documentation site from sources, exported as static files. A host hands it
its sections — decision records, Markdown guides, a reference it derives from
its own metadata — and a registry of the ids a guide may cite; the engine turns
them into one page tree, checks every page when the site is created, and renders
each with `fumadocs-ui` under entifix's tokens. Search is Pagefind over the
exported HTML. The decision is
[ADR 0031](../../../docs/adr/0031-entifix-docs-carries-the-records-and-a-docs-engine-reads-any-repositorys.md).

Two entry points, so a host that only wants the loader installs no UI:

| Import                             | Holds                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `@entifix/docs-engine`             | the sources, the directive check, `createDocsSite` — `fumadocs-core` only    |
| `@entifix/docs-engine/ui`          | `DocsRoot`, `DocsHead`, `DocsLayout`, `DocsPage`, the Pagefind search dialog |
| `@entifix/docs-engine/ui/docs.css` | fumadocs' preset under entifix's tokens, and the conditions of ADR 0031 §4   |

`fumadocs-ui` is an optional peer, pinned exactly with `fumadocs-core`: both
move together, and only with the gate re-run.

## A site

```ts
// site.ts — runs at build time, in Node
import { ENTIFIX_AREAS } from '@entifix/docs/reader';
import { createDocsSite, guidesSource, recordsSource, referenceKind } from '@entifix/docs-engine';

const records = recordsSource({
  directory: 'node_modules/@entifix/docs/records',
  areas: ENTIFIX_AREAS,
  title: 'Decision records',
  links: {
    record: id => `/records/${id}/`,
    file: path => `https://github.com/…/blob/main/docs/adr/${path}`,
  },
});

export const site = createDocsSite({
  baseUrl: '/',
  sources: [guidesSource({ directory: 'content/guides', title: 'Guides' }), records],
  references: {
    record: referenceKind(
      records.pages.map(page => page.record?.id ?? ''),
      id => `/records/${id}/`,
      id => `ADR ${id}`,
    ),
  },
});
```

```tsx
// app/[...slug]/page.tsx
export const dynamicParams = false;
export const generateStaticParams = () => site.params();
export default async function Page({ params }) {
  return <DocsPage site={site} slugs={(await params).slug} />;
}
```

The layout renders `DocsHead` in `<head>`, then `DocsRoot` inside the host's
translator (`I18nProvider` from `@entifix/react-controls/i18next`), then
`DocsLayout`. `next.config` sets `output: 'export'` and `trailingSlash: true`,
and the build ends with `pagefind --site out --output-subdir pagefind`.
`examples/docs` is the whole of it, served under a `basePath` (`/docs`, with the controls' Storybook beside it at `/ui`).

## Guides and their directives

A guide is Markdown with a `title` (and optionally `description` and `order`)
in its frontmatter. It cites what it describes:

| Directive                         | Becomes                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `:<kind>[id]`                     | a link, for a kind the host registered and an id it holds |
| `:::note`, `:::tip`, `:::warning` | a callout                                                 |

⚠️ **Any other directive, and any id its kind does not hold, fails `next
build`** with the file and the line — every page is checked when the site is
created, not when it is first visited. An id may contain colons
(`:use-case[order:product-order:cancel]`). A bare `:word` glued to the word
before it is prose (`10:30`, `layer:base`) and stays as written.

## The theme

`data-theme` is the one owner of the palette, as everywhere in entifix.
fumadocs only knows light and dark, so a palette the host lists in
`darkPalettes` sets `data-scheme="dark"`, and fumadocs' `dark:` utilities and
the code blocks follow that. The first paint comes from `DocsHead` — an export
has no server to read the theme cookie.

## The gate

`examples/docs-e2e` runs on every change that reaches the engine, fumadocs or
the tokens: axe at WCAG 2.2 AA with `target-size`, entifix's keyboard walk, the
search dialog, a 3:1 control boundary, one focus indicator per control, and
forced colours — on two palettes at two widths. A fumadocs bump is not done
until it is green.
