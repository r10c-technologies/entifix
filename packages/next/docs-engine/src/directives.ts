/**
 * The directives a page may use, resolved at build time.
 *
 *   :<kind>[id]                   a citation of an id the host registered
 *   :::note / :::tip / :::warning a callout
 *
 * Any other directive, and any id its kind does not hold, stops the build with
 * the file and the line: a typo is caught where it was made, not found later as
 * text on the page. A bare text directive glued to the word before it is prose
 * — a ratio, a time or a tag, `1:N`, `10:30`, `layer:base` — and is written
 * back as the text it was.
 *
 * Graduated from myself-app's post directives (entifix ADR 0031 §5).
 */
import type { Root, Text } from 'mdast';
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from 'mdast-util-directive';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

import { DocsContentError } from './errors.js';
import type { ReferenceRegistry } from './references.js';

export const CALLOUTS = ['note', 'tip', 'warning'] as const;

type Directive = ContainerDirective | LeafDirective | TextDirective;

export interface DirectiveOptions {
  /** The page's file, for the error. */
  readonly file: string;
  readonly references: ReferenceRegistry;
}

/**
 * A citation's id, as written. An id with colons — `order:product-order:cancel`,
 * a use case's shape — is parsed by remark-directive as text with nested text
 * directives (`order` then `:product-order` then `:cancel`), so each one nested
 * is read back as the colon and the name it was.
 */
const textOf = (node: { readonly children: readonly unknown[] }): string =>
  (node.children as readonly (Directive | { type: string; value?: string })[])
    .map(child => {
      if (child.type === 'textDirective') {
        const nested = child as TextDirective;
        const inner = textOf(nested);
        return `:${nested.name}${inner === '' ? '' : `[${inner}]`}`;
      }
      return 'value' in child && child.value !== undefined
        ? String(child.value)
        : '';
    })
    .join('')
    .trim();

const fail = (file: string, node: Directive, detail: string): never => {
  throw new DocsContentError(file, detail, node.position?.start.line);
};

const cite = (
  node: TextDirective,
  { file, references }: DirectiveOptions,
): void => {
  const kind = references[node.name];
  if (kind === undefined) {
    fail(file, node, `holds an unknown directive ":${node.name}"`);
    return;
  }
  const id = textOf(node);
  if (!kind.ids.has(id)) {
    fail(file, node, `cites an unknown ${node.name} "${id}"`);
    return;
  }
  const label: Text = { type: 'text', value: kind.label?.(id) ?? id };
  node.data = {
    hName: 'a',
    hProperties: {
      href: kind.href(id),
      className: ['docs-citation'],
      dataCitation: node.name,
    },
  };
  node.children = [label];
};

export const remarkDocsDirectives: Plugin<[DirectiveOptions], Root> =
  options => tree => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'textDirective' && parent && index !== undefined) {
        const before = parent.children[index - 1];
        const glued = before?.type === 'text' && /\S$/.test(before.value);
        const bare =
          node.children.length === 0 &&
          Object.keys({ ...node.attributes }).length === 0;
        if (glued && bare) {
          parent.children.splice(index, 1, {
            type: 'text',
            value: `:${node.name}`,
          });
          return;
        }
        cite(node, options);
        return;
      }
      if (node.type === 'containerDirective') {
        if ((CALLOUTS as readonly string[]).includes(node.name)) {
          node.data = {
            hName: 'aside',
            hProperties: {
              role: 'note',
              className: ['docs-callout', `docs-callout-${node.name}`],
            },
          };
          return;
        }
        fail(
          options.file,
          node,
          `holds an unknown directive ":::${node.name}"`,
        );
      }
      if (node.type === 'leafDirective') {
        fail(options.file, node, `holds an unknown directive "::${node.name}"`);
      }
    });
  };
