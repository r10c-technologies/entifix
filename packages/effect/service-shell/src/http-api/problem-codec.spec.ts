import { Failure, PROBLEM_CONTENT_TYPE, ProtocolFailure } from '@entifix/core';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { serveEndpoints } from './build-api.js';
import { problemCodec } from './problem-codec.js';

class Taken extends Failure.conflict<Taken>()(
  'SpecCodecTaken',
  'specCodecTaken',
  {
    slug: Schema.String,
  },
) {}

const codec = problemCodec(Taken, 409) as unknown as Schema.Codec<
  unknown,
  Record<string, unknown>
>;

describe('the problem codec', () => {
  it('encodes a failure as its problem body, at the status it was given', () => {
    expect(Schema.encodeSync(codec)(new Taken({ slug: 'a' }))).toEqual({
      type: 'urn:entifix:failure:specCodecTaken',
      title: 'SpecCodecTaken',
      status: 409,
      code: 'specCodecTaken',
      category: 'conflict',
      slug: 'a',
    });
  });

  it('decodes a problem body back into the failure its code names', () => {
    const decoded = Schema.decodeUnknownSync(codec)({
      type: 'urn:entifix:failure:specCodecTaken',
      title: 'SpecCodecTaken',
      status: 409,
      code: 'specCodecTaken',
      category: 'conflict',
      slug: 'b',
    });

    expect(decoded).toMatchObject({ _tag: 'SpecCodecTaken', slug: 'b' });
  });

  it('decodes a body naming an unknown code as a protocol failure', () => {
    const decoded = Schema.decodeUnknownSync(codec)({
      type: 'urn:entifix:failure:nobody',
      title: 'Nobody',
      status: 409,
      code: 'nobodyRegisteredThis',
      category: 'conflict',
      slug: 'b',
    });

    expect(decoded).toBeInstanceOf(ProtocolFailure);
  });
});

describe('serveEndpoints', () => {
  it('builds the API and the layer that serves it from one set of groups', () => {
    const served = serveEndpoints('spec', []);

    expect(served.api.identifier).toBe('spec');
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
    expect(Effect.isEffect(served.layer)).toBe(false);
  });
});
