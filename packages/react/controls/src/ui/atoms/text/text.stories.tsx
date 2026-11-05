import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Blockquote,
  Caption,
  Code,
  Em,
  HeadingOne,
  HeadingThree,
  HeadingTwo,
  Kbd,
  Lead,
  Link,
  List,
  ListItem,
  Overline,
  Small,
  Strong,
  Text,
} from './text.js';

const meta: Meta = {
  title: 'Atoms/Text',
  component: Text,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

/** The type scale and every inline element, in reading order. */
export const Typography: Story = {
  render: () => (
    <article className="max-w-prose flex flex-col gap-s">
      <Overline>Catalogue</Overline>
      <HeadingOne>Products</HeadingOne>
      <Lead>Everything the shop sells, with its stock and its price.</Lead>
      <HeadingTwo>Adding a product</HeadingTwo>
      <Text>
        Press <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> and choose{' '}
        <Strong>New product</Strong>. The form saves a <Em>draft</Em> as you
        type, under the key <Code>product:new</Code>. See{' '}
        <Link href="#guide">the guide</Link>.
      </Text>
      <HeadingThree>Before you publish</HeadingThree>
      <List>
        <ListItem>Give it a name and a price.</ListItem>
        <ListItem>Attach at least one image.</ListItem>
      </List>
      <Blockquote>A product without stock is shown as unavailable.</Blockquote>
      <Small>Prices include tax.</Small>
      <Caption>Last updated today.</Caption>
      <Text muted>Muted text for secondary detail.</Text>
    </article>
  ),
};
