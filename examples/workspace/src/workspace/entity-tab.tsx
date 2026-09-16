'use client';

import { screenAddress } from '@entifix/authz';
import type { EntityCrudSingleViewProps } from '@entifix/next-shell';
import { useEntityDraft, useTabEntityNav } from '@entifix/next-shell';
import type { ReactElement } from 'react';

/**
 * A generated single view hosted in a workspace tab, with autosave.
 *
 * `useEntityDraft` is the whole of it: every edit is written to IndexedDB under
 * the tab's own address, the form seeds from that draft on mount, and a real
 * Save or Delete clears it. The workspace reads the same store to mark the tab
 * dirty and to confirm before closing it.
 */
export function EntityEditorTab({
  entityKey,
  id,
  Page,
}: {
  entityKey: string;
  id: string;
  Page: (props?: EntityCrudSingleViewProps) => ReactElement;
}) {
  const nav = useTabEntityNav();
  const draft = useEntityDraft(
    screenAddress({ type: 'master', key: entityKey, id }),
  );
  const done = () => nav.toList(entityKey);

  return <Page slug={id} draft={draft} onSaved={done} onDeleted={done} />;
}
