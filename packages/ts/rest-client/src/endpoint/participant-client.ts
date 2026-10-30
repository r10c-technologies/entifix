import {
  currentRemainingMs,
  DEADLINE_HEADER,
  decodeProblem,
  type EntifixFailure,
  formatIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  Internal,
  PROBLEM_CONTENT_TYPE,
  ProtocolFailure,
  Timeout,
  Unavailable,
} from '@entifix/core';
import {
  type ParticipantCall,
  type ParticipantClient,
  ParticipantClientTag,
} from '@entifix/transactions';
import { Effect, Layer, Redacted } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

/** Where one participant is reached, and the token it takes. */
export interface ParticipantAddress {
  readonly baseUrl: string;
  /** The crossing token this caller presents to that participant. */
  readonly crossingToken: Redacted.Redacted<string>;
}

/** The header a crossing token travels in. */
const CROSSING_TOKEN_HEADER = 'x-crossing-token';
/** The header a crossing names the organization it acts for in. */
const ORGANIZATION_HEADER = 'x-organization-id';

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * The step's path with each `:name` taken from its parameters, then from what
 * earlier steps answered — the order a flow learns ids in.
 */
const pathOf = (call: ParticipantCall, path: string) =>
  path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) =>
    encodeURIComponent(
      String(
        call.step.parameters?.[name] ??
          (call.outputs[name] as Record<string, unknown> | undefined)?.['id'] ??
          '',
      ),
    ),
  );

/**
 * Calls participants over HTTP, as the slip pinned each step's call
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * the crossing token the participant takes, the step's `Idempotency-Key`, the
 * flow's remaining deadline, and a body of the step's parameters and what
 * earlier steps answered. A refusal decodes into the failure the participant
 * sent, by its code; a body that is not a problem is `protocol`; no answer at
 * all is `unavailable`. A step with no call — the commit point that names no
 * participant — answers at once.
 */
export const makeHttpParticipantClient = (
  client: HttpClient.HttpClient,
  participants: Readonly<Record<string, ParticipantAddress>>,
): ParticipantClient => ({
  call: request =>
    Effect.gen(function* () {
      const target =
        request.kind === 'action'
          ? request.step.call
          : request.step.compensation;
      if (target === undefined) return undefined;
      const name = request.step.participant ?? '';
      const address = participants[name];
      if (address === undefined)
        return yield* Effect.fail(new Internal() as EntifixFailure);
      const dependency = `${name} ${target.method} ${target.path}`;

      const remaining = yield* currentRemainingMs;
      if (remaining === 0)
        return yield* Effect.fail(new Timeout({ dependency }));

      const organizationId = request.step.parameters?.['organizationId'];
      const outgoing = HttpClientRequest.make(target.method)(
        `${address.baseUrl}${pathOf(request, target.path)}`,
      ).pipe(
        HttpClientRequest.setHeaders({
          accept: 'application/json',
          [CROSSING_TOKEN_HEADER]: Redacted.value(address.crossingToken),
          [IDEMPOTENCY_KEY_HEADER]: formatIdempotencyKey(
            request.idempotencyKey,
          ),
          ...(typeof organizationId === 'string'
            ? { [ORGANIZATION_HEADER]: organizationId }
            : {}),
          ...(remaining === undefined
            ? {}
            : { [DEADLINE_HEADER]: String(remaining) }),
        }),
        HttpClientRequest.bodyText(
          JSON.stringify({
            parameters: request.step.parameters ?? {},
            outputs: request.outputs,
          }),
          'application/json',
        ),
      );

      const response = yield* client
        .execute(outgoing)
        .pipe(Effect.mapError(() => new Unavailable({ dependency })));
      const text = yield* response.text.pipe(
        Effect.mapError(() => new Unavailable({ dependency })),
      );
      if (response.status < 400) return text === '' ? undefined : parse(text);
      const isProblem =
        response.headers['content-type']?.startsWith(PROBLEM_CONTENT_TYPE) ===
        true;
      return yield* Effect.fail(
        isProblem
          ? decodeProblem(parse(text), response.status)
          : new ProtocolFailure({
              reason: `${dependency} answered ${String(response.status)} without a problem body`,
              upstreamStatus: response.status,
            }),
      );
    }),
});

/** The HTTP participant client over the host's `HttpClient`. */
export const HttpParticipantClientLayer = (
  participants: Readonly<Record<string, ParticipantAddress>>,
) =>
  Layer.effect(
    ParticipantClientTag,
    Effect.map(HttpClient.HttpClient, client =>
      makeHttpParticipantClient(client, participants),
    ),
  );
