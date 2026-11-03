'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useErrorMessage, useT } from '../../../i18n/index.js';
import { Button } from '../../atoms/button/index.js';

/**
 * A failure as {@link useErrorMessage} renders it: a typed failure carries its
 * `code`, and anything else that reached the user keeps its `message`.
 */
export type ToastFailure = Parameters<ReturnType<typeof useErrorMessage>>[0];

/** One failure waiting in the region, under the id it was shown with. */
export interface FailureToast {
  readonly id: number;
  readonly failure: ToastFailure;
}

export interface Toasts {
  /** The failures shown, oldest first. */
  readonly failures: readonly FailureToast[];
  /** Shows a failure until it is dismissed, and answers its id. */
  readonly showFailure: (failure: ToastFailure) => number;
  readonly dismiss: (id: number) => void;
}

const ToastContext = createContext<Toasts | undefined>(undefined);

/**
 * Holds the toasts one host shows. Mounted once, above everything that can
 * fail asynchronously, with a {@link ToastRegion} somewhere inside it.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [failures, setFailures] = useState<readonly FailureToast[]>([]);
  const next = useRef(0);

  const showFailure = useCallback((failure: ToastFailure) => {
    next.current += 1;
    const id = next.current;
    setFailures(shown => [...shown, { id, failure }]);
    return id;
  }, []);
  const dismiss = useCallback((id: number) => {
    setFailures(shown => shown.filter(toast => toast.id !== id));
  }, []);

  const value = useMemo(
    () => ({ failures, showFailure, dismiss }),
    [failures, showFailure, dismiss],
  );
  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

/**
 * The {@link ToastProvider} above, or `undefined` outside one: a caller with
 * no region to show a failure in keeps it where it can, rather than having it
 * vanish.
 */
export const useToasts = (): Toasts | undefined => useContext(ToastContext);

/**
 * Where a host's toasts render: each failure in the reader's language,
 * through the same {@link useErrorMessage} a form's error slot uses, so an
 * asynchronous failure reads exactly as a synchronous one would.
 *
 * A failure stays until it is dismissed. It reports something that already
 * happened, often after the screen that started it was left, and a message
 * that times out is one a slow reader never gets.
 */
export function ToastRegion() {
  const toasts = useToasts();
  const t = useT();
  const message = useErrorMessage();

  if (toasts === undefined) return null;
  return (
    <section
      aria-label={t('toast.region')}
      className="bottom-0 right-0 max-w-md fixed z-50 flex w-full flex-col gap-xs p-s"
    >
      {toasts.failures.map(({ id, failure }) => (
        <div
          key={id}
          role="alert"
          className="flex items-start gap-xs rounded-lg border border-danger bg-surface p-xs shadow-overlay"
        >
          <p className="flex-1 text-step-sm text-danger">{message(failure)}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => toasts.dismiss(id)}
          >
            {t('toast.dismiss')}
          </Button>
        </div>
      ))}
    </section>
  );
}
