/**
 * One kind of id a guide may cite, as `:<kind>[id]`: `:use-case[order-management:product-order:cancel]`.
 *
 * The engine knows no host's ids. A host passes one entry per directive name,
 * built from whatever already holds them — a capability register, the entity
 * metadata, the record index — so a guide can only cite what exists.
 */
export interface ReferenceKind {
  /** Every id this kind may cite. */
  readonly ids: ReadonlySet<string>;
  /** Where a citation links. */
  readonly href: (id: string) => string;
  /** The words a citation shows; the id itself when absent. */
  readonly label?: (id: string) => string;
}

/** Every directive name a guide may use, and what it resolves against. */
export type ReferenceRegistry = Readonly<Record<string, ReferenceKind>>;

/** A registry from plain id lists, for the common case. */
export const referenceKind = (
  ids: Iterable<string>,
  href: (id: string) => string,
  label?: (id: string) => string,
): ReferenceKind =>
  label === undefined
    ? { ids: new Set(ids), href }
    : { ids: new Set(ids), href, label };
