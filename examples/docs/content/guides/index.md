---
title: entifix, documented from its sources
description: A site the docs engine builds from records, guides and metadata.
order: 0
---

This site is the docs engine's own proof. Its records are the ones
`@entifix/docs` ships, read with the same reader the build checks them with —
:record[0031] is the decision that made it.

## What a guide may cite

A guide cites what it describes by id, and the build refuses one it cannot
resolve. This page cites :record[0001] and the package :package[@entifix/docs-engine].

:::note
A citation of an id that does not exist stops `next build` with the file and
the line.
:::
