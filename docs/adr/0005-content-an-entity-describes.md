# 5. Content an entity describes: locales from the host, a localized type, constraints, views, and one record check

- Status: Accepted
- Date: 2026-10-20
- Revised: 2026-11-02 by [#126](https://github.com/r10c-technologies/entifix/issues/126) — the `EntifixError` tree is deleted; a declaration that cannot be honoured throws a plain `Error`.
- Revised: 2026-11-15 by [#237](https://github.com/r10c-technologies/entifix/issues/237) — the link picker and the record search query a localized member in the reader's locale rather than refusing it.
- Revised: 2026-11-17 by [#273](https://github.com/r10c-technologies/entifix/issues/273) — a `scalarCollection` may be `filterable`; sortable on any collection still throws.
- Revised: 2026-11-22 by [#312](https://github.com/r10c-technologies/entifix/issues/312) — a host may name the locale each of its locales formats in, and the scaled parser follows it.
- Area: entities
- Read when: declaring locales, holding text in several languages, writing a validation rule a consumer keeps repeating, publishing an entity narrower than it is stored, serving records that arrive as JSON, or about to write a second in-memory filter — the host declares its locales, a localized member is queried one locale at a time, and untyped records go through `validateRecords` before anything serves them

## Context

A static-export site built on entifix (myself-app) had to carry six pieces in an
incubator of its own, each because the framework could not say it:

- a list of which `type: 'string'` members really held `{ en, es }`, because
  `MetaAccessorTypes` was closed;
- `exactly`, `atLeast`, `nonEmpty` and `notBefore` rule factories, because
  `@accessor` and `@entity` could express none of them;
- a `{ request, omit }` pair per published file, typed loosely enough to need a
  cast, and a `present` rule standing in for a `required` the entity could not
  declare;
- a validator for records read from JSON, because the deserializer assigns every
  non-relation value raw;
- a read-only repository with its own copy of Mongo's filter semantics;
- and its own locale list, because core fixed r10c's — `['es', 'en']`, Spanish
  by default — as framework behaviour.

Each was filed as an issue (#35, #36, #37, #39, #40) to be designed from the
shape the consumer had proven rather than from a guess.

## Decision

**Locales are a host value.** `defineLocales({ locales, defaultLocale })` — or
the same two fields on `defineCatalogs` — declares them, and a host narrows
`Locale` by augmenting `LocaleRegister`, the mechanism i18next's
`CustomTypeOptions` uses. Every reader (`negotiateLocale`, i18next's fallback,
the controls' no-provider translator, `getRequestLocale`) resolves the
declaration at call time, never at module load. A host that declares nothing
speaks English alone. This is the seam rule of
[ADR 0001](0001-the-tier-contract-and-the-host-seam.md) applied to a value it
had missed.

The host may also name `formattingLocales`, the tag `Intl` gets per locale.
The language of a screen and the conventions its numbers follow are two facts:
Guatemalan Spanish writes `64.99`, and reading it as `es` made a typed
`64.999` nearly sixty-five thousand quetzales (#312). Every formatter and parser in
the framework resolves it through `formattingLocale(locale)`; catalogs, routing
and the cookie never see it.

**A localized member is one value with a text per locale, queried one locale at
a time.** `type: 'localized'` holds a `LocalizedText`; `localize(text, locale)`
reads it, falling back to the host's default. A filter or sort names `title.en`,
never `title`: the bare object compared as text matches nothing, so core rejects
it with a message naming the path, and rejects a locale the host did not
declare. Mongo reads the dotted path natively; SQL compares `"title"->>$1` over
a `jsonb` column with the locale bound as a parameter. Completeness is
all-or-nothing: absent is absent, and once any locale holds text every declared
locale must. A composition child cannot hold one (a row is a flat string map)
and refuses it at definition rather than guess. The link picker and the record
search take the reader's locale and query a localized member in it — filtered
and sorted as `name.es`, read with the same fallback — so a host's vocabulary
can be written per language without giving up being picked or found.

**Constraints live in metadata.** `minItems` / `maxItems` on a collection,
`notBefore` between two dates, `cardinality` on the entity. A declaration that
cannot be honoured is a thrown `Error` when the entity is described, the
same posture as a collection declared sortable. A `scalarCollection` may be
`filterable` — an equality on it means "any element matches" — while sortable
on any collection, and filterable on a `linkCollection` or `composition`, throw.

**Untyped records go through one check, in core.** `validateRecords` sits beside
the deserializer it makes up for, so every adapter that reads JSON shares it,
and the generated form judges a draft by the same metadata. Every problem is
collected with its path and thrown together.

**A view is the shape an entity is published in.** `@entity({ views })` names
the records a view keeps and the members it omits; `serializeEntityCollection`
applies it, and `validateRecords(…, { view })` does not require what the view
left out — so `required` keeps its meaning for the full record.

**Filtering and sorting records held in memory has one implementation, in
core.** The in-memory double, the static repository and a view all use it, with
Mongo's semantics: `like` is case-insensitive and nothing more, so the three
cannot disagree with the adapter they stand in for. The incubator's accent
folding was not promoted for that reason.

**`@entifix/static` is a package of its own at T2**, not a subpath of
`business`. It depends on nothing external, but a site that installs it should
see that it installed an adapter, and it is one.

## Consequences

- `LOCALES` and `DEFAULT_LOCALE` are gone — a breaking change, released on the
  minor. r10c, which supplied the Spanish default, now declares it.
- `EntityDraftValue` has a third shape (a text per locale), and
  `EntityDraftMessages` gains `minItems`, `maxItems`, `notBefore` and `locale`.
- A new published package needs a bootstrap publish before trusted publishing can
  be configured for it ([ADR 0003](0003-releasing-without-a-credential.md)).
- The link picker and the record search query a localized member in the
  reader's locale, and refuse one only when it is not `filterable` (a record
  search label also needs `sortable`), as for any member. A composition child
  cannot hold one.
