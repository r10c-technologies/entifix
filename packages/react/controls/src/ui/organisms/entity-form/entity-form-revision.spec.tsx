import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  StaleRevision,
} from '@entifix/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('a form whose save was refused because the record changed', () => {
  const conflicted = (handlers = {}) =>
    render(
      <EntityForm<Memo>
        entityConstructor={Memo}
        mode="edit"
        values={{ text: 'typed', revision: '3' }}
        error={new StaleRevision({ current: 4 })}
        onFieldChange={vi.fn()}
        onSubmit={vi.fn()}
        {...handlers}
      />,
    );

  it('keeps the typed values, announces the conflict and takes focus', () => {
    conflicted();

    expect(screen.getByLabelText('Text')).toHaveValue('typed');
    const conflict = screen.getByTestId('entity-form-conflict');
    expect(conflict).toHaveFocus();
    expect(within(conflict).getByRole('alert')).toBeTruthy();
    // The generic error alert and Retry are not shown beside it.
    expect(screen.queryByTestId('region-state-error')).toBeNull();
  });

  it('offers each choice only when it is handled, and never saves by itself', () => {
    const onSubmit = vi.fn();
    const onKeepMine = vi.fn();
    const onLoadCurrent = vi.fn();
    conflicted({ onSubmit, onKeepMine, onLoadCurrent });

    fireEvent.click(
      screen.getByRole('button', { name: /conservar mis cambios/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /cargar el registro actual/i }),
    );

    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onLoadCurrent).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers no button without a handler', () => {
    conflicted();

    expect(
      screen.queryByRole('button', { name: /conservar mis cambios/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /registro actual/i }),
    ).toBeNull();
  });
});
