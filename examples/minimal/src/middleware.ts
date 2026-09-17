import { resolveLocale, rewriteToLocale } from '@entifix/next-i18n';
import { stubSessionCookie } from '@entifix/testing-auth';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Locale routing, and a session for everyone.
 *
 * ⚠️ **The stub session is what makes this an example and not an application.**
 * `@entifix/testing-auth` mints an unsigned token that the service's stub token
 * layer accepts without checking. A real host signs a visitor in and sets the
 * cookie from its identity provider; everything downstream — the proxy's bearer
 * token, the service's `requirePermission` — is the same code either way.
 */
export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);
  const response: NextResponse =
    locale.redirect ?? rewriteToLocale(request, locale);
  const cookie = stubSessionCookie();
  if (request.cookies.get(cookie.name) === undefined) {
    response.cookies.set(cookie.name, cookie.value, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  return response;
}

export const config = {
  // The stub token is built with `Buffer`, which the edge runtime lacks.
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
};
