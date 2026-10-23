import type {
  ConfigurationClient,
  ConfigurationExtractMode,
} from '@entifix/core';

/**
 * How a create is sent to this entity's service.
 *
 * `entity` is the plain REST write: `POST` an entity envelope, get the stored
 * entity back. `command` is the CQRS write path — the client mints the
 * transaction id, `POST`s a `command` envelope and gets a `202` naming the
 * transaction, because the write completes asynchronously behind a saga.
 *
 * It is per entity rather than global because the two live side by side today:
 * `ProductSpecification` is transactional, while `ProductBrand` and
 * `ProductCategory` are plain writes on another service.
 */
export type EntityCreateProtocol = 'entity' | 'command';

export interface BuildEntityRestOptions {
  uriConfig: {
    key: string;
    group?: string;
    extractionMode?: ConfigurationExtractMode;
  };
  /** Defaults to `'entity'` — the plain REST write. */
  create?: EntityCreateProtocol;
  /**
   * Where `uriConfig` is looked up, bound when the adapter is built.
   *
   * A value rather than a requirement on each call: the URL lookup is this
   * adapter's mechanism, and putting it in the repository port's environment
   * made every use case — and every static or database-backed caller — provide
   * a configuration it never read.
   */
  configuration: ConfigurationClient;
}
