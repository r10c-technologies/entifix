---
title: Adopting the engine
description: The four pieces a host writes.
order: 1
---

## Sources

A host passes its sources — records, guides and a reference it derives from its
own metadata — and a registry of the ids a guide may cite.

```ts
const site = createDocsSite({ baseUrl: '/', sources, references });
```

## Theme

The palette is owned by `data-theme`, as everywhere else in entifix
(:record[0025]). A palette the host declares dark is what fumadocs calls dark.

## Search

Pagefind indexes the exported HTML after `next build`, one index per site.
