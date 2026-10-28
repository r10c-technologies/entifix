import {
  type EntifixFailure,
  PROBLEM_CONTENT_TYPE,
  problemOf,
  type ProblemOptions,
} from '@entifix/core';
import { NextResponse } from 'next/server';

/**
 * A failure answered from a Next route handler that is not a proxy, as
 * `application/problem+json` with its category's status unless one is given
 * ([ADR 0013](../../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 *
 * `no-store`, because a refusal is about one caller and must never be served
 * to the next one from a cache.
 */
export const problemResponse = (
  failure: EntifixFailure,
  options: ProblemOptions = {},
): NextResponse => {
  const body = problemOf(failure, options);
  return new NextResponse(JSON.stringify(body), {
    status: body.status,
    headers: {
      'content-type': PROBLEM_CONTENT_TYPE,
      'cache-control': 'no-store',
    },
  });
};
