import {
  decodeProblem,
  type EntifixFailure,
  type FailureClass,
  isFailure,
  Problem,
  PROBLEM_CONTENT_TYPE,
  problemOf,
} from '@entifix/core';
import { Schema, SchemaTransformation } from 'effect';
import { HttpApiSchema } from 'effect/http-api';

/** The class's own fields; the tag is the problem's `title`, not a member. */
const ownFields = (failureClass: FailureClass): Schema.Struct.Fields =>
  Object.fromEntries(
    Object.entries(failureClass.fields).filter(([key]) => key !== '_tag'),
  );

/**
 * A failure class as an endpoint's error schema: the problem body on the wire,
 * the failure as its type, the policy's status and the problem content type
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)).
 *
 * The wire side is the problem envelope plus the class's own fields, so the
 * OpenAPI document shows what a client receives. Decoding goes through the
 * registry, by `code`, so a body that names another code decodes to the
 * failure it names rather than to this class.
 */
export const problemCodec = (
  failureClass: FailureClass,
  status: number,
): Schema.Top =>
  Schema.Struct({ ...Problem.fields, ...ownFields(failureClass) }).pipe(
    // The type side is any failure, not only this class: a body may name
    // another code, and decoding it yields what it names.
    Schema.decodeTo(
      Schema.declare((value): value is EntifixFailure => isFailure(value)),
      SchemaTransformation.transform({
        decode: body => decodeProblem(body, status),
        encode: failure =>
          problemOf(failure, { status }) as typeof Problem.Type,
      }),
    ),
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: PROBLEM_CONTENT_TYPE }),
  );
