import {
  ToastProvider,
  ToastRegion,
  useLiveUpdates,
} from '@entifix/react-controls';
import { makeInMemoryPushChannel } from '@entifix/react-integration';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PendingFlowsProvider } from './pending-flows.js';
import { ANONYMOUS_WORKSPACE_SCOPE } from './workspace-scope.js';

function Connection() {
  const live = useLiveUpdates();
  return <span data-testid="connection">{live.connection}</span>;
}

describe('PendingFlowsProvider', () => {
  it('publishes its channel’s connection to the controls below it', () => {
    const channel = makeInMemoryPushChannel();
    const storage = { getItem: () => null, setItem: () => undefined };
    render(
      <ToastProvider>
        <PendingFlowsProvider
          scope={ANONYMOUS_WORKSPACE_SCOPE}
          channel={channel}
          storage={storage}
        >
          <Connection />
        </PendingFlowsProvider>
        <ToastRegion />
      </ToastProvider>,
    );
    expect(screen.getByTestId('connection')).toHaveTextContent('open');

    act(() => channel.drop('closed'));
    expect(screen.getByTestId('connection')).toHaveTextContent('closed');
  });
});
