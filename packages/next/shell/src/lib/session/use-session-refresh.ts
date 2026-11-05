'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Browser events that count as a person being present. */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'scroll',
  'visibilitychange',
] as const;

/**
 * Session timing, as this shell assumes it when a host says nothing.
 *
 * ⚠️ **Defaults, not policy.** These four used to be imported from the
 * application's own session package, which made a framework hook carry one
 * product's security decisions — and meant a second application could not use
 * the hook at all without adopting the first one's token lifetime. A host that has a
 * session policy passes it in; a host that has not yet thought about it gets
 * numbers that are defensible rather than absent.
 *
 * The server is still the authority. These only decide when the browser *asks*;
 * the refresh endpoint decides whether the session actually slides.
 */
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 15;
const DEFAULT_IDLE_STOP_SECONDS = 60 * 15;
const DEFAULT_EXPIRY_WARNING_SECONDS = 60 * 5;
const DEFAULT_REFRESH_LEAD_RATIO = 0.8;

export interface UseSessionRefreshOptions {
  /** Where this app mounts the shared refresh handler. */
  readonly endpoint?: string;
  /**
   * Access-token lifetime in seconds, assumed until the server says otherwise.
   *
   * Only a fallback: every refresh answers the `expiresIn` of the token it just
   * minted, and the next refresh is scheduled from that. A server whose token
   * lifetime is a configuration value would otherwise be refreshed on this
   * number, and a token shorter than it would lapse between two refreshes.
   */
  readonly tokenTtlSeconds?: number;
  /**
   * Seconds left on the token the page was rendered with, when the host knows
   * it — read on the server from the token's `exp`.
   *
   * Schedules the **first** refresh. Without it the first one waits for a full
   * `tokenTtlSeconds` lead, which is late for a page loaded on a token already
   * part-way through its life, and later still for a token shorter than the
   * fallback.
   */
  readonly tokenExpiresInSeconds?: number;
  /**
   * How long without interaction before the timer stops asking.
   *
   * This is what makes "idle timeout" measure whether a person is there rather
   * than whether a tab is open, so a host raising it is choosing to keep
   * forgotten tabs alive.
   */
  readonly idleStopSeconds?: number;
  /** How long before the absolute ceiling `expiringSoon` turns true. */
  readonly expiryWarningSeconds?: number;
  /** Fraction of the token's life at which to refresh. */
  readonly refreshLeadRatio?: number;
  /** Called when the session is gone and the user has to sign in again. */
  readonly onExpired?: () => void;
}

export interface SessionRefreshState {
  /** Seconds left before the session's absolute ceiling, once known. */
  readonly sessionExpiresIn: number | undefined;
  /** True inside the final window before the ceiling — prompt the user. */
  readonly expiringSoon: boolean;
  /** True once a refresh has failed and the session is over. */
  readonly expired: boolean;
}

/**
 * Keeps the access-token cookie fresh while someone is actually using the app.
 *
 * The refresh runs at 80% of the current token's life, but **only while the
 * user has interacted recently**. That condition is the whole point: the server
 * slides the session on refresh, so a timer that fired unconditionally would
 * keep a forgotten tab's session alive forever and "idle timeout" would measure
 * whether a tab is open rather than whether a person is there. Going quiet lets
 * the token lapse and the session age out on schedule.
 *
 * The token itself is never visible here — it lives in an httpOnly cookie, and
 * the endpoint below rewrites it server-side.
 */
export function useSessionRefresh(
  options: UseSessionRefreshOptions = {},
): SessionRefreshState {
  const {
    endpoint = '/api/auth/refresh',
    tokenTtlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
    tokenExpiresInSeconds,
    idleStopSeconds = DEFAULT_IDLE_STOP_SECONDS,
    expiryWarningSeconds = DEFAULT_EXPIRY_WARNING_SECONDS,
    refreshLeadRatio = DEFAULT_REFRESH_LEAD_RATIO,
    onExpired,
  } = options;

  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | undefined>(
    undefined,
  );
  const [expired, setExpired] = useState(false);
  // Seeded on mount rather than at construction: reading the clock during
  // render is impure, and the value is only ever consumed from an effect.
  const lastActivity = useRef(0);
  const onExpiredRef = useRef(onExpired);
  /**
   * Mirrors `expired` synchronously. The state update only tears the interval
   * down on the next render, so without this a burst of ticks fires — and
   * `onExpired` runs — several times over for one dead session.
   */
  const expiredRef = useRef(false);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    markActive();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
    };
  }, [markActive]);

  useEffect(() => {
    if (expired) return undefined;

    /** When to ask, for a token that has `seconds` left. Never sooner than 1s. */
    const leadMs = (seconds: number) =>
      Math.max(1, Math.floor(seconds * refreshLeadRatio)) * 1000;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      timer = setTimeout(() => {
        void tick();
      }, ms);
    };

    /**
     * One refresh, answering when the next one is due.
     *
     * ⚠️ **The delay comes from the token the server just minted**, not from
     * a period fixed at mount. A fixed interval held the fallback lifetime
     * for the life of the tab, so a server minting shorter tokens saw every
     * one of them lapse before the browser asked again.
     */
    const attempt = async (): Promise<number> => {
      const idleFor = (Date.now() - lastActivity.current) / 1000;
      // Nobody is here. Skipping the refresh is what lets the session lapse.
      if (idleFor > idleStopSeconds) return leadMs(tokenTtlSeconds);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
        });
        if (cancelled) return 0;

        if (response.status === 401) {
          expiredRef.current = true;
          setExpired(true);
          onExpiredRef.current?.();
          return 0;
        }
        // transient (503) — try again after a fallback lead
        if (!response.ok) return leadMs(tokenTtlSeconds);

        const body = (await response.json()) as {
          expiresIn?: unknown;
          sessionExpiresIn?: unknown;
        };
        if (cancelled) return 0;
        if (typeof body.sessionExpiresIn === 'number') {
          setSessionExpiresIn(body.sessionExpiresIn);
        }
        return typeof body.expiresIn === 'number' && body.expiresIn > 0
          ? leadMs(body.expiresIn)
          : leadMs(tokenTtlSeconds);
      } catch {
        // Offline or a dropped request: keep the schedule and retry.
        return leadMs(tokenTtlSeconds);
      }
    };

    const tick = async () => {
      const next = await attempt();
      if (cancelled || expiredRef.current) return;
      schedule(next);
    };

    schedule(leadMs(tokenExpiresInSeconds ?? tokenTtlSeconds));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, tokenTtlSeconds, tokenExpiresInSeconds, expired]);

  return {
    sessionExpiresIn,
    expiringSoon:
      sessionExpiresIn !== undefined &&
      sessionExpiresIn <= expiryWarningSeconds,
    expired,
  };
}
