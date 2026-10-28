import { DuplicateKey } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { translateSqlError } from './translate-sql-error.js';

/** `@effect/sql` wraps the driver's error; the SQLSTATE sits on the cause. */
const wrapped = (code: string) => ({
  _tag: 'SqlError',
  cause: Object.assign(new Error('pg said no'), { code }),
});

describe('translateSqlError', () => {
  it.each([
    ['23505', 'DuplicateKey'],
    ['40001', 'Contention'],
    ['40P01', 'Contention'],
    ['57014', 'Timeout'],
    ['08006', 'Unavailable'],
  ])('reads SQLSTATE %s as %s', (code, tag) => {
    expect(translateSqlError(wrapped(code))).toMatchObject({ _tag: tag });
  });

  it('ignores a code that is not a SQLSTATE, like a socket error', () => {
    expect(
      translateSqlError(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      ),
    ).toMatchObject({ _tag: 'Unavailable', dependency: 'sql' });
    expect(translateSqlError(null, 'config')).toMatchObject({
      _tag: 'Unavailable',
      dependency: 'config',
    });
  });

  it('stops looking after five causes', () => {
    let deep: Record<string, unknown> = { code: '23505' };
    for (let depth = 0; depth < 6; depth += 1) deep = { cause: deep };

    expect(translateSqlError(deep)).toMatchObject({ _tag: 'Unavailable' });
  });

  it('passes a failure already translated through', () => {
    const taken = new DuplicateKey({});

    expect(translateSqlError(taken)).toBe(taken);
  });
});
