# @entifix/react-controls

The React UI. `EntityTable`, `EntityForm`, `FilterBuilder`, `SortBuilder`, `Wizard` and `CommandPalette` render from an entity's own metadata, so a column, a field or a filter operator comes from the `@entity()` class rather than from a prop list. Beside them sit the layout primitives (`Stack`, `Cluster`, `Sidebar`, `Switcher`, …) and the atoms they are built from.

Styling is Tailwind utilities over the token names in `@entifix/style`.

They hold to WCAG 2.2 AA by contract, not by care at each call site
([conformance report](https://github.com/r10c-technologies/entifix/blob/main/docs/accessibility/openacr.yaml)):

- **Actions** — one `ActionBar` renders every surface: one primary, an overflow menu, destructive verbs last and confirmed through `ConfirmDialog` (undo, confirm or typed), and the shortcuts it advertises bound through `useHotkey`, which takes modifier chords only and refuses a conflict.
- **States** — `RegionState` says why a region is empty or failed, with Clear filters, Retry and a host's next step from `ErrorActionsProvider`; toasts take a tone and an action through `useToasts().show`; `useFocusOnArrival` keeps focus off `<body>` after a write; `LiveUpdatesProvider` lets the top bar say when live updates pause.
- **Tables** — header sort, a caption, a keyboard-reachable scroll region, announced result counts, `FilterChips`, facet counts, and cards when the table's own container is too narrow.
- **Theme** — `ThemeProvider` keeps the choice in a cookie a server can render (`readThemeCookies` in `@entifix/next-shell/server`); `ThemeScript` is for a host with no server.

## Install

```sh
pnpm add @entifix/react-controls effect react
```

## Entry points

| Import                               | What it holds                                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/react-controls`            | Everything: entity organisms, layout primitives, atoms, theme and UI-preference providers                                                                                                                  |
| `@entifix/react-controls/primitives` | Layout primitives, atoms (`Alert`, `StatusTag`, `Money`, `QuantityInput`…) and presentational molecules (`Breadcrumbs`, `EmptyState`, `MediaGallery`, `SegmentedNav`…), `ThemeScript` — no entity metadata |
| `@entifix/react-controls/i18next`    | `I18nProvider`, binding the controls to i18next                                                                                                                                                            |

## Optional peers

Install these only if you use what needs them.

| Peer                                        | Needed by                         |
| ------------------------------------------- | --------------------------------- |
| `i18next`, `react-i18next`, `@entifix/i18n` | `@entifix/react-controls/i18next` |

A table does not arrive with i18next attached: without the `i18next` subpath the controls translate through the `Translator` you provide.

---

Tier 3 (ui) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
