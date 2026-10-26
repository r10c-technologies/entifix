# 11. `like` ignores accents

- Status: Accepted
- Date: 2026-10-26
- Area: entities
- Read when: a search for `cafe` does not find `Café`, writing a filter translator for a new engine, or about to add a collation, a text index or a second "search" operator

## Context

`like` was a case-insensitive substring match in every engine: `$regex` with
`i` in Mongo, `ILIKE` in SQL, a case-insensitive `RegExp` in memory. None of
them ignored accents, so in Spanish, French or Portuguese a search typed the way
people type it — without the accent, or on a keyboard that lacks the letter —
found nothing. `cafe` did not find `Café`, `nino` did not find `Niño`.

The obvious engine features do not reach `like`:

- A Mongo **collation** with strength 1 compares without accents, but `$regex`
  ignores collation entirely.
- A Mongo **text index** is diacritic-insensitive, but it matches whole stemmed
  words, not substrings, so `caf` would find nothing — a different operator with
  different results, not a fix for this one.
- Postgres's **`unaccent`** is an extension. A query using it fails on any
  database where nobody ran `CREATE EXTENSION`, so it would turn an adapter into
  a deployment requirement.

## Decision

**`like` and `nlike` match with accents and case ignored, in every engine, by one
rule.** No flag and no second operator: an accent-sensitive substring search is
not something anyone asks for, and two operators that differ in one subtle way
are two to choose between on every filter.

The rule is Unicode's: decompose (NFD), drop the combining marks, lowercase. So
`é` is `e`, `ü` is `u` and `ñ` is `n` — the last a choice, since `ñ` is its own
letter in Spanish, made because a buyer who types `nino` wants `niño`. A letter
that does not decompose (`ß`, `ø`, `æ`, `ł`) is left as it is.

It lives once, in `packages/ts/core/src/query/fold.ts`, and each engine takes the
form it can use:

- **In memory** folds both sides and compares (`containsFolded`).
- **Mongo** cannot fold the stored value in a `find`, so it widens the query:
  the search is folded and each letter becomes the class of its accented forms
  (`foldedPattern`, `e` → `[eEéÉèÈ…]`). Both cases are listed, so the pattern
  does not lean on how the regex engine case-folds outside ASCII.
- **SQL** folds the column with the built-in `translate(column, from, to)` and
  compares with `ILIKE` against the folded search (`FOLD_TRANSLATION`).

The class table and the translation are **generated from `foldText` at module
load** over Latin-1 Supplement and Latin Extended-A, not typed out, so a letter
folds in every engine exactly when it folds in the rule. The repository contract
suite asserts the same searches against every repository it runs.

## Consequences

- A breaking change to what `like` returns, released on the minor.
- An unanchored `like` was a collection scan before and still is: the Mongo
  pattern is a regex no index serves, and `translate(column)` defeats a plain
  index on the column. A store that needs a fast search needs a stored folded
  copy or a text index, which is a separate decision.
- Text stored already decomposed (a letter followed by a combining mark) is not
  found by the Mongo pattern, which lists precomposed forms only. Input is
  normally precomposed (NFC), and a store that cannot promise it should
  normalize on write.
- Letters outside the two Latin blocks fold in memory but not in Mongo or SQL.
  Widening the table is a change to one range in `fold.ts`.
- Ranking results by relevance is not part of `like` and is not decided here.
