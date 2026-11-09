import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HotkeyScopeProvider,
  resetHotkeysForTesting,
  useHotkey,
} from './use-hotkey.js';

function Bound({
  chords,
  onFire,
  ifFree,
  enabled,
}: {
  chords: string[];
  onFire: () => void;
  ifFree?: boolean;
  enabled?: boolean;
}) {
  useHotkey(chords, onFire, { ifFree, enabled });
  return <input aria-label="field" />;
}

const press = (key: string, init: KeyboardEventInit = {}, target?: Element) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? document).dispatchEvent(event);
  return event;
};

afterEach(() => resetHotkeysForTesting());

describe('useHotkey', () => {
  it('fires on its chord with ⌘ or Ctrl, and prevents the browser’s own', () => {
    const onFire = vi.fn();
    render(<Bound chords={['Mod+K', 'Mod+Shift+P']} onFire={onFire} />);

    expect(press('k', { metaKey: true }).defaultPrevented).toBe(true);
    press('K', { ctrlKey: true });
    press('p', { ctrlKey: true, shiftKey: true });
    press('k');
    press('k', { ctrlKey: true, shiftKey: true });
    press('k', { ctrlKey: true, altKey: true });

    expect(onFire).toHaveBeenCalledTimes(3);
  });

  it('fires inside a text field: a chord is never typing', () => {
    const onFire = vi.fn();
    const { getByLabelText } = render(
      <Bound chords={['Mod+S']} onFire={onFire} />,
    );

    press('s', { ctrlKey: true }, getByLabelText('field'));

    expect(onFire).toHaveBeenCalledOnce();
  });

  it('refuses a chord no reader can use, when it is bound', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Bound chords={['S']} onFire={vi.fn()} />)).toThrow(
      /holds Mod/,
    );
  });

  it('refuses a second binding of a chord in one scope', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <>
          <Bound chords={['Mod+S']} onFire={vi.fn()} />
          <Bound chords={['Mod+S']} onFire={vi.fn()} />
        </>,
      ),
    ).toThrow(/Mod\+S is already bound here/);
  });

  it('yields a default to a binding already there', () => {
    const host = vi.fn();
    const fallback = vi.fn();
    render(
      <>
        <Bound chords={['Mod+S']} onFire={host} />
        <Bound chords={['Mod+S', 'Mod+Enter']} onFire={fallback} ifFree />
      </>,
    );

    press('s', { ctrlKey: true });
    press('Enter', { ctrlKey: true });

    expect(host).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('binds nothing when every chord is taken, or while disabled', () => {
    const fallback = vi.fn();
    render(
      <>
        <Bound chords={['Mod+S']} onFire={vi.fn()} />
        <Bound chords={['Mod+S']} onFire={fallback} ifFree />
        <Bound chords={['Mod+J']} onFire={fallback} enabled={false} />
      </>,
    );

    press('s', { ctrlKey: true });
    press('j', { ctrlKey: true });

    expect(fallback).not.toHaveBeenCalled();
  });

  it('scopes a tab’s chords to the active tab, and lets two tabs hold one chord', () => {
    const first = vi.fn();
    const second = vi.fn();
    const tabs = (active: 'a' | 'b') => (
      <>
        <HotkeyScopeProvider value={{ id: 'a', active: active === 'a' }}>
          <Bound chords={['Mod+S']} onFire={first} />
        </HotkeyScopeProvider>
        <HotkeyScopeProvider value={{ id: 'b', active: active === 'b' }}>
          <Bound chords={['Mod+S']} onFire={second} />
        </HotkeyScopeProvider>
      </>
    );
    const { rerender } = render(tabs('a'));
    press('s', { ctrlKey: true });
    rerender(tabs('b'));
    press('s', { ctrlKey: true });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('refuses a page chord a tab already holds, and a tab chord the page holds', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <>
          <HotkeyScopeProvider value={{ id: 'a', active: true }}>
            <Bound chords={['Mod+K']} onFire={vi.fn()} />
          </HotkeyScopeProvider>
          <Bound chords={['Mod+K']} onFire={vi.fn()} />
        </>,
      ),
    ).toThrow(/already bound/);
    resetHotkeysForTesting();
    expect(() =>
      render(
        <>
          <Bound chords={['Mod+J']} onFire={vi.fn()} />
          <HotkeyScopeProvider value={{ id: 'b', active: true }}>
            <Bound chords={['Mod+J']} onFire={vi.fn()} />
          </HotkeyScopeProvider>
        </>,
      ),
    ).toThrow(/already bound/);
  });

  it('frees its chords when it unmounts', () => {
    const { unmount } = render(<Bound chords={['Mod+S']} onFire={vi.fn()} />);
    unmount();
    const again = vi.fn();
    render(<Bound chords={['Mod+S']} onFire={again} />);

    press('s', { ctrlKey: true });
    expect(again).toHaveBeenCalledOnce();
  });
});
