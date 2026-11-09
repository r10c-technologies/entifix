import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ASSESSMENT } from './assessment.js';
import {
  buildReport,
  CHAPTERS,
  criteriaOf,
  gateRulesFor,
  renderReport,
  REPORT_PATH,
  SCHEMA_PATH,
} from './openacr.js';

const committed = () =>
  existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, 'utf8') : '';

describe('the OpenACR report', () => {
  // Written on request, checked always: a change to the assessment or to
  // axe's rules reaches the committed report, or this fails.
  it('is the committed file', () => {
    if (process.env['UPDATE_OPENACR'] === '1') {
      mkdirSync(dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, renderReport());
    }
    expect(committed()).toBe(renderReport());
  });

  it('validates against GSA’s OpenACR schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(
      JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as object,
    );
    expect(validate(parse(committed()))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('assesses every WCAG 2.2 A and AA criterion, and nothing else', () => {
    const listed = CHAPTERS.flatMap(criteriaOf).sort();
    expect(Object.keys(ASSESSMENT).sort()).toEqual(listed);
    expect(listed).toHaveLength(56);
  });

  it('names the axe rules the gate runs against a criterion', () => {
    expect(gateRulesFor('1.4.3')).toContain('color-contrast');
    expect(gateRulesFor('2.5.8')).toContain('target-size');
    expect(gateRulesFor('3.2.6')).toEqual([]);
  });

  it('refuses a criterion with no assessment', async () => {
    const { ASSESSMENT: table } = await import('./assessment.js');
    const saved = table['1.1.1'];
    delete (table as Record<string, unknown>)['1.1.1'];
    try {
      expect(() => buildReport()).toThrow(/1\.1\.1 has no assessment/);
    } finally {
      (table as Record<string, unknown>)['1.1.1'] = saved;
    }
  });
});
