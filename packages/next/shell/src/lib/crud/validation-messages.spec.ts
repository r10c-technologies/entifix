import { getServerTFor } from '@entifix/i18n';
import { describe, expect, it } from 'vitest';

import { validationMessagesFor } from './validation-messages.js';

describe('validationMessagesFor', () => {
  it('words every rule from the controls catalog, plurals included', () => {
    const say = validationMessagesFor(getServerTFor('en', 'controls'));

    expect(say.required('Name')).toBe('Name is required');
    expect(say.number('Size')).toBe('Size must be a number');
    expect(say.date('Start')).toBe('Start must be a date');
    expect(say.option('Kind')).toBe('Kind is not a valid option');
    expect(say.minItems('Tags', 1)).toBe('Tags needs at least 1 item');
    expect(say.maxItems('Tags', 3)).toBe('Tags takes at most 3 items');
    expect(say.notBefore('End', 'Start')).toBe('End cannot be before Start');
  });

  it('speaks the catalog it is handed', () => {
    const say = validationMessagesFor(getServerTFor('es', 'controls'));

    expect(say.minItems('Etiquetas', 2)).toBe(
      'Etiquetas necesita al menos 2 elementos',
    );
  });
});
