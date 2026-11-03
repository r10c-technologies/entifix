import { Effect } from 'effect/Effect';

import type { Unavailable } from '../../failure/generic.js';

export type ConfigurationExtractMode = 'exact' | 'match' | 'compose';

export interface ConfigurationClientGroup {
  getNumber(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<number, Unavailable>;
  getString(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<string, Unavailable>;
  getDate(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<Date, Unavailable>;
  getArrayNumber(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<number[], Unavailable>;
  getArrayString(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<string[], Unavailable>;
  getArrayDate(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<Date[], Unavailable>;
  getOptionalNumber(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<number | undefined, Unavailable>;
  getOptionalString(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<string | undefined, Unavailable>;
  getOptionalDate(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<Date | undefined, Unavailable>;
  getOptionalArrayNumber(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<number[] | undefined, Unavailable>;
  getOptionalArrayString(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<string[] | undefined, Unavailable>;
  getOptionalArrayDate(
    key: string,
    extractMode?: ConfigurationExtractMode,
  ): Effect<Date[] | undefined, Unavailable>;
}

export interface ConfigurationClient {
  in(key: string): ConfigurationClientGroup;
}

export interface ConfigurationItem {
  key: string;
  value: unknown;
  /**
   * Marks the value as a credential — a connection password, a signing key.
   *
   * It travels with the item because the only place that knows is the
   * configuration store's own `is_secret` column, while the place that must act
   * on it is a service's `GET /api/config` introspection route, several hops
   * away. Inferring it there from the key's *name* would be a guess, and the
   * cost of guessing wrong is publishing a private key.
   */
  isSecret?: boolean;
}

export interface ConfigurationPlain {
  [key: string]: ConfigurationItem[];
}
