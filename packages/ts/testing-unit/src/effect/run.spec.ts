import { ConfigurationRepositoryTag } from '@entifix/business';
import { EntifixConnError } from '@entifix/core';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { stubUriConfigurationLayer } from '../doubles/configuration.js';
import { expectFailure, run, runExit, runFailure, runUC } from './run.js';

const failure = new EntifixConnError('unreachable');

/** An Effect that needs something from its environment, for `runUC` to provide. */
const needsConfiguration = Effect.gen(function* () {
  const store = yield* ConfigurationRepositoryTag;
  return yield* store.in('uri').getString('service');
});

describe('runUC', () => {
  it('provides the layer and returns the value', async () => {
    expect(
      await runUC(
        needsConfiguration,
        stubUriConfigurationLayer(
          { service: 'http://svc' },
          { keyTemplate: '[entity]', group: 'uri' },
        ),
      ),
    ).toBe('http://svc');
  });
});

// Asserting on the error *value* is the point: "it failed with the
// EntifixLockError the facade turns into a 409" beats "a promise rejected".
describe('expectFailure', () => {
  it('returns the typed error', async () => {
    const error = await expectFailure(
      Effect.fail(failure),
      Layer.succeed(ConfigurationRepositoryTag, {} as never),
    );

    expect(error).toBe(failure);
  });

  it('complains when the effect succeeded instead', async () => {
    await expect(
      expectFailure(
        Effect.succeed('fine'),
        Layer.succeed(ConfigurationRepositoryTag, {} as never),
      ),
    ).rejects.toThrow(/succeeded with: "fine"/);
  });

  // A defect is not a typed failure — reporting it as one would hide a bug in
  // the code under test behind an assertion that looks satisfied.
  it('complains when the effect died instead', async () => {
    await expect(
      expectFailure(
        Effect.die(new Error('boom')),
        Layer.succeed(ConfigurationRepositoryTag, {} as never),
      ),
    ).rejects.toThrow(/died with/);
  });
});

describe('runExit', () => {
  it('keeps a failure as an exit rather than rejecting', async () => {
    const exit = await runExit(Effect.fail(failure));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('keeps a success as an exit too', async () => {
    const exit = await runExit(Effect.succeed(7));

    expect(Exit.isSuccess(exit) && exit.value).toBe(7);
  });
});

describe('run', () => {
  it('runs an Effect that requires nothing', async () => {
    expect(await run(Effect.succeed(7))).toBe(7);
  });
});

describe('runFailure', () => {
  it('returns the typed error', async () => {
    expect(await runFailure(Effect.fail(failure))).toBe(failure);
  });

  it('complains when the effect succeeded instead', async () => {
    await expect(runFailure(Effect.succeed('fine'))).rejects.toThrow(
      /succeeded with: "fine"/,
    );
  });

  it('complains when the effect died instead', async () => {
    await expect(runFailure(Effect.die(new Error('boom')))).rejects.toThrow(
      /died with/,
    );
  });
});
