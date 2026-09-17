import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEntityNavHost } from './entity-nav.js';
import { entityTabKind, type EntityTabScreens } from './entity-tab-kind.js';
import { useTabsState } from './tabs-state.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const screens: EntityTabScreens = {
  lists: { widget: { titleKey: 'entity:widget.plural', render: () => 'list' } },
  records: {
    widget: {
      labelKey: 'entity:widget.label',
      render: id => `record ${id}`,
    },
  },
};

const translate = (key: string) => `t(${key})`;

describe('entityTabKind', () => {
  it('takes its kind from the screen type, so two types are two kinds', () => {
    expect(entityTabKind('master', screens).kind).toBe('master');
    expect(entityTabKind('operation', screens).kind).toBe('operation');
  });

  describe('a list address', () => {
    const kind = entityTabKind('operation', screens);

    it('matches, titles from the plural and renders the list', () => {
      const addr = kind.match('widget');

      expect(addr).toEqual({ key: 'widget' });
      expect(kind.title(addr!, translate)).toBe('t(entity:widget.plural)');
      render(<>{kind.render(addr!)}</>);
      expect(screen.getByText('list')).toBeInTheDocument();
      expect(kind.toParam(addr!)).toBe('widget');
    });
  });

  describe('a record address', () => {
    const kind = entityTabKind('operation', screens);

    it('matches, titles from the label and renders the record', () => {
      const addr = kind.match('widget:abc');

      expect(addr).toEqual({ key: 'widget', id: 'abc' });
      expect(kind.title(addr!, translate)).toBe('t(entity:widget.label) #abc');
      render(<>{kind.render(addr!)}</>);
      expect(screen.getByText('record abc')).toBeInTheDocument();
      expect(kind.toParam(addr!)).toBe('widget:abc');
    });
  });

  // #20: a page rendered in a tab must navigate by tab, and by a tab of its own
  // kind — an Operaciones record opened as `master:` resolves to nothing.
  describe('the navigation it provides', () => {
    beforeEach(() => {
      useTabsState.setState({ tabs: [], activeParam: undefined } as never);
    });

    function Probe() {
      const host = useEntityNavHost();
      return (
        <button type="button" onClick={() => host?.toEntity('widget', 'w-7')}>
          {host === undefined ? 'no host' : 'host'}
        </button>
      );
    }

    it('mounts a tab host of its own screen type around what it renders', () => {
      const kind = entityTabKind('operation', {
        lists: {
          widget: { titleKey: 'entity:widget.plural', render: () => <Probe /> },
        },
        records: {},
      });

      render(<>{kind.render({ key: 'widget' })}</>);
      act(() => screen.getByRole('button', { name: 'host' }).click());

      expect(useTabsState.getState().tabs.map(tab => tab.param)).toContain(
        'operation:widget:w-7',
      );
    });

    it('titles a create form as new rather than as a record called "new"', () => {
      const kind = entityTabKind('master', screens);

      expect(kind.title({ key: 'widget', id: 'new' }, translate)).toBe(
        't(entity:widget.label) · t(shell:breadcrumbs.new)',
      );
    });
  });

  describe('what it refuses', () => {
    const kind = entityTabKind('operation', screens);

    it('refuses a key it does not know', () => {
      expect(kind.match('absent')).toBeNull();
      expect(kind.match('absent:abc')).toBeNull();
    });

    it('refuses a malformed payload rather than treating an empty id as present', () => {
      // `widget:` parsing as `{ key: 'widget', id: '' }` would resolve to the
      // record editor for a record with no id.
      expect(kind.match('widget:')).toBeNull();
      expect(kind.match('')).toBeNull();
    });

    it('refuses a record address for a screen that offers only a list', () => {
      const listOnly = entityTabKind('operation', {
        lists: screens.lists,
        records: {},
      });

      expect(listOnly.match('widget')).toEqual({ key: 'widget' });
      expect(listOnly.match('widget:abc')).toBeNull();
    });
  });
});
