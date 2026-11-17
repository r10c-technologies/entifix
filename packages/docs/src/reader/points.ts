/**
 * A record's decision in a few lines.
 *
 * Read from the `## Decision` section: a point per paragraph that opens in
 * bold and per top-level bullet, at most five, when there are two or more;
 * otherwise the first two sentences of the first plain paragraph. A paragraph
 * that opens in plain text is context, not a point.
 */

/** Markdown as plain text: a link's words, without its target. */
const plainText = (markdown: string): string =>
  markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The first `count` sentences of a text. */
const sentences = (text: string, count: number): string =>
  text
    .split(/(?<=[.!?]) (?=[A-Z`§])/)
    .slice(0, count)
    .join(' ');

/** A text cut at a word to `limit` characters, marked when it is. */
const clipped = (text: string, limit: number): string =>
  text.length <= limit
    ? text
    : `${text.slice(0, text.lastIndexOf(' ', limit - 1))}…`;

/** A warning's sign, which leads some bullets: `⚠️ **Never …**`. */
const WARNING = /^⚠️\s*/u;

/**
 * One bullet or paragraph as a point: its bold lead, with the sentence after
 * it when the lead alone is only a name (`Tailwind v4, CSS-first`), else its
 * first sentence.
 */
const pointOf = (block: string): string => {
  const text = block.replace(WARNING, '');
  const lead = /^\*\*(.+?)\*\*/.exec(text)?.[1];
  if (lead === undefined) return clipped(sentences(plainText(text), 1), 160);
  const rest = plainText(text.slice(lead.length + 4));
  const name = plainText(lead);
  if (name.split(' ').length >= 4 || rest === '') return name;
  // `**Routes carry the locale**: …` reads on without a space.
  const joint = /^[,:;.]/.test(rest) ? '' : ' ';
  return clipped(`${name}${joint}${sentences(rest, 1)}`, 160);
};

export const pointsOf = (markdown: string): string[] => {
  const section = /^## Decision\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
    markdown,
  )?.[1];
  if (section === undefined) return [];

  const blocks = section
    .replace(/^```[\s\S]*?^```/gm, '')
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(block => block !== '' && !/^(#|\||>)/.test(block));

  const points = blocks.flatMap(block => {
    if (block.startsWith('- ')) {
      return block
        .split(/^- /m)
        .filter(Boolean)
        .map(bullet => pointOf(bullet.trim()));
    }
    return block.replace(WARNING, '').startsWith('**') ? [pointOf(block)] : [];
  });

  // Each a sentence, as a lead written as a heading is not.
  const ended = points.map(point =>
    /[.!?…:]$/.test(point) ? point : `${point}.`,
  );
  if (ended.length >= 2) return ended.slice(0, 5);

  const first = blocks.find(block => !block.startsWith('- '));
  return first === undefined
    ? []
    : [clipped(sentences(plainText(first), 2), 280)];
};
