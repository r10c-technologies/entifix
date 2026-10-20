import { type Action, permissionForEntity } from '@entifix/authz';
import {
  deleteUCFactory,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  EntityTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@entifix/business';
import {
  EntifixBuildError,
  type EntityLoadRequest,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
} from '@entifix/core';
import { Book } from '@entifix/example-minimal-domain';
import { entityMetadataRoute, requirePermission } from '@entifix/service-shell';
import { makeSqlRepository } from '@entifix/sql';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { SqlClient } from 'effect/sql';

const failure = (status: number, code: string, detail?: unknown) =>
  HttpServerResponse.json({ code, detail: String(detail ?? '') }, { status });

const repository = Effect.map(SqlClient.SqlClient, sql =>
  makeSqlRepository(sql, Book),
);

const guard = (action: Action) =>
  requirePermission(permissionForEntity(Book, action));

const list = guard('read')(() =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(request.url, 'http://localhost').searchParams;
    const load = yield* Effect.try({
      try: () =>
        parseLoadRequestParams(Book, search) as unknown as EntityLoadRequest,
      catch: error => error as EntifixBuildError,
    });
    const page = yield* loadUCFactory<Book>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* repository),
      Effect.provideService(EntityLoadRequestTag, load),
    );
    return yield* HttpServerResponse.json(
      makeEntityPageEnvelope(Book, page, []),
    );
  }).pipe(Effect.catch(error => failure(400, 'invalidQuery', error))),
);

const byId = guard('read')(() =>
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const book = yield* getUCFactory<Book>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* repository),
      Effect.provideService(EntityIdTag, id),
    );
    return yield* HttpServerResponse.json(makeEntityEnvelope(Book, book, []));
  }).pipe(Effect.catch(() => failure(404, 'notFound'))),
);

const save = (fromParams: boolean) =>
  guard('write')(() =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const book = yield* readEntityEnvelope(Book, yield* request.json);
      if (fromParams) book.id = (yield* HttpRouter.params).id;
      const saved = yield* saveUCFactory<Book>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository),
        Effect.provideService(EntityTag, book),
      );
      return yield* HttpServerResponse.json(
        makeEntityEnvelope(Book, saved, []),
      );
    }).pipe(Effect.catch(error => failure(400, 'invalidBody', error))),
  );

const remove = guard('delete')(() =>
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    yield* deleteUCFactory<Book>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* repository),
      Effect.provideService(EntityIdTag, id),
    );
    return yield* HttpServerResponse.json({
      meta: { type: 'entity', entity: 'book', links: [] },
      data: { id },
    });
  }).pipe(Effect.catch(error => failure(500, 'unexpected', error))),
);

/** One entity's CRUD over Postgres. `$metadata` precedes `/:id`. */
export const router = HttpRouter.addAll([
  HttpRouter.route('GET', '/api/book', list),
  HttpRouter.route('POST', '/api/book', save(false)),
  HttpRouter.route('GET', '/api/book/$metadata', entityMetadataRoute(Book)),
  HttpRouter.route('GET', '/api/book/:id', byId),
  HttpRouter.route('PUT', '/api/book/:id', save(true)),
  HttpRouter.route('DELETE', '/api/book/:id', remove),
]);
