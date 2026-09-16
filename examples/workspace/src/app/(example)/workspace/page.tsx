'use client';

import { ANONYMOUS_WORKSPACE_SCOPE, WorkspaceShell } from '@entifix/next-shell';
import { useT } from '@entifix/react-controls';

import { workspaceRegistry } from '../../../workspace/registry';

/**
 * The tab workspace. Tabs and drafts persist in IndexedDB keyed by `scope`;
 * with no sign-in there is one scope, so every visitor on this browser profile
 * shares one workspace.
 */
export default function WorkspacePage() {
  const t = useT('shell');
  return (
    <WorkspaceShell
      scope={ANONYMOUS_WORKSPACE_SCOPE}
      registry={workspaceRegistry}
      emptyState={<p className="text-content-muted">{t('workspace.empty')}</p>}
      fallback={<p className="text-danger">{t('workspace.unsupported')}</p>}
    />
  );
}
