import { resolveLocale, rewriteToLocale } from '@entifix/next-i18n';
import type { NextRequest } from 'next/server';

/**
 * Locale routing and nothing else.
 *
 * An unprefixed URL is redirected to `/<locale>/…` chosen from the cookie or
 * `Accept-Language`; a prefixed one is rewritten to the unprefixed route with
 * the locale in a header, which is what `getRequestLocale` reads. There is no
 * session to check.
 */
export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);
  if (locale.redirect) return locale.redirect;
  return rewriteToLocale(request, locale);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
};
