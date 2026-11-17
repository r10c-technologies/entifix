import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntityTable } from './entity-table.js';

@entity({ key: 'memo' })
class Memo implements Entity {
  #id?: EntityId;
  #text?: string;
  #revision?: number;

  @accessor({ type: 'id', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Text' })
  get text(): string | undefined {
    return this.#text;
  }
  set text(value: string | undefined) {
    this.#text = value;
  }

  @accessor({ type: 'revision', label: 'Revision' })
  get revision(): number | undefined {
    return this.#revision;
  }
  set revision(value: number | undefined) {
    this.#revision = value;
  }
}

describe('a table over an entity that declares a revision', () => {
  it('shows a column for every member but the revision', () => {
    const memo = new Memo();
    memo.id = 'm-1';
    memo.text = 'hello';
    memo.revision = 4;

    render(
      <EntityTable
        entityConstructor={Memo}
        items={[memo]}
        isLoading={false}
        totalItems={1}
        currentPage={1}
        pageSize={10}
        onPageChange={() => undefined}
      />,
    );

    expect(screen.getAllByText('Text').length).toBeGreaterThan(0);
    expect(screen.queryByText('Revision')).toBeNull();
  });
});
