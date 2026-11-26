# 33. A search ranks by relevance

- Status: Proposed
- Date: 2026-11-25
- Area: adapters
- Read when: a search answers in name order and the best match sits on page two, choosing how a list sorts while a term is typed, or about to add a text index or a search engine to rank results

## Context

A `like` filter answers _whether_ a record matches a word (ADR 0011). It says
nothing about _how well_. A storefront that splits a search into words — one
`like` per word, all required — finds the right records. It still
lists them in whatever order the request names, usually the name. A search
for "funda" then puts "Batería con funda" before "Funda de silicón", and on a
page of 24 the product the buyer typed can sit on page two.

Every store a repository runs on already holds what a ranking needs: the words
the request asked for, and the member that names a record, its
`labelMember` (ADR 0030). What is missing is a sort key computed from both.

A text index was the other route. Mongo's `$text` is diacritic-insensitive,
but it matches whole stemmed words, so "fund" no longer finds "funda". It
cannot sit beside the substring `like` the search already uses, and it has no
equivalent in the SQL adapter or the in-memory one. A ranking built on the
same folded comparison `like` uses agrees with the filter by construction.

## Decision

### 1. `RELEVANCE` is a sort key, not a member

`RELEVANCE` (`'$relevance'`) is legal in any `EntitySorting`, beside the
`sortable` members. It names no member, so the allowlist does not apply to
it. It reads nothing a client could not already filter on. It is always
**best first**, whatever direction was asked: an ascending relevance has no
use, and refusing one would only make a client's sort harder to build. The
entries after it break ties.

On the wire it is `-$relevance`. `parseSort` reads it with either sign.

### 2. The score is the label's answer to each `like` word

For every `like` value in the request's filtering — through arrays and
groups, never into an `in` list — a record scores:

- **3** when its label starts with the word;
- **2** when a word of its label does (the word follows a space);
- **1** otherwise. The record matched the word on some member, which is why it
  is on the page at all.

The comparison is accent- and case-blind, folded exactly as `like` folds. The
scores add up across words. With no `like` word, or an entity that declares
no `labelMember`, every record scores 0 and the sort falls through to the
next key. It is never an error, so a client may always send it.

### 3. Each adapter computes it where its data is

- **In memory** (`applySorting`, so the repository double and `@entifix/static`
  too) scores each record through `relevanceScore`. It reads the label from
  the record's own `@entity()`.
- **Mongo** sorts a `find` by stored fields only, so a request whose sort
  holds relevance runs the same page as an aggregation: `$match` on the same
  filter, then `$addFields` of the score through `$regexMatch` on the folded
  pattern, then `$sort`, `$skip`, `$limit`, and a `$project` that drops the
  score again. The count is the same `countDocuments`.
- **SQL** orders by a `CASE` sum over the label, folded by the same
  `translate` pair the `like` filter uses.

The repository contract asserts the order on every adapter. The SQL contract
runs against a real Postgres in Change Validation.

## Consequences

- A host gets ranked search by adding one sort key. It needs no index, no
  search engine and no new member.
- The score is lexical and small on purpose. It does not stem, weigh rarity
  or learn from clicks. A catalog that outgrows it is the trigger for a real
  search engine behind a port of its own (ADR 0012's shape), not for more
  weights here.
- A relevance page in Mongo is an aggregation, so the field it sorts by is
  computed, not indexed. That is fine for the page sizes a list asks for over
  a filtered set, and it is the reason the filter still narrows first.

## Alternatives considered

- **Mongo `$text` with `textScore`.** It matches whole stemmed words, so it
  disagrees with `like`. It is Mongo-only.
- **Ranking in the client.** It only sees one page, so the best match on page
  two never reaches page one.
- **A search-only endpoint per host.** It would be a second read path whose
  paging and facet counts drift from the list's.
