import { describe, expect, it } from 'vitest';

import {
  formatIdempotencyKey,
  parseIdempotencyKey,
} from './idempotency-key.js';

describe('the Idempotency-Key codec', () => {
  it.each([
    ['a plain key', '8e03978e-40d5-43e8-bc93-6894a57f9324'],
    ['a key with a quote', 'say "hi"'],
    ['a key with a backslash', 'a\\b'],
  ])('round-trips %s as an RFC 9651 String', (_label, key) => {
    expect(parseIdempotencyKey(formatIdempotencyKey(key))).toBe(key);
  });

  it('quotes and escapes on the way out', () => {
    expect(formatIdempotencyKey('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it.each(['', 'é', 'tab\t'])('refuses to format %j', key => {
    expect(() => formatIdempotencyKey(key)).toThrow('printable ASCII');
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['unquoted', 'abc'],
    ['an empty String', '""'],
    ['unterminated', '"abc'],
    ['an unknown escape', '"a\\nb"'],
    ['trailing bytes', '"abc"x'],
    ['a non-printable character', '"a\tb"'],
  ])('reads %s as no key', (_label, header) => {
    expect(parseIdempotencyKey(header)).toBeUndefined();
  });

  it('ignores the whitespace around a header value', () => {
    expect(parseIdempotencyKey('  "k"  ')).toBe('k');
  });
});
