'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useErrorMessage, useT } from '../../../i18n/index.js';
import { Alert, type AlertTone } from '../../atoms/alert/index.js';
import { Button } from '../../atoms/button/index.js';
import { cn } from '../../utils/cn.js';

/**
 * A failure as {@link useErrorMessage} renders it: a typed failure carries its
 * `code`, and anything else that reached the user keeps its `message`.
 */
export type ToastFailure = Parameters<ReturnType<typeof useErrorMessage>>[0];

/**
 * What a toast reports
 * ([ADR 0028](../../../../../../../docs/adr/0028-states-an-organism-must-render.md)):
 * a write that worked, one that can still be taken back, something worth
 * knowing, or a failure. Only a failure interrupts.
 */
export type ToastTone = 'success' | 'undo' | 'info' | 'failure';

/** The one thing a toast offers to do about what it reports. */
export interface ToastAction {
  /** The button's text, already in the reader's language. */
  readonly label: string;
  readonly onAction: () => void;
}

/**
 * A toast to show. A failure carries the failure itself, rendered through the
 * same {@link useErrorMessage} a form's error slot uses; every other tone
 * carries a sentence already in the reader's language. An `undo` toast without
 * its Undo would be a success toast, so the type asks for the action.
 */
export type ToastInput =
  | {
      readonly tone: 'success' | 'info';
      readonly message: string;
      readonly action?: ToastAction;
    }
  | {
      readonly tone: 'undo';
      readonly message: string;
      readonly action: ToastAction;
    }
  | {
      readonly tone: 'failure';
      readonly failure: ToastFailure;
      readonly action?: ToastAction;
    };

/** One toast waiting in the region, under the id it was shown with. */
export type Toast = ToastInput & { readonly id: number };

export interface Toasts {
  /** The toasts shown, oldest first. */
  readonly toasts: readonly Toast[];
  /** Shows a toast, and answers its id. */
  readonly show: (toast: ToastInput) => number;
  readonly dismiss: (id: number) => void;
}

/**
 * How long a toast that is not a failure stays, in milliseconds. A failure
 * stays until it is dismissed: it reports something that already happened,
 * often after the screen that started it was left, and a message that times
 * out is one a slow reader never gets.
 */
export const TOAST_TIMEOUT_MS = 8000;

const ToastContext = createContext<Toasts | undefined>(undefined);

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** How long a success, undo or info toast stays. */
  readonly timeoutMs?: number;
}

/**
 * Holds the toasts one host shows. Mounted once, above everything that can
 * fail asynchronously, with a {@link ToastRegion} somewhere inside it.
 */
export function ToastProvider({
  children,
  timeoutMs = TOAST_TIMEOUT_MS,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts(shown => shown.filter(toast => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      next.current += 1;
      const id = next.current;
      setToasts(shown => [...shown, { ...toast, id }]);
      if (toast.tone !== 'failure')
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), timeoutMs),
        );
      return id;
    },
    [dismiss, timeoutMs],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ toasts, show, dismiss }),
    [toasts, show, dismiss],
  );
  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

/**
 * The {@link ToastProvider} above, or `undefined` outside one: a caller with
 * no region to show a toast in keeps what it has to say where it can, rather
 * than having it vanish.
 */
export const useToasts = (): Toasts | undefined => useContext(ToastContext);

const ALERT_TONE: Readonly<Record<ToastTone, AlertTone>> = {
  success: 'success',
  undo: 'info',
  info: 'info',
  failure: 'danger',
};

function ToastItem({
  toast,
  onDismiss,
}: {
  readonly toast: Toast;
  readonly onDismiss: () => void;
}) {
  const t = useT();
  const message = useErrorMessage();
  const { action } = toast;
  return (
    <Alert
      tone={ALERT_TONE[toast.tone]}
      data-toast-tone={toast.tone}
      className="pointer-events-auto bg-surface shadow-overlay"
      action={
        <div className="flex gap-3xs">
          {action !== undefined && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                action.onAction();
                onDismiss();
              }}
            >
              {action.label}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onDismiss}>
            {t('toast.dismiss')}
          </Button>
        </div>
      }
    >
      {toast.tone === 'failure' ? message(toast.failure) : toast.message}
    </Alert>
  );
}

/**
 * Where a host's toasts render, each through {@link Alert}: a failure is
 * `role="alert"` and every other tone `role="status"`.
 *
 * ⚠️ **An empty region takes no room and no clicks.** It stays mounted, so a
 * toast lands in a region that already exists, but at zero size and with
 * `pointer-events: none` — a fixed box that kept its padding once covered two
 * focused links and swallowed clicks (WCAG 2.4.11). While toasts show, the
 * document's bottom scroll padding is the region's height, so a control
 * focused by keyboard scrolls clear of it. F6 moves focus into the region.
 */
export function ToastRegion() {
  const toasts = useToasts();
  const t = useT();
  const region = useRef<HTMLElement>(null);
  const shown = toasts?.toasts ?? [];
  const count = shown.length;

  useEffect(() => {
    const root = document.documentElement;
    if (count === 0) {
      root.style.removeProperty('scroll-padding-bottom');
      return;
    }
    // The region renders whenever a toast can: the ref is set by now.
    const node = region.current as HTMLElement;
    root.style.setProperty('scroll-padding-bottom', `${node.offsetHeight}px`);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F6') return;
      event.preventDefault();
      node.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [count]);

  if (toasts === undefined) return null;
  return (
    <section
      ref={region}
      aria-label={t('toast.region')}
      tabIndex={-1}
      data-testid="toast-region"
      className={cn(
        'bottom-0 right-0 pointer-events-none fixed z-(--z-toast) flex flex-col gap-xs focus-ring',
        count === 0 ? 'size-0 overflow-hidden' : 'max-w-md w-full p-s',
      )}
    >
      {shown.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => toasts.dismiss(toast.id)}
        />
      ))}
    </section>
  );
}
