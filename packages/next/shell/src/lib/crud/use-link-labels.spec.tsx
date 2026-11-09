import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LinkLabelCell, targetLabel } from './use-link-labels.js';

describe('LinkLabelCell', () => {
  it('holds a skeleton while the record is read, then names it', () => {
    const { rerender } = render(
      <LinkLabelCell label={{ state: 'resolving' }} />,
    );
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();

    rerender(<LinkLabelCell label={{ state: 'named', label: 'Acme' }} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('reads as empty with no id, or a record with no name', () => {
    const { rerender } = render(<LinkLabelCell label={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(<LinkLabelCell label={{ state: 'unnamed' }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('targetLabel', () => {
  it('reads a localized name in the reader’s locale, and blank as none', () => {
    expect(targetLabel({ es: 'Rojo', en: 'Red' }, 'en')).toBe('Red');
    expect(targetLabel('Acme', 'es')).toBe('Acme');
    expect(targetLabel('', 'es')).toBeUndefined();
    expect(targetLabel(undefined, 'es')).toBeUndefined();
  });
});
