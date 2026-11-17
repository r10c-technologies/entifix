# @entifix/docs

entifix's decision records as they stood at this release, an index of them, and
the reader that parses a collection in their format. Content and its format
only: no React, no Next, no entity class, and no dependency of ours.

It carries the **fleet's version**, so `@entifix/docs@0.23.0` holds the records
as they stood when `0.23.0` was cut — what a site installs is the version of the
decisions it shows. ⚠️ A record corrected in place reaches npm with the next
release, not with the commit: a `docs:` commit cuts no version
([ADR 0003](../../docs/adr/0003-releasing-without-a-credential.md)).

```
node_modules/@entifix/docs/
  records/        every docs/adr/NNNN-*.md and the README, as they stand
  records.json    the index: one entry per record
  dist/reader/    @entifix/docs/reader
```

## The index

`@entifix/docs/records.json` is an array with one entry per record:

| Field          | Holds                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `id`, `number` | `"0031"` and `31`                                                      |
| `file`         | `0031-the-title.md`, under `records/`                                  |
| `title`        | the heading, without its number                                        |
| `status`       | `accepted`, `proposed`, `superseded` or `superseded-in-part`           |
| `supersededBy` | the record that replaced it, when its status names one                 |
| `supersedes`   | the records whose status names this one                                |
| `date`, `area` | the `- Date:` and `- Area:` headers                                    |
| `readWhen`     | the `- Read when:` header, the symptom that should send a reader there |
| `revisions`    | how many `- Revised:` lines the record carries                         |
| `points`       | the decision, in at most five lines                                    |

```ts
import index from '@entifix/docs/records.json' with { type: 'json' };
// A record's Markdown: `@entifix/docs/records/0031-….md`
```

## The reader

`@entifix/docs/reader` is the one parser of the format
[`docs/adr/README.md`](../../docs/adr/README.md) describes, and `@entifix/docs-check`
reads the records with it.

```ts
import { readRecords } from '@entifix/docs/reader';

const { records, problems } = readRecords('docs/adr', {
  areas: ['platform', 'data'],
});
```

`problems` is one `file: what` line per fault: a missing header, an area not in
the list, a heading that disagrees with its file name, a number used twice, a
status the reader does not know, a replacement that does not exist. The area
list is a parameter because a host files records under areas entifix does not
have; `ENTIFIX_AREAS` is entifix's own.

`buildRecords(from, into, { areas })` is what generates this package's
`records/` and `records.json` from `docs/adr` at build time, and writes nothing
when the collection has problems. A host may use it to ship its own.
