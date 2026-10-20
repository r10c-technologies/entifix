import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import type {
  Entity,
  EntityConstructor,
  EntityId,
} from '../../types/Entity.js';
import {
  COLLECTION_TYPES,
  describeEntityColumns,
  type EntityFieldDescriptor,
} from '../describe/index.js';
import { extractMetaEntity } from '../helpers/index.js';

/**
 * Records checked against their entity's metadata before anything serves them.
 *
 * The mapping does not do this, on purpose: `deserializeSingleEntity` assigns
 * every non-relation value raw — it converts no date, enforces no `required`,
 * validates no enum value and resolves no link id — because a record off a
 * database was written through that same mapping and needs none of it. Records
 * that arrive as **untyped JSON** — files bundled with a static build, an
 * import, a seed — have had no such guarantee, and a wrong one reaches a reader
 * as `undefined` in the middle of a page, or as a string where a `Date` was
 * expected. This is the check those records go through.
 *
 * It sits in core, beside the deserializer it makes up for, so every adapter
 * that reads untyped records shares it — and the generated form judges a
 * draft by the same metadata, so a record a form refuses is one this refuses.
 *
 * Every problem is collected rather than the first thrown, each with the path
 * to its value: `employment.json › acme › role is required, and is missing`.
 */

export interface RecordProblem {
  /** `<source> › <id> › <member>`, as far as each is known. */
  readonly path: string;
  readonly message: string;
}

/** Thrown by {@link validRecordsOrThrow}. Carries every problem found. */
export class RecordValidationError extends EntifixBuildError {
  readonly problems: readonly RecordProblem[];

  constructor(problems: readonly RecordProblem[]) {
    super(
      `Records are invalid:\n${problems
        .map(problem => `  ${problem.path} ${problem.message}`)
        .join('\n')}`,
      undefined,
      { count: problems.length },
    );
    this.problems = problems;
  }
}

/**
 * A check one entity needs that metadata cannot express — at most one contact
 * channel per type, say. Handed every record (dates already parsed) and a way
 * to report against one of them by index.
 */
export type EntityRecordRule = (
  records: ReadonlyArray<Readonly<Record<string, unknown>>>,
  report: (index: number, member: string | undefined, message: string) => void,
) => void;

export interface ValidateRecordsOptions {
  /** Where the records came from, for the path in a message. */
  readonly source?: string;
  /**
   * The ids that exist for each `link` or `linkCollection` member, by member
   * name. A member left out is checked for shape only.
   */
  readonly linkTargets?: Readonly<Record<string, ReadonlySet<EntityId>>>;
  /** Checks of the caller's own, run after the metadata's. */
  readonly rules?: readonly EntityRecordRule[];
}

