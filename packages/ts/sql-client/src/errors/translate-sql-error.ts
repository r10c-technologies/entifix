import {
  Contention,
  DuplicateKey,
  isFailure,
  type StoreFailure,
  Timeout,
  Unavailable,
} from '@entifix/core';

/**
 * What a SQL error means, as a categorised failure
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)),
 * read from the Postgres SQLSTATE wherever it sits in the cause chain —
 * `@effect/sql` wraps the driver's error, and the code lives on the driver's.
 *
 * - `23505` unique violation → `DuplicateKey`, naming the column Postgres
 *   reports in its `detail` (`Key (sku)=(A-1) already exists.`), so a member
 *   declared `unique` (ADR 0034) is refused on its own field
 * - `40001` serialization failure, `40P01` deadlock → `Contention`
 * - `57014` statement cancelled by timeout → `Timeout`
 * - class `08` connection exceptions, and anything unrecognised → `Unavailable`
 */
export const translateSqlError = (
  error: unknown,
  dependency = 'sql',
): StoreFailure => {
  if (isFailure(error)) return error as StoreFailure;
  const code = sqlState(error);
  if (code === '23505') {
    const key = duplicatedColumn(error);
    return new DuplicateKey(key === undefined ? {} : { key });
  }
  if (code === '40001' || code === '40P01') return new Contention();
  if (code === '57014') return new Timeout({ dependency });
  return new Unavailable({ dependency });
};

/** The column(s) a unique violation names in its `detail`, comma-joined. */
const duplicatedColumn = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const detail = (current as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      const match = /^Key \((.+?)\)=/.exec(detail);
      if (match?.[1] !== undefined)
        return match[1]
          .split(',')
          .map(column => column.trim().replace(/^"(.*)"$/, '$1'))
          .join(',');
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

const sqlState = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};
