'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

/** Shown for a record's crumb while the record is still being read. */
export const PENDING_CRUMB = '…';

interface BreadcrumbLabels {
  readonly labels: Readonly<Record<string, string>>;
  readonly set: (segment: string, label: string | undefined) => void;
}

const BreadcrumbLabelsContext = createContext<BreadcrumbLabels | undefined>(
  undefined,
);

/**
 * Holds the labels a page knows for its own path segments — a record page
 * knows its record's name, which the shell's breadcrumbs cannot (#200).
 */
export function BreadcrumbLabelsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const set = useCallback((segment: string, label: string | undefined) => {
    setLabels(current => {
      const next = { ...current };
      if (label === undefined) delete next[segment];
      else next[segment] = label;
      return next;
    });
  }, []);
  return (
    <BreadcrumbLabelsContext.Provider value={{ labels, set }}>
      {children}
    </BreadcrumbLabelsContext.Provider>
  );
}

/** The labels pages have given for their segments. */
export const useBreadcrumbLabels = (): Readonly<Record<string, string>> =>
  useContext(BreadcrumbLabelsContext)?.labels ?? {};

/**
 * Names a path segment in the breadcrumbs for as long as the calling page is
 * mounted: a record's id reads as the record. `undefined` while the name is
 * still loading shows a placeholder rather than the id. Outside a shell with
 * breadcrumbs — a workspace tab — it does nothing.
 */
export function useBreadcrumbLabel(
  segment: string | undefined,
  label: string | undefined,
): void {
  const set = useContext(BreadcrumbLabelsContext)?.set;
  useEffect(() => {
    if (set === undefined || segment === undefined) return;
    set(segment, label ?? PENDING_CRUMB);
    return () => set(segment, undefined);
  }, [set, segment, label]);
}