export interface ValidateRecordsResult {
  readonly problems: readonly RecordProblem[];
  /**
   * The records with every `date` member parsed into a `Date`, ready for the
   * mapping. Meaningless when `problems` is not empty.
   */
  readonly records: ReadonlyArray<Record<string, unknown>>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isAbsent = (value: unknown): boolean =>
  value === undefined || value === null || value === '';

type Report = (member: string | undefined, message: string) => void;

const counted = (n: number, noun: string) =>
  `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A date member, parsed: the mapping would leave it a string. */
function parseDate(
  value: unknown,
  report: Report,
  member: string,
): Date | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) report(member, 'is an invalid date');
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    report(member, `holds a ${typeof value}, not a date`);
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    report(member, `is not a date: ${JSON.stringify(value)}`);
    return undefined;
  }
  return parsed;
}

/** A relation: ids, or embedded records, and ids that exist. */
function checkLink(
  value: unknown,
  descriptor: EntityFieldDescriptor,
  known: ReadonlySet<EntityId> | undefined,
  report: Report,
): void {
  const isCollection = descriptor.type === 'linkCollection';
  if (isCollection && !Array.isArray(value)) {
    report(descriptor.name, 'is not a list');
    return;
  }
  for (const id of isCollection ? (value as unknown[]) : [value]) {
    if (isPlainObject(id)) continue; // An embedded record carries its own.
    if (typeof id !== 'string' && typeof id !== 'number') {
      report(descriptor.name, `holds a ${typeof id} where an id was expected`);
    } else if (known !== undefined && !known.has(id)) {
      report(
        descriptor.name,
        `points at ${JSON.stringify(id)}, which does not exist`,
      );
    }
  }
}

/** A scalar: the type the metadata declares. */
function checkScalar(
  value: unknown,
  descriptor: EntityFieldDescriptor,
  report: Report,
): void {
  switch (descriptor.type) {
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        report(descriptor.name, `holds ${JSON.stringify(value)}, not a number`);
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        report(
          descriptor.name,
          `holds ${JSON.stringify(value)}, not a boolean`,
        );
      }
      return;
    case 'enum':
      if (!descriptor.enumValues?.includes(value as string)) {
        report(
          descriptor.name,
          `holds ${JSON.stringify(value)}, which is not one of ${JSON.stringify(
            descriptor.enumValues ?? [],
          )}`,
        );
      }
      return;
    case 'scalarCollection':
    case 'composition':
      if (!Array.isArray(value)) report(descriptor.name, 'is not a list');
      return;
    default:
      // `string` and `id`, the two that carry text.
      if (typeof value !== 'string' && typeof value !== 'number') {
        report(descriptor.name, `holds a ${typeof value}, not text`);
      }
  }
}

/** `minItems` / `maxItems` on a collection that is present and is a list. */
function checkItemCount(
  value: unknown,
  descriptor: EntityFieldDescriptor,
  report: Report,
): void {
  if (!Array.isArray(value)) return;
  const { minItems, maxItems } = descriptor;
  if (minItems !== undefined && value.length < minItems) {
    report(
      descriptor.name,
      `holds ${counted(value.length, 'item')}, and needs at least ${minItems}`,
    );
  }
  if (maxItems !== undefined && value.length > maxItems) {
    report(
      descriptor.name,
      `holds ${counted(value.length, 'item')}, and takes at most ${maxItems}`,
    );
  }
}

/**
 * Checks every record of one entity against its metadata — identity, `required`,
 * each member's type, link ids, item counts, `notBefore`, and the entity's
 * cardinality — then runs the caller's rules.
 */
export function validateRecords<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  records: readonly unknown[],
  { source, linkTargets = {}, rules = [] }: ValidateRecordsOptions = {},
): ValidateRecordsResult {
  const problems: RecordProblem[] = [];
  const descriptors = describeEntityColumns(entityConstructor);
  const parsed: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();

  const at = (where: string, member: string | undefined, message: string) =>
    problems.push({
      path: [source, where, member].filter(Boolean).join(' › '),
      message,
    });

  records.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      at(`#${index}`, undefined, 'is not a record');
      return;
    }

    const id = raw['id'];
    const report: Report = (member, message) =>
      at(isAbsent(id) ? `#${index}` : String(id), member, message);

    if (isAbsent(id)) {
      report('id', 'is missing');
    } else if (seen.has(id)) {
      report('id', 'is used more than once');
    } else {
      seen.add(id);
    }

    const record: Record<string, unknown> = { ...raw };

    for (const descriptor of descriptors) {
      if (descriptor.name === 'id') continue;
      const value = raw[descriptor.key];

      if (isAbsent(value)) {
        if (descriptor.required) {
          report(descriptor.name, 'is required, and is missing');
        }
        continue;
      }

      if (descriptor.type === 'link' || descriptor.type === 'linkCollection') {
        checkLink(value, descriptor, linkTargets[descriptor.name], report);
      } else if (descriptor.type === 'date') {
        const date = parseDate(value, report, descriptor.name);
        if (date !== undefined) record[descriptor.key] = date;
      } else {
        checkScalar(value, descriptor, report);
      }

      if (COLLECTION_TYPES.includes(descriptor.type)) {
        checkItemCount(value, descriptor, report);
      }
    }

    for (const descriptor of descriptors) {
      if (descriptor.notBefore === undefined) continue;
      const earlier = descriptors.find(
        other => other.name === descriptor.notBefore,
      ) as EntityFieldDescriptor;
      const end = record[descriptor.key];
      const start = record[earlier.key];
      if (start instanceof Date && end instanceof Date && end < start) {
        report(descriptor.name, `is before ${earlier.name}`);
      }
    }

    parsed.push(record);
  });

  const { cardinality, name } = extractMetaEntity(entityConstructor);
  const where = `${counted(records.length, 'record')}`;
  if (cardinality?.min !== undefined && records.length < cardinality.min) {
    at(name, undefined, `has ${where}, and needs at least ${cardinality.min}`);
  }
  if (cardinality?.max !== undefined && records.length > cardinality.max) {
    at(name, undefined, `has ${where}, and takes at most ${cardinality.max}`);
  }

  for (const rule of rules) {
    rule(parsed, (index, member, message) => {
      const id = parsed[index]?.['id'];
      at(isAbsent(id) ? `#${index}` : String(id), member, message);
    });
  }

  return { problems, records: parsed };
}

/** The records with their dates parsed, or a {@link RecordValidationError}. */
export function validRecordsOrThrow<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  records: readonly unknown[],
  options?: ValidateRecordsOptions,
): ReadonlyArray<Record<string, unknown>> {
  const result = validateRecords(entityConstructor, records, options);
  if (result.problems.length > 0) {
    throw new RecordValidationError(result.problems);
  }
  return result.records;
}
