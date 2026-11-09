'use client';

import { createContext, type ReactNode, useContext } from 'react';

import { useTranslateKey } from '../../i18n/index.js';

/** What a host can do about a failure, by the failure's `code`. */
export type ErrorActions = Readonly<Record<string, () => void>>;

const ErrorActionsContext = createContext<ErrorActions>({});

/**
 * Registers the host's next step for each failure code it can resolve —
 * "Choose organization" for `noActiveOrganization` — so a region or a toast
 * showing that failure can offer it ([ADR 0028](../../../../../../docs/adr/0028-states-an-organism-must-render.md)).
 */
export function ErrorActionsProvider({
  actions,
  children,
}: {
  actions: ErrorActions;
  children: ReactNode;
}) {
  return (
    <ErrorActionsContext.Provider value={actions}>
      {children}
    </ErrorActionsContext.Provider>
  );
}

/** A failure as the organisms hold it. */
interface CodedFailure {
  code?: unknown;
  details?: Record<string, unknown>;
}

/** The action a failure offers: its label, and what it does. */
export interface ErrorAction {
  readonly label: string;
  readonly onAction: () => void;
}

/**
 * The next step for a failure, or `undefined`. Offered only when **both**
 * exist: a handler the host registered for the failure's code, and the
 * catalog's `errors:<code>Action` to name it — the code stays the catalog key,
 * so a button never shows a key, and copy without a handler never shows a
 * button that does nothing.
 */
export function useErrorAction(): (
  failure: CodedFailure | undefined,
) => ErrorAction | undefined {
  const actions = useContext(ErrorActionsContext);
  const translateKey = useTranslateKey();
  return failure => {
    const code =
      typeof failure?.code === 'string'
        ? failure.code
        : failure?.details?.['code'];
    if (typeof code !== 'string') return undefined;
    const onAction = actions[code];
    if (onAction === undefined) return undefined;
    // A missing key comes back as itself, without its namespace.
    const label = translateKey(`errors:${code}Action`);
    return label === `${code}Action` ? undefined : { label, onAction };
  };
}
