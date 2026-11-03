import { Effect } from 'effect';

import {
  ConfigurationClient,
  ConfigurationClientGroup,
  ConfigurationExtractMode,
  ConfigurationItem,
  ConfigurationPlain,
} from './types.js';

/**
 * Joins a base URL with extra path segments, normalizing slashes so neither
 * doubled nor missing separators appear (e.g. `http://h/api` + `['product']`
 * -> `http://h/api/product`).
 */
function composeUrl(base: string, segments: string[]): string {
  return [
    base.replace(/\/+$/, ''),
    ...segments.map(segment => segment.replace(/^\/+|\/+$/g, '')),
  ]
    .filter(part => part.length > 0)
    .join('/');
}

/** Parses a raw string into a finite number, failing on non-numeric input. */
function parseNumber(key: string, raw: string): Effect.Effect<number> {
  const parsed = Number(raw);
  if (raw.trim() === '' || Number.isNaN(parsed)) {
    return Effect.die(new Error(`Configuration key "${key}" is not a number`));
  }
  return Effect.succeed(parsed);
}

/** Parses a raw string into a valid Date, failing on unparseable input. */
function parseDate(key: string, raw: string): Effect.Effect<Date> {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return Effect.die(new Error(`Configuration key "${key}" is not a date`));
  }
  return Effect.succeed(parsed);
}

/** Splits a comma-separated raw value into trimmed, non-empty segments. */
function splitArray(raw: string): string[] {
  return raw
    .split(',')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);
}

/**
 * In-memory {@link ConfigurationClientGroup} backed by a group's
 * {@link ConfigurationItem} list.
 *
 * String resolution supports `exact` and `compose`; the numeric/date/array
 * getters resolve the raw value with `exact` semantics (the `compose` mode is
 * URL-oriented and only meaningful for strings). `match` remains unimplemented
 * (no defined semantics / consumer yet) and fails explicitly.
 */
export class ConfigurationClientGroupInMemory implements ConfigurationClientGroup {
  #items: ConfigurationItem[];

  constructor(items: ConfigurationItem[] = []) {
    this.#items = items;
  }

  #find(key: string): ConfigurationItem | undefined {
    return this.#items.find(candidate => candidate.key === key);
  }

  #lookup(key: string): Effect.Effect<string> {
    const item = this.#find(key);
    if (item === undefined || item.value == null) {
      return Effect.die(
        new Error(
          `Configuration key "${key}" not found (available: ${this.#items.map(candidate => candidate.key).join(', ') || 'none'})`,
        ),
      );
    }
    return Effect.succeed(String(item.value));
  }

  #lookupOptional(key: string): Effect.Effect<string | undefined, never> {
    const item = this.#find(key);
    return Effect.succeed(
      item === undefined || item.value == null ? undefined : String(item.value),
    );
  }

  #unsupportedMode(
    key: string,
    extractMode: ConfigurationExtractMode,
  ): Effect.Effect<never> {
    return Effect.die(
      new Error(
        `Configuration extract mode "${extractMode}" is not implemented yet`,
      ),
    );
  }

  getString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<string> {
    if (extractMode === 'compose') {
      const [head, ...segments] = key.split('.');
      return this.#lookup(head).pipe(
        Effect.map(base => composeUrl(base, segments)),
      );
    }
    if (extractMode === 'exact') {
      return this.#lookup(key);
    }
    return this.#unsupportedMode(key, extractMode);
  }

  getNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<number> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(Effect.flatMap(raw => parseNumber(key, raw)));
  }

  getDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<Date> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(Effect.flatMap(raw => parseDate(key, raw)));
  }

  getArrayString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<string[]> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(Effect.map(splitArray));
  }

  getArrayNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<number[]> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(
      Effect.flatMap(raw =>
        Effect.all(splitArray(raw).map(segment => parseNumber(key, segment))),
      ),
    );
  }

  getArrayDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<Date[]> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(
      Effect.flatMap(raw =>
        Effect.all(splitArray(raw).map(segment => parseDate(key, segment))),
      ),
    );
  }

  getOptionalString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<string | undefined> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key);
  }

  getOptionalNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<number | undefined> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined ? Effect.succeed(undefined) : parseNumber(key, raw),
      ),
    );
  }

  getOptionalDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<Date | undefined> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined ? Effect.succeed(undefined) : parseDate(key, raw),
      ),
    );
  }

  getOptionalArrayNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<number[] | undefined> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined
          ? Effect.succeed(undefined)
          : Effect.all(
              splitArray(raw).map(segment => parseNumber(key, segment)),
            ),
      ),
    );
  }

  getOptionalArrayString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<string[] | undefined> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.map(raw => (raw === undefined ? undefined : splitArray(raw))),
    );
  }

  getOptionalArrayDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact',
  ): Effect.Effect<Date[] | undefined> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined
          ? Effect.succeed(undefined)
          : Effect.all(splitArray(raw).map(segment => parseDate(key, segment))),
      ),
    );
  }
}

/**
 * In-memory {@link ConfigurationClient} backed by a loaded
 * {@link ConfigurationPlain}. Each `in(group)` returns a group view scoped to
 * that group's items.
 */
export class ConfigurationClientInMemory implements ConfigurationClient {
  #plainConfig: ConfigurationPlain;

  constructor(plainConfig: ConfigurationPlain = {}) {
    this.#plainConfig = plainConfig;
  }

  in(group: string): ConfigurationClientGroup {
    return new ConfigurationClientGroupInMemory(this.#plainConfig[group] ?? []);
  }
}
