import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { makeInMemoryPushChannel } from './push-channel.js';
import { usePushConnection } from './use-push-connection.js';

describe('usePushConnection', () => {
  it('follows the stream through a drop and back, and reconnects on request', () => {
    const channel = makeInMemoryPushChannel();
    const { result } = renderHook(() => usePushConnection(channel));
    expect(result.current.connection).toBe('open');

    act(() => channel.drop('reconnecting'));
    expect(result.current.connection).toBe('reconnecting');

    act(() => channel.drop('closed'));
    expect(result.current.connection).toBe('closed');

    act(() => result.current.reconnect());
    expect(result.current.connection).toBe('open');
  });
});

describe('usePushConnection on the server', () => {
  it('reads as open, since a server render has no stream', () => {
    const channel = makeInMemoryPushChannel();
    channel.drop('closed');
    function Probe() {
      return <span>{usePushConnection(channel).connection}</span>;
    }

    expect(renderToString(<Probe />)).toContain('open');
  });
});
