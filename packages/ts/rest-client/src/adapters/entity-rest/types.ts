import type {
  ConfigurationClient,
  ConfigurationExtractMode,
} from '@entifix/core';

export interface BuildEntityRestOptions {
  uriConfig: {
    key: string;
    group?: string;
    extractionMode?: ConfigurationExtractMode;
  };
  /**
   * The method an update is sent with: `PUT` replaces the stored entity,
   * `PATCH` merges into it. Defaults to `'PUT'`.
   */
  update?: 'PUT' | 'PATCH';
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
