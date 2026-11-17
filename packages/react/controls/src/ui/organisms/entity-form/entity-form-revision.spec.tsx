import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityForm } from './entity-form.js';

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

describe('a form over an entity that declares a revision', () => {
  it('draws a field for every member but the revision', () => {
    render(
      <EntityForm<Memo>
        entityConstructor={Memo}
        mode="edit"
        values={{ text: 'hello', revision: '3' }}
        onFieldChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Text')).toBeTruthy();
    expect(screen.queryByLabelText('Revision')).toBeNull();
    expect(screen.queryByText('Revision')).toBeNull();
  });
});
