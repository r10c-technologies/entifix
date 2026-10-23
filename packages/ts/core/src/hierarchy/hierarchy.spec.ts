import {
  accessor,
  ancestorsOf,
  buildTree,
  cloneEntityDraft,
  depthOf,
  descendantsOf,
  describeEntityColumns,
  EntifixBuildError,
  Entity,
  entity,
  EntityId,
  flattenTree,
  type HierarchyKeys,
  hierarchyOf,
  wouldCycle,
} from '../index.js';

/** A plain row, so the walks are tested apart from any entity. */
interface Row {
  readonly id: string;
  readonly parent?: string;
}

const keys: HierarchyKeys<Row> = {
  idOf: row => row.id,
  parentOf: row => row.parent,
};

//   home
//   ├── lighting
//   │   ├── desk
//   │   └── floor
//   └── kitchen
//   garden
const ROWS: Row[] = [
  { id: 'home' },
  { id: 'lighting', parent: 'home' },
  { id: 'desk', parent: 'lighting' },
  { id: 'floor', parent: 'lighting' },
  { id: 'kitchen', parent: 'home' },
  { id: 'garden' },
];

const ids = (rows: readonly Row[]) => rows.map(row => row.id);

describe('buildTree and flattenTree', () => {
  it('lays the records out depth first, each followed by its subtree', () => {
    const rows = flattenTree(buildTree(ROWS, keys), keys);

    expect(rows.map(row => [row.item.id, row.depth])).toEqual([
      ['home', 0],
      ['lighting', 1],
      ['desk', 2],
      ['floor', 2],
      ['kitchen', 1],
      ['garden', 0],
    ]);
  });

  it('says which rows have children, and the path above each', () => {
    const rows = flattenTree(buildTree(ROWS, keys), keys);
    const desk = rows.find(row => row.item.id === 'desk');

    expect(rows.find(row => row.item.id === 'lighting')?.hasChildren).toBe(
      true,
    );
    expect(desk?.hasChildren).toBe(false);
    expect(desk?.path).toEqual(['home', 'lighting']);
  });

  it('keeps siblings in the order they came in', () => {
    const reversed = [...ROWS].reverse();
    const rows = flattenTree(buildTree(reversed, keys), keys);

    expect(rows.map(row => row.item.id).slice(0, 2)).toEqual([
      'garden',
      'home',
    ]);
  });

  /** A page holds children whose parent is on another page. */
  it('makes a record whose parent is missing a root', () => {
    const tree = buildTree([{ id: 'desk', parent: 'lighting' }], keys);

    expect(tree.roots.map(root => root.item.id)).toEqual(['desk']);
  });

  it('reads an empty parent as none', () => {
    const tree = buildTree([{ id: 'a', parent: '' }], keys);

    expect(tree.roots).toHaveLength(1);
  });

  /** Returned rather than dropped: a vanished row is a defect nobody sees. */
  it('returns the records on a cycle as detached', () => {
    const tree = buildTree(
      [{ id: 'root' }, { id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }],
      keys,
    );

    expect(tree.roots.map(root => root.item.id)).toEqual(['root']);
    expect(ids(tree.detached)).toEqual(['a', 'b']);
  });
});

describe('ancestorsOf', () => {
  it('walks up to the root, root first, without the record itself', () => {
    expect(ids(ancestorsOf(ROWS, keys, 'desk'))).toEqual(['home', 'lighting']);
  });

  it('is empty for a root, and for a key it does not hold', () => {
    expect(ancestorsOf(ROWS, keys, 'home')).toEqual([]);
    expect(ancestorsOf(ROWS, keys, 'nowhere')).toEqual([]);
  });

  it('stops at a parent the set does not hold', () => {
    expect(ancestorsOf([{ id: 'desk', parent: 'gone' }], keys, 'desk')).toEqual(
      [],
    );
  });

  it('terminates on a cycle', () => {
    const cyclic: Row[] = [
      { id: 'a', parent: 'b' },
      { id: 'b', parent: 'c' },
      { id: 'c', parent: 'a' },
    ];

    expect(ids(ancestorsOf(cyclic, keys, 'a'))).toEqual(['c', 'b']);
  });
});

describe('descendantsOf', () => {
  it('names every record under a key, at any depth', () => {
    expect(descendantsOf(ROWS, keys, 'home').sort()).toEqual(
      ['desk', 'floor', 'kitchen', 'lighting'].sort(),
    );
  });

  it('is empty for a leaf', () => {
    expect(descendantsOf(ROWS, keys, 'desk')).toEqual([]);
  });

  it('terminates on a cycle, and never names the key itself', () => {
    const cyclic: Row[] = [
      { id: 'a', parent: 'b' },
      { id: 'b', parent: 'a' },
    ];

    expect(descendantsOf(cyclic, keys, 'a')).toEqual(['b']);
  });
});

