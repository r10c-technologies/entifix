import { EntifixLogicError } from '@entifix/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineRoleLadder, type RoleOf } from './role.js';

/**
 * A ladder of this spec's own. Not any host's: the point of the definition is
 * that the rule holds over whatever rungs a host names, so the spec names some.
 */
const ladder = defineRoleLadder(['member', 'editor', 'owner'] as const);

describe('defineRoleLadder', () => {
  it('ranks the rungs in the order they were given', () => {
    expect(ladder.roles).toEqual(['member', 'editor', 'owner']);
    expect(ladder.rank).toEqual({ member: 0, editor: 1, owner: 2 });
  });

  it('defaults to the lowest rung, or to the rung it is told', () => {
    expect(ladder.defaultRole).toBe('member');
    expect(
      defineRoleLadder(['guest', 'member'] as const, { defaultRole: 'member' })
        .defaultRole,
    ).toBe('member');
  });

  it('types the role union from the tuple', () => {
    expectTypeOf<RoleOf<typeof ladder>>().toEqualTypeOf<
      'member' | 'editor' | 'owner'
    >();
  });

  it('holds over a second ladder with different rungs', () => {
    const other = defineRoleLadder(['user', 'admin', 'super-admin'] as const);

    expect(other.canAssignRole(['admin'], 'admin')).toBe(true);
    expect(other.canAssignRole(['admin'], 'super-admin')).toBe(false);
    expect(other.isRole('owner')).toBe(false);
  });

  describe('refuses a ladder that makes rank meaningless', () => {
    it('with no rungs', () => {
      expect(() =>
        defineRoleLadder([] as unknown as readonly [string, ...string[]]),
      ).toThrow(EntifixLogicError);
    });

    it('with a repeated rung', () => {
      expect(() =>
        defineRoleLadder(['member', 'owner', 'member'] as const),
      ).toThrow(/repeated: member/);
    });

    it('with a default that is not a rung', () => {
      expect(() =>
        defineRoleLadder(['member'] as const, {
          defaultRole: 'owner' as 'member',
        }),
      ).toThrow(/not a rung/);
    });
  });
});

describe('a ladder', () => {
  describe('isRole', () => {
    it('accepts a rung', () => {
      expect(ladder.isRole('editor')).toBe(true);
    });

    it('rejects an unknown string', () => {
      expect(ladder.isRole('root')).toBe(false);
    });

    it('rejects an inherited property name', () => {
      expect(ladder.isRole('toString')).toBe(false);
    });

    it('rejects a non-string', () => {
      expect(ladder.isRole(1)).toBe(false);
    });
  });

  describe('highestRank', () => {
    it('takes the highest recognised rung', () => {
      expect(ladder.highestRank(['member', 'owner', 'editor'])).toBe(
        ladder.rank.owner,
      );
    });

    it('ignores unrecognised roles', () => {
      expect(ladder.highestRank(['root', 'editor'])).toBe(ladder.rank.editor);
    });

    it('is -1 with nothing it recognises', () => {
      expect(ladder.highestRank([])).toBe(-1);
      expect(ladder.highestRank(['root'])).toBe(-1);
    });
  });

  describe('canAssignRole', () => {
    it('lets a rung assign itself', () => {
      expect(ladder.canAssignRole(['editor'], 'editor')).toBe(true);
    });

    it('lets a rung assign below itself', () => {
      expect(ladder.canAssignRole(['editor'], 'member')).toBe(true);
    });

    it('never lets a rung assign above itself', () => {
      expect(ladder.canAssignRole(['editor'], 'owner')).toBe(false);
      expect(ladder.canAssignRole(['member'], 'editor')).toBe(false);
    });

    it('lets the top rung assign the top rung', () => {
      expect(ladder.canAssignRole(['owner'], 'owner')).toBe(true);
    });

    it('lets a caller with no roles assign nothing', () => {
      expect(ladder.canAssignRole([], 'member')).toBe(false);
    });
  });
});
