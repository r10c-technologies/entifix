import {
  accessor,
  DuplicateKey,
  type Entity,
  entity,
  type EntityId,
} from '@entifix/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityForm } from './entity-form.js';

@entity({ key: 'part' })
class Part implements Entity {
  #id?: EntityId;
  #name?: string;
  #code?: string;

  @accessor({ type: 'id', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'string', label: 'SKU', unique: true, alias: 'sku' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }
}

const refused = (error: DuplicateKey) =>
  render(
    <EntityForm<Part>
      entityConstructor={Part}
      mode="edit"
      values={{ name: 'Bolt', code: 'B-1' }}
      error={error}
      onFieldChange={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );

describe('a form whose save was refused because a unique value is taken', () => {
  it('shows the refusal on the field it names, by its stored key, and not as a banner', () => {
    refused(new DuplicateKey({ key: 'sku' }));

    const field = screen.getByLabelText('SKU');
    expect(field).toHaveValue('B-1');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByTestId('entity-form-error-summary').textContent,
    ).toContain('SKU');
  });

  it('falls back to the failure banner when the key names no field', () => {
    refused(new DuplicateKey({ key: 'elsewhere' }));

    expect(screen.getByLabelText('SKU')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('entity-form-error-summary')).toBeNull();
  });
});
