import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { button } from './button-recipe.js';
import { SubmitButton } from './submit-button.js';

describe('SubmitButton', () => {
  it('is a submit button wearing the button recipe', () => {
    render(
      <SubmitButton variant="secondary" size="sm" className="extra">
        Save
      </SubmitButton>,
    );
    const submit = screen.getByRole('button', { name: 'Save' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.className).toContain(
      button({ variant: 'secondary', size: 'sm' }),
    );
    expect(submit.className).toContain('extra');
  });
});
