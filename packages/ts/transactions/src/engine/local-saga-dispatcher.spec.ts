import { EntifixConnError, EntifixLogicError } from '@entifix/core';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { SagaDispatcherTag } from '../ports/saga-dispatcher.js';
import {
  isSagaCall,
  LocalSagaDispatcherLayer,
  type LocalSagaRequest,
  makeLocalSagaDispatcher,
} from './local-saga-dispatcher.js';

const reserve = { method: 'POST', path: '/stock/reservation' } as const;

describe('makeLocalSagaDispatcher', () => {
  it('hands the dispatch, minus the participant, to that participant', async () => {
    const received: LocalSagaRequest[] = [];
    const dispatcher = makeLocalSagaDispatcher({
      stock: request =>
        Effect.sync(() => {
          received.push(request);
          return { ok: true, status: 201, body: { id: 'h-1' } };
        }),
    });

    const response = await Effect.runPromise(
      dispatcher.dispatch({
        participant: 'stock',
        call: reserve,
        commandId: 'c-1',
        body: { quantity: 2 },
      }),
    );

    expect(response).toEqual({ ok: true, status: 201, body: { id: 'h-1' } });
    expect(received).toEqual([
      { call: reserve, commandId: 'c-1', body: { quantity: 2 } },
    ]);
  });

  it('passes a refusal and a connection failure through unchanged', async () => {
    const dispatcher = makeLocalSagaDispatcher({
      payment: () => Effect.succeed({ ok: false, status: 409, body: {} }),
      stock: () => Effect.fail(new EntifixConnError('down')),
    });

    const refused = await Effect.runPromise(
      dispatcher.dispatch({
        participant: 'payment',
        call: reserve,
        commandId: 'c',
      }),
    );
    const unreachable = await Effect.runPromiseExit(
      dispatcher.dispatch({
        participant: 'stock',
        call: reserve,
        commandId: 'c',
      }),
    );

    expect(refused.ok).toBe(false);
    expect(Exit.isFailure(unreachable)).toBe(true);
  });

  // A wiring mistake, not a step that failed: compensating the flow for it would
  // hide the bug behind a rollback.
  it('dies on a participant it has no handler for', async () => {
    const exit = await Effect.runPromiseExit(
      makeLocalSagaDispatcher({}).dispatch({
        participant: 'ghost',
        call: reserve,
        commandId: 'c',
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.isDie(exit.cause)).toBe(true);
      expect(Cause.squash(exit.cause)).toBeInstanceOf(EntifixLogicError);
    }
  });

  it('is provided as the dispatcher port by its layer', async () => {
    const response = await Effect.runPromise(
      SagaDispatcherTag.pipe(
        Effect.flatMap(dispatcher =>
          dispatcher.dispatch({
            participant: 'p',
            call: reserve,
            commandId: 'c',
          }),
        ),
        Effect.provide(
          LocalSagaDispatcherLayer({
            p: () => Effect.succeed({ ok: true, status: 200, body: null }),
          }),
        ),
      ),
    );

    expect(response.status).toBe(200);
  });
});

describe('isSagaCall', () => {
  it('matches on method and path together', () => {
    const request = { call: reserve, commandId: 'c' };

    expect(isSagaCall(request, reserve)).toBe(true);
    expect(isSagaCall(request, { method: 'DELETE', path: reserve.path })).toBe(
      false,
    );
    expect(isSagaCall(request, { method: 'POST', path: '/other' })).toBe(false);
  });
});
