# @entifix/react-integration

Hooks that connect entities to data. It puts TanStack Query and TanStack Form over the entity adapters from `@entifix/business`, so a record, a page of records or a save is one hook — and the adapter behind it, REST or anything else, is supplied once through `createAdaptersContext`.

It also carries the draft model a form edits, schema-based validation, link resolution, wizard state, and reactive invalidation when a write elsewhere settles.

## Install

```sh
pnpm add @entifix/react-integration @tanstack/react-form @tanstack/react-query effect react
```

## Entry points

| Import                       | What it holds                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/react-integration` | `EntifixQueryProvider`, `useEntityRecord`, `useEntityForm`, `useEntityMutation`, `useWizard`, `useReactiveInvalidation`, `useTransactionSettlement` |

---

Tier 3 (ui) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
