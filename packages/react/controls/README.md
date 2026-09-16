# @entifix/react-controls

The React UI. `EntityTable`, `EntityForm`, `FilterBuilder`, `SortBuilder`, `Wizard` and `CommandPalette` render from an entity's own metadata, so a column, a field or a filter operator comes from the `@entity()` class rather than from a prop list. Beside them sit the layout primitives (`Stack`, `Cluster`, `Sidebar`, `Switcher`, …) and the atoms they are built from.

Styling is Tailwind utilities over the token names in `@entifix/style`.

## Install

```sh
pnpm add @entifix/react-controls effect react
```

## Entry points

| Import                               | What it holds                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `@entifix/react-controls`            | Everything: entity organisms, layout primitives, atoms, theme and UI-preference providers |
| `@entifix/react-controls/primitives` | Layout primitives and atoms only — no entity metadata                                     |
| `@entifix/react-controls/i18next`    | `I18nProvider`, binding the controls to i18next                                           |

## Optional peers

Install these only if you use what needs them.

| Peer                                        | Needed by                         |
| ------------------------------------------- | --------------------------------- |
| `i18next`, `react-i18next`, `@entifix/i18n` | `@entifix/react-controls/i18next` |

A table does not arrive with i18next attached: without the `i18next` subpath the controls translate through the `Translator` you provide.

---

Tier 3 (ui) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
