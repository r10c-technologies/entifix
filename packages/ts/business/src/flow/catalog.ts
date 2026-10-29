import {
  type FragmentDescriptor,
  fragmentFingerprint,
  fragmentRef,
  jsonSchemaOf,
  keysDocument,
} from './fragment.js';

/** Every fragment a host composes flows from, by pinned reference. */
export interface FragmentCatalog {
  readonly get: (ref: string) => FragmentDescriptor | undefined;
  readonly refs: readonly string[];
  readonly fragments: readonly FragmentDescriptor[];
}

/**
 * Assembles a catalog. Two fragments claiming one `id@version` throw: a pinned
 * reference must name exactly one contract, or a slip pinned to it means
 * whichever module happened to load last.
 */
export const defineCatalog = (
  fragments: readonly FragmentDescriptor[],
): FragmentCatalog => {
  const byRef = new Map<string, FragmentDescriptor>();
  for (const fragment of fragments) {
    const ref = fragmentRef(fragment);
    const existing = byRef.get(ref);
    if (existing !== undefined && existing !== fragment)
      throw new Error(
        `fragment '${ref}' is declared twice, by '${existing.module}' and '${fragment.module}'. ` +
          'A pinned reference names one contract: bump one of them.',
      );
    byRef.set(ref, fragment);
  }
  const refs = [...byRef.keys()].sort();
  return {
    get: ref => byRef.get(ref),
    refs,
    fragments: refs.map(ref => byRef.get(ref) as FragmentDescriptor),
  };
};

/**
 * The catalog as a JSON document: every fragment with its contract as JSON
 * Schema and its fingerprint, ordered by reference so it is snapshot-stable. It
 * is what a CI check diffs, and what a register check reads without importing
 * the packages that declare the fragments.
 */
export const catalogDocument = (catalog: FragmentCatalog) => ({
  fragments: catalog.fragments.map(fragment => ({
    ref: fragmentRef(fragment),
    id: fragment.id,
    version: fragment.version,
    module: fragment.module,
    kind: fragment.kind,
    cardinality: fragment.cardinality,
    ...(fragment.participant === undefined
      ? {}
      : { participant: fragment.participant }),
    ...(fragment.call === undefined ? {} : { call: fragment.call }),
    ...(fragment.compensation === undefined
      ? {}
      : { compensation: fragment.compensation }),
    readOnly: fragment.readOnly ?? false,
    irreversible: fragment.irreversible ?? false,
    isolation: fragment.isolation ?? 'none',
    requires: fragment.requires ?? {},
    excludedFrom: fragment.excludedFrom ?? {},
    consumes: keysDocument(fragment.consumes),
    provides: keysDocument(fragment.provides),
    contract: {
      input: jsonSchemaOf(fragment.contract.input),
      output: jsonSchemaOf(fragment.contract.output),
      failure: jsonSchemaOf(fragment.contract.failure),
    },
    fingerprint: fragmentFingerprint(fragment),
  })),
});

export type CatalogDocument = ReturnType<typeof catalogDocument>;