describe('wouldCycle', () => {
  it('refuses the record itself as its own parent', () => {
    expect(wouldCycle(ROWS, keys, 'lighting', 'lighting')).toBe(true);
  });

  it('refuses a descendant as the parent', () => {
    expect(wouldCycle(ROWS, keys, 'home', 'desk')).toBe(true);
  });

  it('accepts anything else, and no parent at all', () => {
    expect(wouldCycle(ROWS, keys, 'desk', 'garden')).toBe(false);
    expect(wouldCycle(ROWS, keys, 'desk', undefined)).toBe(false);
    expect(wouldCycle(ROWS, keys, 'desk', '')).toBe(false);
  });
});

describe('depthOf', () => {
  it('counts a root as 1', () => {
    expect(depthOf(ROWS, keys, 'home')).toBe(1);
    expect(depthOf(ROWS, keys, 'desk')).toBe(3);
  });
});

@entity({ key: 'folder' })
class Folder implements Entity {
  #id?: EntityId;
  #parentId?: string;
  #name = '';

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'id', alias: 'parent', parent: true })
  get parentId(): string | undefined {
    return this.#parentId;
  }
  set parentId(value: string | undefined) {
    this.#parentId = value;
  }

  @accessor({ type: 'string' })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }
}

@entity({ key: 'flat' })
class Flat implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

describe('hierarchyOf', () => {
  it('reads the declared parent member by its wire key', () => {
    const folderKeys = hierarchyOf(Folder);

    expect(folderKeys?.idOf({ id: 'f-2', parent: 'f-1' } as never)).toBe('f-2');
    expect(folderKeys?.parentOf({ id: 'f-2', parent: 'f-1' } as never)).toBe(
      'f-1',
    );
    expect(folderKeys?.parentOf({ id: 'f-1' } as never)).toBeUndefined();
  });

  it('is undefined for an entity that declares no parent', () => {
    expect(hierarchyOf(Flat)).toBeUndefined();
  });

  it('refuses two parent members', () => {
    class TwoParents {
      @accessor({ type: 'id', parent: true })
      get a(): string {
        return '';
      }
      @accessor({ type: 'id', parent: true })
      get b(): string {
        return '';
      }
    }

    expect(() => hierarchyOf(TwoParents)).toThrow(/one parent member at most/);
    expect(() => describeEntityColumns(TwoParents)).toThrow(EntifixBuildError);
  });

  /** A hidden member is never serialized: the tree would arrive flat. */
  it('refuses a hidden parent', () => {
    class HiddenParent {
      @accessor({ type: 'id', parent: true, hidden: true })
      get up(): string {
        return '';
      }
    }

    expect(() => hierarchyOf(HiddenParent)).toThrow(/never serialized/);
    expect(() => describeEntityColumns(HiddenParent)).toThrow(
      /never serialized/,
    );
  });

  it('refuses a readonly parent, which is not serialized either', () => {
    class ReadonlyParent {
      @accessor({ type: 'id', parent: true, readonly: true })
      get up(): string {
        return '';
      }
    }

    expect(() => describeEntityColumns(ReadonlyParent)).toThrow(
      /is readonly — such a member is never serialized/,
    );
  });

  it('refuses a parent that cannot name a record', () => {
    class NumberParent {
      @accessor({ type: 'number', parent: true })
      get up(): number {
        return 0;
      }
    }

    expect(() => hierarchyOf(NumberParent)).toThrow(/cannot be the parent/);
    expect(() => describeEntityColumns(NumberParent)).toThrow(
      /cannot be the parent/,
    );
  });

  it('marks the parent on the described member', () => {
    class Visible {
      @accessor({ type: 'string', parent: true })
      get up(): string {
        return '';
      }
    }

    expect(describeEntityColumns(Visible)[0]?.parent).toBe(true);
    // No alias: the member is read by its own name.
    expect(hierarchyOf(Visible)?.parentOf({ up: 'x' } as never)).toBe('x');
  });

  it('reads an unsaved record and a null parent as no key', () => {
    const folderKeys = hierarchyOf(Folder);

    expect(folderKeys?.idOf({} as never)).toBe('');
    expect(folderKeys?.parentOf({ parent: null } as never)).toBeUndefined();
  });
});

describe('cloning a node', () => {
  /** A copy of a node is its sibling; a copy that became a root moved. */
  it('keeps the parent, and resets the identity', () => {
    expect(
      cloneEntityDraft(Folder, { id: 'f-2', parentId: 'f-1', name: 'Docs' }),
    ).toEqual({ id: '', parentId: 'f-1', name: 'Docs' });
  });
});
