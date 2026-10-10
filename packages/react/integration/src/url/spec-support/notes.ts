import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

/**
 * Fixtures for this folder's specs, not shipped code: an entity with an id, a
 * title per locale, tags and a date, and three records of it.
 */
@entity({ key: 'note' })
export class Note implements Entity {
  #id?: EntityId;
  #titleEn?: string;
  #titleEs?: string;
  #tags: string[] = [];
  #writtenAt?: Date;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get titleEn(): string | undefined {
    return this.#titleEn;
  }
  set titleEn(value: string | undefined) {
    this.#titleEn = value;
  }

  @accessor({ type: 'string' })
  get titleEs(): string | undefined {
    return this.#titleEs;
  }
  set titleEs(value: string | undefined) {
    this.#titleEs = value;
  }

  @accessor({ type: 'scalarCollection' })
  get tags(): string[] {
    return this.#tags;
  }
  set tags(value: string[]) {
    this.#tags = value;
  }

  @accessor({ type: 'date', sortable: true })
  get writtenAt(): Date | undefined {
    return this.#writtenAt;
  }
  set writtenAt(value: Date | undefined) {
    this.#writtenAt = value;
  }
}

function note(
  id: string,
  en: string,
  es: string,
  tags: string[],
  writtenAt: string,
): Note {
  const record = new Note();
  record.id = id;
  record.titleEn = en;
  record.titleEs = es;
  record.tags = tags;
  record.writtenAt = new Date(writtenAt);
  return record;
}

export const NOTES = [
  note('static', 'Static sites', 'Sitios estaticos', ['web'], '2025-03-01'),
  note('queries', 'Queries', 'Consultas', ['data', 'web'], '2026-01-15'),
  note('effects', 'Effects', 'Efectos', ['data'], '2026-06-30'),
];

/** The member holding a note's title in a locale. */
export const titleIn = (locale: 'en' | 'es') =>
  locale === 'en' ? 'titleEn' : 'titleEs';
