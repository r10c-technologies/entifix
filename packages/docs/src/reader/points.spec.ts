import { pointsOf } from './points.js';

const decision = (body: string): string =>
  `## Context\n\nx\n\n## Decision\n\n${body}\n\n## Consequences\n\ny\n`;

describe('pointsOf', () => {
  it('is empty without a Decision section, or with an empty one', () => {
    expect(pointsOf('## Context\n\nx\n')).toEqual([]);
    expect(pointsOf('## Decision\n')).toEqual([]);
  });

  it('takes a point per paragraph that opens in bold', () => {
    const text = decision(
      'Plain context stays out.\n\n**Records are content.** More words.\n\n⚠️ **Never a clone**: a clone drifts. And more.',
    );

    expect(pointsOf(text)).toEqual([
      'Records are content. More words.',
      'Never a clone: a clone drifts.',
    ]);
  });

  it('takes a point per bullet, at most five', () => {
    const bullets = Array.from(
      { length: 7 },
      (_, index) => `- **One two three four ${index}**`,
    ).join('\n');

    const points = pointsOf(decision(bullets));

    expect(points).toHaveLength(5);
    expect(points[0]).toBe('One two three four 0.');
  });

  it('takes a bullet that is not bold as its first sentence', () => {
    const points = pointsOf(
      decision('- First [link](x.md) sentence. Second.\n- Another one.'),
    );

    expect(points).toEqual(['First link sentence.', 'Another one.']);
  });

  it('skips code, tables, quotes and headings', () => {
    const text = decision(
      '```\n**not a point**\n```\n\n| a | b |\n\n> quote\n\n### Sub\n\n**One.** x\n\n**Two.** y',
    );

    expect(pointsOf(text)).toEqual(['One. x.', 'Two. y.']);
  });

  it('joins a short name to the sentence after it', () => {
    expect(
      pointsOf(decision('**Short name**, the rest.\n\n**Other** thing here.')),
    ).toEqual(['Short name, the rest.', 'Other thing here.']);
  });

  it('keeps a bare bold lead', () => {
    expect(pointsOf(decision('**Lead only**\n\n**Second** word'))).toEqual([
      'Lead only.',
      'Second word.',
    ]);
  });

  it('falls back to the first two sentences of the first plain paragraph', () => {
    const text = decision('One. Two. Three.\n\n**Only point.** x');

    expect(pointsOf(text)).toEqual(['One. Two.']);
  });

  it('is empty when nothing in the section is a paragraph', () => {
    expect(pointsOf(decision('- **Only one bullet here today**'))).toEqual([]);
  });

  it('clips a long point at a word', () => {
    const long = `${'word '.repeat(60)}end.`;

    const [point] = pointsOf(decision(`**Lead** ${long}\n\n**Two** x`));

    expect(point?.length).toBeLessThanOrEqual(161);
    expect(point?.endsWith('…')).toBe(true);
  });

  it('clips a long fallback paragraph', () => {
    const long = `${'word '.repeat(80)}end.`;

    const [point] = pointsOf(decision(long));

    expect(point?.endsWith('…')).toBe(true);
  });
});
