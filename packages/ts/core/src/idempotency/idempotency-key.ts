/**
 * The one idempotency header, browser to shell and coordinator to participant
 * (draft-ietf-httpapi-idempotency-key-header). Lower case, as a Node request
 * presents every header name.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Printable ASCII, the only characters an RFC 9651 String may hold. */
const PRINTABLE = /^[\x20-\x7e]*$/;

/**
 * Formats a key as an RFC 9651 String item: quoted, with `\` and `"` escaped.
 * Refuses a key with a character a String cannot carry, rather than sending a
 * header the participant would refuse.
 */
export const formatIdempotencyKey = (key: string): string => {
  if (key === '' || !PRINTABLE.test(key))
    throw new Error(
      'an Idempotency-Key is a non-empty run of printable ASCII characters',
    );
  return `"${key.replace(/[\\"]/g, char => `\\${char}`)}"`;
};

/**
 * Parses an `Idempotency-Key` header as an RFC 9651 String item. Answers the
 * key, or `undefined` for a header that is absent, empty, unquoted, badly
 * escaped or carries anything after its closing quote — every one of which a
 * route treats as "no key".
 */
export const parseIdempotencyKey = (
  header: string | undefined,
): string | undefined => {
  const value = header?.trim();
  if (value === undefined || value.length < 2 || !value.startsWith('"'))
    return undefined;
  let key = '';
  for (let index = 1; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === '\\') {
      const next = value.charAt(index + 1);
      if (next !== '\\' && next !== '"') return undefined;
      key += next;
      index += 1;
    } else if (char === '"') {
      return index === value.length - 1 && key !== '' ? key : undefined;
    } else if (!PRINTABLE.test(char)) {
      return undefined;
    } else {
      key += char;
    }
  }
  return undefined;
};
