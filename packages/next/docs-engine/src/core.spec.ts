import { DocsContentError } from './errors.js';
import { rewriteLinks } from './links.js';
import { checkMarkdown } from './markdown.js';
import { referenceKind } from './references.js';

const references = {
  'use-case': referenceKind(
    ['order:cancel'],
    id => `/use-cases/${id}/`,
    id => `Use case ${id}`,
  ),
  record: referenceKind(['0031'], id => `/records/${id}/`),
};

const check = (markdown: string) =>
  checkMarkdown(markdown, 'guide.md', references);

describe('the directives', () => {
  it('accepts a citation of a registered id, a callout and prose colons', () => {
    expect(() =>
      check(
        'See :use-case[order:cancel] and :record[0031].\n\nAt 10:30, 1:N, layer:base.\n\n:::note\nMind it.\n:::\n\n:::tip\nT\n:::\n\n:::warning\nW\n:::\n',
      ),
    ).not.toThrow();
  });

  it('refuses an unknown kind with the file and the line', () => {
    expect(() => check('One.\n\nTwo :widget[x].')).toThrow(
      'guide.md:3: holds an unknown directive ":widget"',
    );
  });

  it('refuses an id its kind does not hold', () => {
    expect(() => check(':use-case[order:refund]')).toThrow(
      new DocsContentError(
        'guide.md',
        'cites an unknown use-case "order:refund"',
        1,
      ),
    );
  });

  it('refuses an unknown container and leaf directive', () => {
    expect(() => check(':::aside\nx\n:::')).toThrow(
      'holds an unknown directive ":::aside"',
    );
    expect(() => check('::figure[c]{src=x}')).toThrow(
      'holds an unknown directive "::figure"',
    );
  });

  it('reads an id with colons, as a use case is written, back whole', () => {
    expect(() => check(':use-case[order:cancel]')).not.toThrow();
    expect(() => check(':use-case[order:cancel[x]]')).toThrow(
      'cites an unknown use-case "order:cancel[x]"',
    );
  });

  it('reads a citation whose label is not plain text as empty', () => {
    expect(() => check(':record[**0031**]')).toThrow(
      'cites an unknown record ""',
    );
  });
});

describe('DocsContentError', () => {
  it('names the file, and the line when it has one', () => {
    expect(new DocsContentError('a.md', 'is wrong').message).toBe(
      'a.md: is wrong',
    );
    expect(new DocsContentError('a.md', 'is wrong', 4).message).toBe(
      'a.md:4: is wrong',
    );
  });
});

describe('referenceKind', () => {
  it('leaves the label out when none is given', () => {
    expect(references.record.label).toBeUndefined();
    expect(references['use-case'].label?.('x')).toBe('Use case x');
  });
});

describe('rewriteLinks', () => {
  const targets = {
    record: (id: string, anchor: string | undefined) =>
      `/records/${id}/${anchor ? `#${anchor}` : ''}`,
    file: (path: string, anchor: string | undefined) =>
      `https://x/${path}${anchor ? `#${anchor}` : ''}`,
  };

  it('points a sibling record at its page and any other file at the repository', () => {
    expect(
      rewriteLinks(
        '[a](0001-one.md) [b](0002-two.md#why) [c](../README.md) [d](tools/x.ts#L1)',
        targets,
      ),
    ).toBe(
      '[a](/records/0001/) [b](/records/0002/#why) [c](https://x/../README.md) [d](https://x/tools/x.ts#L1)',
    );
  });

  it('leaves absolute, root-relative and in-page links alone', () => {
    const text = '[a](https://e.com) [b](/x) [c](#y) [d](mailto:a@b)';
    expect(rewriteLinks(text, targets)).toBe(text);
  });
});
