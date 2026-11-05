import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DescriptionList } from './description-list.js';

describe('DescriptionList', () => {
  it('pairs each term with its description in a real dl', () => {
    const { container } = render(
      <DescriptionList
        items={[
          { term: 'Weight', description: '1,2 kg' },
          { key: 'origin', term: 'Origin', description: 'Guatemala' },
        ]}
      />,
    );
    expect(container.querySelector('dl')).not.toBeNull();
    const terms = [...container.querySelectorAll('dt')].map(
      dt => dt.textContent,
    );
    const values = [...container.querySelectorAll('dd')].map(
      dd => dd.textContent,
    );
    expect(terms).toEqual(['Weight', 'Origin']);
    expect(values).toEqual(['1,2 kg', 'Guatemala']);
  });
});
