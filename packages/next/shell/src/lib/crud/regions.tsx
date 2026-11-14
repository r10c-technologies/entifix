'use client';

import type { EntityDraft, EntityFieldDescriptor } from '@entifix/core';
import { ActiveSection, linkClassName, useT } from '@entifix/react-controls';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

/**
 * The query parameter prefix a create page reads a member's starting value
 * from — `?prefill.customerId=c-1` — so a related region's "New" opens with
 * the parent record already set.
 */
export const PREFILL_PARAM = 'prefill.';

/**
 * A create page's starting values from its query string: only declared,
 * writable members, and only as the strings a draft holds. Anything else in
 * the query is ignored rather than written into a record.
 */
export function readPrefill(
  params: URLSearchParams | null | undefined,
  descriptors: readonly EntityFieldDescriptor[],
): EntityDraft | undefined {
  const values: Record<string, string> = {};
  for (const [name, value] of params ?? []) {
    if (!name.startsWith(PREFILL_PARAM)) continue;
    const member = name.slice(PREFILL_PARAM.length);
    const descriptor = descriptors.find(entry => entry.name === member);
    if (descriptor === undefined || descriptor.readonly) continue;
    values[member] = value;
  }
  return Object.keys(values).length === 0 ? undefined : values;
}

interface Region {
  readonly id: string;
  readonly heading: string;
}

const RegionsContext = createContext<
  ((region: Region) => () => void) | undefined
>(undefined);

/** Lists a region in the record page's section nav while it is mounted. */
export function useRegion(id: string, heading: string): void {
  const register = useContext(RegionsContext);
  useLayoutEffect(() => register?.({ id, heading }), [register, id, heading]);
}

/**
 * The regions under a record's form, and — once there are two or more — a
 * section nav above them, a `nav` landmark whose anchors mark the region in
 * view. Composes what exists: no new organism.
 */
export function RecordRegions({ children }: { children: ReactNode }) {
  const t = useT('shell');
  const [regions, setRegions] = useState<readonly Region[]>([]);
  const register = useCallback((region: Region) => {
    setRegions(current => [...current, region]);
    return () =>
      setRegions(current => current.filter(entry => entry.id !== region.id));
  }, []);
  const ids = useMemo(() => regions.map(region => region.id), [regions]);

  return (
    <RegionsContext.Provider value={register}>
      {regions.length >= 2 && (
        <nav aria-label={t('regions.nav')}>
          <ul role="list" className="m-0 p-0 flex list-none flex-wrap gap-s">
            {regions.map(region => (
              <li key={region.id}>
                <a
                  href={`#${region.id}`}
                  data-section={region.id}
                  className={linkClassName}
                >
                  {region.heading}
                </a>
              </li>
            ))}
          </ul>
          <ActiveSection sections={ids} />
        </nav>
      )}
      {children}
    </RegionsContext.Provider>
  );
}
