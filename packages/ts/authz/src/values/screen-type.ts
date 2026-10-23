/**
 * What shape a back-office screen takes — the framework's back-office model,
 * [ADR 0007](../../../../../../docs/adr/0007-the-host-supplies-the-role-ladder.md).
 *
 * | Value       | The record came from         | Lifecycle | Verbs        |
 * | ----------- | ---------------------------- | --------- | ------------ |
 * | `master`    | a person authored it         | none      | CRUD         |
 * | `operation` | a process produced it        | yes       | domain verbs |
 * | `wizard`    | a guided, multi-step entry   | ends      | next/finish  |
 * | `report`    | nothing — it is an aggregate | n/a       | read only    |
 *
 * The rendered names are the host's, through {@link SCREEN_TYPE_LABEL_KEYS}.
 * The order is the sidebar's top tier, which is the **type** rather than the
 * domain: four fixed entries against however many domains a host has, so
 * "where does this screen go" has one answer whoever owns it. The daily operator's speed is
 * the command palette's job, not the sidebar's.
 *
 * The identifiers are English because every other identifier here is, but two of
 * the obvious words were unusable — `query` collides with RSQL, TanStack Query
 * and `filterable` metadata, and `assistant` reads as an AI agent — so the enum
 * takes `report` and `wizard`, which are already what this repo calls those. The
 * consequence is that the code word and the screen word differ for three of the
 * four, and {@link SCREEN_TYPE_LABEL_KEYS} is the one place that reconciles them.
 *
 * "Publish" is an **action on a `master` screen**, not a fifth value. Every
 * entity can declare verbs, so treating a verb as grounds for promotion to
 * `operation` would promote all of them.
 */
export const ScreenTypes = ['master', 'operation', 'wizard', 'report'] as const;
export type ScreenType = (typeof ScreenTypes)[number];

/**
 * The shipped Spanish names, as catalog keys.
 *
 * `shell:`-namespaced copy in a `business:policy` package is unusual and
 * deliberate: the four names are one vocabulary, and a second declaration site
 * for them is the drift `nav.ts` was already merged once to stop. Only the
 * `app:` namespace is restricted by location, so this is legal as well as
 * intended.
 */
export const SCREEN_TYPE_LABEL_KEYS: Record<ScreenType, string> = {
  master: 'shell:nav.screenType.master',
  operation: 'shell:nav.screenType.operation',
  wizard: 'shell:nav.screenType.wizard',
  report: 'shell:nav.screenType.report',
};

/** Narrow an unknown value (a stored tab address, a request body) to a {@link ScreenType}. */
export const isScreenType = (value: unknown): value is ScreenType =>
  typeof value === 'string' &&
  (ScreenTypes as readonly string[]).includes(value);

/**
 * Sort key for the top tier. A section with no type sorts last — the account
 * surface is not a screen group, so it belongs below the ones that are.
 */
export const screenTypeRank = (type: ScreenType | undefined): number =>
  type === undefined ? ScreenTypes.length : ScreenTypes.indexOf(type);
